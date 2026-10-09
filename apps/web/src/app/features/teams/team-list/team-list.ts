import { Component, effect, inject, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatPaginatorModule } from '@angular/material/paginator';
import { RouterLink } from '@angular/router';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { PAGE_SIZE_OPTIONS } from '../../../core/api/pagination';
import type { Team } from '../../../core/api/teams.models';
import { TeamsService } from '../../../core/api/teams.service';
import { NotificationService } from '../../../core/notifications/notification.service';
import { confirm } from '../../../shared/confirm-dialog/confirm-dialog';
import { ListState } from '../../../shared/list-state/list-state';
import { RelativeTimePipe } from '../../../shared/relative-time/relative-time.pipe';
import { Panel } from '../../../shared/ui/panel';
import { Skeleton } from '../../../shared/ui/skeleton';
import { TeamCreateDialog } from '../team-create/team-create-dialog';

/**
 * `/teams` — the rosters agents can be grouped into.
 */
@Component({
  selector: 'app-team-list',
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
  templateUrl: './team-list.html',
  styleUrl: './team-list.scss',
})
export class TeamList {
  private readonly teams = inject(TeamsService);
  private readonly dialog = inject(MatDialog);
  private readonly notify = inject(NotificationService);
  private readonly router = inject(Router);

  /** Bound from `?new=1`, the same way the other create flows are reached. */
  readonly new = input<string>();

  protected readonly pageSizeOptions = PAGE_SIZE_OPTIONS;

  protected readonly list = new ListState<Team>({
    load: (query) => this.teams.list(query),
    initialSort: 'name',
    initialOrder: 'asc',
  });

  constructor() {
    effect(() => {
      if (this.new()) {
        this.clearNewFlag();
        this.create();
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

  /**
   * Opens the create dialog and goes straight to the new team.
   *
   * The roster is the point of a team and it is empty at this moment, so
   * landing on the list would mean a row the user has to find and click.
   */
  protected create(): void {
    const ref = this.dialog.open<TeamCreateDialog, undefined, Team>(TeamCreateDialog);

    ref.afterClosed().subscribe((team) => {
      if (team) {
        void this.router.navigate(['/teams', team.id]);
      }
    });
  }

  protected async remove(team: Team): Promise<void> {
    const confirmed = await confirm(this.dialog, {
      title: 'Delete team?',
      message:
        `“${team.name}” will be deleted, along with its roster. ` +
        `The ${team.memberCount === 1 ? 'agent' : 'agents'} on it are not affected.`,
      confirmLabel: 'Delete',
    });

    if (!confirmed) {
      return;
    }

    try {
      await firstValueFrom(this.teams.remove(team.id));
      this.notify.success('Team deleted.');
      this.list.reloadAfterRemoval();
    } catch (error) {
      this.notify.error(error, 'Could not delete the team.');
    }
  }
}
