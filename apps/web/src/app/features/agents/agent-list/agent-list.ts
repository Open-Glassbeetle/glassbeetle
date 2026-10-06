import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatSortModule } from '@angular/material/sort';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import type { Agent } from '../../../core/api/agents.models';
import { AgentsService } from '../../../core/api/agents.service';
import { PAGE_SIZE_OPTIONS } from '../../../core/api/pagination';
import { SystemPromptsService } from '../../../core/api/system-prompts.service';
import type { SystemPrompt } from '../../../core/api/system-prompts.models';
import { NotificationService } from '../../../core/notifications/notification.service';
import { confirm } from '../../../shared/confirm-dialog/confirm-dialog';
import { EmptyState } from '../../../shared/empty-state/empty-state';
import { ListState } from '../../../shared/list-state/list-state';
import { PageHeader } from '../../../shared/page-header/page-header';
import { RelativeTimePipe } from '../../../shared/relative-time/relative-time.pipe';
import { AgentAvatar } from '../agent-avatar/agent-avatar';
import { AgentCreateDialog } from '../agent-create/agent-create-dialog';

/** The value the API expects to select rows whose foreign key is NULL. */
const UNASSIGNED = 'null';

@Component({
  selector: 'app-agent-list',
  imports: [
    AgentAvatar,
    EmptyState,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatPaginatorModule,
    MatProgressBarModule,
    MatSelectModule,
    MatSortModule,
    MatTableModule,
    MatTooltipModule,
    PageHeader,
    RelativeTimePipe,
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

  protected readonly pageSizeOptions = PAGE_SIZE_OPTIONS;
  protected readonly columns = ['name', 'systemPrompt', 'sampling', 'updatedAt', 'actions'];

  protected readonly unassigned = UNASSIGNED;

  /** `''` means no filter, `'null'` means "no prompt assigned". */
  protected readonly promptFilter = signal('');

  protected readonly list = new ListState<Agent, { systemPromptId?: string }>({
    load: (query) => this.agents.list(query),
    extraParams: () => {
      const systemPromptId = this.promptFilter();
      return systemPromptId ? { systemPromptId } : {};
    },
    initialSort: 'name',
    initialOrder: 'asc',
  });

  /**
   * Prompts offered in the filter, loaded once.
   *
   * The filter is a `limit=100` read rather than a paged picker: the dropdown
   * has to show a name for an id, and a user with more than a hundred prompt
   * templates is not the case this screen is built for.
   */
  private readonly promptList = signal<readonly SystemPrompt[]>([]);

  /** Prompt names by id, for rendering the agent's link as something readable. */
  protected readonly promptNames = computed(() => {
    const names = new Map<string, string>();
    for (const prompt of this.promptList()) {
      names.set(prompt.id, prompt.name);
    }
    return names;
  });

  protected readonly prompts = this.promptList.asReadonly();

  constructor() {
    this.systemPrompts.list({ limit: 100, sort: 'name', order: 'asc' }).subscribe({
      next: (page) => this.promptList.set(page.items),
      // A failure here only costs the filter dropdown and the prompt names;
      // the agent list itself is unaffected, so it is not worth a snackbar.
      error: () => this.promptList.set([]),
    });
  }

  protected setPromptFilter(value: string): void {
    this.promptFilter.set(value);
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

  protected open(agent: Agent): void {
    void this.router.navigate(['/agents', agent.id]);
  }

  protected createAgent(): void {
    const ref = this.dialog.open<AgentCreateDialog, undefined, Agent>(AgentCreateDialog);

    ref.afterClosed().subscribe((agent) => {
      if (agent) {
        // Straight to the agent's page: a new agent has nothing configured yet,
        // and that is where the configuration lives.
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
    } catch (error) {
      this.notify.error(error, 'Could not delete the agent.');
    }
  }
}
