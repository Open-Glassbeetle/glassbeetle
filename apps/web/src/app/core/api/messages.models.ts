import type { PageQuery } from './pagination';

/** Who produced a message (`messages.role`). */
export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

export const MESSAGE_ROLES: readonly MessageRole[] = [
  'user',
  'assistant',
  'system',
  'tool',
] as const;

/**
 * How far a message got (`messages.status`).
 *
 * Everything the API stores today is `complete`: the states in between belong
 * to a generation run, and nothing generates yet. The UI renders them anyway —
 * they are states the column already has, and a transcript that only knows how
 * to draw finished messages would have to be rewritten the day it does.
 */
export type MessageStatus = 'pending' | 'streaming' | 'complete' | 'error';

export const MESSAGE_STATUSES: readonly MessageStatus[] = [
  'pending',
  'streaming',
  'complete',
  'error',
] as const;

/**
 * One turn of a conversation (`GET /api/v1/chats/:chatId/messages`).
 *
 * `sequence` is the position in the chat, from 1, and is unique per chat. It
 * is what orders the transcript and what the cursor parameters address —
 * timestamps would tie, and offsets shift as a conversation grows.
 *
 * `agentId` is nullable because deleting an agent clears the reference rather
 * than the message: an author-less turn is a state the UI has to render, the
 * same way an owner-less chat is.
 */
export interface Message {
  readonly id: string;
  readonly chatId: string;
  readonly sequence: number;
  readonly role: MessageRole;
  readonly agentId: string | null;
  readonly content: string;
  readonly status: MessageStatus;
  readonly tokenCount: number | null;
  readonly createdAt: string;
}

/**
 * Body for `POST /api/v1/chats/:chatId/messages`.
 *
 * `sequence`, `status`, `tokenCount` and the identifiers are server-managed:
 * the sequence in particular is assigned inside the same transaction that
 * writes the row, which is what makes two clients appending at once safe.
 */
export interface CreateMessageInput {
  content: string;
  role?: MessageRole;
  agentId?: string | null;
}

/**
 * Filters for `GET /api/v1/chats/:chatId/messages`.
 *
 * `before` and `after` are sequence cursors, not offsets: `before` returns
 * messages earlier than that sequence, `after` the later ones. A transcript
 * reads backwards from the end, so it pages with `before` and `order: 'desc'`.
 */
export interface MessageListQuery extends PageQuery {
  readonly role?: MessageRole;
  readonly status?: MessageStatus;
  readonly agentId?: string;
  readonly before?: number;
  readonly after?: number;
}

/** How many messages one read of the transcript asks for. */
export const MESSAGE_PAGE_SIZE = 50;

/** True for the two roles the transcript draws as a person speaking. */
export function isConversational(role: MessageRole): boolean {
  return role === 'user' || role === 'assistant';
}
