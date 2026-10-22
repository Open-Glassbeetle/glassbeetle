import { Controller } from '@nestjs/common';

/**
 * Will expose the `/artifacts` endpoints.
 *
 * No routes yet. An artifact is a work product — a document, some code, a
 * file, or structured data — attributed to the project, chat and agent it
 * came out of, and carrying a `version` counter.
 */
@Controller('artifacts')
export class ArtifactsController {}
