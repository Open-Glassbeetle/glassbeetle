import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { forkJoin, catchError, map, of } from 'rxjs';

import { readinessOf, configuredFraction } from '../../core/agents/agent-readiness';
import { ActivityService, type ActivityEvent } from '../../core/activity/activity.service';
import { SharedMemoriesService } from '../../core/api/memories.service';
import { SystemPromptsService } from '../../core/api/system-prompts.service';
import { AgentRosterService } from '../../core/workspace/agent-roster.service';
import { ApiStatusService } from '../api-status/api-status.service';
import { AgentAvatar } from '../agents/agent-avatar/agent-avatar';
import { Panel } from '../../shared/ui/panel';
import { ReadinessBadge } from '../../shared/ui/readiness-badge';
import { Skeleton } from '../../shared/ui/skeleton';
import { RelativeTimePipe } from '../../shared/relative-time/relative-time.pipe';

/** Icon per activity entity, so the feed is scannable without reading it. */
const ENTITY_ICON: Record<ActivityEvent['entity'], string> = {
  agent: 'graph_3',
  memory: 'database',
  prompt: 'article',
};

const ENTITY_LABEL: Record<ActivityEvent['entity'], string> = {
  agent: 'Agent',
  memory: 'Memory',
  prompt: 'Prompt',
};

/**
 * The workspace home: who is in it, what state they are in, and what has
 * changed recently.
 */
@Component({
  selector: 'app-overview',
  imports: [
    AgentAvatar,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    Panel,
    ReadinessBadge,
    RelativeTimePipe,
    RouterLink,
    Skeleton,
  ],
  templateUrl: './overview.html',
  styleUrl: './overview.scss',
})
export class Overview implements OnInit {
  private readonly activity = inject(ActivityService);
  private readonly memories = inject(SharedMemoriesService);
  private readonly prompts = inject(SystemPromptsService);

  protected readonly roster = inject(AgentRosterService);
  protected readonly status = inject(ApiStatusService);

  protected readonly events = signal<readonly ActivityEvent[]>([]);
  protected readonly activityLoaded = signal(false);

  protected readonly memoryCount = signal<number | null>(null);
  protected readonly promptCount = signal<number | null>(null);
  protected readonly countsLoaded = signal(false);

  protected readonly entityIcon = ENTITY_ICON;
  protected readonly entityLabel = ENTITY_LABEL;

  /** The roster, ordered so the agents needing attention surface first. */
  protected readonly agents = computed(() =>
    this.roster
      .agents()
      .map((agent) => ({
        agent,
        readiness: readinessOf(agent),
        configured: Math.round(configuredFraction(agent) * 100),
      }))
      .sort((a, b) => {
        const order = { blocked: 0, unguided: 1, ready: 2 };
        const byLevel = order[a.readiness.level] - order[b.readiness.level];
        return byLevel !== 0 ? byLevel : a.agent.name.localeCompare(b.agent.name);
      }),
  );

  protected readonly needsAttention = computed(
    () => this.agents().filter((entry) => entry.readiness.level !== 'ready').length,
  );

  ngOnInit(): void {
    this.status.refresh();
    this.roster.refresh();
    this.loadActivity();
    this.loadCounts();
  }

  protected refresh(): void {
    this.status.refresh();
    this.roster.refresh();
    this.activityLoaded.set(false);
    this.countsLoaded.set(false);
    this.loadActivity();
    this.loadCounts();
  }

  private loadActivity(): void {
    this.activity.recent(10).subscribe((events) => {
      this.events.set(events);
      this.activityLoaded.set(true);
    });
  }

  /**
   * Reads each collection's `total` with the smallest page the API allows:
   * the envelope carries the count for the whole filtered set, not just the
   * page, so `limit=1` is the cheapest way to learn it.
   */
  private loadCounts(): void {
    const count = (total: number) => total;

    forkJoin({
      memories: this.memories.list({ limit: 1 }).pipe(
        map((page) => count(page.total)),
        catchError(() => of(null)),
      ),
      prompts: this.prompts.list({ limit: 1 }).pipe(
        map((page) => count(page.total)),
        catchError(() => of(null)),
      ),
    }).subscribe(({ memories, prompts }) => {
      this.memoryCount.set(memories);
      this.promptCount.set(prompts);
      this.countsLoaded.set(true);
    });
  }
}
