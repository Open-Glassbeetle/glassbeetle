import { newId } from '../../../common/persistence/identifiers.js';
import {
  parseJsonColumn,
  serializeJsonColumn,
} from '../../../common/persistence/row-mapping.js';
import { nowIso } from '../../../common/persistence/timestamps.js';
import type { AgentResponseDto } from './agent-response.dto.js';
import type { CreateAgentDto } from './create-agent.dto.js';
import type { UpdateAgentDto } from './update-agent.dto.js';

/**
 * Raw row shape for the `agents` SQLite table.
 */
export interface AgentRow {
  readonly id: string;
  readonly name: string;
  readonly personality: string | null;
  readonly instructions: string | null;
  readonly system_prompt_id: string | null;
  readonly model_id: string | null;
  readonly temperature: number | null;
  readonly max_tokens: number | null;
  readonly model_params: string | null;
  readonly picture_path: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

/**
 * Options when mapping a CreateAgentDto to a new database row.
 */
export interface CreateAgentRowOptions {
  /** Optional ID override (defaults to generating a new UUIDv7). */
  readonly id?: string;
  /** Optional timestamp override (defaults to nowIso()). */
  readonly now?: string;
}

/**
 * Maps a SQLite `agents` row to the public `AgentResponseDto`.
 *
 * Ensures:
 * - `picture_path` is never leaked; replaced by `hasPicture: boolean`.
 * - `model_params` is deserialized from JSON text into an object (or null on failure).
 * - Nullable columns are returned as `null`, not undefined.
 * - Snake_case columns are mapped to camelCase.
 */
export function mapAgentRowToResponse(row: AgentRow): AgentResponseDto {
  return {
    id: row.id,
    name: row.name,
    personality: row.personality ?? null,
    instructions: row.instructions ?? null,
    systemPromptId: row.system_prompt_id ?? null,
    modelId: row.model_id ?? null,
    temperature: row.temperature ?? null,
    maxTokens: row.max_tokens ?? null,
    modelParams: parseJsonColumn<Record<string, unknown> | null>(
      row.model_params,
      null,
    ),
    hasPicture: Boolean(row.picture_path),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Maps a `CreateAgentDto` to a fresh `AgentRow` ready for database insertion.
 */
export function mapCreateAgentDtoToRow(
  dto: CreateAgentDto,
  options?: CreateAgentRowOptions,
): AgentRow {
  const timestamp = options?.now ?? nowIso();

  return {
    id: options?.id ?? newId(),
    name: dto.name,
    personality: dto.personality ?? null,
    instructions: dto.instructions ?? null,
    system_prompt_id: dto.systemPromptId ?? null,
    model_id: dto.modelId ?? null,
    temperature: dto.temperature ?? null,
    max_tokens: dto.maxTokens ?? null,
    model_params: serializeJsonColumn(dto.modelParams),
    picture_path: null,
    created_at: timestamp,
    updated_at: timestamp,
  };
}

/**
 * Result of evaluating an `UpdateAgentDto` against an existing `AgentRow`.
 */
export interface AgentUpdateResult {
  /** The updated row representation. */
  readonly updatedRow: AgentRow;
  /** True if at least one field was changed. */
  readonly hasChanges: boolean;
  /** Map of column names to new values for SQL UPDATE. */
  readonly changedColumns: Readonly<Record<string, unknown>>;
  /** SQL SET clauses (e.g. `["name = ?", "system_prompt_id = ?"]`). */
  readonly setClauses: readonly string[];
  /** Parameter values corresponding to `setClauses`. */
  readonly setParams: readonly unknown[];
}

/**
 * Applies an `UpdateAgentDto` to an existing `AgentRow`.
 *
 * Implements the null-vs-omitted contract:
 * - Omitted (`undefined`): Column is unchanged.
 * - Explicit `null`: Nullable column is set to `null`.
 * - Value: Column is set to the provided value.
 * - If no fields were modified (`{}`), returns `hasChanges: false` without altering `updated_at`.
 */
export function applyAgentUpdates(
  existingRow: AgentRow,
  dto: UpdateAgentDto,
  options?: { readonly now?: string },
): AgentUpdateResult {
  const changedColumns: Record<string, unknown> = {};
  const setClauses: string[] = [];
  const setParams: unknown[] = [];

  function recordChange(
    columnName: keyof AgentRow,
    sqlColumn: string,
    newValue: unknown,
  ): void {
    changedColumns[columnName] = newValue;
    setClauses.push(`${sqlColumn} = ?`);
    setParams.push(newValue);
  }

  if (dto.name !== undefined && dto.name !== existingRow.name) {
    recordChange('name', 'name', dto.name);
  }

  if (
    dto.personality !== undefined &&
    dto.personality !== existingRow.personality
  ) {
    recordChange('personality', 'personality', dto.personality);
  }

  if (
    dto.instructions !== undefined &&
    dto.instructions !== existingRow.instructions
  ) {
    recordChange('instructions', 'instructions', dto.instructions);
  }

  if (
    dto.systemPromptId !== undefined &&
    dto.systemPromptId !== existingRow.system_prompt_id
  ) {
    recordChange('system_prompt_id', 'system_prompt_id', dto.systemPromptId);
  }

  if (dto.modelId !== undefined && dto.modelId !== existingRow.model_id) {
    recordChange('model_id', 'model_id', dto.modelId);
  }

  if (
    dto.temperature !== undefined &&
    dto.temperature !== existingRow.temperature
  ) {
    recordChange('temperature', 'temperature', dto.temperature);
  }

  if (dto.maxTokens !== undefined && dto.maxTokens !== existingRow.max_tokens) {
    recordChange('max_tokens', 'max_tokens', dto.maxTokens);
  }

  if (dto.modelParams !== undefined) {
    const serialized = serializeJsonColumn(dto.modelParams);
    if (serialized !== existingRow.model_params) {
      recordChange('model_params', 'model_params', serialized);
    }
  }

  const hasChanges = setClauses.length > 0;
  const updatedAt = hasChanges
    ? (options?.now ?? nowIso())
    : existingRow.updated_at;

  if (hasChanges) {
    changedColumns.updated_at = updatedAt;
    setClauses.push('updated_at = ?');
    setParams.push(updatedAt);
  }

  const updatedRow: AgentRow = {
    ...existingRow,
    ...(changedColumns as Partial<AgentRow>),
    updated_at: updatedAt,
  };

  return {
    updatedRow,
    hasChanges,
    changedColumns,
    setClauses,
    setParams,
  };
}
