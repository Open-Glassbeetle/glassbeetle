import type { PageQuery } from './pagination';

/**
 * A team as the API represents it (`GET /api/v1/teams/:teamId`).
 *
 * A team is an ordered roster of agents; the order is the turn order a
 * multi-agent chat would run them in. Nothing runs yet — there is no inference
 * module — so a team is configuration, the same way an agent is.
 */
export interface Team {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  /** How many agents are on the roster, carried on every list row. */
  readonly memberCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Body for `POST /api/v1/teams`. Only `name` is required. */
export interface CreateTeamInput {
  name: string;
  description?: string | null;
}

/**
 * Body for `PATCH /api/v1/teams/:teamId`.
 *
 * An omitted key leaves the field alone; an explicit `null` clears the
 * description. `name` may not be null or empty.
 */
export type UpdateTeamInput = Partial<Omit<CreateTeamInput, 'name'>> & {
  name?: string;
};

/** Fields `GET /api/v1/teams` accepts for `sort`. */
export const TEAM_SORT_FIELDS = ['createdAt', 'updatedAt', 'name', 'id'] as const;
export type TeamSortField = (typeof TEAM_SORT_FIELDS)[number];

/** Filters for `GET /api/v1/teams`. */
export interface TeamListQuery extends PageQuery {
  readonly search?: string;
  readonly name?: string;
}

/**
 * One agent's place on a team (`GET /api/v1/teams/:teamId/members`).
 *
 * There is no id of its own: the membership is keyed by the pair, and
 * addressed as `/teams/:teamId/members/:agentId`.
 *
 * Only the agent's id is returned. Names come from the roster the shell
 * already holds, so the two cannot disagree and no extra request is made.
 */
export interface TeamMember {
  readonly teamId: string;
  readonly agentId: string;
  readonly role: string | null;
  /** Place in the turn order, counting from zero. Always dense, never tied. */
  readonly position: number;
  readonly createdAt: string;
}

/** Body for `POST /api/v1/teams/:teamId/members`. The agent is appended. */
export interface AddTeamMemberInput {
  agentId: string;
  role?: string | null;
}

/**
 * Body for `PATCH /api/v1/teams/:teamId/members/:agentId`.
 *
 * Only the role. Position is rejected by the API: the order is a dense
 * sequence with one way in, `reorderMembers`.
 */
export interface UpdateTeamMemberInput {
  role?: string | null;
}

/** Longest role label the API accepts. */
export const MAX_MEMBER_ROLE_LENGTH = 60;

/** Longest team name the API accepts. */
export const MAX_TEAM_NAME_LENGTH = 120;

/** Longest team description the API accepts. */
export const MAX_TEAM_DESCRIPTION_LENGTH = 2000;
