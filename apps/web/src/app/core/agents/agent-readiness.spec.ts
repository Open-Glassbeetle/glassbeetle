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

describe('readinessOf', () => {
  it('blocks an agent with no model, because nothing can run it', () => {
    expect(readinessOf(agent()).level).toBe('blocked');
  });

  it('reports a model with nothing steering it as unguided', () => {
    expect(readinessOf(agent({ modelId: 'm1' })).level).toBe('unguided');
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
    expect(configuredFraction(agent())).toBe(0);
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
      ),
    ).toBe(1);
  });

  it('weights the model and instructions above the optional fields', () => {
    // Temperature, max tokens and personality together must not outweigh the
    // two fields that decide whether the agent runs at all.
    const optionalOnly = configuredFraction(
      agent({ personality: 'Terse.', temperature: 0.2, maxTokens: 2048 }),
    );
    const essentialsOnly = configuredFraction(agent({ modelId: 'm1', systemPromptId: 'p1' }));

    expect(essentialsOnly).toBeGreaterThan(optionalOnly);
  });
});
