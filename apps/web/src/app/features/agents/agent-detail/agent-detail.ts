import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { ACCEPTED_PICTURE_TYPES, type Agent } from '../../../core/api/agents.models';
import { AgentsService } from '../../../core/api/agents.service';
import { describeApiError, toApiError, type ApiError } from '../../../core/api/api-error';
import { SystemPromptsService } from '../../../core/api/system-prompts.service';
import type { SystemPrompt } from '../../../core/api/system-prompts.models';
import { NotificationService } from '../../../core/notifications/notification.service';
import { confirm } from '../../../shared/confirm-dialog/confirm-dialog';
import { EmptyState } from '../../../shared/empty-state/empty-state';
import { RelativeTimePipe } from '../../../shared/relative-time/relative-time.pipe';
import { AgentAvatar } from '../agent-avatar/agent-avatar';
import { AgentConfig } from '../agent-config/agent-config';
import { AgentMemoryPanel } from '../agent-memories/agent-memory-panel';

/**
 * One agent: its configuration, its profile picture and its private memories.
 *
 * `agentId` arrives as a route input (`withComponentInputBinding`), so the
 * component does not have to read `ActivatedRoute` itself.
 */
@Component({
  selector: 'app-agent-detail',
  imports: [
    AgentAvatar,
    AgentConfig,
    AgentMemoryPanel,
    EmptyState,
    MatButtonModule,
    MatCardModule,
    MatIconModule,
    MatMenuModule,
    MatProgressBarModule,
    MatTabsModule,
    MatTooltipModule,
    RelativeTimePipe,
    RouterLink,
  ],
  templateUrl: './agent-detail.html',
  styleUrl: './agent-detail.scss',
})
export class AgentDetail {
  private readonly agents = inject(AgentsService);
  private readonly systemPrompts = inject(SystemPromptsService);
  private readonly dialog = inject(MatDialog);
  private readonly notify = inject(NotificationService);
  private readonly router = inject(Router);

  readonly agentId = input.required<string>();

  protected readonly agent = signal<Agent | null>(null);
  protected readonly error = signal<ApiError | null>(null);
  protected readonly loading = signal(true);
  protected readonly uploading = signal(false);

  protected readonly prompts = signal<readonly SystemPrompt[]>([]);

  protected readonly acceptedTypes = ACCEPTED_PICTURE_TYPES.join(',');

  protected readonly promptName = computed(() => {
    const id = this.agent()?.systemPromptId;
    if (!id) {
      return null;
    }

    return this.prompts().find((prompt) => prompt.id === id)?.name ?? id;
  });

  constructor() {
    effect(() => this.load(this.agentId()));

    this.systemPrompts.list({ limit: 100, sort: 'name', order: 'asc' }).subscribe({
      next: (page) => this.prompts.set(page.items),
      // Only costs the prompt picker its labels; the page still works.
      error: () => this.prompts.set([]),
    });
  }

  protected load(agentId: string): void {
    this.loading.set(true);
    this.error.set(null);

    this.agents.get(agentId).subscribe({
      next: (agent) => {
        this.agent.set(agent);
        this.loading.set(false);
      },
      error: (error: unknown) => {
        this.agent.set(null);
        this.error.set(toApiError(error));
        this.loading.set(false);
      },
    });
  }

  protected onSaved(agent: Agent): void {
    this.agent.set(agent);
  }

  /**
   * Uploads a profile picture.
   *
   * The type is checked here as well as on the server so an obviously wrong
   * file is rejected before it is read and sent; the server's check is the one
   * that matters, since this one is trivially bypassed.
   */
  protected async onPictureSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    // Clearing lets the same file be chosen again after a failure.
    input.value = '';

    if (!file) {
      return;
    }

    if (!ACCEPTED_PICTURE_TYPES.includes(file.type)) {
      this.notify.error(null, 'Pictures must be JPEG, PNG, WebP or GIF. SVG is not accepted.');
      return;
    }

    const agent = this.agent();
    if (!agent) {
      return;
    }

    this.uploading.set(true);

    try {
      const updated = await firstValueFrom(this.agents.uploadPicture(agent.id, file));
      this.agent.set(updated);
      this.notify.success('Picture uploaded.');
    } catch (error) {
      this.notify.error(error, 'Could not upload the picture.');
    } finally {
      this.uploading.set(false);
    }
  }

  protected async removePicture(): Promise<void> {
    const agent = this.agent();
    if (!agent) {
      return;
    }

    this.uploading.set(true);

    try {
      await firstValueFrom(this.agents.removePicture(agent.id));
      this.agent.set({ ...agent, hasPicture: false });
      this.notify.success('Picture removed.');
    } catch (error) {
      this.notify.error(error, 'Could not remove the picture.');
    } finally {
      this.uploading.set(false);
    }
  }

  protected async remove(): Promise<void> {
    const agent = this.agent();
    if (!agent) {
      return;
    }

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
      void this.router.navigate(['/agents']);
    } catch (error) {
      this.notify.error(error, 'Could not delete the agent.');
    }
  }

  protected describe(error: ApiError): string {
    return describeApiError(error);
  }
}
