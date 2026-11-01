import {
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
import {
  ModelAdapterError,
  normalizeProviderError,
  redactSecrets,
  sanitizeErrorCause,
} from '../../model-adapters/errors/index.js';
import type {
  AdapterMessage,
  CompletionRequest,
  CompletionResponse,
} from '../../model-adapters/types/index.js';
import { CredentialsService } from '../providers/credentials/credentials.service.js';
import type {
  ProviderKind,
  ProviderRow,
} from '../providers/dto/provider.dto.js';
import type { ModelRow } from '../providers/models/dto/model.dto.js';
import type { AgentRow } from '../agents/dto/agent.mapper.js';
import type { ChatRow } from '../chats/dto/chat.mapper.js';
import type { MessageRow } from '../chats/messages/dto/index.js';
import type {
  CompletionResponseDto,
  CreateCompletionDto,
} from '../chats/completions/dto/index.js';

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
    // -----------------------------------------------------------------------
    // 1. Resolve execution chain & validate runnability
    // -----------------------------------------------------------------------
    const { chat, agent, model, provider, apiKey } = this.resolveExecutionChain(
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
          : model.default_temperature ?? undefined;

    const effectiveMaxTokens =
      dto?.maxTokens !== undefined && dto.maxTokens !== null
        ? dto.maxTokens
        : agent.max_tokens !== null
          ? agent.max_tokens
          : model.default_max_tokens ?? undefined;

    let effectiveModelParams: Record<string, unknown> | undefined;
    if (agent.model_params) {
      try {
        effectiveModelParams = JSON.parse(agent.model_params);
      } catch {
        effectiveModelParams = undefined;
      }
    }

    // -----------------------------------------------------------------------
    // 3. Assemble prompt context (Seam for context construction issue #xx)
    // -----------------------------------------------------------------------
    const { systemPrompt, messages } = this.buildContext(chat, agent);

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
    const adapter = this.adapterFactory.create({
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

    // 2. Team-owned chat check (422)
    if (chat.team_id !== null) {
      throw new UnprocessableEntityException({
        code: 'TEAM_CHAT_NOT_SUPPORTED',
        message: 'Multi-agent team chats are not yet supported for completion',
      });
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

    // 4. Model resolution & existence check (422)
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

    // 5. Provider existence & enabled check (422)
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

    // 6. Credential check (422)
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

    return { chat, agent, model, provider, apiKey };
  }

  /**
   * Assembles the conversation context into a normalised {@link CompletionRequest} structure.
   *
   * Seam for future context construction / compaction integration (#xx).
   */
  private buildContext(
    chat: ChatRow,
    agent: AgentRow,
  ): {
    systemPrompt?: string;
    messages: AdapterMessage[];
  } {
    // Construct system prompt from template, agent instructions, and context summary
    const promptSections: string[] = [];

    if (agent.system_prompt_id) {
      const sp = this.db.get<{ content: string }>(
        'SELECT content FROM system_prompts WHERE id = ?',
        [agent.system_prompt_id],
      );
      if (sp?.content?.trim()) {
        promptSections.push(sp.content.trim());
      }
    }

    if (agent.instructions?.trim()) {
      promptSections.push(agent.instructions.trim());
    }

    if (chat.context_summary?.trim()) {
      promptSections.push(`Context summary:\n${chat.context_summary.trim()}`);
    }

    const systemPrompt =
      promptSections.length > 0 ? promptSections.join('\n\n') : undefined;

    // Fetch message history in sequence order
    const messageRows = this.db.all<MessageRow>(
      'SELECT * FROM messages WHERE chat_id = ? ORDER BY sequence ASC',
      [chat.id],
    );

    const messages: AdapterMessage[] = messageRows.map((row) => ({
      role: row.role,
      content: row.content,
    }));

    return { systemPrompt, messages };
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
