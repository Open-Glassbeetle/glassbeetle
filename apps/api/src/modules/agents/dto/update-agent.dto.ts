import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsNotEmpty, IsString, ValidateIf } from 'class-validator';
import { CreateAgentDto } from './create-agent.dto.js';

/**
 * Request payload for updating an existing agent (PATCH).
 *
 * Extends `CreateAgentDto` via `PartialType` so that all fields are optional.
 *
 * Handling of fields:
 * - Omitted (`undefined`): Field is not modified; database retains existing value.
 * - Explicit `null`: Nullable fields (`personality`, `instructions`, `systemPromptId`,
 *   `modelId`, `temperature`, `maxTokens`, `modelParams`) are cleared (set to NULL).
 * - `name`: Cannot be set to `null` or empty string. If provided, must be a non-empty string.
 * - Empty body (`{}`): Treated as an idempotent no-op (200 OK without updating `updated_at`).
 * - Server-managed fields (`id`, `createdAt`, `updatedAt`) and `picturePath` are rejected.
 */
export class UpdateAgentDto extends PartialType(CreateAgentDto) {
  @ApiPropertyOptional({
    type: String,
    description: 'Display name of the agent (cannot be null or empty)',
    example: 'Lead Researcher',
  })
  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: 'name must be a string' })
  @IsNotEmpty({ message: 'name must not be empty' })
  override name?: string;
}
