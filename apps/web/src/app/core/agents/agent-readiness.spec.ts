import type { Agent } from '../api/agents.models';
import { configuredFraction, readinessOf } from './agent-readiness';

function agent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'a1',
    name: 'Agent',
    personality: null,
    instructions: null,
    systemPromptId: null,
    modelId: null,
    temperature: null,
    maxTokens: null,
    modelParams: null,
    hasPicture: false,
    createdAt: '2026-10-04T12:00:00.000Z',
    updatedAt: '2026-10-04T12:00:00.000Z',
    ...overrides,
  };
}

// The original behaviour, for an API that does serve models.
const withModels = { modelsAvailable: true };

describe('readinessOf', () => {
  it('blocks an agent with no model, because nothing can run it', () => {
    expect(readinessOf(agent(), withModels).level).toBe('blocked');
  });

  it('reports a model with nothing steering it as unguided', () => {
    expect(readinessOf(agent({ modelId: 'm1' }), withModels).level).toBe('unguided');
  });

  it('accepts a linked system prompt as guidance', () => {
    expect(readinessOf(agent({ modelId: 'm1', systemPromptId: 'p1' })).level).toBe('ready');
  });

  it('accepts agent instructions as guidance', () => {
    expect(readinessOf(agent({ modelId: 'm1', instructions: 'Cite sources.' })).level).toBe(
      'ready',
    );
  });

  it('does not count whitespace as guidance', () => {
    expect(readinessOf(agent({ modelId: 'm1', instructions: '   ' })).level).toBe('unguided');
  });
});

describe('configuredFraction', () => {
  it('is zero for an untouched agent', () => {
    expect(configuredFraction(agent(), withModels)).toBe(0);
  });

  it('is one when every field that changes behaviour is set', () => {
    expect(
      configuredFraction(
        agent({
          modelId: 'm1',
          systemPromptId: 'p1',
          personality: 'Terse.',
          temperature: 0.2,
          maxTokens: 2048,
        }),
        withModels,
      ),
    ).toBe(1);
  });

  it('weights the model and instructions above the optional fields', () => {
    // Temperature, max tokens and personality together must not outweigh the
    // two fields that decide whether the agent runs at all.
    const optionalOnly = configuredFraction(
      agent({ personality: 'Terse.', temperature: 0.2, maxTokens: 2048 }),
      withModels,
    );
    const essentialsOnly = configuredFraction(
      agent({ modelId: 'm1', systemPromptId: 'p1' }),
      withModels,
    );

    expect(essentialsOnly).toBeGreaterThan(optionalOnly);
  });
});

describe('readiness when the API cannot assign models', () => {
  // `/models` 404s and the agents endpoint rejects every `modelId` with
  // MODEL_NOT_FOUND, so a missing model is a platform gap rather than
  // something the user left undone.
  const noModels = { modelsAvailable: false };

  it('does not blame an agent for the model it cannot be given', () => {
    expect(readinessOf(agent({ instructions: 'Cite sources.' }), noModels).level).toBe('ready');
  });

  it('still reports an agent with nothing steering it', () => {
    expect(readinessOf(agent(), noModels).level).toBe('unguided');
  });

  it('says the model is still missing without offering a remedy', () => {
    const readiness = readinessOf(agent({ instructions: 'Cite.' }), noModels);
    expect(readiness.detail).toContain('cannot assign');
    expect(readiness.remedy).toBeNull();
  });

  it('excludes the model from the meter, so full really is reachable', () => {
    expect(
      configuredFraction(
        agent({
          systemPromptId: 'p1',
          personality: 'Terse.',
          temperature: 0.2,
          maxTokens: 2048,
        }),
        noModels,
      ),
    ).toBe(1);
  });
});
