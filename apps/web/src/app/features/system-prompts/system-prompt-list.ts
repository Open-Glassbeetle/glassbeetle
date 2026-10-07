import { DecimalPipe } from '@angular/common';
import { Component, effect, inject, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatPaginatorModule } from '@angular/material/paginator';
import { firstValueFrom } from 'rxjs';

import { PAGE_SIZE_OPTIONS } from '../../core/api/pagination';
import { SystemPromptsService } from '../../core/api/system-prompts.service';
import type { SystemPrompt } from '../../core/api/system-prompts.models';
import { NotificationService } from '../../core/notifications/notification.service';
import { ListState } from '../../shared/list-state/list-state';
import { Panel } from '../../shared/ui/panel';
import { Skeleton } from '../../shared/ui/skeleton';
import { RelativeTimePipe } from '../../shared/relative-time/relative-time.pipe';
import { confirm } from '../../shared/confirm-dialog/confirm-dialog';
import { SystemPromptForm, type SystemPromptFormData } from './system-prompt-form';

/**
 * `/system-prompts` — the reusable instruction templates agents link to.
 */
@Component({
  selector: 'app-system-prompt-list',
  imports: [
    DecimalPipe,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatPaginatorModule,
    Panel,
    RelativeTimePipe,
    Skeleton,
  ],
  templateUrl: './system-prompt-list.html',
  styleUrl: './system-prompt-list.scss',
})
export class SystemPromptList {
  private readonly prompts = inject(SystemPromptsService);
  private readonly dialog = inject(MatDialog);
  private readonly notify = inject(NotificationService);
  private readonly router = inject(Router);

  /** Bound from `?new=1`, which the native menu's "New System Prompt" sets. */
  readonly new = input<string>();

  protected readonly pageSizeOptions = PAGE_SIZE_OPTIONS;

  protected readonly list = new ListState<SystemPrompt>({
    load: (query) => this.prompts.list(query),
    initialSort: 'name',
    initialOrder: 'asc',
  });

  constructor() {
    // Opening the editor through a route rather than straight from the menu
    // keeps the create flow addressable, and means the menu, the rail and the
    // page's own button all take the same path.
    effect(() => {
      if (this.new()) {
        this.clearNewFlag();
        this.openEditor(null);
      }
    });
  }

  /** Drops `?new=1` so a reload does not reopen the dialog. */
  private clearNewFlag(): void {
    void this.router.navigate([], {
      queryParams: { new: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  protected openEditor(prompt: SystemPrompt | null): void {
    this.openDialog({ prompt });
  }

  /**
   * Copies a prompt into a new one. The API has no duplicate endpoint, so this
   * opens the create dialog prefilled — the user can rename before saving
   * rather than ending up with two rows sharing a name.
   */
  protected duplicate(prompt: SystemPrompt): void {
    this.openDialog({
      prefill: { name: `${prompt.name} (copy)`, content: prompt.content },
    });
  }

  private openDialog(data: SystemPromptFormData): void {
    const ref = this.dialog.open<SystemPromptForm, SystemPromptFormData, SystemPrompt>(
      SystemPromptForm,
      { data, maxWidth: '52rem' },
    );

    ref.afterClosed().subscribe((saved) => {
      if (saved) {
        this.list.reload();
      }
    });
  }

  protected async remove(prompt: SystemPrompt): Promise<void> {
    const confirmed = await confirm(this.dialog, {
      title: 'Delete system prompt?',
      message:
        `“${prompt.name}” will be deleted. Agents linked to it keep their own ` +
        `instructions but lose this template.`,
      confirmLabel: 'Delete',
    });

    if (!confirmed) {
      return;
    }

    try {
      await firstValueFrom(this.prompts.remove(prompt.id));
      this.notify.success('System prompt deleted.');
      this.list.reloadAfterRemoval();
    } catch (error) {
      this.notify.error(error, 'Could not delete the system prompt.');
    }
  }

  protected async copyContent(prompt: SystemPrompt): Promise<void> {
    try {
      await navigator.clipboard.writeText(prompt.content);
      this.notify.success('Instructions copied.');
    } catch {
      this.notify.error(null, 'Could not copy to the clipboard.');
    }
  }
}
