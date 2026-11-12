import type { PageQuery } from './pagination';

/** The classifications `artifacts.type` holds. */
export const ARTIFACT_TYPES = ['document', 'code', 'file', 'structured'] as const;
export type ArtifactType = (typeof ARTIFACT_TYPES)[number];

/**
 * Something an agent produced (`GET /api/v1/artifacts/:artifactId`).
 *
 * All three references are nullable: an artifact survives the chat it came
 * from, the agent that wrote it and the project it was filed under, with the
 * reference cleared. `content` is only present on a single read — a list
 * carries the metadata and leaves the body to be asked for.
 */
export interface Artifact {
  readonly id: string;
  readonly projectId: string | null;
  readonly chatId: string | null;
  readonly agentId: string | null;
  readonly title: string;
  readonly type: string;
  readonly mimeType: string | null;
  readonly content?: string | null;
  readonly hasFile: boolean;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Filters for `GET /api/v1/artifacts`.
 *
 * Each reference filter accepts the literal `'null'` for artifacts that have
 * none. `search` is a substring match on the title.
 */
export interface ArtifactListQuery extends PageQuery {
  readonly projectId?: string;
  readonly chatId?: string;
  readonly agentId?: string;
  readonly type?: string;
  readonly search?: string;
}

/** The icon an artifact of this type is listed with. */
export function artifactIcon(type: string): string {
  switch (type) {
    case 'code':
      return 'code';
    case 'structured':
      return 'data_object';
    case 'file':
      return 'draft';
    default:
      return 'description';
  }
}
