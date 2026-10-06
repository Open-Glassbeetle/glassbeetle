import type { PageQuery } from './pagination';

/**
 * An agent as the API represents it (`GET /api/v1/agents/:agentId`).
 *
 * Nullable fields are always present and explicitly `null` — the API never
 * omits them, so "not set" is distinguishable from "unknown to this version".
 */
export interface Agent {
  readonly id: string;
  readonly name: string;
  readonly personality: string | null;
  readonly instructions: string | null;
  readonly systemPromptId: string | null;
  readonly modelId: string | null;
  readonly temperature: number | null;
  readonly maxTokens: number | null;
  readonly modelParams: Record<string, unknown> | null;
  /**
   * Whether a profile picture has been uploaded. The stored path is never
   * exposed, and the API has no endpoint to read the image back yet, so the UI
   * can only show that one exists.
   */
  readonly hasPicture: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Body for `POST /api/v1/agents`. Only `name` is required. */
export interface CreateAgentInput {
  name: string;
  personality?: string | null;
  instructions?: string | null;
  systemPromptId?: string | null;
  modelId?: string | null;
  temperature?: number | null;
  maxTokens?: number | null;
  modelParams?: Record<string, unknown> | null;
}

/**
 * Body for `PATCH /api/v1/agents/:agentId`.
 *
 * An omitted key leaves the column untouched; an explicit `null` clears it.
 * `name` may not be null or empty.
 */
export type UpdateAgentInput = Partial<Omit<CreateAgentInput, 'name'>> & {
  name?: string;
};

/** Fields `GET /api/v1/agents` accepts for `sort`. */
export const AGENT_SORT_FIELDS = ['createdAt', 'updatedAt', 'name', 'id'] as const;
export type AgentSortField = (typeof AGENT_SORT_FIELDS)[number];

/**
 * Filters for `GET /api/v1/agents`.
 *
 * `modelId` and `systemPromptId` accept the literal string `'null'` to select
 * agents that have none assigned.
 */
export interface AgentListQuery extends PageQuery {
  readonly search?: string;
  readonly modelId?: string;
  readonly systemPromptId?: string;
}

/** Image types the picture endpoint accepts. SVG is rejected (stored XSS). */
export const ACCEPTED_PICTURE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
