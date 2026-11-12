import { Component, effect, inject, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatPaginatorModule } from '@angular/material/paginator';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { PAGE_SIZE_OPTIONS } from '../../../core/api/pagination';
import type { Project } from '../../../core/api/projects.models';
import { ProjectsService } from '../../../core/api/projects.service';
import { NotificationService } from '../../../core/notifications/notification.service';
import { ConversationsService } from '../../../core/workspace/conversations.service';
import { confirm } from '../../../shared/confirm-dialog/confirm-dialog';
import { ListState } from '../../../shared/list-state/list-state';
import { RelativeTimePipe } from '../../../shared/relative-time/relative-time.pipe';
import { Panel } from '../../../shared/ui/panel';
import { Skeleton } from '../../../shared/ui/skeleton';
import { ProjectDialog, type ProjectDialogData } from '../project-dialog/project-dialog';

/**
 * `/projects` — the folders conversations and their artifacts are filed under.
 */
@Component({
  selector: 'app-project-list',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatPaginatorModule,
    Panel,
    RelativeTimePipe,
    RouterLink,
    Skeleton,
  ],
  templateUrl: './project-list.html',
  styleUrl: './project-list.scss',
})
export class ProjectList {
  private readonly projects = inject(ProjectsService);
  private readonly conversations = inject(ConversationsService);
  private readonly dialog = inject(MatDialog);
  private readonly notify = inject(NotificationService);
  private readonly router = inject(Router);

  /** Bound from `?new=1`, the same way the other create flows are reached. */
  readonly new = input<string>();

  protected readonly pageSizeOptions = PAGE_SIZE_OPTIONS;

  protected readonly list = new ListState<Project>({
    load: (query) => this.projects.list(query),
    initialSort: 'name',
    initialOrder: 'asc',
  });

  constructor() {
    effect(() => {
      if (this.new()) {
        void this.router.navigate([], {
          queryParams: { new: null },
          queryParamsHandling: 'merge',
          replaceUrl: true,
        });
        this.create();
      }
    });
  }

  /** Creates a project and opens it: an empty project is somewhere to start. */
  protected create(): void {
    const ref = this.dialog.open<ProjectDialog, ProjectDialogData, Project>(ProjectDialog);

    ref.afterClosed().subscribe((project) => {
      if (project) {
        void this.router.navigate(['/projects', project.id]);
      }
    });
  }

  protected edit(project: Project): void {
    const ref = this.dialog.open<ProjectDialog, ProjectDialogData, Project>(ProjectDialog, {
      data: { project },
    });

    ref.afterClosed().subscribe((saved) => {
      if (saved) {
        this.list.reload();
      }
    });
  }

  protected async remove(project: Project): Promise<void> {
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
      this.list.reloadAfterRemoval();
      // The sidebar groups by project, and its chats just became unfiled.
      this.conversations.refresh();
    } catch (error) {
      this.notify.error(error, 'Could not delete the project.');
    }
  }
}
