import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatPaginatorModule } from '@angular/material/paginator';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { readinessOf } from '../../../core/agents/agent-readiness';
import type { Agent } from '../../../core/api/agents.models';
import { AgentsService } from '../../../core/api/agents.service';
import { PAGE_SIZE_OPTIONS, type SortOrder } from '../../../core/api/pagination';
import { SystemPromptsService } from '../../../core/api/system-prompts.service';
import type { SystemPrompt } from '../../../core/api/system-prompts.models';
import { NotificationService } from '../../../core/notifications/notification.service';
import { CapabilitiesService } from '../../../core/platform/capabilities.service';
import { AgentRosterService } from '../../../core/workspace/agent-roster.service';
import { confirm } from '../../../shared/confirm-dialog/confirm-dialog';
import { ListState } from '../../../shared/list-state/list-state';
import { Panel } from '../../../shared/ui/panel';
import { ReadinessBadge } from '../../../shared/ui/readiness-badge';
import { Skeleton } from '../../../shared/ui/skeleton';
import { RelativeTimePipe } from '../../../shared/relative-time/relative-time.pipe';
import { AgentAvatar } from '../agent-avatar/agent-avatar';
import { AgentCreateDialog } from '../agent-create/agent-create-dialog';

/** The value the API expects to select rows whose foreign key is NULL. */
const UNASSIGNED = 'null';

interface SortOption {
  readonly key: string;
  readonly label: string;
  readonly sort: string;
  readonly order: SortOrder;
}

const SORT_OPTIONS: readonly SortOption[] = [
  { key: 'name', label: 'Name', sort: 'name', order: 'asc' },
  { key: 'recent', label: 'Recently updated', sort: 'updatedAt', order: 'desc' },
  { key: 'created', label: 'Newest first', sort: 'createdAt', order: 'desc' },
];

@Component({
  selector: 'app-agent-list',
  imports: [
    AgentAvatar,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatPaginatorModule,
    MatSelectModule,
    MatTooltipModule,
    Panel,
    ReadinessBadge,
    RelativeTimePipe,
    RouterLink,
    Skeleton,
  ],
  templateUrl: './agent-list.html',
  styleUrl: './agent-list.scss',
})
export class AgentList {
  private readonly agents = inject(AgentsService);
  private readonly systemPrompts = inject(SystemPromptsService);
  private readonly dialog = inject(MatDialog);
  private readonly notify = inject(NotificationService);
  private readonly router = inject(Router);
  private readonly roster = inject(AgentRosterService);
  private readonly capabilities = inject(CapabilitiesService);

  /** Bound from `?new=1`, which the rail's "New agent" link sets. */
  readonly new = input<string>();

  protected readonly pageSizeOptions = PAGE_SIZE_OPTIONS;
  protected readonly sortOptions = SORT_OPTIONS;
  protected readonly unassigned = UNASSIGNED;

  /** `''` means no filter, `'null'` means "no prompt assigned". */
  protected readonly promptFilter = signal('');
  protected readonly sortKey = signal(SORT_OPTIONS[0]!.key);

  protected readonly list = new ListState<Agent, { systemPromptId?: string }>({
    load: (query) => this.agents.list(query),
    extraParams: () => {
      const systemPromptId = this.promptFilter();
      return systemPromptId ? { systemPromptId } : {};
    },
    initialSort: 'name',
    initialOrder: 'asc',
  });

  private readonly promptList = signal<readonly SystemPrompt[]>([]);
  protected readonly prompts = this.promptList.asReadonly();

  private readonly promptNames = computed(() => {
    const names = new Map<string, string>();
    for (const prompt of this.promptList()) {
      names.set(prompt.id, prompt.name);
    }
    return names;
  });

  protected readonly entries = computed(() => {
    const context = { modelsAvailable: this.capabilities.modelsAvailable() };

    return this.list.items().map((agent) => ({
      agent,
      readiness: readinessOf(agent, context),
    }));
  });

  constructor() {
    this.systemPrompts.list({ limit: 100, sort: 'name', order: 'asc' }).subscribe({
      next: (page) => this.promptList.set(page.items),
      // Costs only the filter's labels; the list itself is unaffected.
      error: () => this.promptList.set([]),
    });

    // The rail links here with `?new=1` rather than opening a dialog from the
    // shell, so the create flow has a URL and the shell stays free of it.
    effect(() => {
      if (this.new()) {
        this.clearNewFlag();
        this.createAgent();
      }
    });
  }

  protected setPromptFilter(value: string): void {
    this.promptFilter.set(value);
    this.list.resetPage();
  }

  protected setSort(key: string): void {
    const option = SORT_OPTIONS.find((entry) => entry.key === key);
    if (!option) {
      return;
    }

    this.sortKey.set(option.key);
    this.list.sort.set(option.sort);
    this.list.order.set(option.order);
    this.list.resetPage();
  }

  protected clearFilters(): void {
    this.promptFilter.set('');
    this.list.clearSearch();
  }

  protected promptLabel(agent: Agent): string | null {
    if (!agent.systemPromptId) {
      return null;
    }

    // Falls back to the id when the prompt is not in the loaded page, which is
    // still more useful than showing nothing.
    return this.promptNames().get(agent.systemPromptId) ?? agent.systemPromptId;
  }

  protected createAgent(): void {
    const ref = this.dialog.open<AgentCreateDialog, undefined, Agent>(AgentCreateDialog);

    ref.afterClosed().subscribe((agent) => {
      if (agent) {
        this.roster.refresh();
        // Straight to the agent's page: a new agent has nothing configured
        // yet, and that is where the configuration lives.
        void this.router.navigate(['/agents', agent.id]);
      }
    });
  }

  protected async remove(agent: Agent): Promise<void> {
    const confirmed = await confirm(this.dialog, {
      title: 'Delete agent?',
      message: `“${agent.name}” and its private memories will be deleted. This cannot be undone.`,
      confirmLabel: 'Delete',
    });

    if (!confirmed) {
      return;
    }

    try {
      await firstValueFrom(this.agents.remove(agent.id));
      this.notify.success('Agent deleted.');
      this.list.reloadAfterRemoval();
      this.roster.refresh();
    } catch (error) {
      this.notify.error(error, 'Could not delete the agent.');
    }
  }

  /** Drops `?new=1` so a reload does not reopen the dialog. */
  private clearNewFlag(): void {
    void this.router.navigate([], {
      queryParams: { new: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
