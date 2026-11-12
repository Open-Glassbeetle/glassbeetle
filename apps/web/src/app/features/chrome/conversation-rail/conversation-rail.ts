import { Component, computed, inject, input, output, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { filter, map } from 'rxjs';

import { ownerOf, titleOf, type Chat } from '../../../core/api/chats.models';
import { AgentRosterService } from '../../../core/workspace/agent-roster.service';
import { ChatRunsService } from '../../../core/workspace/chat-runs.service';
import { ConversationsService } from '../../../core/workspace/conversations.service';
import { RelativeTimePipe } from '../../../shared/relative-time/relative-time.pipe';
import { Skeleton } from '../../../shared/ui/skeleton';

/** A destination in the rail, with the digit it answers to. */
export interface RailLink {
  readonly path: string;
  readonly label: string;
  readonly icon: string;
  readonly shortcut?: string;
  /** Matches only the path itself, for a link whose children are their own places. */
  readonly exact?: boolean;
}

/** What a conversation is doing, when it is doing anything worth a mark. */
type ChatState = 'running' | 'failed' | 'unseen' | null;

interface RailChat {
  readonly chat: Chat;
  readonly title: string;
  readonly untitled: boolean;
  /** Who the conversation is with, or `null` once that agent or team is gone. */
  readonly owner: string | null;
  readonly team: boolean;
  readonly state: ChatState;
}

interface RailSection {
  readonly key: string;
  readonly label: string;
  /** Set for a project, whose heading leads to the project itself. */
  readonly projectId: string | null;
  readonly chats: readonly RailChat[];
}

const DAY = 24 * 60 * 60 * 1000;

/** Where the rail keeps which sections the user folded away. */
const COLLAPSED_KEY = 'glassbeetle.rail.collapsed';
const WORKSPACE_KEY = 'glassbeetle.rail.workspace';

/** The places chats are worked in, which get the rail's first rows. */
export const PRIMARY_LINKS: readonly RailLink[] = [
  { path: '/chats', label: 'Chats', icon: 'forum', shortcut: '1', exact: true },
  { path: '/projects', label: 'Projects', icon: 'folder', shortcut: '2' },
  { path: '/agents', label: 'Agents', icon: 'graph_3', shortcut: '3' },
  { path: '/artifacts', label: 'Artifacts', icon: 'inventory_2', shortcut: '4' },
];

/**
 * What agents are configured from, and how the workspace is doing. Needed,
 * but not where the work happens — so they sit folded at the foot of the rail
 * instead of sharing its first rows with the conversations.
 */
export const WORKSPACE_LINKS: readonly RailLink[] = [
  { path: '/teams', label: 'Teams', icon: 'groups', shortcut: '5' },
  { path: '/memory', label: 'Shared memory', icon: 'database', shortcut: '6' },
  { path: '/prompts', label: 'System prompts', icon: 'article', shortcut: '7' },
  { path: '/overview', label: 'Overview', icon: 'space_dashboard', shortcut: '8' },
  { path: '/budget', label: 'Spending', icon: 'payments' },
];

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    // Storage can be unavailable in a locked-down webview; the rail then
    // simply forgets its folds between launches.
    return null;
  }
}

function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // See `readStored`.
  }
}

/**
 * The rail: starting a conversation, the four places work happens, and the
 * conversations themselves.
 *
 * The conversations take the room the rail has. They are what the workspace
 * is for, and the fastest way between two of them is to see both — so they
 * are listed here on every screen, grouped by project and then by when they
 * were last active, each marked while its agent is working.
 */
@Component({
  selector: 'app-conversation-rail',
  imports: [
    MatIconModule,
    MatTooltipModule,
    RelativeTimePipe,
    RouterLink,
    RouterLinkActive,
    Skeleton,
  ],
  templateUrl: './conversation-rail.html',
  styleUrl: './conversation-rail.scss',
})
export class ConversationRail {
  private readonly router = inject(Router);
  private readonly roster = inject(AgentRosterService);
  private readonly runs = inject(ChatRunsService);
  protected readonly conversations = inject(ConversationsService);

  /** The platform's command key, as the shell renders it. */
  readonly commandKey = input('');

  /** Emitted when a link is followed, so a rail lying over the content closes. */
  readonly navigated = output<void>();

  protected readonly primaryLinks = PRIMARY_LINKS;
  protected readonly workspaceLinks = WORKSPACE_LINKS;

