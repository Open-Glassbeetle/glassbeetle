import { BadRequestException, NotFoundException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DatabaseService } from '../../database/database.service.js';
import { TestFixtures } from '../../../test/harness/fixtures.js';
import { SystemPromptsService } from './system-prompts.service.js';
import type { CreateSystemPromptDto } from './dto/create-system-prompt.dto.js';

describe('SystemPromptsService', () => {
  let db: DatabaseService;
  let fixtures: TestFixtures;
  let service: SystemPromptsService;

  beforeEach(() => {
    db = new DatabaseService();
    db.connect(':memory:');
    fixtures = new TestFixtures(db);
    service = new SystemPromptsService(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('findAll', () => {
    it('returns an empty paginated collection when no system prompts exist', async () => {
      const result = await service.findAll({});

      expect(result).toEqual({
        items: [],
        total: 0,
        limit: 50,
        offset: 0,
      });
    });

    it('returns stored system prompts with default pagination limit and offset', async () => {
      fixtures.createSystemPrompt({ name: 'Prompt A' });
      fixtures.createSystemPrompt({ name: 'Prompt B' });

      const result = await service.findAll({});

      expect(result.total).toBe(2);
      expect(result.items).toHaveLength(2);
      expect(result.limit).toBe(50);
      expect(result.offset).toBe(0);
    });

    it('filters system prompts by name substring search', async () => {
      fixtures.createSystemPrompt({ name: 'Research Assistant Prompt' });
      fixtures.createSystemPrompt({ name: 'Coding Helper Prompt' });

      const result = await service.findAll({ name: 'Research' });

      expect(result.total).toBe(1);
      expect(result.items[0].name).toBe('Research Assistant Prompt');
    });

    it('filters system prompts using the search alias', async () => {
      fixtures.createSystemPrompt({ name: 'Research Assistant Prompt' });
      fixtures.createSystemPrompt({ name: 'Coding Helper Prompt' });

      const result = await service.findAll({ search: 'Coding' });

      expect(result.total).toBe(1);
      expect(result.items[0].name).toBe('Coding Helper Prompt');
    });

    it('escapes LIKE wildcard characters in search', async () => {
      fixtures.createSystemPrompt({ name: 'Prompt 100% Guaranteed' });
      fixtures.createSystemPrompt({ name: 'Prompt 1000' });

      const result = await service.findAll({ search: '100%' });

      expect(result.total).toBe(1);
      expect(result.items[0].name).toBe('Prompt 100% Guaranteed');
    });

    it('sorts system prompts ascending and descending by allowed columns', async () => {
      fixtures.createSystemPrompt({ name: 'Alpha Prompt' });
      fixtures.createSystemPrompt({ name: 'Beta Prompt' });

      const ascResult = await service.findAll({ sort: 'name', order: 'asc' });
      expect(ascResult.items[0].name).toBe('Alpha Prompt');
      expect(ascResult.items[1].name).toBe('Beta Prompt');

      const descResult = await service.findAll({ sort: 'name', order: 'desc' });
      expect(descResult.items[0].name).toBe('Beta Prompt');
      expect(descResult.items[1].name).toBe('Alpha Prompt');
    });

    it('throws BadRequestException on disallowed sort column', async () => {
      await expect(
        service.findAll({ sort: 'disallowed_column' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('respects pagination limit and offset parameters', async () => {
      fixtures.createSystemPrompt({ name: 'Prompt 1' });
      fixtures.createSystemPrompt({ name: 'Prompt 2' });
      fixtures.createSystemPrompt({ name: 'Prompt 3' });

      const page1 = await service.findAll({
        limit: 2,
        offset: 0,
        sort: 'name',
        order: 'asc',
      });
      expect(page1.items).toHaveLength(2);
      expect(page1.total).toBe(3);
      expect(page1.items[0].name).toBe('Prompt 1');
      expect(page1.items[1].name).toBe('Prompt 2');

      const page2 = await service.findAll({
        limit: 2,
        offset: 2,
        sort: 'name',
        order: 'asc',
      });
      expect(page2.items).toHaveLength(1);
      expect(page2.total).toBe(3);
      expect(page2.items[0].name).toBe('Prompt 3');
    });
  });

  describe('findById and findOne', () => {
    it('returns null from findById when prompt does not exist', async () => {
      const result = await service.findById('non-existent-id');
      expect(result).toBeNull();
    });

    it('returns system prompt from findById when prompt exists', async () => {
      const created = fixtures.createSystemPrompt({
        name: 'My Prompt',
        content: 'System prompt content.',
      });

      const result = await service.findById(created.id);
      expect(result).toBeDefined();
      expect(result?.id).toBe(created.id);
      expect(result?.name).toBe('My Prompt');
      expect(result?.content).toBe('System prompt content.');
      expect(result?.createdAt).toBe(created.created_at);
      expect(result?.updatedAt).toBe(created.updated_at);
    });

    it('throws NotFoundException with SYSTEM_PROMPT_NOT_FOUND code when findOne does not find prompt', async () => {
      await expect(
        service.findOne('018f3a9e-0000-7000-8000-000000000999'),
      ).rejects.toThrow(NotFoundException);

      try {
        await service.findOne('018f3a9e-0000-7000-8000-000000000999');
      } catch (err: any) {
        expect(err.getResponse()).toEqual(
          expect.objectContaining({
            code: 'SYSTEM_PROMPT_NOT_FOUND',
          }),
        );
      }
    });

    it('returns system prompt from findOne when prompt exists', async () => {
      const created = fixtures.createSystemPrompt({ name: 'Found Prompt' });
      const result = await service.findOne(created.id);
      expect(result.id).toBe(created.id);
      expect(result.name).toBe('Found Prompt');
    });
  });

  describe('create', () => {
    it('creates and persists a system prompt with server-managed id and timestamps', async () => {
      const dto: CreateSystemPromptDto = {
        name: 'Assistant Persona',
        content: 'You are a meticulous research assistant.',
      };

      const result = await service.create(dto);

      expect(result.id).toBeDefined();
      expect(result.name).toBe(dto.name);
      expect(result.content).toBe(dto.content);
      expect(result.createdAt).toBeDefined();
      expect(result.updatedAt).toBe(result.createdAt);

      const persisted = await service.findById(result.id);
      expect(persisted).toEqual(result);
    });

    it('allows two prompts to share the same name (no uniqueness constraint on name)', async () => {
      const prompt1 = await service.create({
        name: 'Shared Name',
        content: 'Content 1',
      });
      const prompt2 = await service.create({
        name: 'Shared Name',
        content: 'Content 2',
      });

      expect(prompt1.id).not.toBe(prompt2.id);
      expect(prompt1.name).toBe('Shared Name');
      expect(prompt2.name).toBe('Shared Name');
    });
  });

  describe('update', () => {
    it('throws NotFoundException when updating nonexistent prompt', async () => {
      await expect(
        service.update('018f3a9e-0000-7000-8000-000000000999', {
          name: 'Updated',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('updates only name and leaves content unchanged', async () => {
      const fixedInitialTime = '2026-09-01T08:00:00.000Z';
      const prompt = fixtures.createSystemPrompt({
        name: 'Original Name',
        content: 'Original Content that must remain unchanged.',
        created_at: fixedInitialTime,
        updated_at: fixedInitialTime,
      });

      const updated = await service.update(prompt.id, {
        name: 'New Name Only',
      });

      expect(updated.id).toBe(prompt.id);
      expect(updated.name).toBe('New Name Only');
      expect(updated.content).toBe(
        'Original Content that must remain unchanged.',
      );
      expect(updated.createdAt).toBe(fixedInitialTime);
      expect(updated.updatedAt).not.toBe(fixedInitialTime);
      expect(new Date(updated.updatedAt).getTime()).toBeGreaterThan(
        new Date(fixedInitialTime).getTime(),
      );
    });

    it('updates only content and leaves name unchanged', async () => {
      const created = await service.create({
        name: 'Original Name',
        content: 'Original Content',
      });

      const updated = await service.update(created.id, {
        content: 'Updated Content Only',
      });

      expect(updated.id).toBe(created.id);
      expect(updated.name).toBe('Original Name');
      expect(updated.content).toBe('Updated Content Only');
      expect(updated.createdAt).toBe(created.createdAt);
    });

    it('updates both name and content when both are supplied', async () => {
      const created = await service.create({
        name: 'Original Name',
        content: 'Original Content',
      });

      const updated = await service.update(created.id, {
        name: 'Updated Name',
        content: 'Updated Content',
      });

      expect(updated.name).toBe('Updated Name');
      expect(updated.content).toBe('Updated Content');
    });

    it('treats empty update as no-op without bumping updatedAt', async () => {
      const created = await service.create({
        name: 'Original Name',
        content: 'Original Content',
      });

      const updated = await service.update(created.id, {});

      expect(updated.name).toBe('Original Name');
      expect(updated.content).toBe('Original Content');
      expect(updated.updatedAt).toBe(created.updatedAt);
    });

    it('treats identical values update as no-op without bumping updatedAt', async () => {
      const created = await service.create({
        name: 'Original Name',
        content: 'Original Content',
      });

      const updated = await service.update(created.id, {
        name: 'Original Name',
        content: 'Original Content',
      });

      expect(updated.updatedAt).toBe(created.updatedAt);
    });
  });

  describe('delete and foreign key cascade behavior', () => {
    it('throws NotFoundException when deleting nonexistent prompt', async () => {
      await expect(
        service.delete('018f3a9e-0000-7000-8000-000000000999'),
      ).rejects.toThrow(NotFoundException);
    });

    it('deletes an existing prompt successfully', async () => {
      const created = await service.create({
        name: 'To Delete',
        content: 'To Delete Content',
      });

      await service.delete(created.id);

      const found = await service.findById(created.id);
      expect(found).toBeNull();
    });

    it('asserts ON DELETE SET NULL on referencing agent: deleting a prompt sets agent.system_prompt_id to NULL', async () => {
      const prompt = await service.create({
        name: 'Prompt Referenced By Agent',
        content: 'Prompt content.',
      });

      const agent = fixtures.createAgent({
        name: 'Referencing Agent',
        system_prompt_id: prompt.id,
      });

      expect(agent.system_prompt_id).toBe(prompt.id);

      // Verify agent has the reference before deletion
      const agentBefore = db.get<{ system_prompt_id: string | null }>(
        'SELECT system_prompt_id FROM agents WHERE id = ?',
        [agent.id],
      );
      expect(agentBefore?.system_prompt_id).toBe(prompt.id);

      // Delete the system prompt
      await service.delete(prompt.id);

      // Verify the prompt is deleted
      const promptAfter = await service.findById(prompt.id);
      expect(promptAfter).toBeNull();

      // Assert the referencing agent survived intact and its system_prompt_id became NULL
      const agentAfter = db.get<{
        id: string;
        name: string;
        system_prompt_id: string | null;
      }>('SELECT id, name, system_prompt_id FROM agents WHERE id = ?', [
        agent.id,
      ]);
      expect(agentAfter).toBeDefined();
      expect(agentAfter?.id).toBe(agent.id);
      expect(agentAfter?.name).toBe('Referencing Agent');
      expect(agentAfter?.system_prompt_id).toBeNull();
    });
  });
});
