import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { newId } from '../../common/persistence/identifiers.js';
import { nowIso } from '../../common/persistence/timestamps.js';
import { DatabaseService } from '../../database/database.service.js';
import { AdapterFactoryService } from '../../model-adapters/adapter-factory/adapter-factory.service.js';
import type { ModelAdapter } from '../../model-adapters/model-adapter.interface.js';
import {
  ModelAdapterError,
  RequestAbortedError,
  normalizeProviderError,
  redactSecrets,
  sanitizeErrorCause,
  toStreamErrorPayload,
} from '../../model-adapters/errors/index.js';
import type {
  AdapterMessage,
  CompletionRequest,
  CompletionResponse,
  TokenUsage,
} from '../../model-adapters/types/index.js';
import { CredentialsService } from '../providers/credentials/credentials.service.js';
import type {
  ProviderKind,
  ProviderRow,
} from '../providers/dto/provider.dto.js';
import type { ModelRow } from '../providers/models/dto/model.dto.js';
import type { AgentRow } from '../agents/dto/agent.mapper.js';
import type { ChatRow } from '../chats/dto/chat.mapper.js';
import type { TeamRow } from '../teams/dto/team.mapper.js';
import type { MessageRow } from '../chats/messages/dto/index.js';
import type {
  CompactChatDto,
  CompactChatResponseDto,
  CompletionResponseDto,
  CreateCompletionDto,
  SseCompletionEvent,
} from '../chats/completions/dto/index.js';
import {
  COMPACTION_SYSTEM_PROMPT,
  buildCompactionUserPrompt,
} from './compaction-prompts.js';
import { ContextConstructionService } from './context-construction.service.js';
import type {
  AssembledContext,
  ContextBuildingOptions,
} from './context-construction.types.js';

/**
 * Options for executing a chat completion.
 */
export interface CompleteChatOptions {
  /**
   * Cancellation signal propagated from the client request (e.g. `req.signal`).
   * When aborted, cancels the in-flight provider request immediately.
   */
  readonly signal?: AbortSignal;
}

/**
 * Orchestrates non-streaming model execution for chat completions.
 *
 * Responsibilities:
 * 1. Resolves the execution chain: Chat → Owning Agent → Model → Provider → Credential.
 * 2. Assembles request context from message history, system prompt, agent instructions,
 *    and chat context summary.
 * 3. Applies override precedence: Request Body > Agent Configuration > Model Defaults.
 * 4. Invokes the provider model via {@link AdapterFactoryService} and {@link ModelAdapter}.
 * 5. Persists the generated assistant reply with atomic sequence assignment.
 * 6. Advances the chat's `updated_at` timestamp and records token metrics in `usage_events`.
 *
 * ## Architectural Design Decisions:
 * - **Unrunnable Configurations (422 Unprocessable Entity)**:
 *   Missing links in the execution chain (unassigned agent, agent missing model, disabled
 *   model/provider, or unconfigured credentials for hosted providers) represent semantic
 *   configuration problems. Each yields a distinct, actionable error code and message.
 * - **Team-Owned Chats**:
 *   Multi-agent team chats require turn-taking orchestration and are not yet supported for
 *   direct completion; rejected cleanly with `TEAM_CHAT_NOT_SUPPORTED`.
 * - **Provider Success vs. Persistence Failure**:
 *   Non-streaming execution invokes the model before persisting the message. If the provider
 *   succeeds but the subsequent SQLite write fails (e.g. disk full or database lock), the
 *   incident is logged at `ERROR` level with token metrics (never credentials!) and a 500
 *   `PERSISTENCE_FAILED` exception is raised. In non-streaming mode, this avoids writing
 *   dangling `pending` messages if the node process crashes during long local model calls.
 * - **Security and Credential Boundaries**:
 *   Decrypted API keys are held in memory solely for the duration of the provider call.
 *   They are never logged, attached to exceptions, or returned to clients.
 */
@Injectable()
export class InferenceService {
  private readonly logger = new Logger(InferenceService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly adapterFactory: AdapterFactoryService,
    private readonly credentialsService: CredentialsService,
    private readonly contextConstructionService: ContextConstructionService = new ContextConstructionService(
      db,
    ),
  ) {}

  /**
   * Executes a non-streaming completion for a chat.
   *
   * @param chatId - Identifier of the chat to run.
   * @param dto - Optional overrides for model, temperature, and maxTokens.
   * @param options - Execution options including cancellation signal.
   * @returns Persisted assistant message and token usage.
   *
   * @throws NotFoundException (404) if the chat does not exist.
   * @throws UnprocessableEntityException (422) if the chat configuration is unrunnable.
   * @throws ModelAdapterError (mapped to 400/413/422/429/499/502/503/504) on provider failure.
   * @throws InternalServerErrorException (500) if message persistence fails after provider success.
   */
  async completeChat(
    chatId: string,
    dto?: CreateCompletionDto,
    options?: CompleteChatOptions,
  ): Promise<CompletionResponseDto> {
    const chat = this.db.get<ChatRow>('SELECT * FROM chats WHERE id = ?', [
      chatId,
    ]);
    if (!chat) {
      throw new NotFoundException({
        code: 'CHAT_NOT_FOUND',
        message: `Chat with ID "${chatId}" not found`,
      });
    }

    if (chat.team_id !== null) {
      return this.completeTeamChat(chat, dto, options);
    }

    // -----------------------------------------------------------------------
    // 1. Resolve execution chain & validate runnability
    // -----------------------------------------------------------------------
    const { agent, model, provider, apiKey } = this.resolveExecutionChain(
      chatId,
      dto?.modelId,
    );

    // -----------------------------------------------------------------------
    // 2. Resolve parameter precedence: Request Body > Agent Config > Model Defaults
    // -----------------------------------------------------------------------
    const effectiveTemperature =
      dto?.temperature !== undefined && dto.temperature !== null
        ? dto.temperature
        : agent.temperature !== null
          ? agent.temperature
          : (model.default_temperature ?? undefined);

    const effectiveMaxTokens =
      dto?.maxTokens !== undefined && dto.maxTokens !== null
        ? dto.maxTokens
        : agent.max_tokens !== null
          ? agent.max_tokens
          : (model.default_max_tokens ?? undefined);

    let effectiveModelParams: Record<string, unknown> | undefined;
    if (agent.model_params) {
      try {
        effectiveModelParams = JSON.parse(agent.model_params);
      } catch {
        effectiveModelParams = undefined;
      }
    }

    // -----------------------------------------------------------------------
    // 3. Assemble prompt context (delegated to ContextConstructionService)
    // -----------------------------------------------------------------------
    const { systemPrompt, messages } = this.buildContext(chat, agent, model);

    const completionRequest: CompletionRequest = {
      model: model.model_identifier,
      systemPrompt,
      messages,
      temperature: effectiveTemperature,
      maxTokens: effectiveMaxTokens,
      modelParams: effectiveModelParams,
    };

    // -----------------------------------------------------------------------
    // 4. Resolve adapter and call complete()
    // -----------------------------------------------------------------------
    const adapter: ModelAdapter = this.adapterFactory.create({
      providerId: provider.id,
      providerKind: provider.kind as ProviderKind,
      baseUrl: provider.base_url,
      apiKey,
      modelIdentifier: model.model_identifier,
    });

    let completionResponse: CompletionResponse;
    try {
      completionResponse = await adapter.complete(completionRequest, {
        signal: options?.signal,
      });
    } catch (error: unknown) {
      // Re-throw ModelAdapterError directly, ensuring any decrypted API key is redacted
      if (error instanceof ModelAdapterError) {
        if (apiKey) {
          error.message = redactSecrets(error.message, [apiKey]);
          if (error.cause) {
            (error as { cause: unknown }).cause = sanitizeErrorCause(
              error.cause,
              [apiKey],
            );
          }
        }
        throw error;
      }

      // Normalise unexpected errors, redacting any API key present in cause/message
      throw normalizeProviderError({
        providerKind: provider.kind,
        model: model.model_identifier,
        cause: error,
        knownSecrets: apiKey ? [apiKey] : undefined,
      });
    }

    // -----------------------------------------------------------------------
    // 5. Persist assistant reply with atomic sequence assignment
    // -----------------------------------------------------------------------
    return this.persistAssistantReply(
      chat,
      agent,
      provider,
      model,
      completionResponse,
    );
  }

