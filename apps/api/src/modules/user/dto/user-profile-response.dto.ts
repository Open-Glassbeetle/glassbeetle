import { ApiProperty } from '@nestjs/swagger';

/**
 * Public API representation of the user profile.
 *
 * Follows Glassbeetle API conventions:
 * - Identifiers are UUIDv7 strings.
 * - Timestamps are ISO-8601 UTC strings (`nowIso()`).
 * - Column names are mapped from SQLite `snake_case` to JSON `camelCase`.
 * - Nullable columns are emitted as `null`, never omitted.
 * - `picture_path` is never exposed; `hasPicture` says whether one is stored
 *   and `GET /user/picture` serves it.
 * - `singleton` is not exposed: it is how the database refuses a second row,
 *   not information about the user.
 */
export class UserProfileResponseDto {
  @ApiProperty({
    description: 'Unique profile identifier (UUIDv7)',
    example: '018f3a9e-0000-7000-8000-000000000001',
  })
  readonly id!: string;

  @ApiProperty({
    type: String,
    description:
      'Name the interface greets and agents address the user by. Seeded from the operating system account on first read.',
    example: 'Ada',
    nullable: true,
  })
  readonly displayName!: string | null;

  @ApiProperty({
    type: String,
    description:
      'Pronouns agents should use for the user, so they are not inferred from a name',
    example: 'she/her',
    nullable: true,
  })
  readonly pronouns!: string | null;

  @ApiProperty({
    type: String,
    description:
      'Free text describing the user for agents to read: role, current work, how they want to be addressed',
    example: 'Works on Glassbeetle. Prefers short answers and real file paths.',
    nullable: true,
  })
  readonly about!: string | null;

  @ApiProperty({
    type: String,
    description:
      'BCP-47 language tag agents answer in. Seeded from the operating system on first read.',
    example: 'de-CH',
    nullable: true,
  })
  readonly locale!: string | null;

  @ApiProperty({
    type: String,
    description:
      'IANA time zone the user lives in, so an agent can resolve "tomorrow morning". Seeded from the operating system on first read.',
    example: 'Europe/Zurich',
    nullable: true,
  })
  readonly timezone!: string | null;

  @ApiProperty({
    description:
      'Whether the profile is included in prompts. While enabled, name, pronouns and `about` are sent to the configured model provider on every completion — for a remote provider, to a third party.',
    example: true,
  })
  readonly includeInPrompts!: boolean;

  @ApiProperty({
    description:
      'Whether a profile picture is stored. The bytes are served by `GET /user/picture`.',
    example: true,
  })
  readonly hasPicture!: boolean;

  @ApiProperty({
    type: String,
    description:
      'When the profile picture was last replaced, in ISO-8601 UTC format. Usable as a cache-busting query parameter on `GET /user/picture`, which serves a stable URL.',
    example: '2026-10-08T14:22:10.904Z',
    nullable: true,
  })
  readonly pictureUpdatedAt!: string | null;

  @ApiProperty({
    description: 'Timestamp of profile creation in ISO-8601 UTC format',
    example: '2026-10-01T08:00:00.000Z',
  })
  readonly createdAt!: string;

  @ApiProperty({
    description: 'Timestamp of the last profile update in ISO-8601 UTC format',
    example: '2026-10-08T14:22:10.904Z',
  })
  readonly updatedAt!: string;
}

/**
 * Interface representation of the user profile.
 */
export type UserProfileResponse = Readonly<UserProfileResponseDto>;
