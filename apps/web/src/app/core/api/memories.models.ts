import type { PageQuery } from './pagination';

/**
 * A memory — a free-text fact with tags.
 *
 * Agent memories (`/agents/:agentId/memories`) and shared memories
 * (`/memories`) differ only in scoping, so the UI models the common shape once
 * and `AgentMemory` adds the owning agent.
 */
export interface Memory {
  readonly id: string;
  readonly content: string;
  /** Always an array; the API never returns a JSON string or `null`. */
  readonly tags: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AgentMemory extends Memory {
  readonly agentId: string;
}

/** Upper bound the API enforces on `content`. */
export const MEMORY_CONTENT_MAX_LENGTH = 100_000;

export interface CreateMemoryInput {
  content: string;
  tags?: string[];
}

/** `tags: null` or `[]` clears the tags; an omitted key leaves them alone. */
export interface UpdateMemoryInput {
  content?: string;
  tags?: string[] | null;
}

export const MEMORY_SORT_FIELDS = ['createdAt', 'updatedAt', 'content', 'id'] as const;
export type MemorySortField = (typeof MEMORY_SORT_FIELDS)[number];

export interface MemoryListQuery extends PageQuery {
  /** Matches memories carrying this exact tag. */
  readonly tag?: string;
  /** Case-insensitive substring search over `content`. */
  readonly search?: string;
}
