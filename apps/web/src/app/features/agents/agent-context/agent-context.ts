import { DecimalPipe, NgTemplateOutlet } from '@angular/common';
import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { catchError, forkJoin, of } from 'rxjs';

import type { Agent } from '../../../core/api/agents.models';
import type { AgentMemory, Memory } from '../../../core/api/memories.models';
import { AgentMemoriesService, SharedMemoriesService } from '../../../core/api/memories.service';
import type { SystemPrompt } from '../../../core/api/system-prompts.models';
import { Panel } from '../../../shared/ui/panel';
import { Skeleton } from '../../../shared/ui/skeleton';

/** How many memories to show inline before deferring to the full list. */
const PREVIEW_SIZE = 4;

interface MemoryLayer {
  readonly total: number;
  readonly preview: readonly Memory[];
  readonly failed: boolean;
}

/**
 * Everything this agent is configured to draw on, laid out as the layers it is
 * built from.
 *
 * This is a view of the agent's configured inputs, not a rendered prompt. No
 * endpoint composes a final prompt — there is no inference module yet — so
 * presenting one would be inventing a server behaviour that does not exist.
 * What the screen shows is real and checkable: each layer's actual content,
 * its size, and where it comes from.
 */
@Component({
  selector: 'app-agent-context',
  imports: [
    DecimalPipe,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    NgTemplateOutlet,
    Panel,
    RouterLink,
    Skeleton,
  ],
  templateUrl: './agent-context.html',
  styleUrl: './agent-context.scss',
})
export class AgentContext {
  private readonly agentMemories = inject(AgentMemoriesService);
  private readonly sharedMemories = inject(SharedMemoriesService);

  readonly agent = input.required<Agent>();
  /** The agent's linked template, resolved by the parent. */
  readonly systemPrompt = input<SystemPrompt | null>(null);

  protected readonly loaded = signal(false);
  protected readonly privateMemory = signal<MemoryLayer | null>(null);
  protected readonly sharedMemory = signal<MemoryLayer | null>(null);

  protected readonly previewSize = PREVIEW_SIZE;

  protected readonly personality = computed(() => this.agent().personality);
  protected readonly instructions = computed(() => this.agent().instructions);

  /**
   * Total size of the instruction text.
   *
   * Only the three text layers are counted: those are exact. Memory is counted
   * in entries rather than characters because only a page of it is loaded, and
   * a character total over a partial read would be wrong in a way the number
   * would not reveal.
   */
  protected readonly instructionChars = computed(() => {
    const prompt = this.systemPrompt()?.content.length ?? 0;
    const personality = this.personality()?.length ?? 0;
    const instructions = this.instructions()?.length ?? 0;

    return prompt + personality + instructions;
  });

  protected readonly layerCount = computed(() => {
    const present = [
      this.systemPrompt() !== null,
      hasText(this.personality()),
      hasText(this.instructions()),
      (this.sharedMemory()?.total ?? 0) > 0,
      (this.privateMemory()?.total ?? 0) > 0,
    ];

    return present.filter(Boolean).length;
  });

  protected readonly empty = computed(() => this.loaded() && this.layerCount() === 0);

  constructor() {
    effect(() => this.load(this.agent().id));
  }

  /** Describes a memory layer by how much is in it and who can see it. */
  protected memorySubtitle(layer: MemoryLayer | null, scope: string): string {
    if (!layer) {
      return 'Loading…';
    }

    if (layer.failed) {
      return 'Unavailable';
    }

    const entries = `${layer.total} ${layer.total === 1 ? 'entry' : 'entries'}`;
    return `${entries} · ${scope}`;
  }

  protected load(agentId: string): void {
    this.loaded.set(false);

    const query = { limit: PREVIEW_SIZE, sort: 'updatedAt', order: 'desc' as const };

    forkJoin({
      privateMemory: this.agentMemories.list(agentId, query).pipe(catchError(() => of(null))),
      sharedMemory: this.sharedMemories.list(query).pipe(catchError(() => of(null))),
    }).subscribe(({ privateMemory, sharedMemory }) => {
      this.privateMemory.set(toLayer<AgentMemory>(privateMemory));
      this.sharedMemory.set(toLayer<Memory>(sharedMemory));
      this.loaded.set(true);
    });
  }
}

function toLayer<T extends Memory>(
  page: { items: readonly T[]; total: number } | null,
): MemoryLayer {
  if (!page) {
    return { total: 0, preview: [], failed: true };
  }

  return { total: page.total, preview: page.items, failed: false };
}

function hasText(value: string | null): boolean {
  return value !== null && value.trim().length > 0;
}
