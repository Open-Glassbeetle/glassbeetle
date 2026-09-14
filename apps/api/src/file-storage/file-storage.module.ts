import { Module } from '@nestjs/common';
import { FileStorageService } from './file-storage.service';

@Module({
  providers: [FileStorageService]
})
export class FileStorageModule {}
