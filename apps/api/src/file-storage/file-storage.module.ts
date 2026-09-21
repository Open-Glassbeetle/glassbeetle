import { Module } from '@nestjs/common';
import { FileStorageService } from './file-storage.service.js';

@Module({
  providers: [FileStorageService]
})
export class FileStorageModule {}
