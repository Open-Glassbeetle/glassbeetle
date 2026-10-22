import { Injectable } from '@nestjs/common';

/**
 * Will own the `projects` table.
 *
 * Not implemented. `projects.image_path` is a filesystem reference, so the
 * implementation will go through `FileStorageService` and must never
 * serialise the path — the agents and user pictures set the pattern.
 */
@Injectable()
export class ProjectsService {}
