import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatPaginatorModule } from '@angular/material/paginator';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import {
  ownerOf,
  titleOf,
  type Chat,
  type ChatOwner,
  type ChatOwnerKind,
} from '../../../core/api/chats.models';
import { ChatsService } from '../../../core/api/chats.service';
import { PAGE_SIZE_OPTIONS, type SortOrder } from '../../../core/api/pagination';
import type { Team } from '../../../core/api/teams.models';
import { TeamsService } from '../../../core/api/teams.service';
import { NotificationService } from '../../../core/notifications/notification.service';
import { AgentRosterService } from '../../../core/workspace/agent-roster.service';
import { confirm } from '../../../shared/confirm-dialog/confirm-dialog';
import { ListState } from '../../../shared/list-state/list-state';
import { RelativeTimePipe } from '../../../shared/relative-time/relative-time.pipe';
import { Panel } from '../../../shared/ui/panel';
import { Skeleton } from '../../../shared/ui/skeleton';
import { ChatCreateDialog, type ChatCreateData } from '../chat-create/chat-create-dialog';
import { ChatRenameDialog, type ChatRenameData } from '../chat-rename/chat-rename-dialog';

/** The value the API expects to select rows whose foreign key is NULL. */
const UNASSIGNED = 'null';

/** The owner filter's value when it selects chats whose owner was deleted. */
const ORPHANED = 'orphaned';

interface SortOption {
  readonly key: string;
  readonly label: string;
  readonly sort: string;
  readonly order: SortOrder;
}

const SORT_OPTIONS: readonly SortOption[] = [
  { key: 'recent', label: 'Recently updated', sort: 'updatedAt', order: 'desc' },
  { key: 'created', label: 'Newest first', sort: 'createdAt', order: 'desc' },
  { key: 'title', label: 'Title', sort: 'title', order: 'asc' },
];

/** The owner filters the API's `agentId` / `teamId` parameters can express. */
type OwnerFilter = { readonly agentId?: string; readonly teamId?: string };

/**
 * `/chats` — the conversations agents and teams own.
 *
 * Filtered by title, the same way the other lists are, and by owner. Both go
 * to the API, so a match on a later page is still found.
 *
 * `?agentId=` / `?teamId=` preselect the filter, which is how an agent's or a
 * team's page links to the conversations that belong to it.
 */
@Component({
  selector: 'app-chat-list',
  imports: [
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatMenuModule,
    MatPaginatorModule,
    MatSelectModule,
    MatTooltipModule,
    Panel,
    RelativeTimePipe,
    RouterLink,
    Skeleton,
  ],
  templateUrl: './chat-list.html',
  styleUrl: './chat-list.scss',
})
export class ChatList {
  private readonly chats = inject(ChatsService);
  private readonly teamsApi = inject(TeamsService);
  private readonly dialog = inject(MatDialog);
  private readonly notify = inject(NotificationService);
  private readonly router = inject(Router);
  private readonly roster = inject(AgentRosterService);

  /** Bound from `?new=1`, the same way the other create flows are reached. */
  readonly new = input<string>();
  /** Bound from `?agentId=` / `?teamId=`, set by an owner's own page. */
  readonly agentId = input<string>();
  readonly teamId = input<string>();

  protected readonly pageSizeOptions = PAGE_SIZE_OPTIONS;
  protected readonly sortOptions = SORT_OPTIONS;
  protected readonly orphaned = ORPHANED;

  /**
   * `''` is every chat; otherwise `agent:<id>`, `team:<id>` or `orphaned`.
   *
   * One control rather than two selects: a chat has exactly one owner, so
   * separate agent and team filters would offer combinations that can never
   * match anything.
   */
  protected readonly ownerFilter = signal('');
  protected readonly sortKey = signal(SORT_OPTIONS[0]!.key);

  protected readonly agents = this.roster.agents;
  private readonly teamList = signal<readonly Team[]>([]);
  protected readonly teams = this.teamList.asReadonly();

  protected readonly list = new ListState<Chat, OwnerFilter>({
    load: (query) => this.chats.list(query),
    extraParams: () => this.ownerParams(),
    initialSort: 'updatedAt',
    initialOrder: 'desc',
  });

  private readonly teamNames = computed(() => {
    const names = new Map<string, string>();
    for (const team of this.teamList()) {
      names.set(team.id, team.name);
    }
    return names;
  });

  private readonly agentNames = computed(() => {
    const names = new Map<string, string>();
    for (const agent of this.roster.agents()) {
      names.set(agent.id, agent.name);
    }
    return names;
  });

  /** The rows, with each chat's owner resolved to a name and a link. */
  protected readonly entries = computed(() =>
    this.list.items().map((chat) => {
      const owner = ownerOf(chat);

      return {
        chat,
        title: titleOf(chat),
        untitled: !chat.title,
        owner,
        ownerName: owner ? this.ownerName(owner) : null,
        ownerLink: owner ? [owner.kind === 'agent' ? '/agents' : '/teams', owner.id] : null,
      };
    }),
  );

  /** True while the owner filter is narrowing the list to one owner. */
  protected readonly filtered = computed(() => this.ownerFilter() !== '');

  /** True while a title search is narrowing the list. */
  protected readonly searching = computed(() => this.list.search() !== '');

