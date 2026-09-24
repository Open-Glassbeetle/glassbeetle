import type { DatabaseService } from '../../src/database/database.service.js';
import { newId } from '../../src/common/persistence/identifiers.js';
import { nowIso } from '../../src/common/persistence/timestamps.js';

export interface SystemPromptRow {
  id: string;
  name: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export interface ProviderRow {
  id: string;
  name: string;
  kind:
    | 'anthropic'
    | 'openai'
    | 'google'
    | 'ollama'
    | 'lmstudio'
    | 'openai_compatible';
  is_local: number;
  base_url: string | null;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export interface ModelRow {
  id: string;
  provider_id: string;
  model_identifier: string;
  display_name: string;
  source: 'discovered' | 'manual';
  context_window: number | null;
  default_temperature: number | null;
  default_max_tokens: number | null;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export interface AgentRow {
  id: string;
  name: string;
  personality: string | null;
  instructions: string | null;
  system_prompt_id: string | null;
  model_id: string | null;
  temperature: number | null;
  max_tokens: number | null;
  model_params: string | null;
  picture_path: string | null;
  created_at: string;
  updated_at: string;
}

export interface TeamRow {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface TeamMemberRow {
  team_id: string;
  agent_id: string;
  role: string | null;
  position: number | null;
  created_at: string;
}

export interface ProjectRow {
  id: string;
  name: string;
  description: string | null;
  image_path: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChatRow {
  id: string;
  title: string | null;
  project_id: string | null;
  agent_id: string | null;
  team_id: string | null;
  context_summary: string | null;
  created_at: string;
  updated_at: string;
}

export interface MessageRow {
  id: string;
  chat_id: string;
  sequence: number;
  role: 'user' | 'assistant' | 'system' | 'tool';
  agent_id: string | null;
  content: string;
  status: 'pending' | 'streaming' | 'complete' | 'error';
  token_count: number | null;
  created_at: string;
}

export interface ArtifactRow {
  id: string;
  project_id: string | null;
  chat_id: string | null;
  agent_id: string | null;
  title: string;
  type: string;
  mime_type: string | null;
  content: string | null;
  file_path: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface AgentMemoryRow {
  id: string;
  agent_id: string;
  content: string;
  tags: string | null;
  created_at: string;
  updated_at: string;
}

export interface SharedMemoryRow {
  id: string;
  content: string;
  tags: string | null;
  created_at: string;
  updated_at: string;
}

export class TestFixtures {
  constructor(private readonly dbService: DatabaseService) {}

  createSystemPrompt(overrides?: Partial<SystemPromptRow>): SystemPromptRow {
    const now = nowIso();
    const row: SystemPromptRow = {
      id: newId(),
      name: 'Test System Prompt',
      content: 'You are a helpful assistant.',
      created_at: now,
      updated_at: now,
      ...overrides,
    };

    this.dbService.run(
      `INSERT INTO system_prompts (id, name, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      [row.id, row.name, row.content, row.created_at, row.updated_at],
    );

    return row;
  }

  createProvider(overrides?: Partial<ProviderRow>): ProviderRow {
    const now = nowIso();
    const row: ProviderRow = {
      id: newId(),
      name: 'Test Provider',
      kind: 'openai',
      is_local: 0,
      base_url: null,
      enabled: 1,
      created_at: now,
      updated_at: now,
      ...overrides,
    };

    this.dbService.run(
      `INSERT INTO providers (id, name, kind, is_local, base_url, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id,
        row.name,
        row.kind,
        row.is_local,
        row.base_url,
        row.enabled,
        row.created_at,
        row.updated_at,
      ],
    );

    return row;
  }

  createModel(overrides?: Partial<ModelRow>): ModelRow {
    const now = nowIso();
    const provider_id = overrides?.provider_id ?? this.createProvider().id;

    const row: ModelRow = {
      id: newId(),
      provider_id,
      model_identifier: `gpt-4o-${newId().slice(0, 6)}`,
      display_name: 'GPT-4o',
      source: 'manual',
      context_window: 128000,
      default_temperature: 0.7,
      default_max_tokens: 4096,
      enabled: 1,
      created_at: now,
      updated_at: now,
      ...overrides,
    };

    this.dbService.run(
      `INSERT INTO models (id, provider_id, model_identifier, display_name, source, context_window, default_temperature, default_max_tokens, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id,
        row.provider_id,
        row.model_identifier,
        row.display_name,
        row.source,
        row.context_window,
        row.default_temperature,
        row.default_max_tokens,
        row.enabled,
        row.created_at,
        row.updated_at,
      ],
    );

    return row;
  }

  createAgent(overrides?: Partial<AgentRow>): AgentRow {
    const now = nowIso();
    const row: AgentRow = {
      id: newId(),
      name: 'Test Agent',
      personality: 'Helpful',
      instructions: 'Assist user',
      system_prompt_id: null,
      model_id: null,
      temperature: 0.7,
      max_tokens: 2048,
      model_params: null,
      picture_path: null,
      created_at: now,
      updated_at: now,
      ...overrides,
    };

    this.dbService.run(
      `INSERT INTO agents (id, name, personality, instructions, system_prompt_id, model_id, temperature, max_tokens, model_params, picture_path, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id,
        row.name,
        row.personality,
        row.instructions,
        row.system_prompt_id,
        row.model_id,
        row.temperature,
        row.max_tokens,
        row.model_params,
        row.picture_path,
        row.created_at,
        row.updated_at,
      ],
    );

    return row;
  }

  createTeam(overrides?: Partial<TeamRow>): TeamRow {
    const now = nowIso();
    const row: TeamRow = {
      id: newId(),
      name: 'Test Team',
      description: 'A test team',
      created_at: now,
      updated_at: now,
      ...overrides,
    };

    this.dbService.run(
      `INSERT INTO teams (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      [row.id, row.name, row.description, row.created_at, row.updated_at],
    );

    return row;
  }

  createTeamMember(
    teamId?: string,
    agentId?: string,
    overrides?: Partial<TeamMemberRow>,
  ): TeamMemberRow {
    const team_id = teamId ?? overrides?.team_id ?? this.createTeam().id;
    const agent_id = agentId ?? overrides?.agent_id ?? this.createAgent().id;
    const now = nowIso();

    const row: TeamMemberRow = {
      team_id,
      agent_id,
      role: 'member',
      position: 1,
      created_at: now,
      ...overrides,
    };

    this.dbService.run(
      `INSERT INTO team_members (team_id, agent_id, role, position, created_at) VALUES (?, ?, ?, ?, ?)`,
      [row.team_id, row.agent_id, row.role, row.position, row.created_at],
    );

    return row;
  }

  createProject(overrides?: Partial<ProjectRow>): ProjectRow {
    const now = nowIso();
    const row: ProjectRow = {
      id: newId(),
      name: 'Test Project',
      description: 'A test project',
      image_path: null,
      created_at: now,
      updated_at: now,
      ...overrides,
    };

    this.dbService.run(
      `INSERT INTO projects (id, name, description, image_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        row.id,
        row.name,
        row.description,
        row.image_path,
        row.created_at,
        row.updated_at,
      ],
    );

    return row;
  }

  createChat(overrides?: Partial<ChatRow>): ChatRow {
    const now = nowIso();

    let agent_id = overrides?.agent_id ?? null;
    let team_id = overrides?.team_id ?? null;

    if (!agent_id && !team_id) {
      agent_id = this.createAgent().id;
    }

    const row: ChatRow = {
      id: newId(),
      title: 'Test Chat',
      project_id: null,
      agent_id,
      team_id,
      context_summary: null,
      created_at: now,
      updated_at: now,
      ...overrides,
    };

    this.dbService.run(
      `INSERT INTO chats (id, title, project_id, agent_id, team_id, context_summary, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id,
        row.title,
        row.project_id,
        row.agent_id,
        row.team_id,
        row.context_summary,
        row.created_at,
        row.updated_at,
      ],
    );

    return row;
  }

  createMessage(overrides?: Partial<MessageRow>): MessageRow {
    const now = nowIso();
    const chat_id = overrides?.chat_id ?? this.createChat().id;

    const row: MessageRow = {
      id: newId(),
      chat_id,
      sequence: 1,
      role: 'user',
      agent_id: null,
      content: 'Test message content',
      status: 'complete',
      token_count: 10,
      created_at: now,
      ...overrides,
    };

    this.dbService.run(
      `INSERT INTO messages (id, chat_id, sequence, role, agent_id, content, status, token_count, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id,
        row.chat_id,
        row.sequence,
        row.role,
        row.agent_id,
        row.content,
        row.status,
        row.token_count,
        row.created_at,
      ],
    );

    return row;
  }

  createArtifact(overrides?: Partial<ArtifactRow>): ArtifactRow {
    const now = nowIso();
    const row: ArtifactRow = {
      id: newId(),
      project_id: null,
      chat_id: null,
      agent_id: null,
      title: 'Test Artifact',
      type: 'code',
      mime_type: 'text/markdown',
      content: '# Sample Artifact',
      file_path: null,
      version: 1,
      created_at: now,
      updated_at: now,
      ...overrides,
    };

    this.dbService.run(
      `INSERT INTO artifacts (id, project_id, chat_id, agent_id, title, type, mime_type, content, file_path, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id,
        row.project_id,
        row.chat_id,
        row.agent_id,
        row.title,
        row.type,
        row.mime_type,
        row.content,
        row.file_path,
        row.version,
        row.created_at,
        row.updated_at,
      ],
    );

    return row;
  }

  createAgentMemory(overrides?: Partial<AgentMemoryRow>): AgentMemoryRow {
    const now = nowIso();
    const agent_id = overrides?.agent_id ?? this.createAgent().id;

    const row: AgentMemoryRow = {
      id: newId(),
      agent_id,
      content: 'Agent memory content',
      tags: 'test',
      created_at: now,
      updated_at: now,
      ...overrides,
    };

    this.dbService.run(
      `INSERT INTO agent_memories (id, agent_id, content, tags, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        row.id,
        row.agent_id,
        row.content,
        row.tags,
        row.created_at,
        row.updated_at,
      ],
    );

    return row;
  }

  createSharedMemory(overrides?: Partial<SharedMemoryRow>): SharedMemoryRow {
    const now = nowIso();

    const row: SharedMemoryRow = {
      id: newId(),
      content: 'Shared memory content',
      tags: 'shared',
      created_at: now,
      updated_at: now,
      ...overrides,
    };

    this.dbService.run(
      `INSERT INTO shared_memories (id, content, tags, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      [row.id, row.content, row.tags, row.created_at, row.updated_at],
    );

    return row;
  }
}
