import { Controller } from '@nestjs/common';

/**
 * Will expose `/application/backups`.
 *
 * No routes yet. The `backups` table records each archive's stored file, its
 * size, and whether it was taken manually or on schedule.
 */
@Controller('application/backups')
export class BackupsController {}
