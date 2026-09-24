import { createTestApp, TestApp } from './harness/index.js';

describe('Test Harness (e2e self-tests)', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp();
  });

  afterAll(async () => {
    await testApp.close();
  });

  beforeEach(() => {
    testApp.reset();
  });

  describe('Isolation and Reset', () => {
    it('seeds fixtures and allows querying them', () => {
      const agent = testApp.fixtures.createAgent({ name: 'Isolation Agent' });
      const rows = testApp.db.all<{ id: string; name: string }>(
        'SELECT * FROM agents WHERE id = ?',
        [agent.id],
      );

      expect(rows).toHaveLength(1);
      expect(rows[0].name).toBe('Isolation Agent');
    });

    it('proves database was reset cleanly before the next test', () => {
      const rows = testApp.db.all('SELECT * FROM agents');
      expect(rows).toHaveLength(0);
    });
  });

  describe('Foreign Key Enforcement', () => {
    it('enforces foreign key constraints in test database', () => {
      const invalidModelId = 'invalid-model-id';
      const invalidProviderId = 'non-existent-provider';

      expect(() => {
        testApp.db.run(
          `INSERT INTO models (id, provider_id, model_identifier, display_name, source, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
          [invalidModelId, invalidProviderId, 'gpt-4', 'GPT-4', 'manual'],
        );
      }).toThrow(/FOREIGN KEY constraint failed/);
    });
  });

  describe('Typed Fixture Builders', () => {
    it('creates system prompts', () => {
      const prompt = testApp.fixtures.createSystemPrompt({ name: 'Custom Prompt' });
      expect(prompt.name).toBe('Custom Prompt');
      expect(typeof prompt.id).toBe('string');

      const rows = testApp.db.all('SELECT * FROM system_prompts WHERE id = ?', [
        prompt.id,
      ]);
      expect(rows).toHaveLength(1);
    });

    it('creates providers and models with foreign key relations', () => {
      const provider = testApp.fixtures.createProvider({ name: 'Anthropic' });
      const model = testApp.fixtures.createModel({
        provider_id: provider.id,
        display_name: 'Claude 3.5 Sonnet',
      });

      expect(model.provider_id).toBe(provider.id);

      const dbModel = testApp.db.get<{ provider_id: string }>(
        'SELECT * FROM models WHERE id = ?',
        [model.id],
      );
      expect(dbModel?.provider_id).toBe(provider.id);
    });

    it('auto-creates missing dependencies for models', () => {
      const model = testApp.fixtures.createModel();
      expect(typeof model.provider_id).toBe('string');

      const provider = testApp.db.get(
        'SELECT * FROM providers WHERE id = ?',
        [model.provider_id],
      );
      expect(provider).toBeDefined();
    });

    it('creates agents, teams, and team members', () => {
      const agent = testApp.fixtures.createAgent({ name: 'Team Lead' });
      const team = testApp.fixtures.createTeam({ name: 'Core Team' });
      const member = testApp.fixtures.createTeamMember(team.id, agent.id, {
        role: 'lead',
      });

      expect(member.team_id).toBe(team.id);
      expect(member.agent_id).toBe(agent.id);

      const dbMember = testApp.db.get(
        'SELECT * FROM team_members WHERE team_id = ? AND agent_id = ?',
        [team.id, agent.id],
      );
      expect(dbMember).toBeDefined();
    });

    it('creates projects, chats, and messages with relational auto-wiring', () => {
      const project = testApp.fixtures.createProject({ name: 'Glassbeetle Project' });
      const chat = testApp.fixtures.createChat({ project_id: project.id });
      const message = testApp.fixtures.createMessage({
        chat_id: chat.id,
        content: 'Testing harness message',
      });

      expect(message.chat_id).toBe(chat.id);
      expect(chat.project_id).toBe(project.id);
      expect(typeof chat.agent_id).toBe('string'); // auto-created agent to satisfy CHECK constraint

      const dbMessage = testApp.db.get<{ content: string }>(
        'SELECT * FROM messages WHERE id = ?',
        [message.id],
      );
      expect(dbMessage?.content).toBe('Testing harness message');
    });

    it('creates artifacts', () => {
      const artifact = testApp.fixtures.createArtifact({ title: 'Design Spec' });
      expect(artifact.title).toBe('Design Spec');

      const dbArtifact = testApp.db.get(
        'SELECT * FROM artifacts WHERE id = ?',
        [artifact.id],
      );
      expect(dbArtifact).toBeDefined();
    });

    it('creates agent and shared memories', () => {
      const agentMemory = testApp.fixtures.createAgentMemory({
        content: 'Agent remembers test preference',
      });
      const sharedMemory = testApp.fixtures.createSharedMemory({
        content: 'Shared workspace state',
      });

      expect(agentMemory.content).toBe('Agent remembers test preference');
      expect(sharedMemory.content).toBe('Shared workspace state');

      const dbAgentMemory = testApp.db.get(
        'SELECT * FROM agent_memories WHERE id = ?',
        [agentMemory.id],
      );
      const dbSharedMemory = testApp.db.get(
        'SELECT * FROM shared_memories WHERE id = ?',
        [sharedMemory.id],
      );

      expect(dbAgentMemory).toBeDefined();
      expect(dbSharedMemory).toBeDefined();
    });
  });
});
