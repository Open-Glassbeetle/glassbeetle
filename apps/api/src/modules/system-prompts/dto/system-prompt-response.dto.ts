/**
 * Public API representation of a system prompt resource.
 *
 * System prompts are reusable instruction templates that agents reference
 * via `agents.system_prompt_id`.
 */
export class SystemPromptResponseDto {
  /** Unique system prompt identifier (UUIDv7). */
  readonly id!: string;

  /** Human-readable display name for the prompt template. */
  readonly name!: string;

  /** Full instruction text / system prompt body. */
  readonly content!: string;

  /** Timestamp of system prompt creation in ISO-8601 UTC format. */
  readonly createdAt!: string;

  /** Timestamp of last system prompt update in ISO-8601 UTC format. */
  readonly updatedAt!: string;
}

export type SystemPromptResponse = Readonly<SystemPromptResponseDto>;
