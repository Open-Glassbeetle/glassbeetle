import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatDialog } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { ACCEPTED_PICTURE_TYPES, type Agent } from '../../../core/api/agents.models';
import { AgentsService } from '../../../core/api/agents.service';
import { describeApiError, toApiError, type ApiError } from '../../../core/api/api-error';
import { SystemPromptsService } from '../../../core/api/system-prompts.service';
import type { SystemPrompt } from '../../../core/api/system-prompts.models';
import { readinessOf } from '../../../core/agents/agent-readiness';
import { CapabilitiesService } from '../../../core/platform/capabilities.service';
import { NotificationService } from '../../../core/notifications/notification.service';
import { AgentRosterService } from '../../../core/workspace/agent-roster.service';
import { confirm } from '../../../shared/confirm-dialog/confirm-dialog';
import { ReadinessBadge } from '../../../shared/ui/readiness-badge';
import { Skeleton } from '../../../shared/ui/skeleton';
import { RelativeTimePipe } from '../../../shared/relative-time/relative-time.pipe';
import { AgentAvatar } from '../agent-avatar/agent-avatar';
import { AgentConfig } from '../agent-config/agent-config';
import { AgentContext } from '../agent-context/agent-context';
import { AgentMemoryPanel } from '../agent-memories/agent-memory-panel';

const TABS = ['context', 'memory', 'settings'] as const;
type Tab = (typeof TABS)[number];

/**
 * One agent's workspace: what it is configured to draw on, its private memory,
 * and its settings.
 *
 * `agentId` and `tab` arrive as route inputs (`withComponentInputBinding`), so
 * the open section is part of the URL and can be linked to.
 */
@Component({
  selector: 'app-agent-detail',
  imports: [
    AgentAvatar,
    AgentConfig,
    AgentContext,
    AgentMemoryPanel,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatTooltipModule,
    ReadinessBadge,
    RelativeTimePipe,
    RouterLink,
    Skeleton,
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
  private readonly roster = inject(AgentRosterService);
  protected readonly capabilities = inject(CapabilitiesService);

  readonly agentId = input.required<string>();
  /** Bound from `?tab=`; anything unrecognised falls back to the first one. */
  readonly tab = input<string>();

  protected readonly tabs: readonly { id: Tab; label: string; icon: string }[] = [
    { id: 'context', label: 'Context', icon: 'layers' },
    { id: 'memory', label: 'Memory', icon: 'encrypted' },
    { id: 'settings', label: 'Settings', icon: 'tune' },
  ];

  protected readonly agent = signal<Agent | null>(null);
  protected readonly error = signal<ApiError | null>(null);
  protected readonly loading = signal(true);
  protected readonly uploading = signal(false);

  protected readonly prompts = signal<readonly SystemPrompt[]>([]);

  protected readonly acceptedTypes = ACCEPTED_PICTURE_TYPES.join(',');

  protected readonly activeTab = computed<Tab>(() => {
    const requested = this.tab();
    return TABS.includes(requested as Tab) ? (requested as Tab) : 'context';
  });

  protected readonly readiness = computed(() => {
    const agent = this.agent();
    return agent
      ? readinessOf(agent, { modelsAvailable: this.capabilities.modelsAvailable() })
      : null;
  });

  protected readonly linkedPrompt = computed(() => {
    const id = this.agent()?.systemPromptId;
    if (!id) {
      return null;
    }

    return this.prompts().find((prompt) => prompt.id === id) ?? null;
  });

  constructor() {
    effect(() => this.load(this.agentId()));

    this.systemPrompts.list({ limit: 100, sort: 'name', order: 'asc' }).subscribe({
      next: (page) => this.prompts.set(page.items),
      // Only costs the picker its labels; the rest of the page still works.
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

  /** Switches section without adding a history entry per tab click. */
  protected selectTab(tab: Tab): void {
    void this.router.navigate([], {
      queryParams: { tab },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  protected onSaved(agent: Agent): void {
    this.agent.set(agent);
    // The rail shows this agent's name and readiness, so it has to be told.
    this.roster.refresh();
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
      this.roster.refresh();
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
      this.roster.refresh();
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
      this.roster.refresh();
      void this.router.navigate(['/agents']);
    } catch (error) {
      this.notify.error(error, 'Could not delete the agent.');
    }
  }

  protected describe(error: ApiError): string {
    return describeApiError(error);
  }
}