  protected readonly filter = signal('');

  private readonly collapsed = signal<ReadonlySet<string>>(
    new Set((readStored(COLLAPSED_KEY) ?? '').split(',').filter(Boolean)),
  );

  private readonly workspaceUnfolded = signal(readStored(WORKSPACE_KEY) === 'open');

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );

  /**
   * Open when the user unfolded it, and always while the current screen is one
   * of its own — a rail that hides where you are is worse than a long one.
   */
  protected readonly workspaceOpen = computed(() => {
    const path = this.url().split('?')[0] ?? '';

    return (
      this.workspaceUnfolded() ||
      WORKSPACE_LINKS.some((link) => path === link.path || path.startsWith(`${link.path}/`))
    );
  });

  protected readonly filtering = computed(() => this.filter().trim() !== '');

  private readonly entries = computed<readonly RailChat[]>(() => {
    const agents = this.roster.agents();
    const runs = this.runs.runs();
    const unseen = this.runs.unseen();

    return this.conversations.chats().map((chat) => {
      const owner = ownerOf(chat);
      const run = runs.get(chat.id);

      return {
        chat,
        title: titleOf(chat),
        untitled: !chat.title,
        owner: !owner
          ? null
          : owner.kind === 'agent'
            ? (agents.find((agent) => agent.id === owner.id)?.name ?? 'Agent')
            : (this.conversations.teamName(owner.id) ?? 'Team'),
        team: owner?.kind === 'team',
        state: run ? run.status : unseen.has(chat.id) ? 'unseen' : null,
      };
    });
  });

  /**
   * The conversations in the order they are read: projects first, each with
   * its chats, then everything unfiled by when it was last active.
   *
   * A filter flattens that into matches, because someone typing a title is
   * looking for a chat, not for where it is filed.
   */
  protected readonly sections = computed<readonly RailSection[]>(() => {
    const term = this.filter().trim().toLowerCase();
    const entries = this.entries();

    if (term) {
      const matches = entries.filter(
        (entry) =>
          entry.title.toLowerCase().includes(term) ||
          (entry.owner?.toLowerCase().includes(term) ?? false),
      );

      return matches.length
        ? [{ key: 'matches', label: 'Matches', projectId: null, chats: matches }]
        : [];
    }

    const projects = new Map<string, RailChat[]>();
    const buckets: { key: string; label: string; chats: RailChat[] }[] = [
      { key: 'today', label: 'Today', chats: [] },
      { key: 'yesterday', label: 'Yesterday', chats: [] },
      { key: 'week', label: 'Previous 7 days', chats: [] },
      { key: 'older', label: 'Older', chats: [] },
    ];

    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    const today = midnight.getTime();

    for (const entry of entries) {
      const projectId = entry.chat.projectId;

      if (projectId) {
        const bucket = projects.get(projectId);
        if (bucket) {
          bucket.push(entry);
        } else {
          projects.set(projectId, [entry]);
        }
        continue;
      }

      const updated = Date.parse(entry.chat.updatedAt);
      const index =
        updated >= today ? 0 : updated >= today - DAY ? 1 : updated >= today - 7 * DAY ? 2 : 3;
      buckets[index]!.chats.push(entry);
    }

    return [
      ...[...projects].map(([projectId, chats]) => ({
        key: `project:${projectId}`,
        label: this.conversations.projectName(projectId) ?? 'Project',
        projectId,
        chats,
      })),
      ...buckets
        .filter((bucket) => bucket.chats.length)
        .map((bucket) => ({ ...bucket, projectId: null })),
    ];
  });

  protected isCollapsed(key: string): boolean {
    return !this.filtering() && this.collapsed().has(key);
  }

  protected toggleSection(key: string): void {
    this.collapsed.update((collapsed) => {
      const next = new Set(collapsed);

      if (!next.delete(key)) {
        next.add(key);
      }

      writeStored(COLLAPSED_KEY, [...next].join(','));
      return next;
    });
  }

  protected toggleWorkspace(): void {
    this.workspaceUnfolded.update((open) => {
      writeStored(WORKSPACE_KEY, open ? 'closed' : 'open');
      return !open;
    });
  }

  protected stateLabel(state: ChatState): string | null {
    switch (state) {
      case 'running':
        return 'Working';
      case 'failed':
        return 'Run failed';
      case 'unseen':
        return 'Finished, not yet read';
      default:
        return null;
    }
  }
}
