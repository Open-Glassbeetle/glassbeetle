/**
 * Reviewable and tunable prompt templates and utilities for conversation compaction.
 *
 * Conversation compaction condenses chat history into `chats.context_summary`
 * to maintain long-running conversations within model context window boundaries.
 */

/**
 * System prompt instructing the model how to condense conversation turns into a coherent,
 * comprehensive, and structured summary.
 *
 * Designed to preserve essential factual details, decisions made, code architectures,
 * user preferences, and unresolved tasks while shedding conversational pleasantries.
 */
export const COMPACTION_SYSTEM_PROMPT =
  'You are an expert conversation summariser. Your task is to produce a clear, dense, ' +
  'and factual summary of the provided conversation history.\n\n' +
  'Guidelines:\n' +
  '- Preserve key decisions, requirements, architecture details, user preferences, and constraints.\n' +
  '- Keep track of current project state, completed actions, and any unresolved issues or pending next steps.\n' +
  '- Omit conversational filler, polite greetings, and repetitive exchanges.\n' +
  '- Structure the summary cleanly using markdown headings or bullet points where appropriate.\n' +
  '- When an existing summary is provided, synthesize the new conversation turns into it to produce a single, cohesive, updated summary.\n' +
  '- Be concise and dense: do not generate unnecessary narrative prose.';

/**
 * Minimal message representation required for compaction prompting.
 */
export interface CompactionMessageInput {
  readonly sequence: number;
  readonly role: string;
  readonly content: string;
}

/**
 * Formats conversation messages into a clear transcript for summarisation.
 */
export function formatMessagesForCompaction(
  messages: readonly CompactionMessageInput[],
): string {
  return messages
    .map((m) => `[Sequence ${m.sequence} | ${m.role}]:\n${m.content.trim()}`)
    .join('\n\n');
}

/**
 * Options for constructing compaction user prompts.
 */
export interface BuildCompactionPromptInput {
  /**
   * Existing compaction summary from `chats.context_summary` when compacting repeatedly.
   */
  readonly existingSummary?: string | null;
  /**
   * New conversation turns to summarise and fold in.
   */
  readonly messages: readonly CompactionMessageInput[];
}

/**
 * Constructs the user prompt sent to the summarisation model.
 *
 * When an `existingSummary` is present, instructs the model to fold the prior summary
 * and new turns into a unified update rather than starting from scratch or discarding the past.
 */
export function buildCompactionUserPrompt(
  input: BuildCompactionPromptInput,
): string {
  const formattedMessages = formatMessagesForCompaction(input.messages);

  if (input.existingSummary && input.existingSummary.trim().length > 0) {
    return (
      'The conversation was previously summarised as follows:\n\n' +
      `<prior_summary>\n${input.existingSummary.trim()}\n</prior_summary>\n\n` +
      'Here are the new conversation turns that have taken place since that summary:\n\n' +
      `<new_turns>\n${formattedMessages}\n</new_turns>\n\n` +
      'Please produce an updated, cohesive summary that incorporates these new turns into the prior summary. ' +
      'Return only the updated summary.'
    );
  }

  return (
    'Here are the conversation turns to summarise:\n\n' +
    `<conversation_turns>\n${formattedMessages}\n</conversation_turns>\n\n` +
    'Please produce a dense, factual summary of this conversation history. ' +
    'Return only the summary.'
  );
}
