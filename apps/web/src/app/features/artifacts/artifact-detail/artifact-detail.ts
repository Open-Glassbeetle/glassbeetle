import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router, RouterLink } from '@angular/router';
import { Subject, catchError, firstValueFrom, map, of, switchMap } from 'rxjs';

import { describeApiError, toApiError, type ApiError } from '../../../core/api/api-error';
import { artifactIcon, type Artifact } from '../../../core/api/artifacts.models';
import { ArtifactsService } from '../../../core/api/artifacts.service';
import { NotificationService } from '../../../core/notifications/notification.service';
import { AgentRosterService } from '../../../core/workspace/agent-roster.service';
import { ConversationsService } from '../../../core/workspace/conversations.service';
import { confirm } from '../../../shared/confirm-dialog/confirm-dialog';
import { RelativeTimePipe } from '../../../shared/relative-time/relative-time.pipe';
import { Panel } from '../../../shared/ui/panel';
import { Skeleton } from '../../../shared/ui/skeleton';

interface LoadResult {
  readonly artifact: Artifact | null;
  readonly error: ApiError | null;
}

/**
 * `/artifacts/:artifactId` — one artifact: what it is, where it came from,
 * and its content when that is text.
 *
 * A file-backed artifact is not rendered here: its bytes can be anything, and
 * the API serves them with the right type from the content endpoint, so the
 * page links there rather than guessing how to draw them.
 */
@Component({
  selector: 'app-artifact-detail',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatTooltipModule,
    Panel,
    RelativeTimePipe,
    RouterLink,
    Skeleton,
  ],
  templateUrl: './artifact-detail.html',
  styleUrl: './artifact-detail.scss',
})
export class ArtifactDetail {
  private readonly artifacts = inject(ArtifactsService);
  private readonly roster = inject(AgentRosterService);
  private readonly conversations = inject(ConversationsService);
  private readonly dialog = inject(MatDialog);
  private readonly notify = inject(NotificationService);
  private readonly router = inject(Router);

  /** Bound from the route (`withComponentInputBinding`). */
  readonly artifactId = input.required<string>();

  private readonly loads = new Subject<string>();

  protected readonly artifact = signal<Artifact | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<ApiError | null>(null);

  protected readonly icon = computed(() => artifactIcon(this.artifact()?.type ?? ''));

  protected readonly agentName = computed(() => {
    const agentId = this.artifact()?.agentId;
    return agentId
      ? (this.roster.agents().find((agent) => agent.id === agentId)?.name ?? 'Agent')
      : null;
  });

  protected readonly projectName = computed(() => {
    const projectId = this.artifact()?.projectId;
    return projectId ? (this.conversations.projectName(projectId) ?? 'Project') : null;
  });

  protected readonly fileUrl = computed(() => {
    const artifact = this.artifact();
    return artifact?.hasFile ? this.artifacts.contentUrl(artifact.id) : null;
  });

  constructor() {
    this.loads
      .pipe(
        switchMap((artifactId) =>
          this.artifacts.get(artifactId).pipe(
            map((artifact): LoadResult => ({ artifact, error: null })),
            catchError((error: unknown) =>
              of<LoadResult>({ artifact: null, error: toApiError(error) }),
            ),
          ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe(({ artifact, error }) => {
        this.artifact.set(artifact);
        this.error.set(error);
        this.loading.set(false);
      });

    effect(() => this.load(this.artifactId()));
  }

  protected load(artifactId: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.loads.next(artifactId);
  }

  protected async copy(): Promise<void> {
    const content = this.artifact()?.content;
    if (!content) {
      return;
    }

    try {
      await navigator.clipboard.writeText(content);
      this.notify.success('Copied.');
    } catch (error) {
      this.notify.error(error, 'Could not copy to the clipboard.');
    }
  }

  protected async remove(): Promise<void> {
    const artifact = this.artifact();
    if (!artifact) {
      return;
    }

    const confirmed = await confirm(this.dialog, {
      title: 'Delete artifact?',
      message: `“${artifact.title}” and every stored version of it will be deleted. This cannot be undone.`,
      confirmLabel: 'Delete',
    });

    if (!confirmed) {
      return;
    }

    try {
      await firstValueFrom(this.artifacts.remove(artifact.id));
      this.notify.success('Artifact deleted.');
      void this.router.navigate(['/artifacts']);
    } catch (error) {
      this.notify.error(error, 'Could not delete the artifact.');
    }
  }

  protected describe(error: ApiError): string {
    return describeApiError(error);
  }
}