  /**
   * Executes a streaming chat completion, yielding progressive Server-Sent Events.
   *
   * Responsibilities:
   * 1. Resolves execution chain (Chat → Agent → Model → Provider → Credential).
   *    Fails synchronously with standard 404/422 HTTP exceptions before sending SSE headers.
   * 2. Atomically allocates the next sequence number and creates a message row with status='pending'.
   * 3. Yields `message_start` event with message and sequence details.
   * 4. Invokes `adapter.stream()`, transitioning to status='streaming' upon receiving first content chunk.
   * 5. Periodically checkpoints partial content to SQLite (every 500ms or 200 characters).
   * 6. On normal completion: updates row to status='complete', writes full content and token count,
   *    records `usage_events`, emits `usage`, `message_complete`, and `done`.
   * 7. On mid-stream failure: updates row to status='error' (preserving partial content), emits in-band
   *    `error` event with wire-safe payload and `done`.
   * 8. On client disconnect (signal.aborted): aborts upstream adapter, and finalizes the row:
   *    retains partial content with status='complete' if content was received, or status='error' if not.
   *
   * @param chatId - Identifier of the chat to run.
   * @param dto - Optional overrides for model, temperature, maxTokens, and stream.
   * @param options - Execution options including cancellation signal.
   * @returns Async generator yielding structured {@link SseCompletionEvent}s.
   */
  async *streamChat(
    chatId: string,
    dto?: CreateCompletionDto,
    options?: CompleteChatOptions,
  ): AsyncGenerator<SseCompletionEvent, void, unknown> {
    const chat = this.db.get<ChatRow>('SELECT * FROM chats WHERE id = ?', [
      chatId,
    ]);
    if (!chat) {
      throw new NotFoundException({
        code: 'CHAT_NOT_FOUND',
        message: `Chat with ID "${chatId}" not found`,
      });
    }

    if (chat.team_id !== null) {
      yield* this.streamTeamChat(chat, dto, options);
      return;
    }

    // -----------------------------------------------------------------------
    // 1. Resolve execution chain & validate runnability
    // -----------------------------------------------------------------------
    const { agent, model, provider, apiKey } = this.resolveExecutionChain(
      chatId,
      dto?.modelId,
    );

    // Fail immediately if pre-aborted before execution began
    if (options?.signal?.aborted) {
      throw new RequestAbortedError(
        'Request was aborted before execution',
        provider.kind,
      );
    }

    const adapter: ModelAdapter = this.adapterFactory.create({
      providerId: provider.id,
      providerKind: provider.kind as ProviderKind,
      baseUrl: provider.base_url,
      apiKey,
      modelIdentifier: model.model_identifier,
    });

    if (!adapter.capabilities.supportsStreaming) {
      throw new UnprocessableEntityException({
        code: 'STREAMING_NOT_SUPPORTED',
        message: `Model "${model.display_name}" does not support streaming completions`,
      });
    }

    // -----------------------------------------------------------------------
    // 2. Resolve parameter precedence
    // -----------------------------------------------------------------------
    const effectiveTemperature =
      dto?.temperature !== undefined && dto.temperature !== null
        ? dto.temperature
        : agent.temperature !== null
          ? agent.temperature
          : (model.default_temperature ?? undefined);

    const effectiveMaxTokens =
      dto?.maxTokens !== undefined && dto.maxTokens !== null
        ? dto.maxTokens
        : agent.max_tokens !== null
          ? agent.max_tokens
          : (model.default_max_tokens ?? undefined);

    let effectiveModelParams: Record<string, unknown> | undefined;
    if (agent.model_params) {
      try {
        effectiveModelParams = JSON.parse(agent.model_params);
      } catch {
        effectiveModelParams = undefined;
      }
    }

    // -----------------------------------------------------------------------
    // 3. Assemble prompt context (delegated to ContextConstructionService)
    // -----------------------------------------------------------------------
    const { systemPrompt, messages } = this.buildContext(chat, agent, model);

    const completionRequest: CompletionRequest = {
      model: model.model_identifier,
      systemPrompt,
      messages,
      temperature: effectiveTemperature,
      maxTokens: effectiveMaxTokens,
      modelParams: effectiveModelParams,
    };

    // -----------------------------------------------------------------------
    // 4. Atomically allocate sequence and insert pending row in SQLite
    // -----------------------------------------------------------------------
    const pendingRow = this.createPendingMessageRow(chat.id, agent.id);

    // -----------------------------------------------------------------------
    // 5. Emit message_start event
    // -----------------------------------------------------------------------
    yield {
      type: 'message_start',
      data: {
        messageId: pendingRow.id,
        chatId: chat.id,
        sequence: pendingRow.sequence,
        agentId: agent.id,
        agentName: agent.name,
        role: 'assistant',
      },
    };

    // -----------------------------------------------------------------------
    // 6. State tracking and checkpoint helper
    // -----------------------------------------------------------------------
    let accumulatedContent = '';
    let lastFlushedContent = '';
    let lastFlushTime = Date.now();
    let currentStatus: 'pending' | 'streaming' | 'complete' | 'error' =
      'pending';
    let reportedUsage: TokenUsage | undefined;

    const flushPartial = (
      newStatus: 'streaming' | 'complete' | 'error',
      finalOutputTokens?: number | null,
    ) => {
      const now = nowIso();
      this.db.run(
        `UPDATE messages
         SET status = ?,
             content = ?,
             token_count = ?
         WHERE id = ?`,
        [
          newStatus,
          accumulatedContent,
          finalOutputTokens !== undefined
            ? finalOutputTokens
            : (reportedUsage?.outputTokens ?? null),
          pendingRow!.id,
        ],
      );
      this.db.run('UPDATE chats SET updated_at = ? WHERE id = ?', [
        now,
        chat.id,
      ]);
      lastFlushedContent = accumulatedContent;
      lastFlushTime = Date.now();
      currentStatus = newStatus;
    };

    // -----------------------------------------------------------------------
    // 7. Execute streaming generator
    // -----------------------------------------------------------------------
    try {
      const stream = adapter.stream(completionRequest, {
        signal: options?.signal,
      });

      for await (const event of stream) {
        if (options?.signal?.aborted) {
          break;
        }

        switch (event.type) {
          case 'text-delta': {
            accumulatedContent += event.delta;

            if (currentStatus === 'pending') {
              flushPartial('streaming');
            } else {
              const charsSinceFlush =
                accumulatedContent.length - lastFlushedContent.length;
              const timeSinceFlush = Date.now() - lastFlushTime;
              if (charsSinceFlush >= 200 || timeSinceFlush >= 500) {
                flushPartial('streaming');
              }
            }

            yield {
              type: 'token',
              data: {
                messageId: pendingRow.id,
                text: event.delta,
              },
            };
            break;
          }

          case 'thought-delta': {
            yield {
              type: 'thought',
              data: {
                messageId: pendingRow.id,
                thought: event.delta,
              },
            };
            break;
          }

          case 'usage': {
            reportedUsage = event.usage;
            break;
          }

          case 'complete': {
            if (event.usage) {
              reportedUsage = event.usage;
            }
            break;
          }

          case 'error': {
            throw event.error;
          }
        }
      }

      // Check if client aborted while stream was ending
      if (options?.signal?.aborted) {
        if (accumulatedContent.length > 0) {
          flushPartial('complete', reportedUsage?.outputTokens ?? null);
        } else {
          accumulatedContent = 'Generation interrupted';
          flushPartial('error', null);
        }
        return;
      }

      // Normal completion
      flushPartial('complete', reportedUsage?.outputTokens ?? null);

      // Record usage event
      const finalInputTokens = reportedUsage?.inputTokens ?? null;
      const finalOutputTokens = reportedUsage?.outputTokens ?? null;

      this.db.run(
        `INSERT INTO usage_events (
          id, occurred_at, event_type, agent_id, provider_id, model_id, chat_id,
          input_tokens, output_tokens, cost_usd, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          newId(),
          nowIso(),
          'chat_completion',
          agent.id,
          provider.id,
          model.id,
          chat.id,
          finalInputTokens,
          finalOutputTokens,
          null,
          null,
        ],
      );

      // Emit terminal usage event
      if (reportedUsage) {
        yield {
          type: 'usage',
          data: {
            inputTokens: reportedUsage.inputTokens,
            outputTokens: reportedUsage.outputTokens,
            totalTokens: reportedUsage.totalTokens,
            ...(reportedUsage.reasoningTokens !== undefined
              ? { reasoningTokens: reportedUsage.reasoningTokens }
              : {}),
          },
        };
      }

      // Emit message_complete event
      yield {
        type: 'message_complete',
        data: {
          messageId: pendingRow.id,
          status: 'complete',
          tokenCount: reportedUsage?.outputTokens ?? null,
          usage: reportedUsage
            ? {
                inputTokens: reportedUsage.inputTokens,
                outputTokens: reportedUsage.outputTokens,
                totalTokens: reportedUsage.totalTokens,
                reasoningTokens: reportedUsage.reasoningTokens,
              }
            : null,
        },
      };

      // Emit done event
      yield {
        type: 'done',
        data: '[DONE]',
      };
    } catch (error: unknown) {
      const isAborted =
        options?.signal?.aborted ||
        (error instanceof ModelAdapterError &&
          error.code === 'REQUEST_ABORTED') ||
        (error instanceof Error &&
          (error.name === 'AbortError' ||
            error.message.toLowerCase().includes('abort')));

      if (isAborted) {
        if (accumulatedContent.length > 0) {
          flushPartial('complete', reportedUsage?.outputTokens ?? null);
        } else {
          accumulatedContent = 'Generation interrupted';
          flushPartial('error', null);
        }
        return;
      }

      let normalizedError: unknown = error;
      if (apiKey) {
        if (normalizedError instanceof ModelAdapterError) {
          normalizedError.message = redactSecrets(normalizedError.message, [
            apiKey,
          ]);
          if (normalizedError.cause) {
            (normalizedError as { cause: unknown }).cause = sanitizeErrorCause(
              normalizedError.cause,
              [apiKey],
            );
          }
        } else {
          normalizedError = normalizeProviderError({
            providerKind: provider.kind,
            model: model.model_identifier,
            cause: error,
            knownSecrets: [apiKey],
          });
        }
      } else if (!(normalizedError instanceof ModelAdapterError)) {
        normalizedError = normalizeProviderError({
          providerKind: provider.kind,
          model: model.model_identifier,
          cause: error,
        });
      }

      flushPartial('error', reportedUsage?.outputTokens ?? null);

      yield {
        type: 'error',
        data: toStreamErrorPayload(normalizedError),
      };

      yield {
        type: 'done',
        data: '[DONE]',
      };
    }
  }

  /**
   * Retrieves active team members in deterministic execution order.
   *
   * Ordered per RFC 67:
   * 1. Position ascending (NULLS LAST)
   * 2. Membership creation timestamp ascending
   * 3. Agent ID ascending
   */
  private getActiveTeamMembers(teamId: string): Array<{
    agent_id: string;
    role: string | null;
    position: number | null;
    agent_name: string;
    is_coordinator: number;
  }> {
    return this.db.all(
      `SELECT
         tm.agent_id,
         tm.role,
         tm.position,
         a.name AS agent_name,
         COALESCE(tm.is_coordinator, 0) AS is_coordinator
       FROM team_members tm
       JOIN agents a ON a.id = tm.agent_id
       WHERE tm.team_id = ?
       ORDER BY
         tm.position ASC NULLS LAST,
         tm.created_at ASC,
         tm.agent_id ASC`,
      [teamId],
    );
  }

  /**
   * Resolves model, provider, and decrypted API key for an agent.
   */
  private resolveAgentExecution(
    agent: AgentRow,
    overrideModelId?: string,
  ): {
    model: ModelRow;
    provider: ProviderRow;
    apiKey?: string;
  } {
    // 1. Model resolution & existence check (422)
    const effectiveModelId = overrideModelId ?? agent.model_id;
    if (!effectiveModelId) {
      throw new UnprocessableEntityException({
        code: 'AGENT_HAS_NO_MODEL',
        message: `Agent "${agent.name}" has no model configured`,
      });
    }

    const model = this.db.get<ModelRow>('SELECT * FROM models WHERE id = ?', [
      effectiveModelId,
    ]);
    if (!model) {
      throw new UnprocessableEntityException({
        code: 'MODEL_NOT_FOUND',
        message: `Model with ID "${effectiveModelId}" was not found`,
      });
    }

    if (model.enabled === 0) {
      throw new UnprocessableEntityException({
        code: 'MODEL_DISABLED',
        message: `Model "${model.display_name}" is disabled`,
      });
    }

    // 2. Provider existence & enabled check (422)
    const provider = this.db.get<ProviderRow>(
      'SELECT * FROM providers WHERE id = ?',
      [model.provider_id],
    );
    if (!provider) {
      throw new UnprocessableEntityException({
        code: 'PROVIDER_NOT_FOUND',
        message: `Provider with ID "${model.provider_id}" was not found`,
      });
    }

    if (provider.enabled === 0) {
      throw new UnprocessableEntityException({
        code: 'PROVIDER_DISABLED',
        message: `Provider "${provider.name}" is disabled`,
      });
    }

    // 3. Credential check (422)
    const isLocal =
      provider.is_local === 1 ||
      provider.kind === 'ollama' ||
      provider.kind === 'lmstudio';

    let apiKey: string | undefined;
    try {
      apiKey = this.credentialsService.getDecryptedCredential(provider.id);
    } catch (error) {
      if (error instanceof NotFoundException) {
        apiKey = undefined;
      } else {
        throw error;
      }
    }

    if (!isLocal && (!apiKey || apiKey.trim() === '')) {
      throw new UnprocessableEntityException({
        code: 'CREDENTIAL_MISSING',
        message: `Provider "${provider.name}" requires an API credential that is not configured`,
      });
    }

    return { model, provider, apiKey };
  }

  /**
   * Atomically allocates sequence and inserts a pending message row in SQLite.
   */
  private createPendingMessageRow(chatId: string, agentId: string): MessageRow {
    const maxRetries = 3;
    let attempts = 0;
    const messageId = newId();
    const createdAt = nowIso();

    while (attempts < maxRetries) {
      attempts++;
      try {
        const pendingRow = this.db.transaction(() => {
          const insertSql = `
            INSERT INTO messages (
              id,
              chat_id,
              sequence,
              role,
              agent_id,
              content,
              status,
              token_count,
              created_at
            ) VALUES (
              ?,
              ?,
              (SELECT COALESCE(MAX(sequence), 0) + 1 FROM messages WHERE chat_id = ?),
              'assistant',
              ?,
              '',
              'pending',
              NULL,
              ?
            )
            RETURNING *
          `;
          const row = this.db.get<MessageRow>(insertSql, [
            messageId,
            chatId,
            chatId,
            agentId,
            createdAt,
          ]);

          this.db.run('UPDATE chats SET updated_at = ? WHERE id = ?', [
            createdAt,
            chatId,
          ]);

          return row ?? null;
        });

        if (pendingRow) {
          return pendingRow;
        }
      } catch (error: any) {
        const isUniqueConstraint =
          error?.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
          (typeof error?.message === 'string' &&
            error.message.includes(
              'UNIQUE constraint failed: messages.chat_id, messages.sequence',
            ));

        if (isUniqueConstraint && attempts < maxRetries) {
          continue;
        }

        this.logger.error(
          `Failed to allocate sequence for streaming message in chat "${chatId}": ${error?.message}`,
        );
        throw new InternalServerErrorException({
          code: 'SEQUENCE_ALLOCATION_FAILED',
          message: 'Failed to allocate sequence for chat message',
        });
      }
    }

    throw new InternalServerErrorException({
      code: 'SEQUENCE_ALLOCATION_FAILED',
      message: 'Failed to allocate sequence for chat message',
    });
  }

  /**
   * Pre-validates that all active team members exist and their execution chains are runnable.
   * For streaming, also verifies that all member models support streaming.
   */
  private preValidateTeamMembers(
    members: Array<{ agent_id: string }>,
    modelIdOverride?: string,
    requireStreaming: boolean = false,
  ): void {
    for (const member of members) {
      const agent = this.db.get<AgentRow>('SELECT * FROM agents WHERE id = ?', [
        member.agent_id,
      ]);
      if (!agent) {
        throw new UnprocessableEntityException({
          code: 'AGENT_NOT_FOUND',
          message: `Agent with ID "${member.agent_id}" was not found`,
        });
      }
      const { model, provider, apiKey } = this.resolveAgentExecution(
        agent,
        modelIdOverride,
      );
      if (requireStreaming) {
        const adapter: ModelAdapter = this.adapterFactory.create({
          providerId: provider.id,
          providerKind: provider.kind as ProviderKind,
          baseUrl: provider.base_url,
          apiKey,
          modelIdentifier: model.model_identifier,
        });
        if (!adapter.capabilities.supportsStreaming) {
          throw new UnprocessableEntityException({
            code: 'STREAMING_NOT_SUPPORTED',
            message: `Model "${model.display_name}" does not support streaming completions`,
          });
        }
      }
    }
  }

  /**
   * Records a failed message turn row in SQLite to preserve transcript resilience on mid-team failures.
   */
  private recordTurnErrorRow(chatId: string, agentId: string): void {
    try {
      this.db.run(
        `INSERT INTO messages (
          id, chat_id, sequence, role, agent_id, content, status, token_count, created_at
        ) VALUES (
          ?, ?, (SELECT COALESCE(MAX(sequence), 0) + 1 FROM messages WHERE chat_id = ?),
          'assistant', ?, 'Generation failed mid-team turn', 'error', NULL, ?
        )`,
        [newId(), chatId, chatId, agentId, nowIso()],
      );
    } catch {
      // Ignore failure when recording error row
    }
  }

  /**
   * Emits final aggregated usage event and done event in SSE stream.
   */
  private *emitFinalStreamUsageAndDone(totals: {
    totalInputTokens: number;
    totalOutputTokens: number;
    totalTokens: number;
    totalReasoningTokens: number;
  }): Generator<SseCompletionEvent, void, unknown> {
    if (totals.totalInputTokens > 0 || totals.totalOutputTokens > 0) {
      yield {
        type: 'usage',
        data: {
          inputTokens: totals.totalInputTokens,
          outputTokens: totals.totalOutputTokens,
          totalTokens: totals.totalTokens,
          ...(totals.totalReasoningTokens > 0
            ? { reasoningTokens: totals.totalReasoningTokens }
            : {}),
        },
      };
    }

    yield {
      type: 'done',
      data: '[DONE]',
    };
  }

  /**
   * Executes a single agent member turn in non-streaming mode.
   */
  private async executeMemberTurn(
    chat: ChatRow,
    member: {
      agent_id: string;
      role: string | null;
      position: number | null;
      agent_name: string;
      is_coordinator?: number;
    },
    dto?: CreateCompletionDto,
    options?: CompleteChatOptions,
    contextOptions?: ContextBuildingOptions,
    extraInstructions?: string,
  ): Promise<CompletionResponseDto> {
    const agent = this.db.get<AgentRow>('SELECT * FROM agents WHERE id = ?', [
      member.agent_id,
    ])!;
    const { model, provider, apiKey } = this.resolveAgentExecution(
      agent,
      dto?.modelId,
    );

    const effectiveTemperature =
      dto?.temperature !== undefined && dto.temperature !== null
        ? dto.temperature
        : agent.temperature !== null
          ? agent.temperature
          : (model.default_temperature ?? undefined);

    const effectiveMaxTokens =
      dto?.maxTokens !== undefined && dto.maxTokens !== null
        ? dto.maxTokens
        : agent.max_tokens !== null
          ? agent.max_tokens
          : (model.default_max_tokens ?? undefined);

    let effectiveModelParams: Record<string, unknown> | undefined;
    if (agent.model_params) {
      try {
        effectiveModelParams = JSON.parse(agent.model_params);
      } catch {
        effectiveModelParams = undefined;
      }
    }

    const effectiveAgent: AgentRow = extraInstructions
      ? {
          ...agent,
          instructions: agent.instructions
            ? `${agent.instructions}\n\n${extraInstructions}`
            : extraInstructions,
        }
      : agent;

    const { systemPrompt, messages } = this.buildContext(
      chat,
      effectiveAgent,
      model,
      contextOptions,
    );

    const completionRequest: CompletionRequest = {
      model: model.model_identifier,
      systemPrompt,
      messages,
      temperature: effectiveTemperature,
      maxTokens: effectiveMaxTokens,
      modelParams: effectiveModelParams,
    };

    const adapter: ModelAdapter = this.adapterFactory.create({
      providerId: provider.id,
      providerKind: provider.kind as ProviderKind,
      baseUrl: provider.base_url,
      apiKey,
      modelIdentifier: model.model_identifier,
    });

    let completionResponse: CompletionResponse;
    try {
      completionResponse = await adapter.complete(completionRequest, {
        signal: options?.signal,
      });
    } catch (error: unknown) {
      if (error instanceof ModelAdapterError) {
        if (apiKey) {
          error.message = redactSecrets(error.message, [apiKey]);
          if (error.cause) {
            (error as { cause: unknown }).cause = sanitizeErrorCause(
              error.cause,
              [apiKey],
            );
          }
        }
        throw error;
      }

      throw normalizeProviderError({
        providerKind: provider.kind,
        model: model.model_identifier,
        cause: error,
        knownSecrets: apiKey ? [apiKey] : undefined,
      });
    }

    return this.persistAssistantReply(
      chat,
      agent,
      provider,
      model,
      completionResponse,
    );
  }

  /**
   * Dispatches non-streaming completion for a multi-agent team chat (RFC 67).
   */
  private async completeTeamChat(
    chat: ChatRow,
    dto?: CreateCompletionDto,
    options?: CompleteChatOptions,
  ): Promise<CompletionResponseDto> {
    const team =
      this.db.get<TeamRow>('SELECT * FROM teams WHERE id = ?', [
        chat.team_id,
      ]) ?? undefined;

    const members = this.getActiveTeamMembers(chat.team_id!);
    if (members.length === 0) {
      throw new UnprocessableEntityException({
        code: 'TEAM_HAS_NO_MEMBERS',
        message: 'Team has no active members to execute completions',
      });
    }

    this.preValidateTeamMembers(members, dto?.modelId, false);

    const strategy = dto?.strategy ?? team?.strategy ?? 'sequential';
    const configuredMaxTurns =
      dto?.maxTurns ?? team?.max_turns_per_interaction ?? 5;
    const boundedMaxTurns = Math.min(Math.max(1, configuredMaxTurns), 10);

    switch (strategy) {
      case 'coordinator':
        return this.completeCoordinatorTeamChat(
          chat,
          team,
          members,
          boundedMaxTurns,
          dto,
          options,
        );
      case 'broadcast':
        return this.completeBroadcastTeamChat(
          chat,
          members,
          boundedMaxTurns,
          dto,
          options,
        );
      case 'autonomous':
        return this.completeAutonomousTeamChat(
          chat,
          team,
          members,
          boundedMaxTurns,
          dto,
          options,
        );
      case 'sequential':
      default:
        return this.completeSequentialTeamChat(
          chat,
          members,
          boundedMaxTurns,
          dto,
          options,
        );
    }
  }

  /**
   * Phase 1: Sequential position pipeline completion.
   */
  private async completeSequentialTeamChat(
    chat: ChatRow,
    members: Array<{
      agent_id: string;
      role: string | null;
      position: number | null;
      agent_name: string;
    }>,
    boundedMaxTurns: number,
    dto?: CreateCompletionDto,
    options?: CompleteChatOptions,
  ): Promise<CompletionResponseDto> {
    const maxTurns = Math.min(members.length, boundedMaxTurns);
    const completedMessages: CompletionResponseDto[] = [];

    for (let i = 0; i < maxTurns; i++) {
      if (options?.signal?.aborted) {
        if (completedMessages.length === 0) {
          throw new RequestAbortedError('Request was aborted', 'generic');
        }
        break;
      }

      const member = members[i];
      let reply: CompletionResponseDto;
      try {
        reply = await this.executeMemberTurn(chat, member, dto, options);
      } catch (err) {
        if (completedMessages.length > 0) {
          this.recordTurnErrorRow(chat.id, member.agent_id);
        }
        throw err;
      }

      completedMessages.push(reply);

      if (reply.content.includes('<!-- GB_TEAM_FINISH -->')) {
        break;
      }
    }

    const lastMessage = completedMessages[completedMessages.length - 1];
    return {
      ...lastMessage,
      messages: completedMessages,
    };
  }

  /**
   * Phase 2: Designated Coordinator (Router Agent) completion.
   */
  private async completeCoordinatorTeamChat(
    chat: ChatRow,
    team: TeamRow | undefined,
    members: Array<{
      agent_id: string;
      role: string | null;
      position: number | null;
      agent_name: string;
      is_coordinator: number;
    }>,
    boundedMaxTurns: number,
    dto?: CreateCompletionDto,
    options?: CompleteChatOptions,
  ): Promise<CompletionResponseDto> {
    const coordinatorMember =
      members.find((m) => m.is_coordinator === 1) ??
      members.find(
        (m) =>
          m.role?.toLowerCase().includes('coordinator') ||
          m.role?.toLowerCase().includes('router'),
      ) ??
      members[0];

    const specialists = members.filter(
      (m) => m.agent_id !== coordinatorMember.agent_id,
    );

    const specialistRoster = specialists
      .map(
        (s) =>
          `- ${s.agent_name}${s.role ? ` (Role: ${s.role})` : ''} [ID: ${s.agent_id}]`,
      )
      .join('\n');

    const coordinatorDirective =
      specialists.length > 0
        ? `You are the designated Coordinator for team "${team?.name ?? 'Team'}".
Available team specialists:
${specialistRoster}

If a specialist should handle or answer the request, output:
[DELEGATE: <Specialist Name or ID>] <instructions for the specialist>
If you can answer directly without delegation, provide your response directly.`
        : undefined;

    const completedMessages: CompletionResponseDto[] = [];

    const coordReply = await this.executeMemberTurn(
      chat,
      coordinatorMember,
      dto,
      options,
      undefined,
      coordinatorDirective,
    );
    completedMessages.push(coordReply);

    if (boundedMaxTurns >= 2 && specialists.length > 0) {
      const delegateMatch = coordReply.content.match(
        /\[DELEGATE:\s*([^\]]+)\]/i,
      );
      if (delegateMatch) {
        const targetQuery = delegateMatch[1].trim().toLowerCase();
        const specialist =
          specialists.find((s) => s.agent_id.toLowerCase() === targetQuery) ??
          specialists.find(
            (s) => s.agent_name.toLowerCase() === targetQuery,
          ) ??
          specialists.find(
            (s) =>
              s.agent_name.toLowerCase().includes(targetQuery) ||
              targetQuery.includes(s.agent_name.toLowerCase()),
          );

        if (specialist) {
          try {
            const specReply = await this.executeMemberTurn(
              chat,
              specialist,
              dto,
              options,
            );
            completedMessages.push(specReply);
          } catch (err) {
            this.recordTurnErrorRow(chat.id, specialist.agent_id);
            throw err;
          }
        }
      }
    }

    const lastMessage = completedMessages[completedMessages.length - 1];
    return {
      ...lastMessage,
      messages: completedMessages,
    };
  }

  /**
   * Phase 3: Broadcast (Parallel / Independent Context) completion.
   */
  private async completeBroadcastTeamChat(
    chat: ChatRow,
    members: Array<{
      agent_id: string;
      role: string | null;
      position: number | null;
      agent_name: string;
    }>,
    boundedMaxTurns: number,
    dto?: CreateCompletionDto,
    options?: CompleteChatOptions,
  ): Promise<CompletionResponseDto> {
    const boundaryRow = this.db.get<{ maxSeq: number }>(
      'SELECT COALESCE(MAX(sequence), 0) AS maxSeq FROM messages WHERE chat_id = ?',
      [chat.id],
    );
    const preBroadcastMaxSequence = boundaryRow?.maxSeq ?? 0;
    const contextOptions: ContextBuildingOptions = {
      maxSequence: preBroadcastMaxSequence,
    };

    const maxTurns = Math.min(members.length, boundedMaxTurns);
    const completedMessages: CompletionResponseDto[] = [];

    for (let i = 0; i < maxTurns; i++) {
      if (options?.signal?.aborted) {
        if (completedMessages.length === 0) {
          throw new RequestAbortedError('Request was aborted', 'generic');
        }
        break;
      }

      const member = members[i];
      let reply: CompletionResponseDto;
      try {
        reply = await this.executeMemberTurn(
          chat,
          member,
          dto,
          options,
          contextOptions,
        );
      } catch (err) {
        if (completedMessages.length > 0) {
          this.recordTurnErrorRow(chat.id, member.agent_id);
        }
        throw err;
      }

      completedMessages.push(reply);
    }

    const lastMessage = completedMessages[completedMessages.length - 1];
    return {
      ...lastMessage,
      messages: completedMessages,
    };
  }

  /**
   * Phase 4: Autonomous Dynamic Handoff completion.
   */
  private async completeAutonomousTeamChat(
    chat: ChatRow,
    team: TeamRow | undefined,
    members: Array<{
      agent_id: string;
      role: string | null;
      position: number | null;
      agent_name: string;
      is_coordinator: number;
    }>,
    boundedMaxTurns: number,
    dto?: CreateCompletionDto,
    options?: CompleteChatOptions,
  ): Promise<CompletionResponseDto> {
    let currentMember =
      members.find((m) => m.is_coordinator === 1) ??
      members.find(
        (m) =>
          m.role?.toLowerCase().includes('coordinator') ||
          m.role?.toLowerCase().includes('router'),
      ) ??
      members[0];

    const completedMessages: CompletionResponseDto[] = [];

    for (let turn = 0; turn < boundedMaxTurns; turn++) {
      if (options?.signal?.aborted) {
        if (completedMessages.length === 0) {
          throw new RequestAbortedError('Request was aborted', 'generic');
        }
        break;
      }

      const colleagues = members.filter(
        (m) => m.agent_id !== currentMember.agent_id,
      );
      const colleagueRoster = colleagues
        .map(
          (m) =>
            `- @${m.agent_name}${m.role ? ` (${m.role})` : ''} [ID: ${m.agent_id}]`,
        )
        .join('\n');

      const autonomousDirective =
        colleagues.length > 0
          ? `You are collaborating dynamically in an autonomous multi-agent team "${team?.name ?? 'Team'}".
Available colleagues:
${colleagueRoster}

If another colleague should continue the discussion, hand off by including:
[NEXT: @ColleagueName]
When the task is complete and no further response is needed, end with:
[DONE] or <!-- GB_TEAM_FINISH -->.`
          : undefined;

      let reply: CompletionResponseDto;
      try {
        reply = await this.executeMemberTurn(
          chat,
          currentMember,
          dto,
          options,
          undefined,
          autonomousDirective,
        );
      } catch (err) {
        if (completedMessages.length > 0) {
          this.recordTurnErrorRow(chat.id, currentMember.agent_id);
        }
        throw err;
      }

      completedMessages.push(reply);

      if (
        reply.content.includes('[DONE]') ||
        reply.content.includes('<!-- GB_TEAM_FINISH -->')
      ) {
        break;
      }

      const nextMatch = reply.content.match(/\[NEXT:\s*@?([^\]]+)\]/i);
      if (!nextMatch) {
        break;
      }

      const targetQuery = nextMatch[1].trim().toLowerCase();
      const nextMember =
        colleagues.find((c) => c.agent_id.toLowerCase() === targetQuery) ??
        colleagues.find((c) => c.agent_name.toLowerCase() === targetQuery) ??
        colleagues.find(
          (c) =>
            c.agent_name.toLowerCase().includes(targetQuery) ||
            targetQuery.includes(c.agent_name.toLowerCase()),
        );

      if (!nextMember) {
        break;
      }

      currentMember = nextMember;
    }

    const lastMessage = completedMessages[completedMessages.length - 1];
    return {
      ...lastMessage,
      messages: completedMessages,
    };
  }

  /**
   * Dispatches streaming completion for a multi-agent team chat (RFC 67).
   */
  private async *streamTeamChat(
    chat: ChatRow,
    dto?: CreateCompletionDto,
    options?: CompleteChatOptions,
  ): AsyncGenerator<SseCompletionEvent, void, unknown> {
    const team =
      this.db.get<TeamRow>('SELECT * FROM teams WHERE id = ?', [
        chat.team_id,
      ]) ?? undefined;

    const members = this.getActiveTeamMembers(chat.team_id!);
    if (members.length === 0) {
      throw new UnprocessableEntityException({
        code: 'TEAM_HAS_NO_MEMBERS',
        message: 'Team has no active members to execute completions',
      });
    }

    if (options?.signal?.aborted) {
      throw new RequestAbortedError(
        'Request was aborted before execution',
        'generic',
      );
    }

    this.preValidateTeamMembers(members, dto?.modelId, true);

    const strategy = dto?.strategy ?? team?.strategy ?? 'sequential';
    const configuredMaxTurns =
      dto?.maxTurns ?? team?.max_turns_per_interaction ?? 5;
    const boundedMaxTurns = Math.min(Math.max(1, configuredMaxTurns), 10);

    switch (strategy) {
      case 'coordinator':
        yield* this.streamCoordinatorTeamChat(
          chat,
          team,
          members,
          boundedMaxTurns,
          dto,
          options,
        );
        break;
      case 'broadcast':
        yield* this.streamBroadcastTeamChat(
          chat,
          members,
          boundedMaxTurns,
          dto,
          options,
        );
        break;
      case 'autonomous':
        yield* this.streamAutonomousTeamChat(
          chat,
          team,
          members,
          boundedMaxTurns,
          dto,
          options,
        );
        break;
      case 'sequential':
      default:
        yield* this.streamSequentialTeamChat(
          chat,
          members,
          boundedMaxTurns,
          dto,
          options,
        );
        break;
    }
  }

  /**
   * Streams a single agent member turn over SSE events.
   */
  private async *streamMemberTurn(
    chat: ChatRow,
    member: {
      agent_id: string;
      role: string | null;
      position: number | null;
      agent_name: string;
      is_coordinator?: number;
    },
    dto?: CreateCompletionDto,
    options?: CompleteChatOptions,
    contextOptions?: ContextBuildingOptions,
    extraInstructions?: string,
  ): AsyncGenerator<
    SseCompletionEvent,
    { content: string; usage?: TokenUsage; error?: unknown },
    unknown
  > {
    const agent = this.db.get<AgentRow>('SELECT * FROM agents WHERE id = ?', [
      member.agent_id,
    ])!;
    const { model, provider, apiKey } = this.resolveAgentExecution(
      agent,
      dto?.modelId,
    );

    const effectiveTemperature =
      dto?.temperature !== undefined && dto.temperature !== null
        ? dto.temperature
        : agent.temperature !== null
          ? agent.temperature
          : (model.default_temperature ?? undefined);

    const effectiveMaxTokens =
      dto?.maxTokens !== undefined && dto.maxTokens !== null
        ? dto.maxTokens
        : agent.max_tokens !== null
          ? agent.max_tokens
          : (model.default_max_tokens ?? undefined);

    let effectiveModelParams: Record<string, unknown> | undefined;
    if (agent.model_params) {
      try {
        effectiveModelParams = JSON.parse(agent.model_params);
      } catch {
        effectiveModelParams = undefined;
      }
    }

    const effectiveAgent: AgentRow = extraInstructions
      ? {
          ...agent,
          instructions: agent.instructions
            ? `${agent.instructions}\n\n${extraInstructions}`
            : extraInstructions,
        }
      : agent;

    const { systemPrompt, messages } = this.buildContext(
      chat,
      effectiveAgent,
      model,
      contextOptions,
    );

    const completionRequest: CompletionRequest = {
      model: model.model_identifier,
      systemPrompt,
      messages,
      temperature: effectiveTemperature,
      maxTokens: effectiveMaxTokens,
      modelParams: effectiveModelParams,
    };

    const pendingRow = this.createPendingMessageRow(chat.id, agent.id);

    yield {
      type: 'message_start',
      data: {
        messageId: pendingRow.id,
        chatId: chat.id,
        sequence: pendingRow.sequence,
        agentId: agent.id,
        agentName: member.role
          ? `${member.agent_name} (${member.role})`
          : member.agent_name,
        role: 'assistant',
      },
    };

    let accumulatedContent = '';
    let lastFlushedContent = '';
    let lastFlushTime = Date.now();
    let currentStatus: 'pending' | 'streaming' | 'complete' | 'error' =
      'pending';
    let reportedUsage: TokenUsage | undefined;

    const flushPartial = (
      newStatus: 'streaming' | 'complete' | 'error',
      finalOutputTokens?: number | null,
    ) => {
      const now = nowIso();
      this.db.run(
        `UPDATE messages
         SET status = ?,
             content = ?,
             token_count = ?
         WHERE id = ?`,
        [
          newStatus,
          accumulatedContent,
          finalOutputTokens !== undefined
            ? finalOutputTokens
            : (reportedUsage?.outputTokens ?? null),
          pendingRow.id,
        ],
      );
      this.db.run('UPDATE chats SET updated_at = ? WHERE id = ?', [
        now,
        chat.id,
      ]);
      lastFlushedContent = accumulatedContent;
      lastFlushTime = Date.now();
      currentStatus = newStatus;
    };

    const adapter: ModelAdapter = this.adapterFactory.create({
      providerId: provider.id,
      providerKind: provider.kind as ProviderKind,
      baseUrl: provider.base_url,
      apiKey,
      modelIdentifier: model.model_identifier,
    });

    let turnError: unknown;
    try {
      const stream = adapter.stream(completionRequest, {
        signal: options?.signal,
      });

      for await (const event of stream) {
        if (options?.signal?.aborted) {
          break;
        }

        switch (event.type) {
          case 'text-delta': {
            accumulatedContent += event.delta;
            if (currentStatus === 'pending') {
              flushPartial('streaming');
            } else {
              const charsSinceFlush =
                accumulatedContent.length - lastFlushedContent.length;
              const timeSinceFlush = Date.now() - lastFlushTime;
              if (charsSinceFlush >= 200 || timeSinceFlush >= 500) {
                flushPartial('streaming');
              }
            }

            yield {
              type: 'token',
              data: {
                messageId: pendingRow.id,
                text: event.delta,
              },
            };
            break;
          }

          case 'thought-delta': {
            yield {
              type: 'thought',
              data: {
                messageId: pendingRow.id,
                thought: event.delta,
              },
            };
            break;
          }

          case 'usage': {
            reportedUsage = event.usage;
            break;
          }

          case 'complete': {
            if (event.usage) {
              reportedUsage = event.usage;
            }
            break;
          }

          case 'error': {
            throw event.error;
          }
        }
      }
    } catch (err: unknown) {
      turnError = err;
    }

    if (options?.signal?.aborted) {
      if (accumulatedContent.length > 0) {
        flushPartial('complete', reportedUsage?.outputTokens ?? null);
      } else {
        accumulatedContent = 'Generation interrupted';
        flushPartial('error', null);
      }
      return {
        content: accumulatedContent,
        usage: reportedUsage,
        error: new RequestAbortedError('Aborted', 'generic'),
      };
    }

    if (turnError) {
      let normalizedError: unknown = turnError;
      if (apiKey) {
        if (normalizedError instanceof ModelAdapterError) {
          normalizedError.message = redactSecrets(normalizedError.message, [
            apiKey,
          ]);
          if (normalizedError.cause) {
            (normalizedError as { cause: unknown }).cause =
              sanitizeErrorCause(normalizedError.cause, [apiKey]);
          }
        } else {
          normalizedError = normalizeProviderError({
            providerKind: provider.kind,
            model: model.model_identifier,
            cause: turnError,
            knownSecrets: [apiKey],
          });
        }
      } else if (!(normalizedError instanceof ModelAdapterError)) {
        normalizedError = normalizeProviderError({
          providerKind: provider.kind,
          model: model.model_identifier,
          cause: turnError,
        });
      }

      flushPartial('error', reportedUsage?.outputTokens ?? null);

      yield {
        type: 'error',
        data: toStreamErrorPayload(normalizedError),
      };

      yield {
        type: 'done',
        data: '[DONE]',
      };

      return {
        content: accumulatedContent,
        usage: reportedUsage,
        error: normalizedError,
      };
    }

    flushPartial('complete', reportedUsage?.outputTokens ?? null);

    const finalInputTokens = reportedUsage?.inputTokens ?? null;
    const finalOutputTokens = reportedUsage?.outputTokens ?? null;

    this.db.run(
      `INSERT INTO usage_events (
        id, occurred_at, event_type, agent_id, provider_id, model_id, chat_id,
        input_tokens, output_tokens, cost_usd, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        newId(),
        nowIso(),
        'chat_completion',
        agent.id,
        provider.id,
        model.id,
        chat.id,
        finalInputTokens,
        finalOutputTokens,
        null,
        null,
      ],
    );

    yield {
      type: 'message_complete',
      data: {
        messageId: pendingRow.id,
        status: 'complete',
        tokenCount: reportedUsage?.outputTokens ?? null,
        usage: reportedUsage
          ? {
              inputTokens: reportedUsage.inputTokens,
              outputTokens: reportedUsage.outputTokens,
              totalTokens: reportedUsage.totalTokens,
              reasoningTokens: reportedUsage.reasoningTokens,
            }
          : null,
      },
    };

    return { content: accumulatedContent, usage: reportedUsage };
  }

  /**
   * Phase 1: Sequential position pipeline streaming.
   */
  private async *streamSequentialTeamChat(
    chat: ChatRow,
    members: Array<{
      agent_id: string;
      role: string | null;
      position: number | null;
      agent_name: string;
    }>,
    boundedMaxTurns: number,
    dto?: CreateCompletionDto,
    options?: CompleteChatOptions,
  ): AsyncGenerator<SseCompletionEvent, void, unknown> {
    const maxTurns = Math.min(members.length, boundedMaxTurns);
    const totals = {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
      totalReasoningTokens: 0,
    };

    for (let i = 0; i < maxTurns; i++) {
      if (options?.signal?.aborted) return;

      const member = members[i];
      const res = yield* this.streamMemberTurn(chat, member, dto, options);
      if (res.error) return;

      if (res.usage) {
        totals.totalInputTokens += res.usage.inputTokens ?? 0;
        totals.totalOutputTokens += res.usage.outputTokens ?? 0;
        totals.totalTokens += res.usage.totalTokens ?? 0;
        totals.totalReasoningTokens += res.usage.reasoningTokens ?? 0;
      }

      if (res.content.includes('<!-- GB_TEAM_FINISH -->')) {
        break;
      }
    }

    yield* this.emitFinalStreamUsageAndDone(totals);
  }

  /**
   * Phase 2: Designated Coordinator (Router Agent) streaming.
   */
  private async *streamCoordinatorTeamChat(
    chat: ChatRow,
    team: TeamRow | undefined,
    members: Array<{
      agent_id: string;
      role: string | null;
      position: number | null;
      agent_name: string;
      is_coordinator: number;
    }>,
    boundedMaxTurns: number,
    dto?: CreateCompletionDto,
    options?: CompleteChatOptions,
  ): AsyncGenerator<SseCompletionEvent, void, unknown> {
    const coordinatorMember =
      members.find((m) => m.is_coordinator === 1) ??
      members.find(
        (m) =>
          m.role?.toLowerCase().includes('coordinator') ||
          m.role?.toLowerCase().includes('router'),
      ) ??
      members[0];

    const specialists = members.filter(
      (m) => m.agent_id !== coordinatorMember.agent_id,
    );

    const specialistRoster = specialists
      .map(
        (s) =>
          `- ${s.agent_name}${s.role ? ` (Role: ${s.role})` : ''} [ID: ${s.agent_id}]`,
      )
      .join('\n');

    const coordinatorDirective =
      specialists.length > 0
        ? `You are the designated Coordinator for team "${team?.name ?? 'Team'}".
Available team specialists:
${specialistRoster}

If a specialist should handle or answer the request, output:
[DELEGATE: <Specialist Name or ID>] <instructions for the specialist>
If you can answer directly without delegation, provide your response directly.`
        : undefined;

    const totals = {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
      totalReasoningTokens: 0,
    };

    const coordRes = yield* this.streamMemberTurn(
      chat,
      coordinatorMember,
      dto,
      options,
      undefined,
      coordinatorDirective,
    );
    if (coordRes.error) return;

    if (coordRes.usage) {
      totals.totalInputTokens += coordRes.usage.inputTokens ?? 0;
      totals.totalOutputTokens += coordRes.usage.outputTokens ?? 0;
      totals.totalTokens += coordRes.usage.totalTokens ?? 0;
      totals.totalReasoningTokens += coordRes.usage.reasoningTokens ?? 0;
    }

    if (boundedMaxTurns >= 2 && specialists.length > 0) {
      const delegateMatch = coordRes.content.match(/\[DELEGATE:\s*([^\]]+)\]/i);
      if (delegateMatch) {
        const targetQuery = delegateMatch[1].trim().toLowerCase();
        const specialist =
          specialists.find((s) => s.agent_id.toLowerCase() === targetQuery) ??
          specialists.find(
            (s) => s.agent_name.toLowerCase() === targetQuery,
          ) ??
          specialists.find(
            (s) =>
              s.agent_name.toLowerCase().includes(targetQuery) ||
              targetQuery.includes(s.agent_name.toLowerCase()),
          );

        if (specialist) {
          const specRes = yield* this.streamMemberTurn(
            chat,
            specialist,
            dto,
            options,
          );
          if (specRes.error) return;

          if (specRes.usage) {
            totals.totalInputTokens += specRes.usage.inputTokens ?? 0;
            totals.totalOutputTokens += specRes.usage.outputTokens ?? 0;
            totals.totalTokens += specRes.usage.totalTokens ?? 0;
            totals.totalReasoningTokens += specRes.usage.reasoningTokens ?? 0;
          }
        }
      }
    }

    yield* this.emitFinalStreamUsageAndDone(totals);
  }

