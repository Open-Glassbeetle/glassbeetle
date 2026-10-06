import type { PageQuery } from './pagination';

/**
 * A reusable instruction template that agents reference through
 * `agents.systemPromptId`.
 */
export interface SystemPrompt {
  readonly id: string;
  readonly name: string;
  readonly content: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateSystemPromptInput {
  name: string;
  content: string;
}

/** Neither field may be cleared — both columns are `NOT NULL`. */
export interface UpdateSystemPromptInput {
  name?: string;
  content?: string;
}

export const SYSTEM_PROMPT_SORT_FIELDS = ['createdAt', 'updatedAt', 'name', 'id'] as const;
export type SystemPromptSortField = (typeof SYSTEM_PROMPT_SORT_FIELDS)[number];

export interface SystemPromptListQuery extends PageQuery {
  readonly search?: string;
}
