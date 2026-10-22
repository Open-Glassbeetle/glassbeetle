import { Controller } from '@nestjs/common';

/**
 * Will expose the `/projects` endpoints.
 *
 * No routes yet. A project is the optional grouping a chat or an artifact
 * can belong to — `projects` holds a name, a description and an image
 * reference — and chats can already be filtered by `projectId`, so the
 * column is reachable before this resource is.
 */
@Controller('projects')
export class ProjectsController {}
