import {
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../../database/database.service.js';
import { ContextLengthExceededError } from '../../model-adapters/errors/model-adapter-error.js';
import type {
  AdapterMessage,
  MessageRole,
} from '../../model-adapters/types/messages.js';
import type {
  AssembledContext,
  BuildContextInput,
  ContextBuildingOptions,
  ContextExcludedMessage,
  ContextFittingStrategy,
  ContextInputMessage,
  ContextMessageDetail,
  ContextSourceData,
  ContextTokenEstimate,
  MessageStatus,
  SystemPromptBreakdown,
} from './context-construction.types.js';

/** Row interface for `chats` table */
interface ChatRow {
  id: string;
  title: string | null;
  project_id: string | null;
  agent_id: string | null;
  team_id: string | null;
  context_summary: string | null;
  created_at: string;
  updated_at: string;
}

/** Row interface for `agents` table */
interface AgentRow {
  id: string;
  name: string;
  personality: string | null;
  instructions: string | null;
  system_prompt_id: string | null;
  model_id: string | null;
  temperature: number | null;
  max_tokens: number | null;
  model_params: string | null;
  created_at: string;
  updated_at: string;
}

/** Row interface for `models` table */
interface ModelRow {
  id: string;
  provider_id: string;
  model_identifier: string;
  display_name: string;
  context_window: number | null;
  default_temperature: number | null;
  default_max_tokens: number | null;
  enabled: number;
}

/** Row interface for `messages` table */
interface MessageRow {
  id: string;
  chat_id: string;
  sequence: number;
  role: string;
  agent_id: string | null;
  content: string;
  status: MessageStatus;
  token_count: number | null;
  created_at: string;
}

/**
 * Character-based token estimation heuristic (~4 characters per token).
 *
 * Exact tokenization requires model-specific BPE/SentencePiece tokenizers (e.g.,
 * tiktoken for OpenAI, Anthropic tokenizer for Claude). For code, CJK scripts,
 * or non-Latin alphabets, actual token consumption may be higher (~1-2 chars/token).
 *
 * @param text - The raw text content to estimate.
 * @returns Estimated number of tokens.
 */
export function estimateTokens(text: string | null | undefined): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Estimates the token cost of a single message including adapter protocol overhead
 * (~4 tokens for message framing and participant role/name headers).
 *
 * @param message - The normalized adapter message.
 * @returns Estimated tokens for the message.
 */
export function estimateMessageTokens(message: AdapterMessage): number {
  const framingOverhead = 4;
  return (
    framingOverhead +
    estimateTokens(message.content) +
    (message.name ? estimateTokens(message.name) : 0)
  );
}

/**
 * Combines system context elements into a single prompt string and structured breakdown.
 *
 * Ordering Hierarchy:
 * 1. Base System Prompt (`systemPromptTemplate`): Foundational instructions, role and capabilities.
 * 2. Personality (`personality`): Free-text character description, tone of voice, demeanor.
 * 3. Instructions (`instructions`): Agent-specific directives and operational rules. Placed after
 *    personality so that specific operational constraints override or guide general persona traits.
 * 4. Semantic Memory Seam: Injected cross-chat persistent facts (see docs/rfc-semantic-memory.md).
 * 5. Context Summary (`contextSummary`): Synthesized summary of prior conversation turns
 *    produced by compaction, placed immediately before the active turns.
 *
 * Separation:
 * Non-empty sections are trimmed and separated by double newlines (`\n\n`).
 * If all sections are absent or whitespace-only, `combined` is null and `systemPrompt` is undefined.
 */
export function assembleSystemPrompt(
  sources: ContextSourceData,
  memorySeamContent?: string | null,
): {
  systemPrompt?: string;
  breakdown: SystemPromptBreakdown;
} {
  const promptTemplate = sources.systemPromptTemplate?.trim() || null;
  const personality = sources.personality?.trim() || null;
  const instructions = sources.instructions?.trim() || null;
  const memorySeam = memorySeamContent?.trim() || null;
  const rawSummary = sources.contextSummary?.trim() || null;
  const contextSummary = rawSummary ? `Context summary:\n${rawSummary}` : null;

  const sections: string[] = [];
  if (promptTemplate) sections.push(promptTemplate);
  if (personality) sections.push(personality);
  if (instructions) sections.push(instructions);
  if (memorySeam) sections.push(memorySeam);
  if (contextSummary) sections.push(contextSummary);

  const combined = sections.length > 0 ? sections.join('\n\n') : null;

  return {
    systemPrompt: combined ?? undefined,
    breakdown: {
      promptTemplate,
      personality,
      instructions,
      memorySeam,
      contextSummary: rawSummary,
      combined,
    },
  };
}

/**
 * Pure function that assembles conversation context, applies message inclusion rules,
 * estimates token counts, and enforces model context window fitting.
 *
 * @param input - Complete context inputs and configuration options.
 * @returns Fully assembled, fitted, and inspectable context structure.
 * @throws {ContextLengthExceededError} If history exceeds context window under 'refuse' strategy.
 */
export function buildContextPure(input: BuildContextInput): AssembledContext {
  const fittingStrategy: ContextFittingStrategy =
    input.fittingStrategy ?? 'refuse';

  // -------------------------------------------------------------------------
  // 1. Semantic Memory Injection Seam (docs/rfc-semantic-memory.md)
  // -------------------------------------------------------------------------
  let memorySeamContent: string | null = null;
  if (input.memorySeam?.retrieveMemories) {
    try {
      const retrieved = input.memorySeam.retrieveMemories({});
      const memoryList = Array.isArray(retrieved) ? retrieved : [];
      if (memoryList.length > 0) {
        memorySeamContent = `<memories>\n${memoryList.join('\n')}\n</memories>`;
      }
    } catch {
      // Memory injection failures must never break core conversation assembly
      memorySeamContent = null;
    }
  }

  // -------------------------------------------------------------------------
  // 2. Assemble System Prompt Layers
  // -------------------------------------------------------------------------
  const { systemPrompt, breakdown: systemDetails } = assembleSystemPrompt(
    input.sources,
    memorySeamContent,
  );

  // System prompt token estimation (4 tokens overhead if present)
  const systemTokens = systemPrompt ? 4 + estimateTokens(systemPrompt) : 0;

  // -------------------------------------------------------------------------
  // 3. Filter and Order Messages
  // -------------------------------------------------------------------------
  const rawMessages = [...input.messages].sort(
    (a, b) => a.sequence - b.sequence,
  );

  const candidateMessages: Array<{
    msg: ContextInputMessage;
    adapterMessage: AdapterMessage;
    estimatedTokens: number;
  }> = [];

  const excludedMessages: ContextExcludedMessage[] = [];

  for (const msg of rawMessages) {
    // Rule: Status must be 'complete'. In-progress ('pending', 'streaming') and
    // aborted/failed ('error') messages are excluded.
    if (msg.status !== 'complete') {
      excludedMessages.push({
        id: msg.id,
        sequence: msg.sequence,
        role: msg.role,
        status: msg.status,
        reason: 'status_not_complete',
        detail: `Message status "${msg.status}" is not complete (in-flight generation or partial error output).`,
      });
      continue;
    }

    // Rule: Empty content messages are dropped (many providers reject empty strings)
    if (!msg.content || msg.content.trim().length === 0) {
      excludedMessages.push({
        id: msg.id,
        sequence: msg.sequence,
        role: msg.role,
        status: msg.status,
        reason: 'empty_content',
        detail: 'Message text content is empty or contains only whitespace.',
      });
      continue;
    }

    // Rule: Compacted history boundary (if explicitly provided)
    if (
      typeof input.compactedBeforeSequence === 'number' &&
      msg.sequence < input.compactedBeforeSequence
    ) {
      excludedMessages.push({
        id: msg.id,
        sequence: msg.sequence,
        role: msg.role,
        status: msg.status,
        reason: 'compacted_history',
        detail: `Message sequence ${msg.sequence} superseded by compaction summary (prior to sequence ${input.compactedBeforeSequence}).`,
      });
      continue;
    }

    // Normalize role and map to AdapterMessage
    const validRole = (
      ['user', 'assistant', 'system', 'tool'].includes(msg.role)
        ? msg.role
        : 'user'
    ) as MessageRole;

    const adapterMessage: AdapterMessage = {
      role: validRole,
      content: msg.content,
      // Retain per-message agent attribution in team chats (omitted when null/deleted)
      ...(msg.agentId ? { name: msg.agentId } : {}),
    };

    const estimatedTokens = estimateMessageTokens(adapterMessage);

    candidateMessages.push({
      msg,
      adapterMessage,
      estimatedTokens,
    });
  }

  // -------------------------------------------------------------------------
  // 4. Context Window Fitting
  // -------------------------------------------------------------------------
  const contextWindow =
    typeof input.contextWindow === 'number' && input.contextWindow > 0
      ? input.contextWindow
      : null;

  let activeCandidates = candidateMessages;

  if (contextWindow !== null) {
    const calculateTotalTokens = (
      candidates: typeof candidateMessages,
    ): number => {
      const messagesTokens = candidates.reduce(
        (sum, item) => sum + item.estimatedTokens,
        0,
      );
      return systemTokens + messagesTokens;
    };

    let totalTokens = calculateTotalTokens(activeCandidates);

    if (totalTokens > contextWindow) {
      if (fittingStrategy === 'truncate_oldest') {
        // Drop oldest complete messages until fitting within contextWindow or only 1 turn remains
        while (activeCandidates.length > 1 && totalTokens > contextWindow) {
          const dropped = activeCandidates.shift()!;
          excludedMessages.push({
            id: dropped.msg.id,
            sequence: dropped.msg.sequence,
            role: dropped.msg.role,
            status: dropped.msg.status,
            reason: 'truncated_for_window',
            detail: `Message dropped because total estimated tokens (${totalTokens}) exceeded model context window (${contextWindow}).`,
          });
          totalTokens = calculateTotalTokens(activeCandidates);
        }

        // If even with the oldest dropped down to 1 message the context is still over limit, refuse
        if (totalTokens > contextWindow) {
          throw new ContextLengthExceededError(
            `Context length exceeded: prompt contains approximately ${totalTokens} tokens, which exceeds the model limit of ${contextWindow} tokens even after dropping older messages.`,
          );
        }
      } else {
        // Default Strategy: 'refuse' (transparent, alerts caller so history can be compacted)
        throw new ContextLengthExceededError(
          `Context length exceeded: prompt contains approximately ${totalTokens} tokens, which exceeds the model limit of ${contextWindow} tokens.`,
        );
      }
    }
  }

  // -------------------------------------------------------------------------
  // 5. Build Final Assembled Representation
  // -------------------------------------------------------------------------
  const messages: AdapterMessage[] = activeCandidates.map(
    (item) => item.adapterMessage,
  );

  const messageDetails: ContextMessageDetail[] = activeCandidates.map(
    (item) => ({
      id: item.msg.id,
      sequence: item.msg.sequence,
      role: item.adapterMessage.role,
      content: item.adapterMessage.content,
      agentId: item.msg.agentId ?? null,
      estimatedTokens: item.estimatedTokens,
      status: item.msg.status as MessageStatus,
    }),
  );

  const messagesTokens = activeCandidates.reduce(
    (sum, item) => sum + item.estimatedTokens,
    0,
  );
  const totalTokens = systemTokens + messagesTokens;

  const tokenEstimate: ContextTokenEstimate = {
    systemTokens,
    messagesTokens,
    totalTokens,
    contextWindow,
    fitsContextWindow: contextWindow === null ? true : totalTokens <= contextWindow,
    heuristic:
      'Character-based heuristic (~4 characters per token + 4 tokens overhead per message/system turn). Exact token count requires model-specific tokenizer.',
  };

  return {
    systemPrompt,
    messages,
    systemDetails,
    messageDetails,
    excludedMessages,
    tokenEstimate,
  };
}

/**
 * Service that constructs and inspects model completion contexts.
 *
 * Responsibilities:
 * 1. Reads agent persona (`agents.personality`), instructions (`agents.instructions`),
 *    and system prompt templates (`system_prompts.content`).
 * 2. Fetches chat history in sequence order, filtering in-flight and errored rows.
 * 3. Incorporates compaction summaries (`chats.context_summary`).
 * 4. Estimates context size using a documented character-based heuristic.
 * 5. Fits context to the model context window (`models.context_window`), refusing
 *    generation with 413 `CONTEXT_LENGTH_EXCEEDED` by default when exceeded.
 * 6. Exposes a comprehensive inspectable breakdown for UI debugging and observability.
 */
@Injectable()
export class ContextConstructionService {
  private readonly logger = new Logger(ContextConstructionService.name);

  constructor(private readonly db: DatabaseService) {}

  /**
   * Pure context construction helper (publicly accessible for testing and fixture evaluation).
   */
  build(input: BuildContextInput): AssembledContext {
    return buildContextPure(input);
  }

  /**
   * Assembles the context for a chat given in-memory or previously resolved entities.
   *
   * @param chat - The chat row from SQLite.
   * @param agent - The agent row from SQLite.
   * @param model - Optional model row (provides context_window limit).
   * @param options - Additional fitting and seam configuration.
   * @returns The assembled context ready for model invocation.
   */
  buildForChat(
    chat: ChatRow,
    agent: AgentRow,
    model?: ModelRow | null,
    options?: ContextBuildingOptions,
  ): AssembledContext {
    // 1. Resolve system prompt template if referenced
    let systemPromptTemplate: string | null = null;
    if (agent.system_prompt_id) {
      const sp = this.db.get<{ content: string }>(
        'SELECT content FROM system_prompts WHERE id = ?',
        [agent.system_prompt_id],
      );
      if (sp?.content) {
        systemPromptTemplate = sp.content;
      }
    }

    // 2. Fetch message history in sequence order
    const messageRows = this.db.all<MessageRow>(
      'SELECT id, chat_id, sequence, role, agent_id, content, status, token_count, created_at FROM messages WHERE chat_id = ? ORDER BY sequence ASC',
      [chat.id],
    );

    const messages: ContextInputMessage[] = messageRows.map((row) => ({
      id: row.id,
      sequence: row.sequence,
      role: row.role,
      content: row.content,
      status: row.status,
      agentId: row.agent_id,
      tokenCount: row.token_count,
    }));

    // 3. Assemble context via pure function
    const contextWindow = options?.contextWindow ?? model?.context_window ?? null;

    return buildContextPure({
      sources: {
        systemPromptTemplate,
        personality: agent.personality,
        instructions: agent.instructions,
        contextSummary: chat.context_summary,
      },
      messages,
      contextWindow,
      fittingStrategy: options?.fittingStrategy ?? 'refuse',
      compactedBeforeSequence: options?.compactedBeforeSequence,
      memorySeam: options?.memorySeam,
    });
  }

  /**
   * Loads chat, agent, and model records from SQLite and constructs the full context.
   *
   * @param chatId - Identifier of the chat to construct context for.
   * @param options - Optional overrides for context window, fitting strategy, etc.
   * @returns The assembled context.
   * @throws {NotFoundException} If chat or assigned agent is not found.
   */
  buildByChatId(
    chatId: string,
    options?: ContextBuildingOptions,
  ): AssembledContext {
    const chat = this.db.get<ChatRow>(
      'SELECT * FROM chats WHERE id = ?',
      [chatId],
    );

    if (!chat) {
      throw new NotFoundException({
        code: 'CHAT_NOT_FOUND',
        message: `Chat with ID "${chatId}" not found`,
      });
    }

    if (!chat.agent_id) {
      this.logger.warn(
        `Chat "${chatId}" is a team chat or lacks agent_id. Context construction for team chats is out of scope.`,
      );
      throw new NotFoundException({
        code: 'AGENT_NOT_FOUND',
        message: `Chat "${chatId}" is not assigned to an individual agent`,
      });
    }

    const agent = this.db.get<AgentRow>(
      'SELECT * FROM agents WHERE id = ?',
      [chat.agent_id],
    );

    if (!agent) {
      throw new NotFoundException({
        code: 'AGENT_NOT_FOUND',
        message: `Agent "${chat.agent_id}" assigned to chat "${chatId}" not found`,
      });
    }

    let model: ModelRow | null = null;
    if (agent.model_id) {
      model =
        this.db.get<ModelRow>('SELECT * FROM models WHERE id = ?', [
          agent.model_id,
        ]) ?? null;
    }

    return this.buildForChat(chat, agent, model, options);
  }

  /**
   * Inspects the constructed context for a chat without invoking any model provider.
   *
   * @param chatId - Identifier of the chat to inspect.
   * @param options - Optional context building options.
   * @returns Detailed inspectable breakdown of system prompt, messages, tokens, and exclusions.
   */
  inspect(chatId: string, options?: ContextBuildingOptions): AssembledContext {
    return this.buildByChatId(chatId, options);
  }
}
