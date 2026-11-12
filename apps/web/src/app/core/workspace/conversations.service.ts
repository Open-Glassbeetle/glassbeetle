import { Injectable, computed, inject, signal } from '@angular/core';
import { catchError, forkJoin, map, of } from 'rxjs';

import type { Chat } from '../api/chats.models';
import { ChatsService } from '../api/chats.service';
import type { Project } from '../api/projects.models';
import { ProjectsService } from '../api/projects.service';
import type { Team } from '../api/teams.models';
import { TeamsService } from '../api/teams.service';

/** How many conversations the sidebar holds. The API's ceiling for one page. */
export const SIDEBAR_CHAT_LIMIT = 100;

/**
 * The conversations the sidebar lists, and the names it needs to label them.
 *
 * Held in a root service for the same reason the agent roster is: the list is
 * part of the shell and on screen on every route, so each screen reading it
 * again would make the sidebar flicker and let two views of one chat disagree.
 * A screen that changes a chat hands the result to `upsert` or `drop`, which
 * keeps the sidebar right without another request.
 *
 * Teams and projects ride along because a chat only carries their ids. They
 * are small collections, and one read of each is cheaper than a lookup per
 * row.
 */
@Injectable({ providedIn: 'root' })
export class ConversationsService {
  private readonly chatsApi = inject(ChatsService);
  private readonly teamsApi = inject(TeamsService);
  private readonly projectsApi = inject(ProjectsService);

  private readonly _chats = signal<readonly Chat[]>([]);
  private readonly _total = signal(0);
  private readonly _teams = signal<readonly Team[]>([]);
  private readonly _projects = signal<readonly Project[]>([]);
  private readonly _loaded = signal(false);
  private readonly _failed = signal(false);

  /** The most recently active conversations, newest first. */
  readonly chats = this._chats.asReadonly();
  /** How many conversations exist, which can be more than are held here. */
  readonly total = this._total.asReadonly();
  readonly teams = this._teams.asReadonly();
  readonly projects = this._projects.asReadonly();
  readonly loaded = this._loaded.asReadonly();
  /** True when the last read of the conversations failed. */
  readonly failed = this._failed.asReadonly();

  /** True when there are more conversations than the sidebar holds. */
  readonly truncated = computed(() => this._total() > this._chats().length);

  private readonly teamNames = computed(
    () => new Map(this._teams().map((team) => [team.id, team.name])),
  );
  private readonly projectNames = computed(
    () => new Map(this._projects().map((project) => [project.id, project.name])),
  );

  /** Reads the conversations and the names that label them. */
  refresh(): void {
    forkJoin({
      chats: this.chatsApi
        .list({ limit: SIDEBAR_CHAT_LIMIT, sort: 'updatedAt', order: 'desc' })
        .pipe(
          map((page) => ({ page, failed: false })),
          catchError(() => of({ page: null, failed: true })),
        ),
      // A failed name lookup costs the sidebar a label, not its conversations.
      teams: this.teamsApi.list({ limit: 100, sort: 'name', order: 'asc' }).pipe(
        map((page) => page.items),
        catchError(() => of(this._teams())),
      ),
      projects: this.projectsApi.list({ limit: 100, sort: 'name', order: 'asc' }).pipe(
        map((page) => page.items),
        catchError(() => of(this._projects())),
      ),
    }).subscribe(({ chats, teams, projects }) => {
      if (chats.page) {
        this._chats.set(chats.page.items);
        this._total.set(chats.page.total);
      }

      this._failed.set(chats.failed);
      this._teams.set(teams);
      this._projects.set(projects);
      this._loaded.set(true);
    });
  }

  /** Re-reads only the projects, after one was created, renamed or deleted. */
  refreshProjects(): void {
    this.projectsApi.list({ limit: 100, sort: 'name', order: 'asc' }).subscribe({
      next: (page) => this._projects.set(page.items),
      error: () => undefined,
    });
  }

  /**
   * Puts a chat the caller just created or changed where it now belongs.
   *
   * `touched` moves it to the top, which is where a conversation that was just
   * spoken in sorts; a rename leaves the order alone.
   */
  upsert(chat: Chat, touched = false): void {
    const known = this._chats().some((entry) => entry.id === chat.id);

    if (!known) {
      this._total.update((total) => total + 1);
    }

    this._chats.update((chats) => {
      if (!known || touched) {
        return [chat, ...chats.filter((entry) => entry.id !== chat.id)];
      }

      return chats.map((entry) => (entry.id === chat.id ? chat : entry));
    });
  }

  /** Moves a chat to the top, as the API does when a turn is added to it. */
  touch(chatId: string): void {
    const chat = this._chats().find((entry) => entry.id === chatId);

    if (chat) {
      this.upsert({ ...chat, updatedAt: new Date().toISOString() }, true);
    }
  }

  /** Removes a deleted chat. */
  drop(chatId: string): void {
    if (this._chats().some((entry) => entry.id === chatId)) {
      this._chats.update((chats) => chats.filter((entry) => entry.id !== chatId));
      this._total.update((total) => Math.max(0, total - 1));
    }
  }

  teamName(teamId: string): string | null {
    return this.teamNames().get(teamId) ?? null;
  }

  projectName(projectId: string): string | null {
    return this.projectNames().get(projectId) ?? null;
  }
}
