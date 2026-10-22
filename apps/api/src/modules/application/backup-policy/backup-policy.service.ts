import { Injectable } from '@nestjs/common';

/**
 * Will own the single `backup_policy` row.
 *
 * Not implemented. The row holds whether scheduled backups are enabled,
 * their frequency, how many to retain, and the target directory; it is
 * seeded by the bootstrap migration, so unlike the user profile and the
 * budget it does not need provisioning on read.
 */
@Injectable()
export class BackupPolicyService {}
