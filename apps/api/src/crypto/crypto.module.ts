import { Module } from '@nestjs/common';
import { EncryptionService } from './encryption/encryption.service.js';

/**
 * Provides {@link EncryptionService} for encrypting data at rest.
 *
 * Imported by `AppModule` and by `ProvidersModule`, the only feature that
 * currently stores ciphertext. Not `@Global()` on purpose: a module that can
 * decrypt provider credentials should have to say so by importing this one.
 */
@Module({
  providers: [EncryptionService],
  exports: [EncryptionService],
})
export class CryptoModule {}
