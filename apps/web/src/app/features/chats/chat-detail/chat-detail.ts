import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router, RouterLink } from '@angular/router';
import { Subject, catchError, firstValueFrom, map, of, switchMap } from 'rxjs';

import { describeApiError, toApiError, type ApiError } from '../../../core/api/api-error';
import { MAX_CHAT_TITLE_LENGTH, ownerOf, titleOf, type Chat } from '../../../core/api/chats.models';
import { ChatsService } from '../../../core/api/chats.service';
import {
  MESSAGE_PAGE_SIZE,
  type Message,
  type MessageRole,
  type MessageStatus,
} from '../../../core/api/messages.models';
import { MessagesService } from '../../../core/api/messages.service';
import type { PaginatedResponse } from '../../../core/api/pagination';
import { TeamsService } from '../../../core/api/teams.service';
import { NotificationService } from '../../../core/notifications/notification.service';
import { AgentRosterService } from '../../../core/workspace/agent-roster.service';
import { UserProfileService } from '../../../core/workspace/user-profile.service';
import { AgentAvatar } from '../../agents/agent-avatar/agent-avatar';
import { Avatar } from '../../../shared/ui/avatar';
import { confirm } from '../../../shared/confirm-dialog/confirm-dialog';
import { RelativeTimePipe } from '../../../shared/relative-time/relative-time.pipe';
import { Panel } from '../../../shared/ui/panel';
import { Skeleton } from '../../../shared/ui/skeleton';

interface LoadResult {
  readonly chat: Chat | null;
  readonly error: ApiError | null;
}

interface TranscriptResult {
  readonly page: PaginatedResponse<Message> | null;
  readonly error: ApiError | null;
}

/**
 * One conversation: what was said, by whom, and what the chat itself is.
 *
 * The transcript is read from `GET /chats/:chatId/messages` backwards from the
 * end — `order: 'desc'` for the newest page, then the `before` cursor for the
 * ones above it. Cursors rather than offsets because a conversation grows at
 * the end: an offset window shifts under the reader the moment a message is
 * appended, while a sequence cursor addresses the same turns either way.
 *
 * There is still no composer. `POST /messages` exists and would store what was
 * typed, but the completion endpoints do not, so nothing would ever answer it;
 * an input that produces a monologue is the kind of half-truth this codebase
 * avoids. The bar below the transcript says that in as many words.
 */
@Component({
  selector: 'app-chat-detail',
  imports: [
    AgentAvatar,
    Avatar,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatMenuModule,
    MatTooltipModule,
    Panel,
    ReactiveFormsModule,
    RelativeTimePipe,
    RouterLink,
    Skeleton,
  ],
  templateUrl: './chat-detail.html',
  styleUrl: './chat-detail.scss',
})
export class ChatDetail {
  private readonly chats = inject(ChatsService);
  private readonly messagesApi = inject(MessagesService);
  private readonly teams = inject(TeamsService);
  private readonly injector = inject(Injector);
  private readonly dialog = inject(MatDialog);
  private readonly notify = inject(NotificationService);
  private readonly router = inject(Router);
  private readonly formBuilder = inject(FormBuilder);
  private readonly roster = inject(AgentRosterService);
  protected readonly user = inject(UserProfileService);

  /** Bound from the route (`withComponentInputBinding`). */
  readonly chatId = input.required<string>();

  private readonly loads = new Subject<string>();
  private readonly ownerLookups = new Subject<string | null>();
  private readonly transcriptLoads = new Subject<string>();

  /** The scrolling element of the transcript, so it can be kept at the end. */
  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');

  protected readonly chat = signal<Chat | null>(null);
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly error = signal<ApiError | null>(null);

  /** The loaded tail of the conversation, oldest first. */
  protected readonly messages = signal<readonly Message[]>([]);
  /** How many messages the chat has in total, which the envelope reports. */
  protected readonly messageTotal = signal(0);
  protected readonly messagesLoading = signal(true);
  protected readonly messagesError = signal<ApiError | null>(null);
  protected readonly loadingOlder = signal(false);

  /** True while part of the conversation is still above what was read. */
  protected readonly hasOlder = computed(() => this.messages().length < this.messageTotal());

  /** The owning team's name, once it has been read. */
  private readonly teamName = signal<string | null>(null);

  protected readonly maxTitleLength = MAX_CHAT_TITLE_LENGTH;

  protected readonly form = this.formBuilder.nonNullable.group({
    title: ['', [Validators.maxLength(MAX_CHAT_TITLE_LENGTH)]],
  });

  protected readonly owner = computed(() => {
    const chat = this.chat();
    return chat ? ownerOf(chat) : null;
  });

