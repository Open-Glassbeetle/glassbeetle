import { Module } from '@nestjs/common';
import { ApplicationController } from './application.controller.js';
import { BackupsController } from './backups/backups.controller.js';
import { BackupsService } from './backups/backups.service.js';
import { BackupPolicyController } from './backup-policy/backup-policy.controller.js';
import { BackupPolicyService } from './backup-policy/backup-policy.service.js';

/**
 * Will wire the application-lifecycle endpoints: backups, restore and the
 * backup policy.
 *
 * A placeholder: all three controllers declare their paths but no routes.
 * The `backups` and `backup_policy` tables exist, and `backup_policy` is
 * seeded with one row by the bootstrap migration.
 */
@Module({
  controllers: [ApplicationController, BackupsController, BackupPolicyController],
  providers: [BackupsService, BackupPolicyService]
})
export class ApplicationModule {}
