import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom, forkJoin } from 'rxjs';

import { toApiError, type ApiError } from '../../../core/api/api-error';
import {
  MAX_MEMBER_ROLE_LENGTH,
  MAX_TEAM_DESCRIPTION_LENGTH,
  MAX_TEAM_NAME_LENGTH,
  type Team,
  type TeamMember,
  type UpdateTeamInput,
} from '../../../core/api/teams.models';
import { TeamsService } from '../../../core/api/teams.service';
import { NotificationService } from '../../../core/notifications/notification.service';
import { AgentRosterService } from '../../../core/workspace/agent-roster.service';
import { confirm } from '../../../shared/confirm-dialog/confirm-dialog';
import { RelativeTimePipe } from '../../../shared/relative-time/relative-time.pipe';
import { Panel } from '../../../shared/ui/panel';
import { Skeleton } from '../../../shared/ui/skeleton';
import { AgentAvatar } from '../../agents/agent-avatar/agent-avatar';

/**
 * One team: what it is for, and who is on it in which order.
 *
 * The roster is the substance of the screen. Order matters — it is the turn
 * order a team chat would run — so the list is explicitly ranked and moved
 * with controls rather than sorted by anything incidental.
 *
 * Agent names come from the roster the shell already holds. The API returns
 * ids only, deliberately: one source for an agent's name means the rail and
 * this page cannot disagree about it.
 */