  /**
   * Phase 3: Broadcast (Parallel / Independent Context) streaming.
   */
  private async *streamBroadcastTeamChat(
    chat: ChatRow,
    members: Array<{
      agent_id: string;
      role: string | null;
      position: number | null;
      agent_name: string;
    }>,
    boundedMaxTurns: number,
    dto?: CreateCompletionDto,
    options?: CompleteChatOptions,
  ): AsyncGenerator<SseCompletionEvent, void, unknown> {
    const boundaryRow = this.db.get<{ maxSeq: number }>(
      'SELECT COALESCE(MAX(sequence), 0) AS maxSeq FROM messages WHERE chat_id = ?',
      [chat.id],
    );
    const preBroadcastMaxSequence = boundaryRow?.maxSeq ?? 0;
    const contextOptions: ContextBuildingOptions = {
      maxSequence: preBroadcastMaxSequence,
    };

    const maxTurns = Math.min(members.length, boundedMaxTurns);
    const totals = {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
      totalReasoningTokens: 0,
    };

    for (let i = 0; i < maxTurns; i++) {
      if (options?.signal?.aborted) return;

      const member = members[i];
      const res = yield* this.streamMemberTurn(
        chat,
        member,
        dto,
        options,
        contextOptions,
      );
      if (res.error) return;

      if (res.usage) {
        totals.totalInputTokens += res.usage.inputTokens ?? 0;
        totals.totalOutputTokens += res.usage.outputTokens ?? 0;
        totals.totalTokens += res.usage.totalTokens ?? 0;
        totals.totalReasoningTokens += res.usage.reasoningTokens ?? 0;
      }
    }

    yield* this.emitFinalStreamUsageAndDone(totals);
  }

