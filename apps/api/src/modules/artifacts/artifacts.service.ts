import { Injectable } from '@nestjs/common';

/**
 * Will own the `artifacts` table.
 *
 * Not implemented. The schema stores small artifacts inline in `content` and
 * large or binary ones as a `file_path` reference into file storage, so the
 * implementation has to choose between the two and, as everywhere else,
 * never return the path.
 */
@Injectable()
export class ArtifactsService {}
