import { Module } from '@nestjs/common';
import { ApplicationController } from './application.controller.js';
import { BackupsController } from './backups/backups.controller.js';
import { BackupsService } from './backups/backups.service.js';
import { BackupPolicyController } from './backup-policy/backup-policy.controller.js';
import { BackupPolicyService } from './backup-policy/backup-policy.service.js';

@Module({
  controllers: [ApplicationController, BackupsController, BackupPolicyController],
  providers: [BackupsService, BackupPolicyService]
})
export class ApplicationModule {}
