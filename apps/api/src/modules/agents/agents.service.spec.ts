import {
  BadRequestException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DatabaseService } from '../../database/database.service.js';
import { TestFixtures } from '../../../test/harness/fixtures.js';
import {
  AgentsService,
  escapeLikePattern,
  ALLOWED_AGENT_SORT_COLUMNS,
} from './agents.service.js';
import type { CreateAgentDto } from './dto/create-agent.dto.js';

describe('AgentsService', () => {
  let db: DatabaseService;
  let fixtures: TestFixtures;
  let service: AgentsService;

  beforeEach(() => {
    db = new DatabaseService();
    db.connect(':memory:');
    fixtures = new TestFixtures(db);
    service = new AgentsService(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('escapeLikePattern', () => {
    it('escapes %, _, and \\ with backslashes', () => {
      expect(escapeLikePattern('100%')).toBe('100\\%');
      expect(escapeLikePattern('agent_01')).toBe('agent\\_01');
      expect(escapeLikePattern('path\\test')).toBe('path\\\\test');
      expect(escapeLikePattern('normal-name')).toBe('normal-name');
      expect(escapeLikePattern('%_\\')).toBe('\\%\\_\\\\');
    });
  });

  describe('findAll', () => {
    it('returns an empty paginated collection when no agents exist', async () => {
      const result = await service.findAll({});

      expect(result).toEqual({
        items: [],
        total: 0,
        limit: 50,
        offset: 0,
      });
    });

    it('returns stored agents with mapped camelCase fields and parsed modelParams', async () => {
      const agent = fixtures.createAgent({
        name: 'Analysis Bot',
        personality: 'Analytical and calm',
        instructions: 'Summarize clearly',
        temperature: 0.4,
        max_tokens: 2048,
        model_params: '{"top_p":0.85,"presence_penalty":0.1}',
        picture_path: 'pictures/018f3a9e-0000-7000-8000-000000000001.jpg',
      });

      const result = await service.findAll({});

      expect(result.total).toBe(1);
      expect(result.items).toHaveLength(1);

      const item = result.items[0];
      expect(item.id).toBe(agent.id);
      expect(item.name).toBe('Analysis Bot');
      expect(item.personality).toBe('Analytical and calm');
      expect(item.instructions).toBe('Summarize clearly');
      expect(item.temperature).toBe(0.4);
      expect(item.maxTokens).toBe(2048);
      expect(item.modelParams).toEqual({ top_p: 0.85, presence_penalty: 0.1 });
      expect(item.hasPicture).toBe(true);
      // picture_path must NOT be leaked
      expect((item as Record<string, unknown>).picture_path).toBeUndefined();
      expect((item as Record<string, unknown>).picturePath).toBeUndefined();
      expect(typeof item.createdAt).toBe('string');
      expect(typeof item.updatedAt).toBe('string');
    });

    it('includes agents with null model_id in an unfiltered list', async () => {
      const model = fixtures.createModel();
      const agentWithModel = fixtures.createAgent({
        name: 'Agent With Model',
        model_id: model.id,
      });
      const agentWithoutModel = fixtures.createAgent({
        name: 'Agent Without Model',
        model_id: null,
      });

      const result = await service.findAll({});

      expect(result.total).toBe(2);
      const ids = result.items.map((a) => a.id);
      expect(ids).toContain(agentWithModel.id);
      expect(ids).toContain(agentWithoutModel.id);

      const unassigned = result.items.find((a) => a.id === agentWithoutModel.id);
      expect(unassigned?.modelId).toBeNull();
    });

    describe('filtering', () => {
      it('filters agents by exact modelId', async () => {
        const model1 = fixtures.createModel({ display_name: 'Model 1' });
        const model2 = fixtures.createModel({ display_name: 'Model 2' });

        const agent1 = fixtures.createAgent({ name: 'Agent 1', model_id: model1.id });
        fixtures.createAgent({ name: 'Agent 2', model_id: model2.id });
        fixtures.createAgent({ name: 'Agent 3', model_id: null });

        const result = await service.findAll({ modelId: model1.id });

        expect(result.total).toBe(1);
        expect(result.items[0].id).toBe(agent1.id);
        expect(result.items[0].modelId).toBe(model1.id);
      });

      it('filters for agents with unassigned model using modelId="null"', async () => {
        const model = fixtures.createModel();
        fixtures.createAgent({ name: 'Assigned', model_id: model.id });
        const unassigned = fixtures.createAgent({ name: 'Unassigned', model_id: null });

        const result = await service.findAll({ modelId: 'null' });

        expect(result.total).toBe(1);
        expect(result.items[0].id).toBe(unassigned.id);
        expect(result.items[0].modelId).toBeNull();
      });

      it('filters agents by exact systemPromptId', async () => {
        const prompt1 = fixtures.createSystemPrompt({ name: 'Prompt 1' });
        const prompt2 = fixtures.createSystemPrompt({ name: 'Prompt 2' });

        const agent1 = fixtures.createAgent({
          name: 'Agent 1',
          system_prompt_id: prompt1.id,
        });
        fixtures.createAgent({
          name: 'Agent 2',
          system_prompt_id: prompt2.id,
        });
        fixtures.createAgent({
          name: 'Agent 3',
          system_prompt_id: null,
        });

        const result = await service.findAll({ systemPromptId: prompt1.id });

        expect(result.total).toBe(1);
        expect(result.items[0].id).toBe(agent1.id);
        expect(result.items[0].systemPromptId).toBe(prompt1.id);
      });

      it('filters for agents with unassigned system prompt using systemPromptId="null"', async () => {
        const prompt = fixtures.createSystemPrompt();
        fixtures.createAgent({ name: 'Assigned', system_prompt_id: prompt.id });
        const unassigned = fixtures.createAgent({
          name: 'Unassigned',
          system_prompt_id: null,
        });

        const result = await service.findAll({ systemPromptId: 'null' });

        expect(result.total).toBe(1);
        expect(result.items[0].id).toBe(unassigned.id);
        expect(result.items[0].systemPromptId).toBeNull();
      });

      it('filters agents by name substring search (case-insensitive)', async () => {
        const match1 = fixtures.createAgent({ name: 'Senior Researcher' });
        const match2 = fixtures.createAgent({ name: 'Junior research assistant' });
        fixtures.createAgent({ name: 'Frontend Developer' });

        const result = await service.findAll({ name: 'research' });

        expect(result.total).toBe(2);
        const names = result.items.map((a) => a.name);
        expect(names).toContain(match1.name);
        expect(names).toContain(match2.name);
      });

      it('supports search query parameter as alias for name search', async () => {
        const match = fixtures.createAgent({ name: 'Creative Writer' });
        fixtures.createAgent({ name: 'Data Analyst' });

        const result = await service.findAll({ search: 'writer' });

        expect(result.total).toBe(1);
        expect(result.items[0].id).toBe(match.id);
      });

      it('properly escapes LIKE wildcards in search terms (% and _)', async () => {
        const exactMatchPercent = fixtures.createAgent({
          name: '100% Reliable Agent',
        });
        fixtures.createAgent({ name: '1000 Tasks Completed' });

        const exactMatchUnderscore = fixtures.createAgent({
          name: 'test_special_name',
        });
        fixtures.createAgent({ name: 'test-special-name' });

        // Search for "100%" should only match "100% Reliable Agent", not "1000"
        const percentResult = await service.findAll({ name: '100%' });
        expect(percentResult.total).toBe(1);
        expect(percentResult.items[0].id).toBe(exactMatchPercent.id);

        // Search for "test_special" should only match "test_special_name", not "test-special"
        const underscoreResult = await service.findAll({ name: 'test_special' });
        expect(underscoreResult.total).toBe(1);
        expect(underscoreResult.items[0].id).toBe(exactMatchUnderscore.id);
      });

      it('combines multiple filters with AND semantics', async () => {
        const model1 = fixtures.createModel();
        const model2 = fixtures.createModel();
        const prompt1 = fixtures.createSystemPrompt();

        const target = fixtures.createAgent({
          name: 'Target Researcher',
          model_id: model1.id,
          system_prompt_id: prompt1.id,
        });

        // Same name but different model
        fixtures.createAgent({
          name: 'Target Researcher',
          model_id: model2.id,
          system_prompt_id: prompt1.id,
        });

        // Same model but different name
        fixtures.createAgent({
          name: 'Other Agent',
          model_id: model1.id,
          system_prompt_id: prompt1.id,
        });

        const result = await service.findAll({
          name: 'Target',
          modelId: model1.id,
          systemPromptId: prompt1.id,
        });

        expect(result.total).toBe(1);
        expect(result.items[0].id).toBe(target.id);
      });
    });

    describe('pagination', () => {
      beforeEach(() => {
        for (let i = 1; i <= 15; i++) {
          fixtures.createAgent({
            name: `Agent ${String(i).padStart(2, '0')}`,
            created_at: `2026-10-01T00:${String(i).padStart(2, '0')}:00.000Z`,
          });
        }
      });

      it('applies default limit 50 and offset 0', async () => {
        const result = await service.findAll({});

        expect(result.total).toBe(15);
        expect(result.items).toHaveLength(15);
        expect(result.limit).toBe(50);
        expect(result.offset).toBe(0);
      });

      it('paginates the first page correctly', async () => {
        const result = await service.findAll({
          limit: 5,
          offset: 0,
          sort: 'name',
          order: 'asc',
        });

        expect(result.total).toBe(15);
        expect(result.items).toHaveLength(5);
        expect(result.items[0].name).toBe('Agent 01');
        expect(result.items[4].name).toBe('Agent 05');
      });

      it('paginates the middle and last pages correctly', async () => {
        const page2 = await service.findAll({
          limit: 5,
          offset: 5,
          sort: 'name',
          order: 'asc',
        });
        expect(page2.items).toHaveLength(5);
        expect(page2.items[0].name).toBe('Agent 06');
        expect(page2.items[4].name).toBe('Agent 10');

        const page3 = await service.findAll({
          limit: 5,
          offset: 10,
          sort: 'name',
          order: 'asc',
        });
        expect(page3.items).toHaveLength(5);
        expect(page3.items[0].name).toBe('Agent 11');
        expect(page3.items[4].name).toBe('Agent 15');
      });

      it('returns empty items when offset is beyond total count', async () => {
        const result = await service.findAll({ limit: 10, offset: 100 });

        expect(result.total).toBe(15);
        expect(result.items).toHaveLength(0);
        expect(result.offset).toBe(100);
      });
    });

    describe('sorting and security', () => {
      it('sorts by name ascending and descending', async () => {
        fixtures.createAgent({ name: 'Alpha' });
        fixtures.createAgent({ name: 'Zeta' });
        fixtures.createAgent({ name: 'Beta' });

        const asc = await service.findAll({ sort: 'name', order: 'asc' });
        expect(asc.items.map((a) => a.name)).toEqual(['Alpha', 'Beta', 'Zeta']);

        const desc = await service.findAll({ sort: 'name', order: 'desc' });
        expect(desc.items.map((a) => a.name)).toEqual(['Zeta', 'Beta', 'Alpha']);
      });

      it('sorts by id ascending and descending', async () => {
        const a1 = fixtures.createAgent({ name: 'A' });
        const a2 = fixtures.createAgent({ name: 'B' });

        const asc = await service.findAll({ sort: 'id', order: 'asc' });
        const desc = await service.findAll({ sort: 'id', order: 'desc' });

        const sortedIds = [a1.id, a2.id].sort();
        expect(asc.items.map((a) => a.id)).toEqual(sortedIds);
        expect(desc.items.map((a) => a.id)).toEqual([...sortedIds].reverse());
      });

      it('rejects un-whitelisted sort fields with BadRequestException (400)', async () => {
        await expect(service.findAll({ sort: 'hackerField' })).rejects.toThrow(
          BadRequestException,
        );
      });

      it('rejects SQL injection attempts in sort parameter', async () => {
        const maliciousSort = 'name; DROP TABLE agents; --';
        await expect(service.findAll({ sort: maliciousSort })).rejects.toThrow(
          BadRequestException,
        );
      });

      it('confirms ALLOWED_AGENT_SORT_COLUMNS keys', () => {
        expect(Object.keys(ALLOWED_AGENT_SORT_COLUMNS)).toEqual([
          'createdAt',
          'name',
          'id',
          'updatedAt',
        ]);
      });
    });
  });

  describe('findById', () => {
    it('returns null when agent does not exist', async () => {
      const found = await service.findById('non-existent-id');
      expect(found).toBeNull();
    });

    it('returns the agent when found', async () => {
      const agent = fixtures.createAgent({ name: 'Find Me' });
      const found = await service.findById(agent.id);

      expect(found).not.toBeNull();
      expect(found?.id).toBe(agent.id);
      expect(found?.name).toBe('Find Me');
    });
  });

  describe('findOne', () => {
    it('returns an existing agent with full resource mapping', async () => {
      const agent = fixtures.createAgent({
        name: 'Existing Agent',
        personality: 'Friendly bot',
        instructions: 'Help users',
        temperature: 0.5,
        max_tokens: 1500,
        model_params: '{"top_p":0.9}',
        picture_path: 'pictures/existing.png',
      });

      const result = await service.findOne(agent.id);

      expect(result.id).toBe(agent.id);
      expect(result.name).toBe('Existing Agent');
      expect(result.personality).toBe('Friendly bot');
      expect(result.instructions).toBe('Help users');
      expect(result.temperature).toBe(0.5);
      expect(result.maxTokens).toBe(1500);
      expect(result.modelParams).toEqual({ top_p: 0.9 });
      expect(result.hasPicture).toBe(true);
      expect((result as Record<string, unknown>).picture_path).toBeUndefined();
      expect((result as Record<string, unknown>).picturePath).toBeUndefined();
    });

    it('throws NotFoundException when agent does not exist', async () => {
      const missingId = '018f3a9e-0000-7000-8000-000000000999';

      await expect(service.findOne(missingId)).rejects.toThrow(
        NotFoundException,
      );

      try {
        await service.findOne(missingId);
      } catch (err: any) {
        expect(err.getStatus()).toBe(404);
        const res = err.getResponse();
        expect(res.code).toBe('AGENT_NOT_FOUND');
        expect(res.message).toContain(missingId);
      }
    });

    it('returns an agent with null modelId and null systemPromptId normally without error', async () => {
      const agent = fixtures.createAgent({
        name: 'Unconfigured Agent',
        model_id: null,
        system_prompt_id: null,
        personality: null,
        instructions: null,
      });

      const result = await service.findOne(agent.id);

      expect(result).toBeDefined();
      expect(result.id).toBe(agent.id);
      expect(result.modelId).toBeNull();
      expect(result.systemPromptId).toBeNull();
      expect(result.personality).toBeNull();
      expect(result.instructions).toBeNull();
    });

    it('safely handles an ID containing SQL metacharacters and throws NotFoundException', async () => {
      const sqlInjectionId = "018f3a9e' OR '1'='1";

      await expect(service.findOne(sqlInjectionId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('create', () => {
    it('creates an agent with minimal input (name only)', async () => {
      const dto: CreateAgentDto = { name: 'Minimal Bot' };
      const created = await service.create(dto);

      expect(created).toBeDefined();
      expect(typeof created.id).toBe('string');
      expect(created.id).toHaveLength(36);
      expect(created.name).toBe('Minimal Bot');
      expect(created.personality).toBeNull();
      expect(created.instructions).toBeNull();
      expect(created.systemPromptId).toBeNull();
      expect(created.modelId).toBeNull();
      expect(created.temperature).toBeNull();
      expect(created.maxTokens).toBeNull();
      expect(created.modelParams).toBeNull();
      expect(created.hasPicture).toBe(false);
      expect(typeof created.createdAt).toBe('string');
      expect(typeof created.updatedAt).toBe('string');
      expect(created.createdAt).toBe(created.updatedAt);

      // Verify row exists in DB
      const dbRow = db.get<{ id: string; name: string }>(
        'SELECT id, name FROM agents WHERE id = ?',
        [created.id],
      );
      expect(dbRow).toBeDefined();
      expect(dbRow?.name).toBe('Minimal Bot');
    });

    it('creates an agent with all optional fields and persists modelParams as JSON', async () => {
      const model = fixtures.createModel();
      const prompt = fixtures.createSystemPrompt();

      const dto: CreateAgentDto = {
        name: 'Full Feature Agent',
        personality: 'Analytical and patient',
        instructions: 'Format all math in LaTeX',
        systemPromptId: prompt.id,
        modelId: model.id,
        temperature: 0.6,
        maxTokens: 3000,
        modelParams: {
          top_p: 0.95,
          stop: ['END'],
          metadata: { version: 1 },
        },
      };

      const created = await service.create(dto);

      expect(created.name).toBe('Full Feature Agent');
      expect(created.personality).toBe('Analytical and patient');
      expect(created.instructions).toBe('Format all math in LaTeX');
      expect(created.systemPromptId).toBe(prompt.id);
      expect(created.modelId).toBe(model.id);
      expect(created.temperature).toBe(0.6);
      expect(created.maxTokens).toBe(3000);
      expect(created.modelParams).toEqual({
        top_p: 0.95,
        stop: ['END'],
        metadata: { version: 1 },
      });
      expect(created.hasPicture).toBe(false);

      // Verify DB stored JSON text for model_params
      const rawRow = db.get<{ model_params: string }>(
        'SELECT model_params FROM agents WHERE id = ?',
        [created.id],
      );
      expect(rawRow?.model_params).toBe(
        '{"top_p":0.95,"stop":["END"],"metadata":{"version":1}}',
      );
    });

    it('rejects non-existent modelId with 422 UnprocessableEntityException', async () => {
      const nonExistentModelId = '018f3a9e-0000-7000-8000-999999999999';
      const dto: CreateAgentDto = {
        name: 'Agent With Bad Model',
        modelId: nonExistentModelId,
      };

      await expect(service.create(dto)).rejects.toThrow(
        UnprocessableEntityException,
      );

      try {
        await service.create(dto);
      } catch (err: any) {
        expect(err.getStatus()).toBe(422);
        const res = err.getResponse();
        expect(res.code).toBe('MODEL_NOT_FOUND');
        expect(res.message).toContain(nonExistentModelId);
      }
    });

    it('rejects non-existent systemPromptId with 422 UnprocessableEntityException', async () => {
      const nonExistentPromptId = '018f3a9e-0000-7000-8000-888888888888';
      const dto: CreateAgentDto = {
        name: 'Agent With Bad Prompt',
        systemPromptId: nonExistentPromptId,
      };

      await expect(service.create(dto)).rejects.toThrow(
        UnprocessableEntityException,
      );

      try {
        await service.create(dto);
      } catch (err: any) {
        expect(err.getStatus()).toBe(422);
        const res = err.getResponse();
        expect(res.code).toBe('SYSTEM_PROMPT_NOT_FOUND');
        expect(res.message).toContain(nonExistentPromptId);
      }
    });

    it('ensures creation is atomic: rolls back if insert fails', async () => {
      const initialCount = db.get<{ total: number }>(
        'SELECT COUNT(*) AS total FROM agents',
      )?.total;

      // Force an error inside transaction by spying on db.run
      const originalRun = db.run.bind(db);
      db.run = () => {
        throw new Error('Simulated database write failure');
      };

      try {
        await expect(service.create({ name: 'Failing Agent' })).rejects.toThrow(
          'Simulated database write failure',
        );
      } finally {
        db.run = originalRun;
      }

      // Assert no row was created in agents table
      const afterCount = db.get<{ total: number }>(
        'SELECT COUNT(*) AS total FROM agents',
      )?.total;
      expect(afterCount).toBe(initialCount);
    });

    it('created row is readable afterwards through findAll', async () => {
      const created = await service.create({ name: 'Listable Agent' });

      const listResult = await service.findAll({});
      expect(listResult.total).toBe(1);
      expect(listResult.items[0].id).toBe(created.id);
      expect(listResult.items[0].name).toBe('Listable Agent');
    });
  });

  describe('update', () => {
    it('updates a single field on a fully-populated agent and asserts every other column is untouched', async () => {
      const model = fixtures.createModel();
      const prompt = fixtures.createSystemPrompt();

      const initialTime = '2026-10-01T10:00:00.000Z';
      const agent = fixtures.createAgent({
        name: 'Original Agent Name',
        personality: 'Original Personality',
        instructions: 'Original Instructions',
        system_prompt_id: prompt.id,
        model_id: model.id,
        temperature: 0.7,
        max_tokens: 2048,
        model_params: '{"top_p":0.9,"custom_key":"custom_val"}',
        picture_path: 'pictures/original-agent.jpg',
        created_at: initialTime,
        updated_at: initialTime,
      });

      const updated = await service.update(agent.id, {
        name: 'New Brand Name',
      });

      // Verify the returned DTO
      expect(updated.id).toBe(agent.id);
      expect(updated.name).toBe('New Brand Name');
      expect(updated.personality).toBe('Original Personality');
      expect(updated.instructions).toBe('Original Instructions');
      expect(updated.systemPromptId).toBe(prompt.id);
      expect(updated.modelId).toBe(model.id);
      expect(updated.temperature).toBe(0.7);
      expect(updated.maxTokens).toBe(2048);
      expect(updated.modelParams).toEqual({
        top_p: 0.9,
        custom_key: 'custom_val',
      });
      expect(updated.hasPicture).toBe(true);
      expect(updated.createdAt).toBe(initialTime);
      expect(updated.updatedAt).not.toBe(initialTime);

      // Verify the persisted row directly in SQLite
      const rawRow = db.get<Record<string, unknown>>(
        'SELECT * FROM agents WHERE id = ?',
        [agent.id],
      );
      expect(rawRow).toBeDefined();
      expect(rawRow?.id).toBe(agent.id);
      expect(rawRow?.name).toBe('New Brand Name');
      expect(rawRow?.personality).toBe('Original Personality');
      expect(rawRow?.instructions).toBe('Original Instructions');
      expect(rawRow?.system_prompt_id).toBe(prompt.id);
      expect(rawRow?.model_id).toBe(model.id);
      expect(rawRow?.temperature).toBe(0.7);
      expect(rawRow?.max_tokens).toBe(2048);
      expect(rawRow?.model_params).toBe(
        '{"top_p":0.9,"custom_key":"custom_val"}',
      );
      expect(rawRow?.picture_path).toBe('pictures/original-agent.jpg');
      expect(rawRow?.created_at).toBe(initialTime);
      expect(rawRow?.updated_at).not.toBe(initialTime);
    });

    it('updated_at advances on successful update; created_at does not change', async () => {
      const fixedInitialTime = '2026-09-01T08:00:00.000Z';
      const agent = fixtures.createAgent({
        name: 'Time Test Agent',
        created_at: fixedInitialTime,
        updated_at: fixedInitialTime,
      });

      const updated = await service.update(agent.id, {
        personality: 'Evolved Persona',
      });

      expect(updated.createdAt).toBe(fixedInitialTime);
      expect(updated.updatedAt).not.toBe(fixedInitialTime);
      expect(new Date(updated.updatedAt).getTime()).toBeGreaterThan(
        new Date(fixedInitialTime).getTime(),
      );

      const persisted = db.get<{ created_at: string; updated_at: string }>(
        'SELECT created_at, updated_at FROM agents WHERE id = ?',
        [agent.id],
      );
      expect(persisted?.created_at).toBe(fixedInitialTime);
      expect(persisted?.updated_at).toBe(updated.updatedAt);
    });

    it('explicitly clears each nullable field when set to null', async () => {
      const model = fixtures.createModel();
      const prompt = fixtures.createSystemPrompt();

      const agent = fixtures.createAgent({
        name: 'Clearing Agent',
        personality: 'To Be Cleared',
        instructions: 'To Be Cleared',
        system_prompt_id: prompt.id,
        model_id: model.id,
        temperature: 0.8,
        max_tokens: 1500,
        model_params: '{"clear":true}',
      });

      const updated = await service.update(agent.id, {
        personality: null,
        instructions: null,
        systemPromptId: null,
        modelId: null,
        temperature: null,
        maxTokens: null,
        modelParams: null,
      });

      expect(updated.name).toBe('Clearing Agent');
      expect(updated.personality).toBeNull();
      expect(updated.instructions).toBeNull();
      expect(updated.systemPromptId).toBeNull();
      expect(updated.modelId).toBeNull();
      expect(updated.temperature).toBeNull();
      expect(updated.maxTokens).toBeNull();
      expect(updated.modelParams).toBeNull();

      const rawRow = db.get<Record<string, unknown>>(
        'SELECT * FROM agents WHERE id = ?',
        [agent.id],
      );
      expect(rawRow?.personality).toBeNull();
      expect(rawRow?.instructions).toBeNull();
      expect(rawRow?.system_prompt_id).toBeNull();
      expect(rawRow?.model_id).toBeNull();
      expect(rawRow?.temperature).toBeNull();
      expect(rawRow?.max_tokens).toBeNull();
      expect(rawRow?.model_params).toBeNull();
    });

    it('distinguishes omitted fields from null and leaves omitted fields untouched', async () => {
      const model = fixtures.createModel();
      const agent = fixtures.createAgent({
        name: 'Original Name',
        personality: 'Keep Me',
        instructions: 'Keep Me Too',
        model_id: model.id,
        temperature: 0.5,
      });

      const updated = await service.update(agent.id, {
        temperature: 0.9,
      });

      expect(updated.temperature).toBe(0.9);
      expect(updated.name).toBe('Original Name');
      expect(updated.personality).toBe('Keep Me');
      expect(updated.instructions).toBe('Keep Me Too');
      expect(updated.modelId).toBe(model.id);
    });

    it('clearing modelId leaves an agent with null modelId (valid detached state)', async () => {
      const model = fixtures.createModel();
      const agent = fixtures.createAgent({
        name: 'Model Detached Agent',
        model_id: model.id,
      });

      const updated = await service.update(agent.id, {
        modelId: null,
      });

      expect(updated.modelId).toBeNull();

      const raw = db.get<{ model_id: string | null }>(
        'SELECT model_id FROM agents WHERE id = ?',
        [agent.id],
      );
      expect(raw?.model_id).toBeNull();
    });

    it('re-serialises modelParams to JSON text on write and returns parsed object', async () => {
      const agent = fixtures.createAgent({
        name: 'Params Agent',
        model_params: '{"old":true}',
      });

      const updated = await service.update(agent.id, {
        modelParams: {
          frequency_penalty: 0.5,
          presence_penalty: 0.2,
          stop: ['\n', 'USER:'],
        },
      });

      expect(updated.modelParams).toEqual({
        frequency_penalty: 0.5,
        presence_penalty: 0.2,
        stop: ['\n', 'USER:'],
      });

      const raw = db.get<{ model_params: string }>(
        'SELECT model_params FROM agents WHERE id = ?',
        [agent.id],
      );
      expect(raw?.model_params).toBe(
        '{"frequency_penalty":0.5,"presence_penalty":0.2,"stop":["\\n","USER:"]}',
      );
    });

    it('treats empty body as a no-op: returns 200 OK without bumping updated_at', async () => {
      const fixedTime = '2026-10-02T12:00:00.000Z';
      const agent = fixtures.createAgent({
        name: 'No-op Agent',
        created_at: fixedTime,
        updated_at: fixedTime,
      });

      const updated = await service.update(agent.id, {});

      expect(updated.id).toBe(agent.id);
      expect(updated.name).toBe('No-op Agent');
      expect(updated.updatedAt).toBe(fixedTime);

      const persisted = db.get<{ updated_at: string }>(
        'SELECT updated_at FROM agents WHERE id = ?',
        [agent.id],
      );
      expect(persisted?.updated_at).toBe(fixedTime);
    });

    it('does not bump updated_at if fields have identical values to existing row', async () => {
      const fixedTime = '2026-10-02T12:00:00.000Z';
      const agent = fixtures.createAgent({
        name: 'Unchanged Name Agent',
        temperature: 0.5,
        created_at: fixedTime,
        updated_at: fixedTime,
      });

      const updated = await service.update(agent.id, {
        name: 'Unchanged Name Agent',
        temperature: 0.5,
      });

      expect(updated.updatedAt).toBe(fixedTime);

      const persisted = db.get<{ updated_at: string }>(
        'SELECT updated_at FROM agents WHERE id = ?',
        [agent.id],
      );
      expect(persisted?.updated_at).toBe(fixedTime);
    });

    it('throws 404 NotFoundException when agent does not exist', async () => {
      const nonExistentId = '018f3a9e-0000-7000-8000-000000000404';

      await expect(
        service.update(nonExistentId, { name: 'New Name' }),
      ).rejects.toThrow(NotFoundException);

      try {
        await service.update(nonExistentId, { name: 'New Name' });
      } catch (err: any) {
        expect(err.getStatus()).toBe(404);
        const res = err.getResponse();
        expect(res.code).toBe('AGENT_NOT_FOUND');
        expect(res.message).toContain(nonExistentId);
      }
    });

    it('throws 404 NotFoundException for non-existent agent even with empty body', async () => {
      const nonExistentId = '018f3a9e-0000-7000-8000-000000000404';

      await expect(service.update(nonExistentId, {})).rejects.toThrow(
        NotFoundException,
      );
    });

    it('rejects non-existent modelId with 422 UnprocessableEntityException', async () => {
      const agent = fixtures.createAgent({ name: 'FK Agent' });
      const badModelId = '018f3a9e-0000-7000-8000-999999999999';

      await expect(
        service.update(agent.id, { modelId: badModelId }),
      ).rejects.toThrow(UnprocessableEntityException);

      try {
        await service.update(agent.id, { modelId: badModelId });
      } catch (err: any) {
        expect(err.getStatus()).toBe(422);
        const res = err.getResponse();
        expect(res.code).toBe('MODEL_NOT_FOUND');
        expect(res.message).toContain(badModelId);
      }
    });

    it('rejects non-existent systemPromptId with 422 UnprocessableEntityException', async () => {
      const agent = fixtures.createAgent({ name: 'FK Agent' });
      const badPromptId = '018f3a9e-0000-7000-8000-888888888888';

      await expect(
        service.update(agent.id, { systemPromptId: badPromptId }),
      ).rejects.toThrow(UnprocessableEntityException);

      try {
        await service.update(agent.id, { systemPromptId: badPromptId });
      } catch (err: any) {
        expect(err.getStatus()).toBe(422);
        const res = err.getResponse();
        expect(res.code).toBe('SYSTEM_PROMPT_NOT_FOUND');
        expect(res.message).toContain(badPromptId);
      }
    });

    it('ensures update is atomic: rolls back if update fails', async () => {
      const agent = fixtures.createAgent({ name: 'Safe Agent' });

      const originalRun = db.run.bind(db);
      db.run = () => {
        throw new Error('Simulated update database write failure');
      };

      try {
        await expect(
          service.update(agent.id, { name: 'Failed Name' }),
        ).rejects.toThrow('Simulated update database write failure');
      } finally {
        db.run = originalRun;
      }

      // Assert row in agents table is still the original name
      const current = db.get<{ name: string }>(
        'SELECT name FROM agents WHERE id = ?',
        [agent.id],
      );
      expect(current?.name).toBe('Safe Agent');
    });
  });
});

