import { Injectable } from '@nestjs/common';

/**
 * Will own `provider_credentials`: a provider's API key, encrypted at rest.
 *
 * Not implemented. The scheme it has to use is already settled and
 * documented in `EncryptionService`: AES-256-GCM with a fresh nonce per
 * write, the provider id bound as additional authenticated data so a
 * ciphertext cannot be moved between provider rows, and a masked preview
 * produced by `maskKey` for display.
 */
@Injectable()
export class CredentialsService {}
