import type { PageQuery } from './pagination';

/**
 * A chat as the API represents it (`GET /api/v1/chats/:chatId`).
 *
 * A chat is the container a conversation happens in: who it belongs to, what
 * it is called, and the compacted summary of what has been said. The turns
 * themselves are their own resource (`messages.models.ts`), read from
 * `/chats/:chatId/messages`. What is still missing is generation: the
 * completion endpoints are empty controllers, so a conversation can be read
 * and appended to, but nothing answers.
 *
 * Both owner fields are nullable even though a chat is created with exactly
 * one owner: deleting an agent or a team clears the reference rather than the
 * chat, so an owner-less chat is a state the UI has to render.
 */
export interface Chat {
  readonly id: string;
  readonly title: string | null;
  readonly projectId: string | null;
  readonly agentId: string | null;
  readonly teamId: string | null;
  /** Written by the compaction endpoint; read-only on every CRUD write. */
  readonly contextSummary: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Body for `POST /api/v1/chats`.
 *
 * Exactly one of `agentId` and `teamId` has to be set: the API rejects both
 * and neither with a 400. `title` is optional — an untitled chat is a valid
 * chat, and the UI names it in the list rather than inventing a stored title.
 */
export interface CreateChatInput {
  title?: string | null;
  projectId?: string | null;
  agentId?: string | null;
  teamId?: string | null;
}

/**
 * Body for `PATCH /api/v1/chats/:chatId`.
 *
 * An omitted key leaves the column untouched; an explicit `null` clears the
 * title or detaches the chat from its project. The owner is deliberately not
 * in here: the API refuses to move a conversation to a different agent or
 * team, because its history was produced under the original one.
 */
export interface UpdateChatInput {
  title?: string | null;
  projectId?: string | null;
}

/** Fields `GET /api/v1/chats` accepts for `sort`. */
export const CHAT_SORT_FIELDS = ['createdAt', 'updatedAt', 'title', 'id'] as const;
export type ChatSortField = (typeof CHAT_SORT_FIELDS)[number];

/**
 * Filters for `GET /api/v1/chats`.
 *
 * Each filter accepts the literal string `'null'` to select chats with no
 * project, no agent or no team.
 *
 * There is no text filter: the endpoint takes no `search` parameter, and the
 * API rejects unknown query parameters outright. That is why the chat list
 * filters by owner rather than offering a search box like the other
 * collections do.
 */
export interface ChatListQuery extends PageQuery {
  readonly projectId?: string;
  readonly agentId?: string;
  readonly teamId?: string;
}

/** Longest chat title the API accepts. */
export const MAX_CHAT_TITLE_LENGTH = 200;

/** Which kind of thing a chat belongs to. */
export type ChatOwnerKind = 'agent' | 'team';

/** A chat's owner, as the id of either an agent or a team. */
export interface ChatOwner {
  readonly kind: ChatOwnerKind;
  readonly id: string;
}

/**
 * The owner a chat was created under, or `null` once that agent or team has
 * been deleted.
 */
export function ownerOf(chat: Chat): ChatOwner | null {
  if (chat.agentId) {
    return { kind: 'agent', id: chat.agentId };
  }

  if (chat.teamId) {
    return { kind: 'team', id: chat.teamId };
  }

  return null;
}

/** What to call a chat that was never given a title. */
export const UNTITLED_CHAT = 'Untitled chat';

/** A chat's title, or the placeholder the UI shows in its place. */
export function titleOf(chat: Chat): string {
  return chat.title?.trim() ? chat.title : UNTITLED_CHAT;
}
