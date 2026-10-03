import { Module } from '@nestjs/common';
import { EncryptionService } from './encryption/encryption.service.js';

@Module({
  providers: [EncryptionService],
  exports: [EncryptionService],
})
export class CryptoModule {}
