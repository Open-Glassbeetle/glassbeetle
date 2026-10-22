import { Controller } from '@nestjs/common';

/**
 * Will expose the application-level endpoints under `/application`.
 *
 * No routes yet. Backups and the backup policy have their own controllers
 * below this path.
 */
@Controller('application')
export class ApplicationController {}