  /**
   * The owner's name and where to find it.
   *
   * An agent's name comes from the roster the shell already holds — the same
   * source the rail uses, so the two cannot disagree. A team is read on its
   * own because the shell does not hold teams, and until that lands the id
   * stands in for the name.
   */
  protected readonly ownerName = computed(() => {
    const owner = this.owner();
    if (!owner) {
      return null;
    }

    if (owner.kind === 'agent') {
      return this.roster.agents().find((agent) => agent.id === owner.id)?.name ?? owner.id;
    }

    return this.teamName() ?? owner.id;
  });

  protected readonly ownerLink = computed(() => {
    const owner = this.owner();
    return owner ? [owner.kind === 'agent' ? '/agents' : '/teams', owner.id] : null;
  });

  /** The title as stored, for the heading and the delete confirmation. */
  protected readonly heading = computed(() => {
    const chat = this.chat();
    return chat ? titleOf(chat) : '';
  });

  protected readonly untitled = computed(() => !this.chat()?.title);

  /**
   * What is in the title field, as a signal.
   *
   * The control's value is read through `valueChanges` rather than from the
   * template so that `titleChanged` is a real computed: a plain
   * `form.getRawValue()` call inside one would never recompute as the user
   * types.
   */
  private readonly typedTitle = toSignal(this.form.controls.title.valueChanges, {
    initialValue: '',
  });

  /** True when the field holds something other than what is stored. */
  protected readonly titleChanged = computed(() => {
    const chat = this.chat();
    if (!chat) {
      return false;
    }

    const trimmed = this.typedTitle().trim();
    return (trimmed === '' ? null : trimmed) !== (chat.title ?? null);
  });

  /**
   * The transcript, with every turn resolved to who said it.
   *
   * An assistant turn carries the agent that produced it; in a chat owned by a
   * single agent the column is redundant, so the chat's own owner stands in
   * when it is empty. A turn whose agent has since been deleted keeps its
   * place and is drawn without a name rather than being hidden — it is part of
   * what was said.
   */
  protected readonly turns = computed(() => {
    const agents = this.roster.agents();
    const ownerAgentId = this.chat()?.agentId ?? null;

    return this.messages().map((message) => {
      const agentId = message.agentId ?? (message.role === 'assistant' ? ownerAgentId : null);
      const agent = agentId ? (agents.find((entry) => entry.id === agentId) ?? null) : null;

      return {
        message,
        agent,
        agentId,
        author: this.authorName(message.role, agent?.name ?? null),
        own: message.role === 'user',
        // The two roles a person reads as speech; `system` and `tool` are
        // machinery and are drawn as the quieter lines they are.
        spoken: message.role === 'user' || message.role === 'assistant',
      };
    });
  });

