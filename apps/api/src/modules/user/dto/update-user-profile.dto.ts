import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { IsResolvableLocale, IsResolvableTimezone } from './intl-validators.js';

/**
 * Collapses surrounding whitespace and an emptied field to `null`.
 *
 * A form that clears a text input submits `""`, which is not a name — and
 * storing it would make `displayName` a string the UI has to treat as absent
 * anyway. One representation of "not set" is enough.
 */
function trimToNull({ value }: { value: unknown }): unknown {
  if (typeof value !== 'string') {
    return value;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Maximum length of `about`.
 *
 * A prompt budget rather than a storage concern: this text is prepended to
 * every completion, so 4000 characters is already a meaningful slice of a small
 * model's context window.
 */
export const MAX_ABOUT_LENGTH = 4000;

/**
 * Request payload for updating the user profile (PATCH).
 *
 * There is no create payload: the profile is a singleton that `GET /user`
 * provisions, so there is never a moment at which a client could create it.
 *
 * Handling of fields:
 * - Omitted (`undefined`): field is not modified.
 * - Explicit `null`, or a string of only whitespace: field is cleared.
 * - Empty body (`{}`): idempotent no-op (200 OK, `updatedAt` untouched).
 * - Server-managed fields (`id`, `createdAt`, `updatedAt`), `hasPicture`,
 *   `pictureUpdatedAt` and the stored picture path are rejected.
 */
export class UpdateUserProfileDto {
  @ApiPropertyOptional({
    type: String,
    description: 'Name the interface greets and agents address the user by',
    example: 'Ada',
    maxLength: 120,
    nullable: true,
  })
  @IsOptional()
  @Transform(trimToNull)
  @IsString({ message: 'displayName must be a string' })
  @MaxLength(120, { message: 'displayName must not exceed 120 characters' })
  displayName?: string | null;

  @ApiPropertyOptional({
    type: String,
    description: 'Pronouns agents should use for the user',
    example: 'she/her',
    maxLength: 60,
    nullable: true,
  })
  @IsOptional()
  @Transform(trimToNull)
  @IsString({ message: 'pronouns must be a string' })
  @MaxLength(60, { message: 'pronouns must not exceed 60 characters' })
  pronouns?: string | null;

  @ApiPropertyOptional({
    type: String,
    description: 'Free text describing the user for agents to read',
    example: 'Works on Glassbeetle. Prefers short answers and real file paths.',
    maxLength: MAX_ABOUT_LENGTH,
    nullable: true,
  })
  @IsOptional()
  @Transform(trimToNull)
  @IsString({ message: 'about must be a string' })
  @MaxLength(MAX_ABOUT_LENGTH, {
    message: `about must not exceed ${MAX_ABOUT_LENGTH} characters`,
  })
  about?: string | null;

  @ApiPropertyOptional({
    type: String,
    description: 'BCP-47 language tag agents answer in',
    example: 'de-CH',
    nullable: true,
  })
  @IsOptional()
  @Transform(trimToNull)
  @IsResolvableLocale()
  locale?: string | null;

  @ApiPropertyOptional({
    type: String,
    description: 'IANA time zone name the user lives in',
    example: 'Europe/Zurich',
    nullable: true,
  })
  @IsOptional()
  @Transform(trimToNull)
  @IsResolvableTimezone()
  timezone?: string | null;

  @ApiPropertyOptional({
    description:
      'Whether the profile may be included in prompts sent to model providers',
    example: true,
  })
  // `@IsOptional()` would also let `null` through, and `null` has no meaning
  // here: the column is NOT NULL, so there is no "unset" state to clear it to.
  // Accepting it would quietly store `false` and switch prompt sharing off
  // without the client asking.
  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean({ message: 'includeInPrompts must be a boolean' })
  includeInPrompts?: boolean;
}
