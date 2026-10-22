import { Controller } from '@nestjs/common';

/**
 * Will expose `/application/backup-policy`.
 *
 * No routes yet. The policy is a singleton — `backup_policy` has
 * `CHECK (id = 1)` — so the path has no id, like `/user` and `/budget`.
 */
@Controller('application/backup-policy')
export class BackupPolicyController {}
