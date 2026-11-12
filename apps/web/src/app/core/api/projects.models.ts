import type { PageQuery } from './pagination';

/**
 * A project as the API represents it (`GET /api/v1/projects/:projectId`).
 *
 * A project is a folder for work: the chats held in it and the artifacts
 * those chats produced. Both counts come from the API, so a list of projects
 * can say how much is in each without a request per row.
 */
export interface Project {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly hasImage: boolean;
  readonly chatCount: number;
  readonly artifactCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Body for `POST /api/v1/projects`. Only `name` is required. */
export interface CreateProjectInput {
  name: string;
  description?: string | null;
}

/**
 * Body for `PATCH /api/v1/projects/:projectId`.
 *
 * An omitted key leaves the column alone; an explicit `null` clears the
 * description.
 */
export interface UpdateProjectInput {
  name?: string;
  description?: string | null;
}

/** Filters for `GET /api/v1/projects`. `search` matches the name. */
export interface ProjectListQuery extends PageQuery {
  readonly search?: string;
}

/** Longest project name the UI offers; the API validates the real bound. */
export const MAX_PROJECT_NAME_LENGTH = 120;