  constructor() {
    // `switchMap` rather than a subscribe per id: navigating from one chat to
    // the next must not leave a slow first response overwriting the second.
    this.loads
      .pipe(
        switchMap((chatId) =>
          this.chats.get(chatId).pipe(
            map((chat): LoadResult => ({ chat, error: null })),
            catchError((error: unknown) =>
              of<LoadResult>({ chat: null, error: toApiError(error) }),
            ),
          ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe(({ chat, error }) => {
        this.chat.set(chat);
        this.error.set(error);
        this.loading.set(false);
        this.reset();
      });

    // Same reasoning, for the owning team's name.
    this.ownerLookups
      .pipe(
        switchMap((teamId) =>
          teamId === null
            ? of<string | null>(null)
            : this.teams.get(teamId).pipe(
                map((team) => team.name),
                // The id is already on screen as the fallback; a failed name
                // lookup is not worth reporting over the chat itself.
                catchError(() => of<string | null>(null)),
              ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((name) => this.teamName.set(name));

    // The transcript is its own request: the chat's metadata and its turns
    // arrive independently, and a slow conversation should not hold back the
    // header that says which conversation it is.
    this.transcriptLoads
      .pipe(
        switchMap((chatId) =>
          this.messagesApi.list(chatId, { limit: MESSAGE_PAGE_SIZE, order: 'desc' }).pipe(
            map((page): TranscriptResult => ({ page, error: null })),
            catchError((error: unknown) =>
              of<TranscriptResult>({ page: null, error: toApiError(error) }),
            ),
          ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe(({ page, error }) => {
        this.messagesLoading.set(false);
        this.messagesError.set(error);
        // Read newest-first so the tail is one request; shown oldest-first,
        // which is the order a conversation is read in.
        this.messages.set(page ? [...page.items].reverse() : []);
        this.messageTotal.set(page?.total ?? 0);

        if (page) {
          this.scrollToLatest();
        }
      });

    effect(() => this.load(this.chatId()));

    effect(() => this.ownerLookups.next(this.chat()?.teamId ?? null));
  }

  protected load(chatId: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.loads.next(chatId);

    this.messagesLoading.set(true);
    this.messagesError.set(null);
    this.messages.set([]);
    this.messageTotal.set(0);
    this.transcriptLoads.next(chatId);
  }

  /**
   * Reads the page of turns above the oldest one on screen.
   *
   * `before` addresses that turn's sequence, so appending a message while this
   * is in flight cannot shift the window — which is exactly what an offset
   * would do.
   */
  protected async loadOlder(): Promise<void> {
    const oldest = this.messages()[0];

    if (!oldest || this.loadingOlder()) {
      return;
    }

    this.loadingOlder.set(true);
    const element = this.scroller()?.nativeElement;
    const heightBefore = element?.scrollHeight ?? 0;

    try {
      const page = await firstValueFrom(
        this.messagesApi.list(this.chatId(), {
          limit: MESSAGE_PAGE_SIZE,
          order: 'desc',
          before: oldest.sequence,
        }),
      );

      this.messages.update((current) => [...[...page.items].reverse(), ...current]);
      this.messageTotal.set(page.total);

      // Prepending moves everything down; without this the reader is thrown
      // back to a part of the conversation they were not looking at.
      if (element) {
        afterNextRender(
          () => {
            element.scrollTop += element.scrollHeight - heightBefore;
          },
          { injector: this.injector },
        );
      }
    } catch (error) {
      this.notify.error(error, 'Could not load earlier messages.');
    } finally {
      this.loadingOlder.set(false);
    }
  }

  /** Puts the newest turn in view, which is where a conversation is read. */
  private scrollToLatest(): void {
    afterNextRender(
      () => {
        const element = this.scroller()?.nativeElement;

        if (element) {
          element.scrollTop = element.scrollHeight;
        }
      },
      { injector: this.injector },
    );
  }

  /** What to call the author of a turn. */
  private authorName(role: MessageRole, agentName: string | null): string {
    switch (role) {
      case 'user':
        return this.user.displayName();
      case 'assistant':
        // A team chat can carry a turn whose agent was never recorded, and an
        // agent can be deleted out from under one. Neither is a nameless
        // message; both are simply the assistant side of the conversation.
        return agentName ?? 'Assistant';
      case 'system':
        return 'System';
      case 'tool':
        return agentName ?? 'Tool';
    }
  }

  /** Puts the form back to what the API last returned. */
  protected reset(): void {
    this.form.reset({ title: this.chat()?.title ?? '' });
  }

  /**
   * Saves the title, or clears it.
   *
   * Only sent when it actually differs: the API treats an unchanged PATCH as a
   * no-op, and a request that changes nothing should not report that it did.
   */
  protected save(): void {
    const chat = this.chat();
    const title = this.nextTitle();

    if (!chat || this.form.invalid || this.saving() || title === undefined) {
      return;
    }

    this.saving.set(true);

    this.chats.update(chat.id, { title }).subscribe({
      next: (updated) => {
        this.saving.set(false);
        this.chat.set(updated);
        this.reset();
        this.notify.success(title ? 'Title saved.' : 'Title cleared.');
      },
      error: (error: unknown) => {
        this.saving.set(false);
        this.notify.error(error, 'Could not save the title.');
      },
    });
  }

  /** Detaches the chat from its project, which `projectId: null` does. */
  protected async detachProject(): Promise<void> {
    const chat = this.chat();
    if (!chat || !chat.projectId || this.saving()) {
      return;
    }

    const confirmed = await confirm(this.dialog, {
      title: 'Remove from project?',
      message:
        'The chat stays, with its history, but no longer belongs to a project. ' +
        'It can be put back once the projects endpoints exist.',
      confirmLabel: 'Remove',
      destructive: false,
    });

    if (!confirmed) {
      return;
    }

    this.saving.set(true);

    try {
      const updated = await firstValueFrom(this.chats.update(chat.id, { projectId: null }));
      this.chat.set(updated);
      this.notify.success('Chat removed from its project.');
    } catch (error) {
      this.notify.error(error, 'Could not remove the chat from its project.');
    } finally {
      this.saving.set(false);
    }
  }

  protected async remove(): Promise<void> {
    const chat = this.chat();
    if (!chat) {
      return;
    }

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
      void this.router.navigate(['/chats']);
    } catch (error) {
      this.notify.error(error, 'Could not delete the chat.');
    }
  }

  protected describe(error: ApiError): string {
    return describeApiError(error);
  }

  /**
   * Which pill a message status is drawn as.
   *
   * Nothing writes anything but `complete` today — these are the states a
   * generation run will move through, and the transcript is ready to show
   * them rather than having to learn to that day.
   */
  protected statusTone(status: MessageStatus): 'warn' | 'error' | 'idle' {
    if (status === 'error') {
      return 'error';
    }

    return status === 'complete' ? 'idle' : 'warn';
  }

  /**
   * The title to send, or `undefined` when there is nothing to send.
   *
   * An emptied field clears the stored title with an explicit `null` rather
   * than storing a blank string, which is the distinction the API makes.
   */
  private nextTitle(): string | null | undefined {
    const chat = this.chat();
    if (!chat) {
      return undefined;
    }

    const trimmed = this.form.getRawValue().title.trim();
    const next = trimmed === '' ? null : trimmed;

    return next === (chat.title ?? null) ? undefined : next;
  }
}
