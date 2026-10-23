import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, MinLength } from 'class-validator';

/**
 * Request body for `PUT /api/v1/providers/:providerId/credential`.
 *
 * Accepts either `apiKey` or `value` as the property name for the credential
 * secret. Replaces any existing credential for the provider.
 *
 * Validation rules:
 * - Empty or whitespace-only inputs are rejected with 400 Bad Request.
 * - Non-string values are rejected with 400 Bad Request.
 * - Unknown properties are rejected by the global validation pipe.
 * - The plaintext secret is never echoed in error messages.
 */
export class SetCredentialDto {
  @ApiPropertyOptional({
    description: 'API key or credential secret for the provider',
    example: 'sk-ant-api03-sample-key-1234',
  })
  @IsOptional()
  @IsString({ message: 'apiKey must be a string' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1, { message: 'apiKey must not be empty' })
  apiKey?: string;

  @ApiPropertyOptional({
    description: 'Alternative property name for the credential secret',
    example: 'sk-ant-api03-sample-key-1234',
  })
  @IsOptional()
  @IsString({ message: 'value must be a string' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1, { message: 'value must not be empty' })
  value?: string;
}
