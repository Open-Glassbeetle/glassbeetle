import { Controller } from '@nestjs/common';

/**
 * Will expose `/providers/:providerId/credential`.
 *
 * No routes yet. A singular path segment because a provider has at most one
 * credential — `provider_credentials.provider_id` is its primary key.
 *
 * One rule is already fixed by the API conventions: there is no endpoint
 * that returns a credential's plaintext and none should be added.
 * `masked_preview` is the only credential value a response may carry.
 */
@Controller('providers/:providerId/credential')
export class CredentialsController {}
