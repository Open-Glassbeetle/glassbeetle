import { Global, Module } from '@nestjs/common';
import { FileStorageService } from './file-storage.service.js';

/**
 * File storage module providing filesystem operations over managed storage buckets.
 */
@Global()
@Module({
  providers: [FileStorageService],
  exports: [FileStorageService],
})
export class FileStorageModule {}
