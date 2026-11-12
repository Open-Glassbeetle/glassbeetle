import {
  afterRenderEffect,
  Component,
  computed,
  ElementRef,
  inject,
  signal,
  viewChildren,
} from '@angular/core';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { Router } from '@angular/router';
import { Subject, debounceTime, distinctUntilChanged, switchMap } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { combineLatest, catchError, map, of } from 'rxjs';

import { AgentsService } from '../../core/api/agents.service';
import { titleOf } from '../../core/api/chats.models';
import { ChatsService } from '../../core/api/chats.service';
import { SharedMemoriesService } from '../../core/api/memories.service';
import { SystemPromptsService } from '../../core/api/system-prompts.service';
import { Skeleton } from '../../shared/ui/skeleton';

interface PaletteItem {
  readonly id: string;
  readonly icon: string;
  readonly label: string;
  readonly hint: string | null;
  readonly group: string;
  readonly link: readonly string[];
}

/** Destinations that are always offered, before anything is typed. */
const NAVIGATION: readonly PaletteItem[] = [
  {
    id: 'nav:new-chat',
    icon: 'edit_square',
    label: 'New chat',
    hint: 'Start a conversation with an agent or a team',
    group: 'Go to',
    link: ['/chats/new'],
  },
  {
    id: 'nav:chats',
    icon: 'forum',
    label: 'Chats',
    hint: 'Every conversation',
    group: 'Go to',
    link: ['/chats'],
  },
  {
    id: 'nav:projects',
    icon: 'folder',
    label: 'Projects',
    hint: 'Conversations and artifacts, by piece of work',
    group: 'Go to',
    link: ['/projects'],
  },
  {
    id: 'nav:agents',
    icon: 'graph_3',
    label: 'Agents',
    hint: 'The roster',
    group: 'Go to',
    link: ['/agents'],
  },
  {
    id: 'nav:artifacts',
    icon: 'inventory_2',
    label: 'Artifacts',
    hint: 'What agents produced',
    group: 'Go to',
    link: ['/artifacts'],
  },
  {
    id: 'nav:teams',
    icon: 'groups',
    label: 'Teams',
    hint: 'Agents that take turns in one chat',
    group: 'Go to',
    link: ['/teams'],
  },
  {
    id: 'nav:memory',
    icon: 'database',
    label: 'Shared memory',
    hint: 'Context every agent draws on',
    group: 'Go to',
    link: ['/memory'],
  },
  {
    id: 'nav:prompts',
    icon: 'article',
    label: 'System prompts',
    hint: 'Reusable instruction templates',
    group: 'Go to',
    link: ['/prompts'],
  },
  {
    id: 'nav:overview',
    icon: 'space_dashboard',
    label: 'Overview',
    hint: 'Workspace status and recent changes',
    group: 'Go to',
    link: ['/overview'],
  },
];

/**
 * Keyboard-first search across everything the API can search.
 *
 * Each collection is queried with its own `search` filter rather than by
 * fetching everything and matching locally: the API already does
 * case-insensitive substring matching, and a workspace's memory can be far
 * larger than a page.
 */
@Component({
  selector: 'app-command-palette',
  imports: [MatDialogModule, MatIconModule, Skeleton],
  templateUrl: './command-palette.html',
  styleUrl: './command-palette.scss',
})
export class CommandPalette {
  private readonly agents = inject(AgentsService);
  private readonly chats = inject(ChatsService);
  private readonly memories = inject(SharedMemoriesService);
  private readonly prompts = inject(SystemPromptsService);
  private readonly router = inject(Router);
  private readonly dialogRef = inject<MatDialogRef<CommandPalette, void>>(MatDialogRef);

  private readonly queries = new Subject<string>();
  private readonly options = viewChildren<ElementRef<HTMLElement>>('option');

  protected readonly closed = signal(false);
  protected readonly term = signal('');
  protected readonly searching = signal(false);
  protected readonly results = signal<readonly PaletteItem[]>([]);
  protected readonly activeIndex = signal(0);

  /** Navigation entries matching the term, plus whatever the API found. */
  protected readonly items = computed(() => {
    const term = this.term().trim().toLowerCase();
    const navigation = term
      ? NAVIGATION.filter((item) => item.label.toLowerCase().includes(term))
      : NAVIGATION;

    return [...navigation, ...this.results()];
  });

