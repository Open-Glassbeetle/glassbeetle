import type {
  AdapterMessage,
  MessageRole,
} from '../../model-adapters/types/messages.js';

/**
 * Message status values constrained by `data/chats/messages.sql`.
 */
export type MessageStatus = 'pending' | 'streaming' | 'complete' | 'error';

/**
 * Raw input sources for assembling the agent's system prompt context.
 */
export interface ContextSourceData {
  /** Reusable system prompt template from system_prompts table */
  readonly systemPromptTemplate?: string | null;
  /** Free-text character description from agents.personality */
  readonly personality?: string | null;
  /** Agent-specific instructions from agents.instructions */
  readonly instructions?: string | null;
  /** Compacted summary of prior conversation from chats.context_summary */
  readonly contextSummary?: string | null;
}

/**
 * Input message representation for context construction.
 */
export interface ContextInputMessage {
  readonly id?: string;
  readonly sequence: number;
  readonly role: string;
  readonly content: string;
  readonly status: MessageStatus | string;
  readonly agentId?: string | null;
  readonly agentName?: string | null;
  readonly agentRole?: string | null;
  readonly tokenCount?: number | null;
}

/**
 * Strategy to apply when conversation history exceeds the model's context window.
 *
 * - 'refuse' (default): Refuses generation by throwing `ContextLengthExceededError` (HTTP 413).
 *   Transparent and honest: tells the client/orchestration that compaction is needed.
 * - 'truncate_oldest': Drops oldest messages from history until it fits within the context window,
 *   preserving the system context and at least the latest message.
 */
export type ContextFittingStrategy = 'refuse' | 'truncate_oldest';

/**
 * Extension seam for Semantic Memory Injection (see docs/rfc-semantic-memory.md).
 *
 * Future semantic memory resolution will hook into this seam to inject
 * agent-private and shared memories into the system context.
 */
export interface MemoryInjectionSeam {
  retrieveMemories?(params: {
    agentId?: string | null;
    chatId?: string;
  }): Promise<string[]> | string[];
}

/**
 * Configuration options for context building and fitting.
 */
export interface ContextBuildingOptions {
  /** The model's context window in tokens, or null/undefined if unknown */
  readonly contextWindow?: number | null;
  /** Fitting strategy when context exceeds contextWindow. Defaults to 'refuse'. */
  readonly fittingStrategy?: ContextFittingStrategy;
  /** Sequence boundary: if specified, messages with sequence < compactedBeforeSequence are omitted */
  readonly compactedBeforeSequence?: number | null;
  /** Optional memory injection seam implementation */
  readonly memorySeam?: MemoryInjectionSeam;
  /** In team chats, target agent ID for whom context is being constructed */
  readonly targetAgentId?: string | null;
}

/**
 * Complete input needed by the pure context builder function.
 */
export interface BuildContextInput {
  readonly sources: ContextSourceData;
  readonly messages: ContextInputMessage[];
  readonly contextWindow?: number | null;
  readonly fittingStrategy?: ContextFittingStrategy;
  readonly compactedBeforeSequence?: number | null;
  readonly memorySeam?: MemoryInjectionSeam;
  /** In team chats, indicates that peer turns should be framed with participant banners */
  readonly isTeamChat?: boolean;
  /** ID of the speaking agent (turns from this agent are self assistant turns, others are peer turns) */
  readonly currentAgentId?: string | null;
}

/**
 * Detailed breakdown of each individual layer in the system context.
 */
export interface SystemPromptBreakdown {
  readonly promptTemplate: string | null;
  readonly personality: string | null;
  readonly instructions: string | null;
  readonly memorySeam: string | null;
  readonly contextSummary: string | null;
  readonly combined: string | null;
}

/**
 * Detailed inspectable representation of an included message.
 */
export interface ContextMessageDetail {
  readonly id?: string;
  readonly sequence: number;
  readonly role: MessageRole;
  readonly content: string;
  readonly agentId: string | null;
  readonly estimatedTokens: number;
  readonly status: MessageStatus;
}

/**
 * Reason for excluding a message from the prompt sent to the model.
 */
export type ExclusionReason =
  | 'status_not_complete'
  | 'empty_content'
  | 'compacted_history'
  | 'truncated_for_window';

/**
 * Detailed inspectable representation of an excluded or dropped message.
 */
export interface ContextExcludedMessage {
  readonly id?: string;
  readonly sequence: number;
  readonly role: string;
  readonly status: string;
  readonly reason: ExclusionReason;
  readonly detail: string;
}

/**
 * Token estimation metrics.
 */
export interface ContextTokenEstimate {
  readonly systemTokens: number;
  readonly messagesTokens: number;
  readonly totalTokens: number;
  readonly contextWindow: number | null;
  readonly fitsContextWindow: boolean;
  readonly heuristic: string;
}

/**
 * Fully assembled and inspectable conversation context ready for adapter invocation.
 */
export interface AssembledContext {
  /** The combined system prompt string to send to adapter, or undefined if empty */
  readonly systemPrompt?: string;
  /** Normalised messages array in sequence order to send to adapter */
  readonly messages: AdapterMessage[];
  /** Detailed breakdown of all system prompt layers */
  readonly systemDetails: SystemPromptBreakdown;
  /** Detailed inspectable list of included messages */
  readonly messageDetails: ContextMessageDetail[];
  /** Messages that were filtered out or dropped with reasons */
  readonly excludedMessages: ContextExcludedMessage[];
  /** Token estimations and context window fitting metadata */
  readonly tokenEstimate: ContextTokenEstimate;
}
