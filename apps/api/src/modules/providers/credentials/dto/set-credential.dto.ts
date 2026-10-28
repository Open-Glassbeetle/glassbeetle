import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * The longest credential the endpoint accepts.
 *
 * Real provider keys are tens to a few hundred characters (Anthropic's and
 * OpenAI's are around 100); 4096 is generous for every kind we support,
 * including local runtimes and long-lived tokens, while still refusing a
 * pasted `.env` file, certificate or JSON blob before it is encrypted and
 * stored as if it were a key.
 */
export const CREDENTIAL_MAX_LENGTH = 4096;

/**
 * Request body for `PUT /api/v1/providers/:providerId/credential`.
 *
 * Accepts either `apiKey` or `value` as the property name for the credential
 * secret. Replaces any existing credential for the provider.
 *
 * Validation rules:
 * - Empty or whitespace-only inputs are rejected with 400 Bad Request.
 * - Non-string values are rejected with 400 Bad Request.
 * - Values longer than {@link CREDENTIAL_MAX_LENGTH} characters are rejected
 *   with 400 Bad Request.
 * - Unknown properties are rejected by the global validation pipe.
 * - The plaintext secret is never echoed in error messages.
 */
export class SetCredentialDto {
  @ApiPropertyOptional({
    description: `API key or credential secret for the provider (at most ${CREDENTIAL_MAX_LENGTH} characters)`,
    example: 'sk-ant-api03-sample-key-1234',
    maxLength: CREDENTIAL_MAX_LENGTH,
  })
  @IsOptional()
  @IsString({ message: 'apiKey must be a string' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1, { message: 'apiKey must not be empty' })
  @MaxLength(CREDENTIAL_MAX_LENGTH, {
    message: `apiKey must be at most ${CREDENTIAL_MAX_LENGTH} characters`,
  })
  apiKey?: string;

  @ApiPropertyOptional({
    description: `Alternative property name for the credential secret (at most ${CREDENTIAL_MAX_LENGTH} characters)`,
    example: 'sk-ant-api03-sample-key-1234',
    maxLength: CREDENTIAL_MAX_LENGTH,
  })
  @IsOptional()
  @IsString({ message: 'value must be a string' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1, { message: 'value must not be empty' })
  @MaxLength(CREDENTIAL_MAX_LENGTH, {
    message: `value must be at most ${CREDENTIAL_MAX_LENGTH} characters`,
  })
  value?: string;
}