@Component({
  selector: 'app-team-detail',
  imports: [
    AgentAvatar,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatMenuModule,
    MatSelectModule,
    MatTooltipModule,
    Panel,
    ReactiveFormsModule,
    RelativeTimePipe,
    RouterLink,
    Skeleton,
  ],
  templateUrl: './team-detail.html',
  styleUrl: './team-detail.scss',
})
export class TeamDetail {
  private readonly teams = inject(TeamsService);
  private readonly notify = inject(NotificationService);
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);
  private readonly formBuilder = inject(FormBuilder);

  protected readonly roster = inject(AgentRosterService);

  /** Bound from the route (`withComponentInputBinding`). */
  readonly teamId = input.required<string>();

  protected readonly team = signal<Team | null>(null);
  protected readonly members = signal<readonly TeamMember[]>([]);
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  /** True while a roster write is in flight, so the controls cannot race. */
  protected readonly busy = signal(false);
  protected readonly error = signal<ApiError | null>(null);

  protected readonly maxNameLength = MAX_TEAM_NAME_LENGTH;
  protected readonly maxDescriptionLength = MAX_TEAM_DESCRIPTION_LENGTH;
  protected readonly maxRoleLength = MAX_MEMBER_ROLE_LENGTH;

  protected readonly form = this.formBuilder.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(MAX_TEAM_NAME_LENGTH)]],
    description: ['', [Validators.maxLength(MAX_TEAM_DESCRIPTION_LENGTH)]],
  });

  /**
   * The roster with each agent resolved to its name.
   *
   * An agent the rail has not loaded falls back to its id rather than to a
   * blank row: the membership is real either way, and showing nothing would
   * make it look like the row was broken.
   */
  protected readonly entries = computed(() => {
    const agents = this.roster.agents();

    return this.members().map((member) => ({
      member,
      agent: agents.find((agent) => agent.id === member.agentId) ?? null,
      name: agents.find((agent) => agent.id === member.agentId)?.name ?? member.agentId,
    }));
  });

  /** Agents not yet on this team, which is what the add control offers. */
  protected readonly available = computed(() => {
    const taken = new Set(this.members().map((member) => member.agentId));
    return this.roster.agents().filter((agent) => !taken.has(agent.id));
  });

  constructor() {
    effect(() => this.load(this.teamId()));
  }

  protected load(teamId: string): void {
    this.loading.set(true);
    this.error.set(null);

    forkJoin({
      team: this.teams.get(teamId),
      members: this.teams.members(teamId),
    }).subscribe({
      next: ({ team, members }) => {
        this.team.set(team);
        this.members.set(members.items);
        this.reset();
        this.loading.set(false);
      },
      error: (error: unknown) => {
        this.team.set(null);
        this.error.set(toApiError(error));
        this.loading.set(false);
      },
    });
  }

  /** Refills the settings form from the stored team. */
  protected reset(): void {
    const team = this.team();
    if (!team) {
      return;
    }

    this.form.reset({ name: team.name, description: team.description ?? '' });
  }

  protected save(): void {
    if (this.form.invalid || this.saving()) {
      this.form.markAllAsTouched();
      return;
    }

    const patch = this.buildPatch();

    if (Object.keys(patch).length === 0) {
      this.notify.success('Nothing to save.');
      return;
    }

    this.saving.set(true);

    this.teams.update(this.teamId(), patch).subscribe({
      next: (team) => {
        this.saving.set(false);
        this.team.set(team);
        this.form.markAsPristine();
        this.reset();
        this.notify.success('Team saved.');
      },
      error: (error: unknown) => {
        this.saving.set(false);
        this.notify.error(error, 'Could not save the team.');
      },
    });
  }

  /**
   * Builds the PATCH body.
   *
   * Only what changed, and an emptied description as `null` rather than `''` —
   * the API would store the empty string and report the field as set.
   */
  private buildPatch(): UpdateTeamInput {
    const value = this.form.getRawValue();
    const team = this.team();
    const patch: UpdateTeamInput = {};

    if (!team) {
      return patch;
    }

    const name = value.name.trim();
    if (name !== team.name) {
      patch.name = name;
    }

    const description = value.description.trim() || null;
    if (description !== team.description) {
      patch.description = description;
    }

    return patch;
  }

  protected async addAgent(agentId: string): Promise<void> {
    if (!agentId || this.busy()) {
      return;
    }

    await this.rosterWrite(
      () => firstValueFrom(this.teams.addMember(this.teamId(), { agentId })),
      'Could not add the agent.',
    );
  }

  /**
   * Commits a role as typed.
   *
   * An emptied field clears the label: the API treats whitespace as `null`,
   * and so should the thing that sends it.
   */
  protected async setRole(agentId: string, raw: string): Promise<void> {
    const role = raw.trim() || null;
    const current = this.members().find((member) => member.agentId === agentId);

    if (!current || current.role === role || this.busy()) {
      return;
    }

    await this.rosterWrite(
      () => firstValueFrom(this.teams.updateMember(this.teamId(), agentId, { role })),
      'Could not change the role.',
    );
  }

  /**
   * Moves one agent one place through the order.
   *
   * The whole order is sent, which is what the endpoint takes: a move
   * renumbers several rows, and sending the end state makes it one atomic
   * write instead of a sequence that could half-apply.
   */
  protected async move(index: number, by: -1 | 1): Promise<void> {
    const order = this.members().map((member) => member.agentId);
    const target = index + by;

    if (target < 0 || target >= order.length || this.busy()) {
      return;
    }

    [order[index], order[target]] = [order[target]!, order[index]!];

    await this.rosterWrite(
      () => firstValueFrom(this.teams.reorderMembers(this.teamId(), order)),
      'Could not change the order.',
    );
  }

  protected async removeAgent(agentId: string, name: string): Promise<void> {
    const confirmed = await confirm(this.dialog, {
      title: 'Take off the team?',
      message: `“${name}” is removed from this team. The agent itself is not deleted.`,
      confirmLabel: 'Remove',
    });

    if (!confirmed) {
      return;
    }

    await this.rosterWrite(
      () => firstValueFrom(this.teams.removeMember(this.teamId(), agentId)),
      'Could not remove the agent.',
    );
  }

  /**
   * Runs a roster write and re-reads the roster afterwards.
   *
   * Re-read rather than patched in place: positions are renumbered server-side
   * on every add, remove and reorder, so the authoritative order is the one
   * that comes back. Guessing it here would be a second implementation of the
   * same rule.
   */
  private async rosterWrite(write: () => Promise<unknown>, failure: string): Promise<void> {
    this.busy.set(true);

    try {
      await write();
      const [team, members] = await Promise.all([
        firstValueFrom(this.teams.get(this.teamId())),
        firstValueFrom(this.teams.members(this.teamId())),
      ]);
      this.team.set(team);
      this.members.set(members.items);
    } catch (error) {
      this.notify.error(error, failure);
    } finally {
      this.busy.set(false);
    }
  }

  protected async removeTeam(): Promise<void> {
    const team = this.team();
    if (!team) {
      return;
    }

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
      void this.router.navigate(['/teams']);
    } catch (error) {
      this.notify.error(error, 'Could not delete the team.');
    }
  }
}
