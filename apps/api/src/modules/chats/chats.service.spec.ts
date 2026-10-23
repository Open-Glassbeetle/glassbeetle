import {
  BadRequestException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DatabaseService } from '../../database/database.service.js';
import { TestFixtures } from '../../../test/harness/fixtures.js';
import {
  BOTH_OWNERS_ERROR_MESSAGE,
  CONTEXT_SUMMARY_READONLY_ERROR_MESSAGE,
  NEITHER_OWNER_ERROR_MESSAGE,
  OWNER_IMMUTABLE_ERROR_MESSAGE,
} from './dto/chat-validators.js';
import { ChatsService } from './chats.service.js';

describe('ChatsService', () => {
  let db: DatabaseService;
  let fixtures: TestFixtures;
  let service: ChatsService;

  beforeEach(() => {
    db = new DatabaseService();
    db.connect(':memory:');
    fixtures = new TestFixtures(db);
    service = new ChatsService(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('create', () => {
    it('creates an agent-owned chat and returns 201 response shape', async () => {
      const agent = fixtures.createAgent({ name: 'Coder' });

      const chat = await service.create({
        agentId: agent.id,
        title: 'Development Chat',
      });

      expect(chat).toMatchObject({
        id: expect.any(String),
        title: 'Development Chat',
        agentId: agent.id,
        teamId: null,
        projectId: null,
        contextSummary: null,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });

      // Verify row persisted
      const persisted = db.get<{ id: string; agent_id: string }>(
        'SELECT * FROM chats WHERE id = ?',
        [chat.id],
      );
      expect(persisted).toBeDefined();
      expect(persisted?.agent_id).toBe(agent.id);
    });

    it('creates a team-owned chat and returns 201 response shape', async () => {
      const team = fixtures.createTeam({ name: 'DevOps Team' });

      const chat = await service.create({
        teamId: team.id,
        title: 'Infra Chat',
      });

      expect(chat).toMatchObject({
        id: expect.any(String),
        title: 'Infra Chat',
        agentId: null,
        teamId: team.id,
        projectId: null,
      });
    });

    it('creates a chat with an associated project', async () => {
      const agent = fixtures.createAgent();
      const project = fixtures.createProject({ name: 'Glassbeetle' });

      const chat = await service.create({
        agentId: agent.id,
        projectId: project.id,
        title: 'Project Chat',
      });

      expect(chat.projectId).toBe(project.id);
    });

    it('rejects create with both agentId and teamId with 400 and does not persist row', async () => {
      const agent = fixtures.createAgent();
      const team = fixtures.createTeam();

      await expect(
        service.create({
          agentId: agent.id,
          teamId: team.id,
          title: 'Conflict Chat',
        }),
      ).rejects.toThrow(BadRequestException);

      try {
        await service.create({
          agentId: agent.id,
          teamId: team.id,
          title: 'Conflict Chat',
        });
      } catch (err: any) {
        expect(err.response?.message).toBe(BOTH_OWNERS_ERROR_MESSAGE);
      }

      const rows = db.all('SELECT * FROM chats');
      expect(rows).toHaveLength(0);
    });

    it('rejects create with neither agentId nor teamId with 400 and does not persist row', async () => {
      await expect(
        service.create({
          title: 'No Owner Chat',
        } as any),
      ).rejects.toThrow(BadRequestException);

      try {
        await service.create({
          title: 'No Owner Chat',
        } as any);
      } catch (err: any) {
        expect(err.response?.message).toBe(NEITHER_OWNER_ERROR_MESSAGE);
      }

      const rows = db.all('SELECT * FROM chats');
      expect(rows).toHaveLength(0);
    });

    it('rejects non-existent agentId with 422 UnprocessableEntityException naming the field', async () => {
      const missingAgentId = '018f3a9e-0000-7000-8000-999999999999';

      await expect(
        service.create({ agentId: missingAgentId }),
      ).rejects.toThrow(UnprocessableEntityException);

      try {
        await service.create({ agentId: missingAgentId });
      } catch (err: any) {
        expect(err.response?.code).toBe('AGENT_NOT_FOUND');
        expect(err.response?.message).toContain(`agentId "${missingAgentId}"`);
      }

      const rows = db.all('SELECT * FROM chats');
      expect(rows).toHaveLength(0);
    });

    it('rejects non-existent teamId with 422 UnprocessableEntityException naming the field', async () => {
      const missingTeamId = '018f3a9e-0000-7000-8000-888888888888';

      await expect(
        service.create({ teamId: missingTeamId }),
      ).rejects.toThrow(UnprocessableEntityException);

      try {
        await service.create({ teamId: missingTeamId });
      } catch (err: any) {
        expect(err.response?.code).toBe('TEAM_NOT_FOUND');
        expect(err.response?.message).toContain(`teamId "${missingTeamId}"`);
      }

      const rows = db.all('SELECT * FROM chats');
      expect(rows).toHaveLength(0);
    });

    it('rejects non-existent projectId with 422 UnprocessableEntityException naming the field', async () => {
      const agent = fixtures.createAgent();
      const missingProjectId = '018f3a9e-0000-7000-8000-777777777777';

      await expect(
        service.create({
          agentId: agent.id,
          projectId: missingProjectId,
        }),
      ).rejects.toThrow(UnprocessableEntityException);

      try {
        await service.create({
          agentId: agent.id,
          projectId: missingProjectId,
        });
      } catch (err: any) {
        expect(err.response?.code).toBe('PROJECT_NOT_FOUND');
        expect(err.response?.message).toContain(`projectId "${missingProjectId}"`);
      }

      const rows = db.all('SELECT * FROM chats');
      expect(rows).toHaveLength(0);
    });

    it('rejects attempts to set contextSummary or context_summary with 400', async () => {
      const agent = fixtures.createAgent();

      await expect(
        service.create({
          agentId: agent.id,
          contextSummary: 'Summary',
        } as any),
      ).rejects.toThrow(BadRequestException);

      try {
        await service.create({
          agentId: agent.id,
          contextSummary: 'Summary',
        } as any);
      } catch (err: any) {
        expect(err.response?.message).toBe(CONTEXT_SUMMARY_READONLY_ERROR_MESSAGE);
      }

      await expect(
        service.create({
          agentId: agent.id,
          context_summary: 'Summary',
        } as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('findAll', () => {
    it('returns an empty paginated collection when no chats exist', async () => {
      const result = await service.findAll({ limit: 50, offset: 0 });
      expect(result).toEqual({
        items: [],
        total: 0,
        limit: 50,
        offset: 0,
      });
    });

    it('filters by agentId', async () => {
      const agent1 = fixtures.createAgent({ name: 'Agent 1' });
      const agent2 = fixtures.createAgent({ name: 'Agent 2' });

      fixtures.createChat({ agent_id: agent1.id, title: 'Chat A1' });
      fixtures.createChat({ agent_id: agent1.id, title: 'Chat A2' });
      fixtures.createChat({ agent_id: agent2.id, title: 'Chat B1' });

      const result = await service.findAll({
        agentId: agent1.id,
        limit: 50,
        offset: 0,
      });
      expect(result.total).toBe(2);
      expect(result.items.every((c) => c.agentId === agent1.id)).toBe(true);
    });

    it('filters by teamId', async () => {
      const team1 = fixtures.createTeam({ name: 'Team 1' });
      const team2 = fixtures.createTeam({ name: 'Team 2' });

      fixtures.createChat({ team_id: team1.id, agent_id: null, title: 'Team 1 Chat' });
      fixtures.createChat({ team_id: team2.id, agent_id: null, title: 'Team 2 Chat' });

      const result = await service.findAll({
        teamId: team1.id,
        limit: 50,
        offset: 0,
      });
      expect(result.total).toBe(1);
      expect(result.items[0].teamId).toBe(team1.id);
    });

    it('filters by projectId and projectId="null"', async () => {
      const project = fixtures.createProject({ name: 'Alpha' });
      const agent = fixtures.createAgent();

      fixtures.createChat({
        agent_id: agent.id,
        project_id: project.id,
        title: 'Project Chat',
      });
      fixtures.createChat({
        agent_id: agent.id,
        project_id: null,
        title: 'Standalone Chat',
      });

      const inProject = await service.findAll({
        projectId: project.id,
        limit: 50,
        offset: 0,
      });
      expect(inProject.total).toBe(1);
      expect(inProject.items[0].projectId).toBe(project.id);

      const outsideProject = await service.findAll({
        projectId: 'null',
        limit: 50,
        offset: 0,
      });
      expect(outsideProject.total).toBe(1);
      expect(outsideProject.items[0].projectId).toBeNull();
    });

    it('combines filters across projectId, agentId, and teamId', async () => {
      const project1 = fixtures.createProject();
      const project2 = fixtures.createProject();
      const agent = fixtures.createAgent();

      fixtures.createChat({
        agent_id: agent.id,
        project_id: project1.id,
        title: 'P1-Agent',
      });
      fixtures.createChat({
        agent_id: agent.id,
        project_id: project2.id,
        title: 'P2-Agent',
      });

      const result = await service.findAll({
        projectId: project1.id,
        agentId: agent.id,
        limit: 50,
        offset: 0,
      });
      expect(result.total).toBe(1);
      expect(result.items[0].title).toBe('P1-Agent');
    });

    it('searches titles by substring and ignores a blank search', async () => {
      const agent = fixtures.createAgent();
      fixtures.createChat({ agent_id: agent.id, title: 'Quarterly Review' });
      fixtures.createChat({ agent_id: agent.id, title: 'Standup notes' });
      fixtures.createChat({ agent_id: agent.id, title: null });

      const result = await service.findAll({
        search: '  review ',
        limit: 50,
        offset: 0,
      });
      expect(result.total).toBe(1);
      expect(result.items[0].title).toBe('Quarterly Review');

      const blank = await service.findAll({
        search: '   ',
        limit: 50,
        offset: 0,
      });
      expect(blank.total).toBe(3);
    });

    it('does not search context_summary', async () => {
      const agent = fixtures.createAgent();
      const chat = fixtures.createChat({
        agent_id: agent.id,
        title: 'Untitled thread',
      });
      db.run('UPDATE chats SET context_summary = ? WHERE id = ?', [
        'Discussed the migration plan',
        chat.id,
      ]);

      const result = await service.findAll({
        search: 'migration',
        limit: 50,
        offset: 0,
      });
      expect(result.total).toBe(0);
    });

    it('sorts by allowed sort columns', async () => {
      const agent = fixtures.createAgent();
      fixtures.createChat({ agent_id: agent.id, title: 'B Chat' });
      fixtures.createChat({ agent_id: agent.id, title: 'A Chat' });

      const result = await service.findAll({
        sort: 'title',
        order: 'asc',
        limit: 50,
        offset: 0,
      });
      expect(result.items[0].title).toBe('A Chat');
      expect(result.items[1].title).toBe('B Chat');
    });

    it('rejects invalid sort column with 400', async () => {
      await expect(
        service.findAll({ sort: 'malicious_column', limit: 50, offset: 0 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('defensively lists chats whose owner was deleted without crashing', async () => {
      const agent = fixtures.createAgent();
      const chat = fixtures.createChat({ agent_id: agent.id, title: 'Owner Will Be Deleted' });

      // Simulate orphaned row state by disabling check constraint check in test setup
      db.exec('PRAGMA ignore_check_constraints = ON');
      db.run('UPDATE chats SET agent_id = NULL WHERE id = ?', [chat.id]);
      db.exec('PRAGMA ignore_check_constraints = OFF');

      const result = await service.findAll({ limit: 50, offset: 0 });
      expect(result.total).toBe(1);
      expect(result.items[0].agentId).toBeNull();
      expect(result.items[0].teamId).toBeNull();
      expect(result.items[0].title).toBe('Owner Will Be Deleted');
    });
  });

  describe('findOne', () => {
    it('retrieves an existing chat with contextSummary', async () => {
      const agent = fixtures.createAgent();
      const chat = fixtures.createChat({
        agent_id: agent.id,
        title: 'Detailed Chat',
        context_summary: 'Existing compacted summary',
      });

      const found = await service.findOne(chat.id);
      expect(found).toMatchObject({
        id: chat.id,
        title: 'Detailed Chat',
        agentId: agent.id,
        teamId: null,
        contextSummary: 'Existing compacted summary',
      });
    });

    it('defensively returns a chat whose owner was deleted', async () => {
      const agent = fixtures.createAgent();
      const chat = fixtures.createChat({ agent_id: agent.id });
      db.exec('PRAGMA ignore_check_constraints = ON');
      db.run('UPDATE chats SET agent_id = NULL WHERE id = ?', [chat.id]);
      db.exec('PRAGMA ignore_check_constraints = OFF');

      const found = await service.findOne(chat.id);
      expect(found.agentId).toBeNull();
      expect(found.teamId).toBeNull();
    });

    it('throws 404 NotFoundException for unknown chatId', async () => {
      await expect(service.findOne('non-existent-id')).rejects.toThrow(
        NotFoundException,
      );

      try {
        await service.findOne('non-existent-id');
      } catch (err: any) {
        expect(err.response?.code).toBe('CHAT_NOT_FOUND');
      }
    });
  });

  describe('update', () => {
    it('partially updates title and bumps updatedAt', async () => {
      const agent = fixtures.createAgent();
      const chat = fixtures.createChat({
        agent_id: agent.id,
        title: 'Old Title',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      });

      const updated = await service.update(chat.id, { title: 'New Title' });

      expect(updated.title).toBe('New Title');
      expect(updated.updatedAt).not.toBe('2026-01-01T00:00:00.000Z');

      const persisted = db.get<{ title: string; updated_at: string }>(
        'SELECT title, updated_at FROM chats WHERE id = ?',
        [chat.id],
      );
      expect(persisted?.title).toBe('New Title');
    });

    it('moves chat to a different project', async () => {
      const agent = fixtures.createAgent();
      const project1 = fixtures.createProject({ name: 'Project 1' });
      const project2 = fixtures.createProject({ name: 'Project 2' });
      const chat = fixtures.createChat({
        agent_id: agent.id,
        project_id: project1.id,
      });

      const updated = await service.update(chat.id, {
        projectId: project2.id,
      });
      expect(updated.projectId).toBe(project2.id);
    });

    it('clears project with null', async () => {
      const agent = fixtures.createAgent();
      const project = fixtures.createProject();
      const chat = fixtures.createChat({
        agent_id: agent.id,
        project_id: project.id,
      });

      const updated = await service.update(chat.id, { projectId: null });
      expect(updated.projectId).toBeNull();
    });

    it('clears title with null', async () => {
      const agent = fixtures.createAgent();
      const chat = fixtures.createChat({
        agent_id: agent.id,
        title: 'Original Title',
      });

      const updated = await service.update(chat.id, { title: null });
      expect(updated.title).toBeNull();
    });

    it('empty payload is an idempotent no-op leaving updatedAt untouched', async () => {
      const agent = fixtures.createAgent();
      const chat = fixtures.createChat({
        agent_id: agent.id,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      });

      const updated = await service.update(chat.id, {});
      expect(updated.updatedAt).toBe('2026-01-01T00:00:00.000Z');
    });

    it('rejects owner changes via agentId with 400', async () => {
      const agent1 = fixtures.createAgent();
      const agent2 = fixtures.createAgent();
      const chat = fixtures.createChat({ agent_id: agent1.id });

      await expect(
        service.update(chat.id, { agentId: agent2.id } as any),
      ).rejects.toThrow(BadRequestException);

      try {
        await service.update(chat.id, { agentId: agent2.id } as any);
      } catch (err: any) {
        expect(err.response?.message).toBe(OWNER_IMMUTABLE_ERROR_MESSAGE);
      }
    });

    it('rejects owner changes via teamId with 400', async () => {
      const agent = fixtures.createAgent();
      const team = fixtures.createTeam();
      const chat = fixtures.createChat({ agent_id: agent.id });

      await expect(
        service.update(chat.id, { teamId: team.id } as any),
      ).rejects.toThrow(BadRequestException);

      try {
        await service.update(chat.id, { teamId: team.id } as any);
      } catch (err: any) {
        expect(err.response?.message).toBe(OWNER_IMMUTABLE_ERROR_MESSAGE);
      }
    });

    it('rejects attempts to set contextSummary or context_summary in update with 400', async () => {
      const agent = fixtures.createAgent();
      const chat = fixtures.createChat({ agent_id: agent.id });

      await expect(
        service.update(chat.id, { contextSummary: 'Compacted text' } as any),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.update(chat.id, { context_summary: 'Compacted text' } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects updating to non-existent projectId with 422', async () => {
      const agent = fixtures.createAgent();
      const chat = fixtures.createChat({ agent_id: agent.id });
      const nonExistentProjectId = '018f3a9e-0000-7000-8000-000000999999';

      await expect(
        service.update(chat.id, { projectId: nonExistentProjectId }),
      ).rejects.toThrow(UnprocessableEntityException);

      try {
        await service.update(chat.id, { projectId: nonExistentProjectId });
      } catch (err: any) {
        expect(err.response?.code).toBe('PROJECT_NOT_FOUND');
      }
    });

    it('throws 404 NotFoundException when updating non-existent chat', async () => {
      await expect(
        service.update('missing-chat-id', { title: 'New' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('delete and cascade behaviour', () => {
    it('deletes an existing chat', async () => {
      const agent = fixtures.createAgent();
      const chat = fixtures.createChat({ agent_id: agent.id });

      await service.delete(chat.id);

      const persisted = db.get('SELECT * FROM chats WHERE id = ?', [chat.id]);
      expect(persisted).toBeUndefined();
    });

    it('throws 404 NotFoundException when deleting non-existent chat', async () => {
      await expect(service.delete('missing-chat-id')).rejects.toThrow(
        NotFoundException,
      );

      try {
        await service.delete('missing-chat-id');
      } catch (err: any) {
        expect(err.response?.code).toBe('CHAT_NOT_FOUND');
      }
    });

    it('cascades deletion to messages and clears chat_id on artifacts', async () => {
      const agent = fixtures.createAgent();
      const chat = fixtures.createChat({ agent_id: agent.id });

      // Create messages in the chat
      const msg1 = fixtures.createMessage({ chat_id: chat.id, sequence: 1 });
      const msg2 = fixtures.createMessage({ chat_id: chat.id, sequence: 2 });

      // Create artifact referencing the chat
      const artifact = fixtures.createArtifact({
        chat_id: chat.id,
        title: 'Project Roadmap',
      });

      // Verify records are present before deletion
      expect(db.all('SELECT * FROM messages WHERE chat_id = ?', [chat.id])).toHaveLength(2);
      expect(
        db.get<{ chat_id: string }>('SELECT chat_id FROM artifacts WHERE id = ?', [
          artifact.id,
        ])?.chat_id,
      ).toBe(chat.id);

      // Delete the chat
      await service.delete(chat.id);

      // Verify messages are destroyed (ON DELETE CASCADE)
      const remainingMessages = db.all('SELECT * FROM messages WHERE chat_id = ?', [
        chat.id,
      ]);
      expect(remainingMessages).toHaveLength(0);

      const msg1Row = db.get('SELECT * FROM messages WHERE id = ?', [msg1.id]);
      expect(msg1Row).toBeUndefined();
      const msg2Row = db.get('SELECT * FROM messages WHERE id = ?', [msg2.id]);
      expect(msg2Row).toBeUndefined();

      // Verify artifact survived with chat_id set to NULL (ON DELETE SET NULL)
      const survivingArtifact = db.get<{ id: string; chat_id: string | null }>(
        'SELECT id, chat_id FROM artifacts WHERE id = ?',
        [artifact.id],
      );
      expect(survivingArtifact).toBeDefined();
      expect(survivingArtifact?.chat_id).toBeNull();
    });
  });

  describe('removeAll (bulk deletion)', () => {
    it('returns deletedChats: 0 and deletedMessages: 0 on empty database', async () => {
      const result = await service.removeAll();
      expect(result).toEqual({
        deletedChats: 0,
        deletedMessages: 0,
      });
    });

    it('permanently deletes all chats and cascaded messages, returning exact counts', async () => {
      const agent = fixtures.createAgent({ name: 'Alice' });
      const team = fixtures.createTeam({ name: 'Dev Team' });
      const project = fixtures.createProject({ name: 'Alpha' });

      // Create 3 chats with multiple messages
      const chat1 = fixtures.createChat({ agent_id: agent.id, project_id: project.id });
      const chat2 = fixtures.createChat({ agent_id: agent.id });
      const chat3 = fixtures.createChat({ team_id: team.id, agent_id: null });

      fixtures.createMessage({ chat_id: chat1.id, sequence: 1 });
      fixtures.createMessage({ chat_id: chat1.id, sequence: 2 });
      fixtures.createMessage({ chat_id: chat2.id, sequence: 1 });
      fixtures.createMessage({ chat_id: chat3.id, sequence: 1 });
      fixtures.createMessage({ chat_id: chat3.id, sequence: 2 });
      fixtures.createMessage({ chat_id: chat3.id, sequence: 3 });

      // Create linked artifact and usage event
      const artifact = fixtures.createArtifact({
        chat_id: chat1.id,
        title: 'Design Spec',
      });
      const usageEvent = fixtures.createUsageEvent({
        chat_id: chat1.id,
        agent_id: agent.id,
      });

      // Also create a private memory and a shared memory
      fixtures.createAgentMemory({ agent_id: agent.id, content: 'Agent memory' });
      fixtures.createSharedMemory({ content: 'Shared memory' });

      // Pre-assert counts
      expect(db.all('SELECT * FROM chats')).toHaveLength(3);
      expect(db.all('SELECT * FROM messages')).toHaveLength(6);

      // Perform bulk delete
      const result = await service.removeAll();

      // Assert counts returned
      expect(result).toEqual({
        deletedChats: 3,
        deletedMessages: 6,
      });

      // Assert all chats and messages are gone
      expect(db.all('SELECT * FROM chats')).toHaveLength(0);
      expect(db.all('SELECT * FROM messages')).toHaveLength(0);

      // Assert artifact survived with chat_id = NULL (ON DELETE SET NULL)
      const survivingArtifact = db.get<{ chat_id: string | null }>(
        'SELECT chat_id FROM artifacts WHERE id = ?',
        [artifact.id],
      );
      expect(survivingArtifact).toBeDefined();
      expect(survivingArtifact?.chat_id).toBeNull();

      // Assert usage event survived with chat_id = NULL (ON DELETE SET NULL)
      const survivingUsageEvent = db.get<{ chat_id: string | null; agent_id: string }>(
        'SELECT chat_id, agent_id FROM usage_events WHERE id = ?',
        [usageEvent.id],
      );
      expect(survivingUsageEvent).toBeDefined();
      expect(survivingUsageEvent?.chat_id).toBeNull();
      expect(survivingUsageEvent?.agent_id).toBe(agent.id);

      // Assert agents, teams, projects, and memories are completely untouched
      expect(db.all('SELECT * FROM agents')).toHaveLength(1);
      expect(db.all('SELECT * FROM teams')).toHaveLength(1);
      expect(db.all('SELECT * FROM projects')).toHaveLength(1);
      expect(db.all('SELECT * FROM agent_memories')).toHaveLength(1);
      expect(db.all('SELECT * FROM shared_memories')).toHaveLength(1);
    });
  });
});
