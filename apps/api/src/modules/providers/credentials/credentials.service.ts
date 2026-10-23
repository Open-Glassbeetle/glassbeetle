import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../../../database/database.service.js';
import { EncryptionService } from '../../../crypto/encryption/encryption.service.js';
import { nowIso } from '../../../common/persistence/timestamps.js';
import { SetCredentialDto } from './dto/set-credential.dto.js';
import { CredentialResponseDto } from './dto/credential-response.dto.js';

/**
 * Raw row shape from SQLite table `provider_credentials`.
 */
export interface ProviderCredentialRow {
  provider_id: string;
  encrypted_value: Buffer;
  nonce: Buffer;
  masked_preview: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Manages `provider_credentials`: AI provider API keys, encrypted at rest.
 *
 * A credential is a singleton sub-resource: one provider has at most one
 * credential. Plaintext secrets are never stored in the database, never
 * returned in responses, and never logged.
 *
 * ## Security Guarantees:
 * 1. Plaintext secrets are encrypted immediately using AES-256-GCM via {@link EncryptionService}.
 * 2. Each write generates a fresh 96-bit cryptographic nonce (IV). Nonces are never reused.
 * 3. The `provider_id` is bound as Additional Authenticated Data (AAD) during encryption and decryption,
 *    preventing ciphertext transplantation between provider records.
 * 4. Only safe masked previews produced by {@link EncryptionService.maskKey} are exposed to clients.
 * 5. DELETE is idempotent: deleting an already absent credential on an existing provider succeeds with 204.
 */
@Injectable()
export class CredentialsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly encryptionService: EncryptionService,
  ) {}

  /**
   * Retrieves the metadata for a provider's credential.
   *
   * Returns metadata only (`configured`, `maskedPreview`, `createdAt`, `updatedAt`).
   * Plaintext, ciphertext, and cryptographic nonces are never returned.
   *
   * @param providerId - Parent provider identifier.
   * @throws NotFoundException if the provider does not exist, or if no credential is configured.
   */
  find(providerId: string): CredentialResponseDto {
    this.assertProviderExists(providerId);

    const row = this.db.get<ProviderCredentialRow>(
      'SELECT * FROM provider_credentials WHERE provider_id = ?',
      [providerId],
    );

    if (!row) {
      throw new NotFoundException(
        `No credential configured for provider '${providerId}'`,
      );
    }

    return {
      providerId: row.provider_id,
      configured: true,
      maskedPreview: row.masked_preview ?? '',
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Sets or replaces the credential for a provider (upsert).
   *
   * Encrypts the secret with AES-256-GCM and a fresh nonce before persisting.
   * Plaintext is never written to the database. If a credential already exists,
   * it is replaced and `updated_at` is refreshed while `created_at` is preserved.
   *
   * @param providerId - Parent provider identifier.
   * @param dto - Request body containing the plaintext `apiKey` or `value`.
   * @returns Metadata shape matching {@link find}.
   * @throws NotFoundException if the provider does not exist.
   * @throws BadRequestException if the secret is missing, empty, or whitespace-only.
   */
  set(providerId: string, dto: SetCredentialDto): CredentialResponseDto {
    this.assertProviderExists(providerId);

    const secret = (dto.apiKey ?? dto.value)?.trim();
    if (!secret || secret.length === 0) {
      throw new BadRequestException(
        'Credential value is required and cannot be empty',
      );
    }

    // Encrypt with fresh nonce per write; providerId bound as AAD
    const { encryptedValue, nonce } = this.encryptionService.encrypt(
      secret,
      providerId,
    );
    const maskedPreview = this.encryptionService.maskKey(secret);
    const now = nowIso();

    this.db.run(
      `INSERT INTO provider_credentials (
         provider_id,
         encrypted_value,
         nonce,
         masked_preview,
         created_at,
         updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(provider_id) DO UPDATE SET
         encrypted_value = excluded.encrypted_value,
         nonce = excluded.nonce,
         masked_preview = excluded.masked_preview,
         updated_at = excluded.updated_at`,
      [providerId, encryptedValue, nonce, maskedPreview, now, now],
    );

    const row = this.db.get<ProviderCredentialRow>(
      'SELECT * FROM provider_credentials WHERE provider_id = ?',
      [providerId],
    );

    if (!row) {
      throw new InternalServerErrorException(
        'Failed to retrieve persisted credential record',
      );
    }

    return {
      providerId: row.provider_id,
      configured: true,
      maskedPreview: row.masked_preview ?? '',
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Deletes a provider's credential.
   *
   * ### Idempotent DELETE Rationale
   * Calling DELETE on a provider that has no credential configured succeeds
   * idempotently and returns normally (which translates to HTTP 204 No Content).
   * Per HTTP semantics (RFC 9110), DELETE is idempotent: once executed, the
   * resource is absent regardless of whether it existed immediately prior to the call.
   *
   * If the parent provider itself does not exist, a 404 is raised.
   *
   * @param providerId - Parent provider identifier.
   * @throws NotFoundException if the provider does not exist.
   */
  remove(providerId: string): void {
    this.assertProviderExists(providerId);

    this.db.run('DELETE FROM provider_credentials WHERE provider_id = ?', [
      providerId,
    ]);
  }

  /**
   * Decrypts and returns the raw plaintext credential for a provider.
   *
   * **Internal server-side use only** (e.g. by model adapters when issuing
   * completion requests to provider APIs). Never expose this method or its return
   * value through any HTTP controller, response DTO, error message, or log line.
   *
   * @param providerId - Parent provider identifier.
   * @returns Decrypted plaintext API key string.
   * @throws NotFoundException if the provider or credential does not exist.
   * @throws DecryptionError if decryption or authentication verification fails.
   */
  getDecryptedCredential(providerId: string): string {
    this.assertProviderExists(providerId);

    const row = this.db.get<ProviderCredentialRow>(
      'SELECT * FROM provider_credentials WHERE provider_id = ?',
      [providerId],
    );

    if (!row) {
      throw new NotFoundException(
        `No credential configured for provider '${providerId}'`,
      );
    }

    return this.encryptionService.decrypt(
      row.encrypted_value,
      row.nonce,
      providerId,
    );
  }

  /**
   * Asserts that the parent provider exists in the database.
   *
   * @throws NotFoundException if no provider with the given ID exists.
   */
  private assertProviderExists(providerId: string): void {
    const provider = this.db.get<{ id: string }>(
      'SELECT id FROM providers WHERE id = ?',
      [providerId],
    );

    if (!provider) {
      throw new NotFoundException(`Provider '${providerId}' not found`);
    }
  }
}
