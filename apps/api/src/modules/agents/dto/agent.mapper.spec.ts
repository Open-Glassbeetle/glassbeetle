import { describe, expect, it } from 'vitest';
import type { AgentRow } from './agent.mapper.js';
import {
  applyAgentUpdates,
  mapAgentRowToResponse,
  mapCreateAgentDtoToRow,
} from './agent.mapper.js';
import type { CreateAgentDto } from './create-agent.dto.js';
import type { UpdateAgentDto } from './update-agent.dto.js';

describe('agent.mapper', () => {
  const sampleRow: AgentRow = {
    id: '018f3a9e-0000-7000-8000-000000000001',
    name: 'Research Assistant',
    personality: 'Curious and thorough',
    instructions: 'Always cite sources',
    system_prompt_id: '018f3a9e-0000-7000-8000-000000000002',
    model_id: '018f3a9e-0000-7000-8000-000000000003',
    temperature: 0.7,
    max_tokens: 4096,
    model_params: '{"top_p":0.9,"presence_penalty":0.1}',
    picture_path: 'pictures/018f3a9e-0000-7000-8000-000000000001.jpg',
    created_at: '2026-10-04T10:00:00.000Z',
    updated_at: '2026-10-04T10:00:00.000Z',
  };

  describe('mapAgentRowToResponse', () => {
    it('correctly maps snake_case SQLite columns to camelCase API properties', () => {
      const response = mapAgentRowToResponse(sampleRow);

      expect(response.id).toBe(sampleRow.id);
      expect(response.name).toBe(sampleRow.name);
      expect(response.personality).toBe(sampleRow.personality);
      expect(response.instructions).toBe(sampleRow.instructions);
      expect(response.systemPromptId).toBe(sampleRow.system_prompt_id);
      expect(response.modelId).toBe(sampleRow.model_id);
      expect(response.temperature).toBe(sampleRow.temperature);
      expect(response.maxTokens).toBe(sampleRow.max_tokens);
      expect(response.createdAt).toBe(sampleRow.created_at);
      expect(response.updatedAt).toBe(sampleRow.updated_at);
    });

    it('does NOT expose picture_path; exposes hasPicture = true when picture is present', () => {
      const response = mapAgentRowToResponse(sampleRow);

      expect(response.hasPicture).toBe(true);
      expect(
        (response as Record<string, unknown>).picture_path,
      ).toBeUndefined();
      expect((response as Record<string, unknown>).picturePath).toBeUndefined();
    });

    it('exposes hasPicture = false when picture_path is null', () => {
      const rowWithoutPicture: AgentRow = {
        ...sampleRow,
        picture_path: null,
      };

      const response = mapAgentRowToResponse(rowWithoutPicture);
      expect(response.hasPicture).toBe(false);
    });

    it('parses valid JSON model_params into a real object', () => {
      const response = mapAgentRowToResponse(sampleRow);

      expect(response.modelParams).toEqual({
        top_p: 0.9,
        presence_penalty: 0.1,
      });
    });

    it('returns null for null model_params', () => {
      const rowWithNullParams: AgentRow = {
        ...sampleRow,
        model_params: null,
      };

      const response = mapAgentRowToResponse(rowWithNullParams);
      expect(response.modelParams).toBeNull();
    });

    it('gracefully degrades to null when SQLite contains invalid JSON in model_params', () => {
      const corruptRow: AgentRow = {
        ...sampleRow,
        model_params: '{invalid-json',
      };

      const response = mapAgentRowToResponse(corruptRow);
      expect(response.modelParams).toBeNull();
    });

    it('emits null for nullable fields rather than omitting them', () => {
      const minimalRow: AgentRow = {
        id: '018f3a9e-0000-7000-8000-000000000001',
        name: 'Bare Agent',
        personality: null,
        instructions: null,
        system_prompt_id: null,
        model_id: null,
        temperature: null,
        max_tokens: null,
        model_params: null,
        picture_path: null,
        created_at: '2026-10-04T10:00:00.000Z',
        updated_at: '2026-10-04T10:00:00.000Z',
      };

      const response = mapAgentRowToResponse(minimalRow);

      expect(response.personality).toBeNull();
      expect(response.instructions).toBeNull();
      expect(response.systemPromptId).toBeNull();
      expect(response.modelId).toBeNull();
      expect(response.temperature).toBeNull();
      expect(response.maxTokens).toBeNull();
      expect(response.modelParams).toBeNull();
      expect(response.hasPicture).toBe(false);
    });
  });

  describe('mapCreateAgentDtoToRow', () => {
    it('creates a valid row from minimal DTO with generated id and timestamps', () => {
      const dto: CreateAgentDto = { name: 'New Agent' };
      const row = mapCreateAgentDtoToRow(dto);

      expect(typeof row.id).toBe('string');
      expect(row.id).toHaveLength(36); // UUID format
      expect(row.name).toBe('New Agent');
      expect(row.personality).toBeNull();
      expect(row.instructions).toBeNull();
      expect(row.system_prompt_id).toBeNull();
      expect(row.model_id).toBeNull();
      expect(row.temperature).toBeNull();
      expect(row.max_tokens).toBeNull();
      expect(row.model_params).toBeNull();
      expect(row.picture_path).toBeNull();
      expect(row.created_at).toBe(row.updated_at);
      expect(typeof row.created_at).toBe('string');
    });

    it('serializes modelParams to a JSON string and applies optional overrides', () => {
      const dto: CreateAgentDto = {
        name: 'Configured Agent',
        personality: 'Friendly',
        instructions: 'Helpful',
        systemPromptId: 'sp-1',
        modelId: 'm-1',
        temperature: 0.5,
        maxTokens: 1000,
        modelParams: { custom: true, count: 5 },
      };

      const fixedId = '018f3a9e-0000-7000-8000-000000000099';
      const fixedTime = '2026-10-04T12:00:00.000Z';

      const row = mapCreateAgentDtoToRow(dto, { id: fixedId, now: fixedTime });

      expect(row.id).toBe(fixedId);
      expect(row.name).toBe('Configured Agent');
      expect(row.personality).toBe('Friendly');
      expect(row.instructions).toBe('Helpful');
      expect(row.system_prompt_id).toBe('sp-1');
      expect(row.model_id).toBe('m-1');
      expect(row.temperature).toBe(0.5);
      expect(row.max_tokens).toBe(1000);
      expect(row.model_params).toBe('{"custom":true,"count":5}');
      expect(row.picture_path).toBeNull();
      expect(row.created_at).toBe(fixedTime);
      expect(row.updated_at).toBe(fixedTime);
    });
  });

  describe('applyAgentUpdates', () => {
    it('returns hasChanges = false and leaves updated_at untouched on empty DTO', () => {
      const dto: UpdateAgentDto = {};
      const result = applyAgentUpdates(sampleRow, dto);

      expect(result.hasChanges).toBe(false);
      expect(result.updatedRow.updated_at).toBe(sampleRow.updated_at);
      expect(result.setClauses).toHaveLength(0);
      expect(result.setParams).toHaveLength(0);
    });

    it('returns hasChanges = false if fields have identical values to existing row', () => {
      const dto: UpdateAgentDto = {
        name: sampleRow.name,
        temperature: sampleRow.temperature,
      };
      const result = applyAgentUpdates(sampleRow, dto);

      expect(result.hasChanges).toBe(false);
      expect(result.setClauses).toHaveLength(0);
    });

    it('applies changed fields, sets updated_at, and builds SQL clauses', () => {
      const dto: UpdateAgentDto = {
        name: 'Renamed Assistant',
        temperature: 0.2,
      };
      const updateTime = '2026-10-04T15:00:00.000Z';

      const result = applyAgentUpdates(sampleRow, dto, { now: updateTime });

      expect(result.hasChanges).toBe(true);
      expect(result.updatedRow.name).toBe('Renamed Assistant');
      expect(result.updatedRow.temperature).toBe(0.2);
      expect(result.updatedRow.updated_at).toBe(updateTime);

      expect(result.setClauses).toEqual([
        'name = ?',
        'temperature = ?',
        'updated_at = ?',
      ]);
      expect(result.setParams).toEqual(['Renamed Assistant', 0.2, updateTime]);
    });

    it('handles null-vs-omitted: explicitly clears system_prompt_id and model_id when set to null', () => {
      const dto: UpdateAgentDto = {
        systemPromptId: null,
        modelId: null,
      };
      const updateTime = '2026-10-04T15:30:00.000Z';

      const result = applyAgentUpdates(sampleRow, dto, { now: updateTime });

      expect(result.hasChanges).toBe(true);
      expect(result.updatedRow.system_prompt_id).toBeNull();
      expect(result.updatedRow.model_id).toBeNull();
      // Omitted fields remain intact
      expect(result.updatedRow.name).toBe(sampleRow.name);
      expect(result.updatedRow.instructions).toBe(sampleRow.instructions);

      expect(result.setClauses).toContain('system_prompt_id = ?');
      expect(result.setClauses).toContain('model_id = ?');
      expect(result.setClauses).toContain('updated_at = ?');
    });

    it('serializes updated modelParams to JSON string', () => {
      const dto: UpdateAgentDto = {
        modelParams: { new_setting: 'enabled' },
      };

      const result = applyAgentUpdates(sampleRow, dto);

      expect(result.hasChanges).toBe(true);
      expect(result.updatedRow.model_params).toBe('{"new_setting":"enabled"}');
    });

    it('allows clearing modelParams by setting to null', () => {
      const dto: UpdateAgentDto = {
        modelParams: null,
      };

      const result = applyAgentUpdates(sampleRow, dto);

      expect(result.hasChanges).toBe(true);
      expect(result.updatedRow.model_params).toBeNull();
    });
  });
});
