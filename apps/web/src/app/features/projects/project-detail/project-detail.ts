import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { Router, RouterLink } from '@angular/router';
import { Subject, catchError, firstValueFrom, forkJoin, map, of, switchMap } from 'rxjs';

import { describeApiError, toApiError, type ApiError } from '../../../core/api/api-error';
import { artifactIcon, type Artifact } from '../../../core/api/artifacts.models';
import { ArtifactsService } from '../../../core/api/artifacts.service';
import { ownerOf, titleOf, type Chat } from '../../../core/api/chats.models';
import { ChatsService } from '../../../core/api/chats.service';
import type { Project } from '../../../core/api/projects.models';
import { ProjectsService } from '../../../core/api/projects.service';
import { NotificationService } from '../../../core/notifications/notification.service';
import { AgentRosterService } from '../../../core/workspace/agent-roster.service';
import { ConversationsService } from '../../../core/workspace/conversations.service';
import { confirm } from '../../../shared/confirm-dialog/confirm-dialog';
import { RelativeTimePipe } from '../../../shared/relative-time/relative-time.pipe';
import { Panel } from '../../../shared/ui/panel';
import { Skeleton } from '../../../shared/ui/skeleton';
import { ProjectDialog, type ProjectDialogData } from '../project-dialog/project-dialog';

/** How many of a project's chats and artifacts its page reads. */
const PROJECT_PAGE_SIZE = 50;

interface Contents {
  readonly chats: readonly Chat[];
  readonly chatTotal: number;
  readonly artifacts: readonly Artifact[];
  readonly artifactTotal: number;
}

interface LoadResult {
  readonly project: Project | null;
  readonly contents: Contents | null;
  readonly error: ApiError | null;
}

/**
 * `/projects/:projectId` — one piece of work: its conversations and what they
 * produced.
 *
 * Both lists are read with the project as a filter on the collections that
 * already exist, so this page is a view over chats and artifacts rather than
 * a third place either of them lives.
 */
@Component({
  selector: 'app-project-detail',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    Panel,
    RelativeTimePipe,
    RouterLink,
    Skeleton,
  ],
  templateUrl: './project-detail.html',
  styleUrl: './project-detail.scss',
})
export class ProjectDetail {
  private readonly projects = inject(ProjectsService);
  private readonly chatsApi = inject(ChatsService);
  private readonly artifactsApi = inject(ArtifactsService);
  private readonly conversations = inject(ConversationsService);
  private readonly roster = inject(AgentRosterService);
  private readonly dialog = inject(MatDialog);
  private readonly notify = inject(NotificationService);
  private readonly router = inject(Router);

  /** Bound from the route (`withComponentInputBinding`). */
  readonly projectId = input.required<string>();

  private readonly loads = new Subject<string>();

  protected readonly project = signal<Project | null>(null);
  protected readonly contents = signal<Contents | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<ApiError | null>(null);

  /** The project's conversations, each named with who it is with. */
  protected readonly chats = computed(() =>
    (this.contents()?.chats ?? []).map((chat) => ({
      chat,
      title: titleOf(chat),
      untitled: !chat.title,
      owner: this.ownerLabel(chat),
    })),
  );

  protected readonly artifacts = computed(() =>
    (this.contents()?.artifacts ?? []).map((artifact) => ({
      artifact,
      icon: artifactIcon(artifact.type),
    })),
  );

  constructor() {
    this.loads
      .pipe(
        switchMap((projectId) =>
          forkJoin({
            project: this.projects.get(projectId),
            chats: this.chatsApi.list({
              projectId,
              limit: PROJECT_PAGE_SIZE,
              sort: 'updatedAt',
              order: 'desc',
            }),
            artifacts: this.artifactsApi.list({
              projectId,
              limit: PROJECT_PAGE_SIZE,
              sort: 'updatedAt',
              order: 'desc',
            }),
          }).pipe(
            map(({ project, chats, artifacts }): LoadResult => ({
              project,
              contents: {
                chats: chats.items,
                chatTotal: chats.total,
                artifacts: artifacts.items,
                artifactTotal: artifacts.total,
              },
              error: null,
            })),
            catchError((error: unknown) =>
              of<LoadResult>({ project: null, contents: null, error: toApiError(error) }),
            ),
          ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe(({ project, contents, error }) => {
        this.project.set(project);
        this.contents.set(contents);
        this.error.set(error);
        this.loading.set(false);
      });

    effect(() => this.load(this.projectId()));
  }

  protected load(projectId: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.loads.next(projectId);
  }

  protected edit(): void {
    const project = this.project();
    if (!project) {
      return;
    }

    const ref = this.dialog.open<ProjectDialog, ProjectDialogData, Project>(ProjectDialog, {
      data: { project },
    });

    ref.afterClosed().subscribe((saved) => {
      if (saved) {
        this.project.set(saved);
      }
    });
  }

  protected async remove(): Promise<void> {
    const project = this.project();
    if (!project) {
      return;
    }

    const confirmed = await confirm(this.dialog, {
      title: 'Delete project?',
      message:
        `“${project.name}” will be deleted. Its conversations and artifacts are kept ` +
        `and become unfiled.`,
      confirmLabel: 'Delete',
    });

    if (!confirmed) {
      return;
    }

    try {
      await firstValueFrom(this.projects.remove(project.id));
      this.notify.success('Project deleted.');
      this.conversations.refresh();
      void this.router.navigate(['/projects']);
    } catch (error) {
      this.notify.error(error, 'Could not delete the project.');
    }
  }

  protected describe(error: ApiError): string {
    return describeApiError(error);
  }

  /** Who a chat is with, in the words the rest of the workspace uses. */
  private ownerLabel(chat: Chat): string | null {
    const owner = ownerOf(chat);
    if (!owner) {
      return null;
    }

    if (owner.kind === 'agent') {
      return this.roster.agents().find((agent) => agent.id === owner.id)?.name ?? 'Agent';
    }

    return this.conversations.teamName(owner.id) ?? 'Team';
  }
}
