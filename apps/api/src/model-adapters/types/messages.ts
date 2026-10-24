/**
 * Allowed roles for messages sent to model adapters.
 *
 * Constrained by `data/chats/messages.sql` to 'user', 'assistant', 'system', 'tool'.
 */
export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

/**
 * Normalised message representation provided to model adapters.
 *
 * Designed to accommodate differences across providers:
 * - OpenAI accepts system, user, assistant, and tool messages in an array.
 * - Anthropic expects system instructions as a separate top-level parameter
 *   and alternates user/assistant turns in the message array.
 * - Each adapter translates this normalised representation into its vendor-specific wire payload.
 */
export interface AdapterMessage {
  /** The participant role in the conversation */
  readonly role: MessageRole;
  /** The text content of the message */
  readonly content: string;
  /** Optional participant name or agent identifier */
  readonly name?: string;
  /** Optional tool call identifier (when role === 'tool') */
  readonly toolCallId?: string;
}
