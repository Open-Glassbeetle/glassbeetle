import type { Agent } from '../api/agents.models';

/**
 * How ready an agent is to be given work.
 *
 * This is derived from the agent's stored configuration, not from a runtime
 * signal: the API has no inference or chat endpoints yet, so nothing reports
 * whether an agent is *currently* doing anything. Showing an invented
 * "running" state would be a claim the UI could never back up. What it can say
 * truthfully is whether an agent is configured well enough to run at all, and
 * that is what this models.
 */
export type ReadinessLevel = 'ready' | 'unguided' | 'blocked';

export interface Readiness {
  readonly level: ReadinessLevel;
  /** Short label for a badge. */
  readonly label: string;
  /** One sentence explaining the level, used as a tooltip or helper text. */
  readonly detail: string;
  /** What to do about it, when there is something to do. */
  readonly remedy: string | null;
}

/**
 * Classifies an agent by what its configuration is missing.
 *
 * `modelId` is the hard requirement — without a model there is nothing to send
 * a completion to. Instructions are the soft one: an agent with a model but no
 * system prompt, instructions or personality will run, but with nothing
 * steering it.
 */
export function readinessOf(agent: Agent): Readiness {
  if (!agent.modelId) {
    return {
      level: 'blocked',
      label: 'No model',
      detail: 'This agent has no model assigned, so it cannot run.',
      remedy: 'Assign a model',
    };
  }

  const guided =
    agent.systemPromptId !== null || hasText(agent.instructions) || hasText(agent.personality);

  if (!guided) {
    return {
      level: 'unguided',
      label: 'No instructions',
      detail:
        'This agent has a model but no system prompt, instructions or personality to steer it.',
      remedy: 'Add instructions',
    };
  }

  return {
    level: 'ready',
    label: 'Ready',
    detail: 'This agent has a model and instructions.',
    remedy: null,
  };
}

/**
 * The share of an agent's configuration that has been filled in.
 *
 * Weighted towards the fields that change behaviour: the model and the
 * instructions matter far more than the sampling options, so the meter must
 * not read as "almost done" because only the optional fields are set.
 */
export function configuredFraction(agent: Agent): number {
  const checks: readonly [boolean, number][] = [
    [agent.modelId !== null, 3],
    [agent.systemPromptId !== null || hasText(agent.instructions), 3],
    [hasText(agent.personality), 1],
    [agent.temperature !== null, 1],
    [agent.maxTokens !== null, 1],
  ];

  const total = checks.reduce((sum, [, weight]) => sum + weight, 0);
  const earned = checks.reduce((sum, [met, weight]) => sum + (met ? weight : 0), 0);

  return earned / total;
}

function hasText(value: string | null): boolean {
  return value !== null && value.trim().length > 0;
}
