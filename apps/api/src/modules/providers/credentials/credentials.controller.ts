import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Put,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { ApiErrorResponseDto } from '../../../common/http/api-error.js';
import { CredentialsService } from './credentials.service.js';
import { CredentialResponseDto } from './dto/credential-response.dto.js';
import { SetCredentialDto } from './dto/set-credential.dto.js';

/**
 * Controller for `/providers/:providerId/credential`.
 *
 * Exposes the three credential management endpoints for an AI provider.
 * A credential is a singleton sub-resource: one provider has at most one
 * credential, stored encrypted, and its plaintext value must never leave the server.
 *
 * ## Security Guarantees:
 * - Plaintext API keys and secrets are never returned in responses, logged, or echoed in error messages.
 * - Ciphertext and cryptographic nonces are never returned.
 * - Only safe masked previews produced by `maskKey` (e.g. `sk-ant-…4f2a`) are returned.
 */
@ApiTags('providers')
@Controller('providers/:providerId/credential')
export class CredentialsController {
  constructor(private readonly credentialsService: CredentialsService) {}

  /**
   * Retrieve credential metadata for a provider.
   *
   * Returns metadata only: whether a credential is configured, its masked
   * preview, and its creation/update timestamps. Never returns plaintext,
   * ciphertext, or cryptographic nonces.
   *
   * @param providerId - Parent provider identifier.
   */
  @Get()
  @ApiOperation({
    summary: 'Retrieve credential metadata for a provider',
    description: `Returns metadata only: whether a credential is configured, its safe masked preview (e.g. \`sk-ant-…4f2a\`), and its timestamps.

It must never return the plaintext API key, the ciphertext, or the cryptographic nonce. Returns 404 when the provider does not exist or when no credential is configured.`,
  })
  @ApiParam({
    name: 'providerId',
    description: 'Provider identifier (UUIDv7)',
    example: '018f3a9e-0000-7000-8000-000000000001',
  })
  @ApiOkResponse({
    description: 'Credential metadata for the provider',
    type: CredentialResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Provider does not exist, or has no credential configured',
    type: ApiErrorResponseDto,
  })
  find(@Param('providerId') providerId: string): CredentialResponseDto {
    return this.credentialsService.find(providerId);
  }

  /**
   * Set or replace the credential for a provider.
   *
   * Replaces any existing credential (upsert). Encrypts the secret at rest with
   * AES-256-GCM and a fresh nonce per write before persisting. No outbound call
   * is made to test the credential.
   *
   * @param providerId - Parent provider identifier.
   * @param dto - Request body with `apiKey` or `value`.
   */
  @Put()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Set or replace credential for a provider',
    description: `Sets or replaces the API credential for the specified provider (PUT upsert).

The plaintext secret is encrypted at rest using AES-256-GCM with a fresh random 96-bit nonce before storage; no plaintext is ever written to the database.

No outbound network call is made to test or validate the key with the remote provider.
Returns 200 with the credential metadata (safe masked preview and timestamps).`,
  })
  @ApiParam({
    name: 'providerId',
    description: 'Provider identifier (UUIDv7)',
    example: '018f3a9e-0000-7000-8000-000000000001',
  })
  @ApiOkResponse({
    description: 'Updated credential metadata',
    type: CredentialResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'Request validation failed (e.g. empty, whitespace-only or over-long value)',
    type: ApiErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Provider does not exist',
    type: ApiErrorResponseDto,
  })
  set(
    @Param('providerId') providerId: string,
    @Body() dto: SetCredentialDto,
  ): CredentialResponseDto {
    return this.credentialsService.set(providerId, dto);
  }

  /**
   * Delete a provider's credential.
   *
   * Removes the credential row from storage. Returns 204 No Content.
   *
   * ### Idempotent DELETE
   * Calling DELETE when no credential is configured on an existing provider
   * succeeds idempotently with 204. If the parent provider itself does not
   * exist, 404 is returned.
   *
   * @param providerId - Parent provider identifier.
   */
  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete credential for a provider',
    description: `Removes the credential for the specified provider.

This operation is idempotent: if the provider exists but has no credential configured, it returns 204 No Content without error.
Returns 404 only when the parent provider itself does not exist.`,
  })
  @ApiParam({
    name: 'providerId',
    description: 'Provider identifier (UUIDv7)',
    example: '018f3a9e-0000-7000-8000-000000000001',
  })
  @ApiNoContentResponse({
    description:
      'Credential successfully deleted, or was already absent (idempotent)',
  })
  @ApiNotFoundResponse({
    description: 'Provider does not exist',
    type: ApiErrorResponseDto,
  })
  remove(@Param('providerId') providerId: string): void {
    this.credentialsService.remove(providerId);
  }
}
