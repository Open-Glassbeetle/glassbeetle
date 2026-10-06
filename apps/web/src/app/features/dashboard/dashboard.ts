import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { RouterLink } from '@angular/router';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { Observable, catchError, forkJoin, map, of } from 'rxjs';

import { AgentsService } from '../../core/api/agents.service';
import { SharedMemoriesService } from '../../core/api/memories.service';
import { SystemPromptsService } from '../../core/api/system-prompts.service';
import type { PaginatedResponse } from '../../core/api/pagination';
import { ApiStatusService } from '../api-status/api-status.service';
import { PageHeader } from '../../shared/page-header/page-header';

interface ResourceTotals {
  readonly agents: number | null;
  readonly sharedMemories: number | null;
  readonly systemPrompts: number | null;
}

/**
 * Landing page: whether the three tiers are talking to each other, and how
 * much of each resource exists.
 */
@Component({
  selector: 'app-dashboard',
  imports: [
    FormsModule,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    PageHeader,
    RouterLink,
  ],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class Dashboard implements OnInit {
  private readonly agents = inject(AgentsService);
  private readonly sharedMemories = inject(SharedMemoriesService);
  private readonly systemPrompts = inject(SystemPromptsService);

  protected readonly status = inject(ApiStatusService);

  protected readonly totals = signal<ResourceTotals>({
    agents: null,
    sharedMemories: null,
    systemPrompts: null,
  });
  protected readonly loadingTotals = signal(false);

  protected readonly inTauri = signal(isTauri());
  protected readonly greetName = signal('Glassbeetle');
  protected readonly greeting = signal('');

  protected readonly databaseCheck = computed(() => this.status.health()?.checks?.database ?? null);

  protected readonly uptime = computed(() => {
    const seconds = this.status.health()?.uptimeSeconds;
    return seconds === undefined ? null : formatUptime(seconds);
  });

  protected readonly tiles = computed(() => [
    {
      label: 'Agents',
      icon: 'smart_toy',
      total: this.totals().agents,
      link: '/agents',
    },
    {
      label: 'Shared memories',
      icon: 'hard_drive',
      total: this.totals().sharedMemories,
      link: '/memories',
    },
    {
      label: 'System prompts',
      icon: 'description',
      total: this.totals().systemPrompts,
      link: '/system-prompts',
    },
  ]);

  ngOnInit(): void {
    this.status.refresh();
    this.loadTotals();
  }

  protected refresh(): void {
    this.status.refresh();
    this.loadTotals();
  }

  /**
   * Reads each collection's `total` with the smallest page the API allows.
   *
   * `limit=1` is the cheapest way to learn a count: the envelope carries
   * `total` for the whole filtered set, not just the page. A failing resource
   * yields `null` so the other tiles still render — a dashboard that blanks out
   * entirely because one endpoint is unhappy is less useful than one that says
   * which one.
   */
  private loadTotals(): void {
    this.loadingTotals.set(true);

    forkJoin({
      agents: countOf(this.agents.list({ limit: 1 })),
      sharedMemories: countOf(this.sharedMemories.list({ limit: 1 })),
      systemPrompts: countOf(this.systemPrompts.list({ limit: 1 })),
    }).subscribe((totals) => {
      this.totals.set(totals);
      this.loadingTotals.set(false);
    });
  }

  /**
   * Calls the `greet` command in `apps/desktop/src-tauri/src/lib.rs` — the
   * working example of Angular reaching Rust directly.
   */
  protected async greet(): Promise<void> {
    if (!this.inTauri()) {
      this.greeting.set('Tauri IPC is only available inside the desktop window.');
      return;
    }

    this.greeting.set(await invoke<string>('greet', { name: this.greetName() }));
  }
}

/**
 * Reads the `total` off a paginated envelope, reporting `null` instead of
 * failing so one unhappy endpoint does not blank the whole dashboard.
 */
function countOf(source: Observable<PaginatedResponse<unknown>>): Observable<number | null> {
  return source.pipe(
    map((page) => page.total),
    catchError(() => of(null)),
  );
}

/** Renders a second count as the largest sensible unit, e.g. "2h 5m". */
function formatUptime(seconds: number): string {
  if (seconds < 60) {
    return `${Math.floor(seconds)}s`;
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ${minutes % 60}m`;
  }

  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}
