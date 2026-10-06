import { Injectable, inject } from '@angular/core';
import { Observable, catchError, combineLatest, map, of } from 'rxjs';

import { AgentsService } from '../api/agents.service';
import { SharedMemoriesService } from '../api/memories.service';
import { SystemPromptsService } from '../api/system-prompts.service';
import type { Agent } from '../api/agents.models';
import type { Memory } from '../api/memories.models';
import type { SystemPrompt } from '../api/system-prompts.models';

export type ActivityEntity = 'agent' | 'memory' | 'prompt';
export type ActivityKind = 'created' | 'updated';

export interface ActivityEvent {
  readonly id: string;
  /** ISO-8601 timestamp the event is sorted by. */
  readonly at: string;
  readonly kind: ActivityKind;
  readonly entity: ActivityEntity;
  readonly title: string;
  readonly detail: string | null;
  /** Router link to the thing that changed, when it has a page of its own. */
  readonly link: readonly string[] | null;
}

/** How many of each collection to read when building the feed. */
const PER_COLLECTION = 15;

/**
 * A change feed for the workspace, assembled from the timestamps every
 * resource already carries.
 *
 * This is a record of what *changed*, not of what agents have *done*: there is
 * no event log in the API, and `usage_events` has no endpoint. Every row here
 * is a real `created_at` or `updated_at` from a real resource, so the feed is
 * honest about being a configuration history — which is the only history that
 * currently exists.
 *
 * Each resource contributes one event: its most recent change. Emitting both a
 * creation and an update for everything would double the feed's length without
 * adding anything, since the two timestamps are equal until the first edit.
 */
@Injectable({ providedIn: 'root' })
export class ActivityService {
  private readonly agents = inject(AgentsService);
  private readonly memories = inject(SharedMemoriesService);
  private readonly prompts = inject(SystemPromptsService);

  /**
   * Reads the most recently changed resources across the workspace.
   *
   * A collection that fails contributes nothing rather than failing the feed:
   * a partial history is more useful than an error where the history should be.
   */
  recent(limit = 12): Observable<readonly ActivityEvent[]> {
    const query = {
      limit: PER_COLLECTION,
      sort: 'updatedAt',
      order: 'desc' as const,
    };

    return combineLatest([
      this.agents.list(query).pipe(
        map((page) => page.items.map(agentEvent)),
        catchError(() => of([] as ActivityEvent[])),
      ),
      this.memories.list(query).pipe(
        map((page) => page.items.map(memoryEvent)),
        catchError(() => of([] as ActivityEvent[])),
      ),
      this.prompts.list(query).pipe(
        map((page) => page.items.map(promptEvent)),
        catchError(() => of([] as ActivityEvent[])),
      ),
    ]).pipe(
      map(([agents, memories, prompts]) =>
        [...agents, ...memories, ...prompts]
          .sort((a, b) => b.at.localeCompare(a.at))
          .slice(0, limit),
      ),
    );
  }
}

/**
 * Timestamps are ISO-8601 UTC with millisecond precision and are written by the
 * server in one place, so an unedited row has `createdAt === updatedAt` exactly.
 */
function kindOf(entity: { createdAt: string; updatedAt: string }): ActivityKind {
  return entity.createdAt === entity.updatedAt ? 'created' : 'updated';
}

function agentEvent(agent: Agent): ActivityEvent {
  return {
    id: `agent:${agent.id}`,
    at: agent.updatedAt,
    kind: kindOf(agent),
    entity: 'agent',
    title: agent.name,
    detail: agent.personality,
    link: ['/agents', agent.id],
  };
}

function memoryEvent(memory: Memory): ActivityEvent {
  return {
    id: `memory:${memory.id}`,
    at: memory.updatedAt,
    kind: kindOf(memory),
    entity: 'memory',
    title: memory.content,
    detail: memory.tags.length > 0 ? memory.tags.join(' · ') : null,
    link: ['/memory'],
  };
}

function promptEvent(prompt: SystemPrompt): ActivityEvent {
  return {
    id: `prompt:${prompt.id}`,
    at: prompt.updatedAt,
    kind: kindOf(prompt),
    entity: 'prompt',
    title: prompt.name,
    detail: null,
    link: ['/prompts'],
  };
}
