import { Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatPaginatorModule } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSortModule } from '@angular/material/sort';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';

import type { Memory } from '../../core/api/memories.models';
import { SharedMemoriesService } from '../../core/api/memories.service';
import { PAGE_SIZE_OPTIONS } from '../../core/api/pagination';
import { NotificationService } from '../../core/notifications/notification.service';
import { confirm } from '../../shared/confirm-dialog/confirm-dialog';
import { EmptyState } from '../../shared/empty-state/empty-state';
import { ListState } from '../../shared/list-state/list-state';
import { PageHeader } from '../../shared/page-header/page-header';
import { RelativeTimePipe } from '../../shared/relative-time/relative-time.pipe';
import { MemoryForm, type MemoryFormData } from '../memories/memory-form';

/**
 * `/memories` — facts available to every agent, as opposed to the private
 * memories that hang off a single agent.
 */
@Component({
  selector: 'app-shared-memory-list',
  imports: [
    EmptyState,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatMenuModule,
    MatPaginatorModule,
    MatProgressBarModule,
    MatSortModule,
    MatTableModule,
    MatTooltipModule,
    PageHeader,
    RelativeTimePipe,
  ],
  templateUrl: './shared-memory-list.html',
  styleUrl: './shared-memory-list.scss',
})
export class SharedMemoryList {
  private readonly memories = inject(SharedMemoriesService);
  private readonly dialog = inject(MatDialog);
  private readonly notify = inject(NotificationService);

  protected readonly pageSizeOptions = PAGE_SIZE_OPTIONS;
  protected readonly columns = ['content', 'tags', 'updatedAt', 'actions'];

  /**
   * Exact-tag filter. The API has no endpoint listing the tags in use, so this
   * is typed or set by clicking a tag on a row rather than picked from a list
   * — a dropdown built from the current page would only ever offer the tags
   * that happen to be visible.
   */
  protected readonly tagFilter = signal('');

  protected readonly list = new ListState<Memory, { tag?: string }>({
    load: (query) => this.memories.list(query),
    extraParams: () => {
      const tag = this.tagFilter().trim();
      return tag ? { tag } : {};
    },
    initialSort: 'createdAt',
    initialOrder: 'desc',
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
    const ref = this.dialog.open<MemoryForm, MemoryFormData, Memory>(MemoryForm, {
      data: {
        memory,
        scopeLabel: 'Shared with every agent',
        create: (input) => this.memories.create(input),
        update: (memoryId, input) => this.memories.update(memoryId, input),
      },
      maxWidth: '48rem',
    });

    ref.afterClosed().subscribe((saved) => {
      if (saved) {
        this.list.reload();
      }
    });
  }

  protected async remove(memory: Memory): Promise<void> {
    const confirmed = await confirm(this.dialog, {
      title: 'Delete memory?',
      message: 'This memory will no longer be available to any agent. This cannot be undone.',
      confirmLabel: 'Delete',
    });

    if (!confirmed) {
      return;
    }

    try {
      await firstValueFrom(this.memories.remove(memory.id));
      this.notify.success('Memory deleted.');
      this.list.reloadAfterRemoval();
    } catch (error) {
      this.notify.error(error, 'Could not delete the memory.');
    }
  }
}
