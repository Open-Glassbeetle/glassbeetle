import { Module } from '@nestjs/common';
import { ApplicationController } from './application.controller';
import { BackupsController } from './backups/backups.controller';
import { BackupsService } from './backups/backups.service';
import { BackupPolicyController } from './backup-policy/backup-policy.controller';
import { BackupPolicyService } from './backup-policy/backup-policy.service';

@Module({
  controllers: [ApplicationController, BackupsController, BackupPolicyController],
  providers: [BackupsService, BackupPolicyService]
})
export class ApplicationModule {}