  /**
   * Whether there is anything a chat could belong to.
   *
   * A workspace with no agents and no teams cannot have a chat at all, so the
   * list says that rather than offering a create button that can only fail.
   */
  protected readonly hasOwners = computed(
    () => this.agents().length > 0 || this.teamList().length > 0,
  );

  constructor() {
    this.teamsApi.list({ limit: 100, sort: 'name', order: 'asc' }).subscribe({
      next: (page) => this.teamList.set(page.items),
      // Costs the filter and the rows their team names; both fall back to the
      // id, and the list itself is unaffected.
      error: () => this.teamList.set([]),
    });

    // An owner's page links here with the filter in the URL, so the filtered
    // list can be bookmarked and reloaded.
    effect(() => {
      const agentId = this.agentId();
      const teamId = this.teamId();

      if (agentId) {
        this.ownerFilter.set(`agent:${agentId}`);
      } else if (teamId) {
        this.ownerFilter.set(`team:${teamId}`);
      }
    });

    effect(() => {
      if (this.new()) {
        this.clearNewFlag();
        this.create();
      }
    });
  }

  protected setOwnerFilter(value: string): void {
    this.ownerFilter.set(value);
    // A filter change invalidates the offset: page 3 of the old result is not
    // page 3 of the new one.
    this.list.resetPage();
  }

  protected setSort(key: string): void {
    const option = SORT_OPTIONS.find((entry) => entry.key === key);
    if (!option) {
      return;
    }

    this.sortKey.set(option.key);
    this.list.sort.set(option.sort);
    this.list.order.set(option.order);
    this.list.resetPage();
  }

  protected clearFilter(): void {
    this.setOwnerFilter('');
    // Keeps the URL and the control in step; the inputs above would otherwise
    // reapply the filter on the next change detection.
    void this.router.navigate([], {
      queryParams: { agentId: null, teamId: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  /** Clears the title search and the owner filter together. */
  protected clearFilters(): void {
    this.list.clearSearch();
    this.clearFilter();
  }

  /** Opens the create dialog, pre-pointed at whoever the list is filtered to. */
  protected create(): void {
    const ref = this.dialog.open<ChatCreateDialog, ChatCreateData, Chat>(ChatCreateDialog, {
      data: { defaultOwner: this.selectedOwner() },
    });

    ref.afterClosed().subscribe((chat) => {
      if (chat) {
        // Straight to the chat: it is empty at this moment, and the list would
        // mean finding the row that was just created.
        void this.router.navigate(['/chats', chat.id]);
      }
    });
  }

  protected rename(chat: Chat): void {
    const ref = this.dialog.open<ChatRenameDialog, ChatRenameData, Chat>(ChatRenameDialog, {
      data: { chat },
    });

    ref.afterClosed().subscribe((updated) => {
      if (updated) {
        this.list.reload();
      }
    });
  }

  protected async remove(chat: Chat): Promise<void> {
    const confirmed = await confirm(this.dialog, {
      title: 'Delete chat?',
      message:
        `“${titleOf(chat)}” and its message history will be deleted. ` +
        `Artifacts produced in it are kept, without their link to the chat. ` +
        `This cannot be undone.`,
      confirmLabel: 'Delete',
    });

    if (!confirmed) {
      return;
    }

    try {
      await firstValueFrom(this.chats.remove(chat.id));
      this.notify.success('Chat deleted.');
      this.list.reloadAfterRemoval();
    } catch (error) {
      this.notify.error(error, 'Could not delete the chat.');
    }
  }

  /** An owner's name, falling back to its id when it is not in hand. */
  protected ownerName(owner: ChatOwner): string {
    const names = owner.kind === 'agent' ? this.agentNames() : this.teamNames();
    return names.get(owner.id) ?? owner.id;
  }

  /** How a kind of owner is named at the start of a line. */
  protected ownerLabel(kind: ChatOwnerKind): string {
    return kind === 'agent' ? 'Agent' : 'Team';
  }

  /** The same word mid-sentence, as in "Open agent". */
  protected ownerNoun(kind: ChatOwnerKind): string {
    return kind === 'agent' ? 'agent' : 'team';
  }

  /** The owner the filter names, or `null` for "every chat" and "orphaned". */
  private selectedOwner(): ChatOwner | null {
    const value = this.ownerFilter();
    const separator = value.indexOf(':');

    if (separator < 0) {
      return null;
    }

    const kind = value.slice(0, separator);
    return kind === 'agent' || kind === 'team' ? { kind, id: value.slice(separator + 1) } : null;
  }

  /**
   * The filter as query parameters.
   *
   * "Owner deleted" asks for both columns being NULL, which is the one case
   * where the two parameters are sent together: a chat whose agent or team was
   * removed keeps its history but no longer belongs to anything.
   */
  private ownerParams(): OwnerFilter {
    if (this.ownerFilter() === ORPHANED) {
      return { agentId: UNASSIGNED, teamId: UNASSIGNED };
    }

    const owner = this.selectedOwner();
    if (!owner) {
      return {};
    }

    return owner.kind === 'agent' ? { agentId: owner.id } : { teamId: owner.id };
  }

  /** Drops `?new=1` so a reload does not reopen the dialog. */
  private clearNewFlag(): void {
    void this.router.navigate([], {
      queryParams: { new: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
