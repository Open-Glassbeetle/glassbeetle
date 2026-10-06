import type { Agent } from '../api/agents.models';

/**
 * How ready an agent is to be given work.
 *
 * Derived from stored configuration, not from a runtime signal: the API has no
 * inference or chat endpoints, so nothing reports whether an agent is
 * *currently* doing anything. An invented "running" state would be a claim the
 * UI could never back up. What it can say truthfully is whether an agent is
 * configured well enough to run at all.
 */
export type ReadinessLevel = 'ready' | 'unguided' | 'blocked';

export interface Readiness {
  readonly level: ReadinessLevel;
  /** Short label for a badge. */
  readonly label: string;
  /** One sentence explaining the level, used as a tooltip or helper text. */
  readonly detail: string;
  /** What the user can do about it, or `null` when it is not theirs to fix. */
  readonly remedy: string | null;
}

/**
 * What the running API supports, which changes what counts as misconfigured.
 */
export interface ReadinessContext {
  /**
   * Whether a model can be assigned at all.
   *
   * When the models endpoint is missing, `agents.model_id` cannot be set by
   * anyone — the agents endpoint rejects every value with `MODEL_NOT_FOUND`.
   * Marking agents blocked for it would report a platform gap as a user error,
   * so the missing model is excluded from the judgement entirely and surfaced
   * once, at workspace level, instead.
   */
  readonly modelsAvailable: boolean;
}

const NO_MODELS: ReadinessContext = { modelsAvailable: false };

export function readinessOf(agent: Agent, context: ReadinessContext = NO_MODELS): Readiness {
  if (context.modelsAvailable && !agent.modelId) {
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
      detail: 'This agent has no system prompt, instructions or personality to steer it.',
      remedy: 'Add instructions',
    };
  }

  return {
    level: 'ready',
    label: 'Configured',
    detail: context.modelsAvailable
      ? 'This agent has a model and instructions.'
      : 'This agent is instructed. It still needs a model, which the API cannot assign yet.',
    remedy: null,
  };
}

/**
 * The share of an agent's configuration that has been filled in.
 *
 * Weighted towards the fields that change behaviour: the sampling options
 * matter far less than the instructions, so the meter must not read as "almost
 * done" because only the optional fields are set.
 *
 * The model is counted only when one could actually be assigned; otherwise
 * every agent would be permanently capped below full for a reason the user
 * cannot act on.
 */
export function configuredFraction(agent: Agent, context: ReadinessContext = NO_MODELS): number {
  const checks: [boolean, number][] = [
    [agent.systemPromptId !== null || hasText(agent.instructions), 3],
    [hasText(agent.personality), 1],
    [agent.temperature !== null, 1],
    [agent.maxTokens !== null, 1],
  ];

  if (context.modelsAvailable) {
    checks.unshift([agent.modelId !== null, 3]);
  }

  const total = checks.reduce((sum, [, weight]) => sum + weight, 0);
  const earned = checks.reduce((sum, [met, weight]) => sum + (met ? weight : 0), 0);

  return earned / total;
}

function hasText(value: string | null): boolean {
  return value !== null && value.trim().length > 0;
}