  /**
   * Phase 4: Autonomous Dynamic Handoff streaming.
   */
  private async *streamAutonomousTeamChat(
    chat: ChatRow,
    team: TeamRow | undefined,
    members: Array<{
      agent_id: string;
      role: string | null;
      position: number | null;
      agent_name: string;
      is_coordinator: number;
    }>,
    boundedMaxTurns: number,
    dto?: CreateCompletionDto,
    options?: CompleteChatOptions,
  ): AsyncGenerator<SseCompletionEvent, void, unknown> {
    let currentMember =
      members.find((m) => m.is_coordinator === 1) ??
      members.find(
        (m) =>
          m.role?.toLowerCase().includes('coordinator') ||
          m.role?.toLowerCase().includes('router'),
      ) ??
      members[0];

    const totals = {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
      totalReasoningTokens: 0,
    };

    for (let turn = 0; turn < boundedMaxTurns; turn++) {
      if (options?.signal?.aborted) return;

      const colleagues = members.filter(
        (m) => m.agent_id !== currentMember.agent_id,
      );
      const colleagueRoster = colleagues
        .map(
          (m) =>
            `- @${m.agent_name}${m.role ? ` (${m.role})` : ''} [ID: ${m.agent_id}]`,
        )
        .join('\n');

      const autonomousDirective =
        colleagues.length > 0
          ? `You are collaborating dynamically in an autonomous multi-agent team "${team?.name ?? 'Team'}".
Available colleagues:
${colleagueRoster}

If another colleague should continue the discussion, hand off by including:
[NEXT: @ColleagueName]
When the task is complete and no further response is needed, end with:
[DONE] or <!-- GB_TEAM_FINISH -->.`
          : undefined;

      const res = yield* this.streamMemberTurn(
        chat,
        currentMember,
        dto,
        options,
        undefined,
        autonomousDirective,
      );
      if (res.error) return;

      if (res.usage) {
        totals.totalInputTokens += res.usage.inputTokens ?? 0;
        totals.totalOutputTokens += res.usage.outputTokens ?? 0;
        totals.totalTokens += res.usage.totalTokens ?? 0;
        totals.totalReasoningTokens += res.usage.reasoningTokens ?? 0;
      }

      if (
        res.content.includes('[DONE]') ||
        res.content.includes('<!-- GB_TEAM_FINISH -->')
      ) {
        break;
      }

      const nextMatch = res.content.match(/\[NEXT:\s*@?([^\]]+)\]/i);
      if (!nextMatch) {
        break;
      }

      const targetQuery = nextMatch[1].trim().toLowerCase();
      const nextMember =
        colleagues.find((c) => c.agent_id.toLowerCase() === targetQuery) ??
        colleagues.find((c) => c.agent_name.toLowerCase() === targetQuery) ??
        colleagues.find(
          (c) =>
            c.agent_name.toLowerCase().includes(targetQuery) ||
            targetQuery.includes(c.agent_name.toLowerCase()),
        );

      if (!nextMember) {
        break;
      }

      currentMember = nextMember;
    }