  /** Only refer to an option while the template actually renders it. */
  protected readonly activeId = computed(() => {
    if (this.closed() || (this.searching() && !this.results().length)) {
      return null;
    }

    const item = this.items()[this.activeIndex()];
    return item ? this.optionId(item) : null;
  });

  protected readonly groups = computed(() => {
    const groups = new Map<string, PaletteItem[]>();

    for (const item of this.items()) {
      const bucket = groups.get(item.group);
      if (bucket) {
        bucket.push(item);
      } else {
        groups.set(item.group, [item]);
      }
    }

    return [...groups].map(([name, items]) => ({ name, items }));
  });

  constructor() {
    this.dialogRef
      .beforeClosed()
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.closed.set(true));

    afterRenderEffect(() => {
      const id = this.activeId();
      if (id) {
        this.options()
          .find((option) => option.nativeElement.id === id)
          ?.nativeElement.scrollIntoView({ block: 'nearest' });
      }
    });

    this.queries
      .pipe(
        map((term) => term.trim()),
        debounceTime(180),
        distinctUntilChanged(),
        switchMap((term) => {
          if (!term) {
            this.searching.set(false);
            return of([] as PaletteItem[]);
          }

          this.searching.set(true);
          return this.search(term);
        }),
        takeUntilDestroyed(),
      )
      .subscribe((results) => {
        this.searching.set(false);
        this.results.set(results);
        this.activeIndex.set(0);
      });
  }

  protected onInput(value: string): void {
    this.term.set(value);
    this.activeIndex.set(0);
    this.queries.next(value);
  }

  protected onKeydown(event: KeyboardEvent): void {
    const items = this.items();

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.activeIndex.update((index) => (index + 1) % Math.max(items.length, 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.activeIndex.update((index) => (index - 1 + items.length) % Math.max(items.length, 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const item = items[this.activeIndex()];
      if (item) {
        this.run(item);
      }
    }
  }

  protected run(item: PaletteItem): void {
    this.dialogRef.close();
    void this.router.navigate([...item.link]);
  }

  /** The flat index of an item, so the template can mark the active row. */
  protected indexOf(item: PaletteItem): number {
    return this.items().indexOf(item);
  }

  /** Item ids already include their collection (nav, chat, agent, prompt or memory). */
  protected optionId(item: PaletteItem): string {
    return `palette-option-${item.id}`;
  }

  private search(term: string) {
    const page = { limit: 5, search: term };

    return combineLatest([
      // Conversations first: they are what is most often being looked for.
      this.chats.list({ ...page, sort: 'updatedAt', order: 'desc' }).pipe(
        map((result) =>
          result.items.map((chat): PaletteItem => ({
            id: `chat:${chat.id}`,
            icon: 'chat_bubble',
            label: titleOf(chat),
            hint: null,
            group: 'Chats',
            link: ['/chats', chat.id],
          })),
        ),
        catchError(() => of([] as PaletteItem[])),
      ),
      this.agents.list({ ...page, sort: 'name', order: 'asc' }).pipe(
        map((result) =>
          result.items.map((agent): PaletteItem => ({
            id: `agent:${agent.id}`,
            icon: 'graph_3',
            label: agent.name,
            hint: agent.personality,
            group: 'Agents',
            link: ['/agents', agent.id],
          })),
        ),
        catchError(() => of([] as PaletteItem[])),
      ),
      this.prompts.list({ ...page, sort: 'name', order: 'asc' }).pipe(
        map((result) =>
          result.items.map((prompt): PaletteItem => ({
            id: `prompt:${prompt.id}`,
            icon: 'article',
            label: prompt.name,
            hint: prompt.content,
            group: 'System prompts',
            link: ['/prompts'],
          })),
        ),
        catchError(() => of([] as PaletteItem[])),
      ),
      this.memories.list(page).pipe(
        map((result) =>
          result.items.map((memory): PaletteItem => ({
            id: `memory:${memory.id}`,
            icon: 'database',
            label: memory.content,
            hint: memory.tags.join(' · ') || null,
            group: 'Shared memory',
            link: ['/memory'],
          })),
        ),
        catchError(() => of([] as PaletteItem[])),
      ),
    ]).pipe(map((groups) => groups.flat()));
  }
}
