import { Component, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';

import type { Agent } from '../../../core/api/agents.models';
import type { AgentMemory, Memory } from '../../../core/api/memories.models';
import { AgentMemoriesService } from '../../../core/api/memories.service';
import { PAGE_SIZE_OPTIONS } from '../../../core/api/pagination';
import { NotificationService } from '../../../core/notifications/notification.service';
import { confirm } from '../../../shared/confirm-dialog/confirm-dialog';
import { EmptyState } from '../../../shared/empty-state/empty-state';
import { ListState } from '../../../shared/list-state/list-state';
import { RelativeTimePipe } from '../../../shared/relative-time/relative-time.pipe';
import { MemoryForm, type MemoryFormData } from '../../memories/memory-form';

/**
 * One agent's private memories, shown on the agent's own page.
 *
 * Rendered as cards rather than as a table: a memory is a paragraph of text
 * with tags, and the columns a table would need are mostly the text itself.
 */
@Component({
  selector: 'app-agent-memory-panel',
  imports: [
    EmptyState,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatPaginatorModule,
    MatProgressBarModule,
    MatTooltipModule,
    RelativeTimePipe,
  ],
  templateUrl: './agent-memory-panel.html',
  styleUrl: './agent-memory-panel.scss',
})
export class AgentMemoryPanel {
  private readonly memories = inject(AgentMemoriesService);
  private readonly dialog = inject(MatDialog);
  private readonly notify = inject(NotificationService);

  readonly agent = input.required<Agent>();

  protected readonly pageSizeOptions = PAGE_SIZE_OPTIONS;
  protected readonly tagFilter = signal('');

  protected readonly list = new ListState<AgentMemory, { tag?: string }>({
    // Reading `agent()` here is what re-runs the request if the page is ever
    // reused for a different agent.
    load: (query) => this.memories.list(this.agent().id, query),
    extraParams: () => {
      const tag = this.tagFilter().trim();
      return tag ? { tag } : {};
    },
    initialSort: 'createdAt',
    initialOrder: 'desc',
    pageSize: 10,
  });

  protected setTagFilter(tag: string): void {
    this.tagFilter.set(tag);
    this.list.resetPage();
  }

  protected clearFilters(): void {
    this.tagFilter.set('');
    this.list.clearSearch();
  }

  protected openEditor(memory: Memory | null): void {
    const agentId = this.agent().id;

    const ref = this.dialog.open<MemoryForm, MemoryFormData, Memory>(MemoryForm, {
      data: {
        memory,
        scopeLabel: `Private to ${this.agent().name}`,
        create: (input) => this.memories.create(agentId, input),
        update: (memoryId, input) => this.memories.update(agentId, memoryId, input),
      },
      maxWidth: '48rem',
    });

    ref.afterClosed().subscribe((saved) => {
      if (saved) {
        this.list.reload();
      }
    });
  }

  protected async remove(memory: AgentMemory): Promise<void> {
    const confirmed = await confirm(this.dialog, {
      title: 'Delete memory?',
      message: `This memory will be removed from ${this.agent().name}. This cannot be undone.`,
      confirmLabel: 'Delete',
    });

    if (!confirmed) {
      return;
    }

    try {
      await firstValueFrom(this.memories.remove(this.agent().id, memory.id));
      this.notify.success('Memory deleted.');
      this.list.reloadAfterRemoval();
    } catch (error) {
      this.notify.error(error, 'Could not delete the memory.');
    }
  }
}