    yield* this.emitFinalStreamUsageAndDone(totals);
  }

  /**
   * Resolves the full execution chain from chat to provider credentials.
   *
   * Fails with distinct, actionable 422 errors at whichever link is invalid.
   */
  private resolveExecutionChain(
    chatId: string,
    overrideModelId?: string,
  ): {
    chat: ChatRow;
    agent: AgentRow;
    model: ModelRow;
    provider: ProviderRow;
    apiKey?: string;
  } {
    // 1. Chat existence check (404)
    const chat = this.db.get<ChatRow>('SELECT * FROM chats WHERE id = ?', [
      chatId,
    ]);
    if (!chat) {
      throw new NotFoundException({
        code: 'CHAT_NOT_FOUND',
        message: `Chat with ID "${chatId}" not found`,
      });
    }

    // 2. Team-owned chat resolution (422 if empty roster)
    if (chat.team_id !== null) {
      const members = this.getActiveTeamMembers(chat.team_id);
      if (members.length === 0) {
        throw new UnprocessableEntityException({
          code: 'TEAM_HAS_NO_MEMBERS',
          message: 'Team has no active members to execute completions',
        });
      }

      // Default to lead member for single-entity operations (e.g. compaction)
      const lead = members[0];
      const agent = this.db.get<AgentRow>('SELECT * FROM agents WHERE id = ?', [
        lead.agent_id,
      ]);
      if (!agent) {
        throw new UnprocessableEntityException({
          code: 'AGENT_NOT_FOUND',
          message: `Agent with ID "${lead.agent_id}" was not found`,
        });
      }

      const { model, provider, apiKey } = this.resolveAgentExecution(
        agent,
        overrideModelId,
      );
      return { chat, agent, model, provider, apiKey };
    }

    // 3. Agent existence check (422)
    if (!chat.agent_id) {
      throw new UnprocessableEntityException({
        code: 'CHAT_HAS_NO_AGENT',
        message: 'Chat has no assigned agent to execute completions',
      });
    }

    const agent = this.db.get<AgentRow>('SELECT * FROM agents WHERE id = ?', [
      chat.agent_id,
    ]);
    if (!agent) {
      throw new UnprocessableEntityException({
        code: 'AGENT_NOT_FOUND',
        message: `Agent with ID "${chat.agent_id}" was not found`,
      });
    }

    // 4. Resolve agent execution chain (model, provider, apiKey)
    const { model, provider, apiKey } = this.resolveAgentExecution(
      agent,
      overrideModelId,
    );

    return { chat, agent, model, provider, apiKey };
  }

  /**
   * Assembles the conversation context into a normalised structure.
   *
   * Delegates to {@link ContextConstructionService} to combine system prompt layers,
   * filter in-flight/errored messages, and fit to the model context window.
   */
  private buildContext(
    chat: ChatRow,
    agent: AgentRow,
    model?: ModelRow | null,
    options?: ContextBuildingOptions,
  ): {
    systemPrompt?: string;
    messages: AdapterMessage[];
  } {
    const assembled = this.contextConstructionService.buildForChat(
      chat,
      agent,
      model,
      options,
    );
    return {
      systemPrompt: assembled.systemPrompt,
      messages: assembled.messages,
    };
  }

  /**
   * Inspects the constructed conversation context for a chat without invoking any model provider.
   *
   * @param chatId - Chat identifier.
   * @returns Detailed inspectable breakdown of system prompt, messages, tokens, and exclusions.
   */
  inspectContext(chatId: string): AssembledContext {
    return this.contextConstructionService.buildByChatId(chatId);
  }

  /**
   * Summarises conversation history into `chats.context_summary` and advances `chats.updated_at`.
   *
   * Responsibilities:
   * 1. Resolves execution chain (Chat → Agent → Model → Provider → Credential).
   *    Fails with distinct, actionable 404/422 HTTP exceptions if unrunnable.
   * 2. Reads message history in sequence order.
   * 3. Calculates compaction boundary based on `preserveRecentCount` (default: 2).
   *    Preserving recent turns retains immediate conversational thread verbatim.
   * 4. Folds any existing `chats.context_summary` together with new messages into a new summary.
   * 5. Atomically writes summary and `compacted_before_sequence` to `chats`.
   *    Messages are retained in SQLite — full history remains readable via messages endpoint.
   * 6. Records token metrics in `usage_events` under `event_type = 'chat_compaction'`.
   *
   * @param chatId - Identifier of the chat to compact.
   * @param dto - Optional overrides for model and number of recent messages to preserve.
   * @param options - Execution options including cancellation signal.
   * @returns Updated chat representation with compaction metadata.
   */
  async compactChat(
    chatId: string,
    dto?: CompactChatDto,
    options?: CompleteChatOptions,
  ): Promise<CompactChatResponseDto> {
    const preserveRecentCount = dto?.preserveRecentCount ?? 2;
    if (preserveRecentCount < 0) {
      throw new BadRequestException({
        code: 'INVALID_OPTIONS',
        message:
          'preserveRecentCount must be an integer greater than or equal to 0',
      });
    }

    // 1. Resolve execution chain & validate runnability
    const { chat, agent, model, provider, apiKey } = this.resolveExecutionChain(
      chatId,
      dto?.modelId,
    );

    // 2. Fetch all messages in sequence order
    const allMessages = this.db.all<MessageRow>(
      `SELECT id, chat_id, sequence, role, agent_id, content, status, token_count, created_at
       FROM messages
       WHERE chat_id = ?
       ORDER BY sequence ASC`,
      [chat.id],
    );

    // 3. Determine uncompacted messages:
    // If chat.compacted_before_sequence exists, messages with sequence >= compacted_before_sequence are uncompacted.
    // If no prior compaction point exists, all messages are candidates.
    const uncompactedMessages = chat.compacted_before_sequence
      ? allMessages.filter((m) => m.sequence >= chat.compacted_before_sequence!)
      : allMessages;

    // 4. Verify there are enough messages to compact
    if (uncompactedMessages.length <= preserveRecentCount) {
      throw new BadRequestException({
        code: 'NO_MESSAGES_TO_COMPACT',
        message: `Chat has no messages eligible for compaction (found ${uncompactedMessages.length} uncompacted messages, but preserveRecentCount is ${preserveRecentCount})`,
      });
    }

    // 5. Partition messages:
    // messagesToCompact: turns to fold into the summary
    // messagesToPreserve: recent turns left verbatim
    const messagesToCompact = uncompactedMessages.slice(
      0,
      uncompactedMessages.length - preserveRecentCount,
    );

    // Filter valid complete turns with non-empty content for the summarizer prompt
    const validMessagesToPrompt = messagesToCompact.filter(
      (m) =>
        m.status === 'complete' && m.content && m.content.trim().length > 0,
    );

    if (validMessagesToPrompt.length === 0) {
      throw new BadRequestException({
        code: 'NO_MESSAGES_TO_COMPACT',
        message:
          'No complete messages with content are available for compaction',
      });
    }

    // Crucial: The compaction boundary is computed from the history actually sent to the model!
    // Highest sequence sent + 1. Any message arriving while summarisation is in flight
    // will have sequence > maxSequenceSent, so it will naturally fall >= newCompactedBeforeSequence.
    const maxSequenceSent =
      messagesToCompact[messagesToCompact.length - 1].sequence;
    const newCompactedBeforeSequence = maxSequenceSent + 1;

    // 6. Build summarisation request
    const userPrompt = buildCompactionUserPrompt({
      existingSummary: chat.context_summary,
      messages: validMessagesToPrompt.map((m) => ({
        sequence: m.sequence,
        role: m.role,
        content: m.content,
      })),
    });

    const completionRequest: CompletionRequest = {
      model: model.model_identifier,
      systemPrompt: COMPACTION_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: userPrompt,
        },
      ],
      temperature: 0.2,
      maxTokens: 1024,
    };

    // 7. Invoke provider adapter
    const adapter: ModelAdapter = this.adapterFactory.create({
      providerId: provider.id,
      providerKind: provider.kind as ProviderKind,
      baseUrl: provider.base_url,
      apiKey,
      modelIdentifier: model.model_identifier,
    });

    let completionResponse: CompletionResponse;
    try {
      completionResponse = await adapter.complete(completionRequest, {
        signal: options?.signal,
      });
    } catch (error: unknown) {
      if (error instanceof ModelAdapterError) {
        if (apiKey) {
          error.message = redactSecrets(error.message, [apiKey]);
          if (error.cause) {
            (error as { cause: unknown }).cause = sanitizeErrorCause(
              error.cause,
              [apiKey],
            );
          }
        }
        throw error;
      }

      throw normalizeProviderError({
        providerKind: provider.kind,
        model: model.model_identifier,
        cause: error,
        knownSecrets: apiKey ? [apiKey] : undefined,
      });
    }

    const newSummary = completionResponse.content.trim();
    const now = nowIso();

    // 8. Atomically update chat and record usage
    this.db.transaction(() => {
      this.db.run(
        `UPDATE chats
         SET context_summary = ?,
             compacted_before_sequence = ?,
             updated_at = ?
         WHERE id = ?`,
        [newSummary, newCompactedBeforeSequence, now, chat.id],
      );

      if (completionResponse.usage) {
        this.db.run(
          `INSERT INTO usage_events (
            id, occurred_at, event_type, agent_id, provider_id, model_id, chat_id,
            input_tokens, output_tokens, cost_usd, metadata
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            newId(),
            now,
            'chat_compaction',
            agent.id,
            provider.id,
            model.id,
            chat.id,
            completionResponse.usage.inputTokens ?? null,
            completionResponse.usage.outputTokens ?? null,
            null,
            null,
          ],
        );
      }
    });

    // 9. Fetch updated chat row and calculate total compacted messages count
    const updatedChat = this.db.get<ChatRow>(
      'SELECT * FROM chats WHERE id = ?',
      [chat.id],
    )!;

    // Total messages now covered: all messages in the chat prior to the compaction boundary
    const totalCompactedCount =
      this.db.get<{ count: number }>(
        'SELECT COUNT(*) AS count FROM messages WHERE chat_id = ? AND sequence < ?',
        [chat.id, newCompactedBeforeSequence],
      )?.count ?? messagesToCompact.length;

    return {
      id: updatedChat.id,
      title: updatedChat.title ?? null,
      projectId: updatedChat.project_id ?? null,
      agentId: updatedChat.agent_id ?? null,
      teamId: updatedChat.team_id ?? null,
      contextSummary: updatedChat.context_summary ?? null,
      compactedBeforeSequence: updatedChat.compacted_before_sequence ?? null,
      compactedMessagesCount: totalCompactedCount,
      createdAt: updatedChat.created_at,
      updatedAt: updatedChat.updated_at,
    };
  }

  /**
   * Atomically persists the assistant reply, updates chat.updated_at, and writes usage_events.
   *
   * Handles the provider-success-but-persistence-failure case deliberately:
   * Retries on sequence collisions up to 3 times. On unrecoverable failure,
   * logs the event and raises 500 PERSISTENCE_FAILED.
   */
  private persistAssistantReply(
    chat: ChatRow,
    agent: AgentRow,
    provider: ProviderRow,
    model: ModelRow,
    completionResponse: CompletionResponse,
  ): CompletionResponseDto {
    const tokenCount =
      typeof completionResponse.usage?.outputTokens === 'number' &&
      completionResponse.usage.outputTokens > 0
        ? completionResponse.usage.outputTokens
        : null;

    const maxRetries = 3;
    let attempts = 0;
    let persistedRow: MessageRow | null = null;

    while (attempts < maxRetries) {
      attempts += 1;
      const messageId = newId();
      const now = nowIso();

      try {
        persistedRow = this.db.transaction(() => {
          const insertSql = `
            INSERT INTO messages (
              id,
              chat_id,
              sequence,
              role,
              agent_id,
              content,
              status,
              token_count,
              created_at
            ) VALUES (
              ?,
              ?,
              (SELECT COALESCE(MAX(sequence), 0) + 1 FROM messages WHERE chat_id = ?),
              'assistant',
              ?,
              ?,
              'complete',
              ?,
              ?
            )
            RETURNING *
          `;

          const row = this.db.get<MessageRow>(insertSql, [
            messageId,
            chat.id,
            chat.id,
            agent.id,
            completionResponse.content,
            tokenCount,
            now,
          ]);

          this.db.run('UPDATE chats SET updated_at = ? WHERE id = ?', [
            now,
            chat.id,
          ]);

          // Record usage event seam (#63)
          this.db.run(
            `INSERT INTO usage_events (
              id, occurred_at, event_type, agent_id, provider_id, model_id, chat_id,
              input_tokens, output_tokens, cost_usd, metadata
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              newId(),
              now,
              'chat_completion',
              agent.id,
              provider.id,
              model.id,
              chat.id,
              completionResponse.usage?.inputTokens ?? null,
              completionResponse.usage?.outputTokens ?? null,
              null,
              null,
            ],
          );

          return row ?? null;
        });

        if (persistedRow) {
          break;
        }
      } catch (error: any) {
        const isUniqueConstraint =
          error?.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
          (typeof error?.message === 'string' &&
            error.message.includes(
              'UNIQUE constraint failed: messages.chat_id, messages.sequence',
            ));

        if (isUniqueConstraint && attempts < maxRetries) {
          continue;
        }

        this.logger.error(
          `CRITICAL: Completion succeeded for chat "${chat.id}" but persistence failed: ${error?.message}`,
        );
        throw new InternalServerErrorException({
          code: 'PERSISTENCE_FAILED',
          message:
            'Completion generated successfully but failed to persist to conversation history',
        });
      }
    }

    if (!persistedRow) {
      throw new InternalServerErrorException({
        code: 'PERSISTENCE_FAILED',
        message: 'Failed to persist completion message to database',
      });
    }

    return {
      id: persistedRow.id,
      chatId: persistedRow.chat_id,
      sequence: persistedRow.sequence,
      role: persistedRow.role,
      agentId: persistedRow.agent_id,
      content: persistedRow.content,
      status: persistedRow.status,
      tokenCount: persistedRow.token_count,
      createdAt: persistedRow.created_at,
      usage: completionResponse.usage
        ? {
            inputTokens: completionResponse.usage.inputTokens,
            outputTokens: completionResponse.usage.outputTokens,
            totalTokens: completionResponse.usage.totalTokens,
            reasoningTokens: completionResponse.usage.reasoningTokens,
          }
        : null,
    };
  }
}
