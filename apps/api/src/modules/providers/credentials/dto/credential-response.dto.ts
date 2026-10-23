import { ApiProperty } from '@nestjs/swagger';

/**
 * Public metadata response for a provider credential.
 *
 * Never exposes the plaintext API key, ciphertext, or cryptographic nonce.
 * Exposes only metadata, timestamps, and the safe masked preview.
 */
export class CredentialResponseDto {
  @ApiProperty({
    description: 'Identifier of the provider this credential belongs to',
    example: '018f3a9e-0000-7000-8000-000000000001',
  })
  readonly providerId!: string;

  @ApiProperty({
    description: 'Whether an encrypted credential is configured for this provider',
    example: true,
  })
  readonly configured!: boolean;

  @ApiProperty({
    description:
      'Safe masked preview of the credential (e.g. sk-ant-…4f2a), suitable for UI display',
    example: 'sk-ant-…4f2a',
  })
  readonly maskedPreview!: string;

  @ApiProperty({
    description:
      'When the credential was originally created, in ISO-8601 UTC format',
    example: '2026-10-24T12:00:00.000Z',
  })
  readonly createdAt!: string;

  @ApiProperty({
    description:
      'When the credential was last updated, in ISO-8601 UTC format',
    example: '2026-10-24T12:00:00.000Z',
  })
  readonly updatedAt!: string;
}

/** Readonly view of {@link CredentialResponseDto} for callers that only consume one. */
export type CredentialResponse = Readonly<CredentialResponseDto>;
