import {
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router, RouterLink } from '@angular/router';
import { Subject, catchError, filter, firstValueFrom, interval, map, of, switchMap } from 'rxjs';

import type { Agent } from '../../../core/api/agents.models';
import { describeApiError, toApiError, type ApiError } from '../../../core/api/api-error';
import { ownerOf, titleOf, type Chat } from '../../../core/api/chats.models';
import { ChatsService } from '../../../core/api/chats.service';
import type { ChatContext } from '../../../core/api/completions.models';
import { CompletionsService } from '../../../core/api/completions.service';
import {
  MESSAGE_PAGE_SIZE,
  type Message,
  type MessageRole,
  type MessageStatus,
} from '../../../core/api/messages.models';
import { MessagesService } from '../../../core/api/messages.service';
import type { PaginatedResponse } from '../../../core/api/pagination';
import { NotificationService } from '../../../core/notifications/notification.service';
import { AgentRosterService } from '../../../core/workspace/agent-roster.service';
import { ChatRunsService, type RunDraft } from '../../../core/workspace/chat-runs.service';
import { ConversationsService } from '../../../core/workspace/conversations.service';
import { ModelCatalogService } from '../../../core/workspace/model-catalog.service';
import { UserProfileService } from '../../../core/workspace/user-profile.service';
import { confirm } from '../../../shared/confirm-dialog/confirm-dialog';
import { RelativeTimePipe } from '../../../shared/relative-time/relative-time.pipe';
import { Avatar } from '../../../shared/ui/avatar';
import { Skeleton } from '../../../shared/ui/skeleton';
import { AgentAvatar } from '../../agents/agent-avatar/agent-avatar';
import { ChatInspector } from '../chat-inspector/chat-inspector';
import { ChatRenameDialog, type ChatRenameData } from '../chat-rename/chat-rename-dialog';
import { Composer } from '../composer/composer';
import { MessageBody } from '../message-body/message-body';

interface LoadResult {
  readonly chat: Chat | null;
  readonly error: ApiError | null;
}

interface TranscriptResult {
  readonly page: PaginatedResponse<Message> | null;
  readonly error: ApiError | null;
}

/** Where the choice to keep the details panel open is remembered. */
const INSPECTOR_KEY = 'glassbeetle.chat.inspector';

/** How long the API is given to store a stopped turn before it is read. */
const STOP_SETTLE_MS = 350;

/** How close to the end counts as reading the end, in pixels. */
const PINNED_THRESHOLD = 96;

/** The width from which the details sit beside the conversation, not over it. */
const INSPECTOR_BESIDE = '(min-width: 68rem)';

/**
 * Whether the details start open.
 *
 * Only where they fit beside the conversation: on a narrower window they lie
 * over it, and arriving at a chat half-covered by a panel opened on some
 * earlier, wider day would be the panel taking priority over the conversation.
 */
function readInspectorOpen(): boolean {
  try {
    return (
      localStorage.getItem(INSPECTOR_KEY) === 'open' && window.matchMedia(INSPECTOR_BESIDE).matches
    );
  } catch {
    return false;
  }
}

/** A duration as a person would say it: `8s`, `1m 12s`. */
function formatElapsed(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));

  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/**
 * One conversation, as the place the work is done.
 *
 * The screen is the transcript and the composer under it, and nothing else
 * takes room from them: the chat's own facts are in a header one line tall,
 * and what stands behind the conversation — context, summary, artifacts — is
 * a panel that opens beside it.
 *
 * The transcript is read from `GET /chats/:chatId/messages` backwards from the
 * end — `order: 'desc'` for the newest page, then the `before` cursor for the
 * ones above it. Cursors rather than offsets because a conversation grows at
 * the end: an offset window shifts under the reader the moment a message is
 * appended, while a sequence cursor addresses the same turns either way.
 *
 * A turn is sent in two steps the API keeps apart: the message is stored, then
 * the reply is asked for. The run that produces the reply belongs to
 * `ChatRunsService`, not to this component, so it carries on when another
 * chat is opened and is found again, where it has got to, on the way back.
 * This screen draws the run; it does not own it.
 */
@Component({
  selector: 'app-chat-detail',
  imports: [
    AgentAvatar,
    Avatar,
    ChatInspector,
    Composer,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatTooltipModule,
    MessageBody,
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
  private readonly completions = inject(CompletionsService);
  private readonly runs = inject(ChatRunsService);
  private readonly models = inject(ModelCatalogService);
  private readonly injector = inject(Injector);
  private readonly dialog = inject(MatDialog);
  private readonly notify = inject(NotificationService);
  private readonly router = inject(Router);
  private readonly roster = inject(AgentRosterService);
  protected readonly conversations = inject(ConversationsService);
  protected readonly user = inject(UserProfileService);

  /** Bound from the route (`withComponentInputBinding`). */
  readonly chatId = input.required<string>();

  private readonly loads = new Subject<string>();
  private readonly transcriptLoads = new Subject<string>();
  private readonly contextLoads = new Subject<string>();

  /** The scrolling element of the transcript, so it can be kept at the end. */
  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');
  private readonly composer = viewChild(Composer);

  protected readonly chat = signal<Chat | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<ApiError | null>(null);

  /** The loaded tail of the conversation, oldest first. */
  protected readonly messages = signal<readonly Message[]>([]);
  /** How many messages the chat has in total, which the envelope reports. */
  protected readonly messageTotal = signal(0);
  protected readonly messagesLoading = signal(true);
  protected readonly messagesError = signal<ApiError | null>(null);
  protected readonly loadingOlder = signal(false);

  /** What the model would be sent, for the header's gauge and the details. */
  protected readonly context = signal<ChatContext | null>(null);

  /** What is typed in the composer, held here so a failed send can put it back. */
  protected readonly draft = signal('');
  /** True between Enter and the turn being stored. */
  protected readonly sending = signal(false);

  protected readonly inspectorOpen = signal(readInspectorOpen());
  /** Bumped when a run ends, so the details re-read what the chat produced. */
  protected readonly revision = signal(0);

  /** False once the reader has scrolled up, which stops the view following the run. */
  protected readonly pinned = signal(true);

  /** A clock that only ticks while a run is on screen. */
  private readonly now = signal(Date.now());

  /**
   * The turns being written, kept on screen until what was stored is read.
   *
   * A run is cleared from the service the moment it ends, a request before the
   * stored turns arrive. Holding the last drafts across that gap means the
   * answer is replaced by its stored form in one step instead of vanishing and
   * reappearing.
   */
  private readonly heldDrafts = signal<readonly RunDraft[]>([]);

  /** True while part of the conversation is still above what was read. */
  protected readonly hasOlder = computed(() => this.messages().length < this.messageTotal());

  protected readonly owner = computed(() => {
    const chat = this.chat();
    return chat ? ownerOf(chat) : null;
  });

  /** The agent a single-agent chat is held with, when it still exists. */
  private readonly ownerAgent = computed<Agent | null>(() => {
    const owner = this.owner();

    return owner?.kind === 'agent'
      ? (this.roster.agents().find((agent) => agent.id === owner.id) ?? null)
      : null;
  });

  /**
   * Who the conversation is with: the name, what it runs on, and where to
   * find it.
   *
   * An agent's name comes from the roster and a team's from the list the shell
   * already holds — the same sources the rail uses, so the two cannot
   * disagree. Until either has landed, the kind stands in for the name.
   */
  protected readonly participant = computed(() => {
    const owner = this.owner();
    if (!owner) {
      return null;
    }

    if (owner.kind === 'agent') {
      const agent = this.ownerAgent();

      return {
        kind: 'agent' as const,
        name: agent?.name ?? 'Agent',
        agent,
        detail: this.models.labelFor(agent),
        link: ['/agents', owner.id],
      };
    }

    const team = this.conversations.teams().find((entry) => entry.id === owner.id);

    return {
      kind: 'team' as const,
      name: team?.name ?? 'Team',
      agent: null,
      detail: team ? `${team.memberCount} ${team.memberCount === 1 ? 'agent' : 'agents'}` : null,
      link: ['/teams', owner.id],
    };
  });

  protected readonly project = computed(() => {
    const projectId = this.chat()?.projectId;

    return projectId
      ? {
          id: projectId,
          name: this.conversations.projectName(projectId) ?? 'Project',
        }
      : null;
  });

  /** The title as stored, for the heading and the delete confirmation. */
  protected readonly heading = computed(() => {
    const chat = this.chat();
    return chat ? titleOf(chat) : '';
  });

  protected readonly untitled = computed(() => !this.chat()?.title);

  /** How full the model's window is, as a whole percentage, when it is knowable. */
  protected readonly contextPercent = computed(() => {
    const estimate = this.context()?.tokenEstimate;

    return estimate?.contextWindow
      ? Math.min(100, Math.round((estimate.totalTokens / estimate.contextWindow) * 100))
      : null;
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
    const writing = this.writingIds();

    // The API stores a turn's row the moment it starts, empty, and fills it
    // when the run ends. While it is being written the live draft is the turn;
    // the half-stored row would be a second, blank copy of it.
    return this.messages()
      .filter((message) => !writing.has(message.id))
      .map((message) => {
        const agentId = message.agentId ?? (message.role === 'assistant' ? ownerAgentId : null);
        const agent = agentId ? (agents.find((entry) => entry.id === agentId) ?? null) : null;

        return {
          message,
          agent,
          agentId,
          author: this.authorName(message.role, agent?.name ?? null),
          model: this.models.labelFor(agent),
          own: message.role === 'user',
          // The two roles a person reads as speech; `system` and `tool` are
          // machinery and are drawn as the quieter lines they are.
          spoken: message.role === 'user' || message.role === 'assistant',
        };
      });
  });

  /** The ids of the turns the current run is still producing. */
  private readonly writingIds = computed(
    () => new Set(this.running() ? (this.run()?.drafts ?? []).map((draft) => draft.messageId) : []),
  );

  /** The run for this chat, if one is in flight or failed unread. */
  protected readonly run = computed(() => this.runs.runFor(this.chatId()));

  protected readonly running = computed(() => this.run()?.status === 'running');

  /** Why the last run failed, until it is retried or dismissed. */
  protected readonly failure = computed(() => {
    const run = this.run();
    return run?.status === 'failed' ? run.error : null;
  });

  /**
   * The turns being written right now, resolved the way stored turns are.
   *
   * A team run produces one after another on the same stream, so this is a
   * list: finished members stay above the one currently speaking.
   */
  protected readonly liveTurns = computed(() => {
    const agents = this.roster.agents();
    const running = this.running();
    const stored = new Set(this.messages().map((message) => message.id));

    return (
      this.heldDrafts()
        // Once the run is over and a draft's stored turn has been read, the
        // stored turn takes its place.
        .filter((draft) => running || !stored.has(draft.messageId))
        .map((draft) => {
          const agent = draft.agentId
            ? (agents.find((entry) => entry.id === draft.agentId) ?? null)
            : null;

          return {
            draft,
            agent,
            author: agent?.name ?? draft.agentName ?? 'Assistant',
            model: this.models.labelFor(agent),
            writing: this.running() && !draft.complete,
          };
        })
    );
  });

  /**
   * What the agent is doing, in a line.
   *
   * Derived from the stream itself — whether a turn has opened, whether it is
   * reasoning or writing — so the line only ever says what has been observed.
   */
  protected readonly activity = computed(() => {
    const run = this.run();
    if (run?.status !== 'running') {
      return null;
    }

    const current = run.drafts[run.drafts.length - 1];
    const who =
      (current
        ? (this.roster.agents().find((agent) => agent.id === current.agentId)?.name ??
          current.agentName)
        : null) ??
      this.participant()?.name ??
      'The agent';

    const phase =
      !current || current.complete
        ? 'is starting'
        : current.text
          ? 'is writing'
          : current.thought
            ? 'is reasoning'
            : 'is thinking';

    return {
      text: `${who} ${phase}`,
      // In a team run, which turn of the interaction this is.
      turn: run.drafts.length > 1 ? run.drafts.length : null,
      elapsed: formatElapsed(this.now() - run.startedAt),
    };
  });

  /**
   * True when the last thing said is the user's and nobody is answering it.
   *
   * That is what a chat looks like after a run was stopped, or failed and was
   * dismissed, or after a turn was stored by another client. The reply can
   * simply be asked for; retyping the turn would store it twice.
   */
  protected readonly awaitingReply = computed(() => {
    const last = this.messages()[this.messages().length - 1];

    return !this.run() && !this.sending() && !this.messagesLoading() && last?.role === 'user';
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

        if (error?.status === 404) {
          // Deleted elsewhere: the rail should stop offering it.
          this.conversations.drop(this.chatId());
        }
      });

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
        // A run's turns are in what was just read, so nothing is held back.
        this.heldDrafts.set(this.running() ? (this.run()?.drafts ?? []) : []);

        if (page) {
          this.scrollToLatest();
          // A conversation is opened to be continued, so the cursor goes
          // where the next turn is typed.
          afterNextRender(() => this.composer()?.focus(), { injector: this.injector });
        }
      });

    // Secondary to the conversation: a context that cannot be assembled costs
    // the gauge, not the screen.
    this.contextLoads
      .pipe(
        switchMap((chatId) => this.completions.context(chatId).pipe(catchError(() => of(null)))),
        takeUntilDestroyed(),
      )
      .subscribe((context) => this.context.set(context));

    // When this chat's run ends, read what it stored. Announced by the service
    // rather than watched for here, so a run that ended while another chat was
    // open is not replayed on the way back — its turns are simply in the
    // transcript that is read on arrival.
    this.runs.settled
      .pipe(
        filter((outcome) => outcome.chatId === this.chatId()),
        takeUntilDestroyed(),
      )
      .subscribe((outcome) => void this.afterRun(outcome.result === 'stopped'));

    interval(1000)
      .pipe(takeUntilDestroyed())
      .subscribe(() => {
        if (this.running()) {
          this.now.set(Date.now());
        }
      });

    effect(() => {
      const chatId = this.chatId();
      untracked(() => {
        this.runs.view(chatId);
        this.load(chatId);
      });
    });

    // Mirrors the run's drafts while it is going, and follows them down the
    // page for as long as the reader has not scrolled away.
    effect(() => {
      const run = this.run();

      if (run?.status === 'running') {
        this.heldDrafts.set(run.drafts);
        untracked(() => this.followIfPinned());
      }
    });

    inject(DestroyRef).onDestroy(() => this.runs.view(null));
  }

  protected load(chatId: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.chat.set(null);
    this.loads.next(chatId);

    this.messagesLoading.set(true);
    this.messagesError.set(null);
    this.messages.set([]);
    this.messageTotal.set(0);
    this.heldDrafts.set([]);
    this.pinned.set(true);
    this.transcriptLoads.next(chatId);

    this.context.set(null);
    this.contextLoads.next(chatId);
  }

  /**
   * Stores the turn and asks for the reply.
   *
   * Two requests on purpose. The turn is the user's and is kept whatever
   * happens next; if the reply then fails, the failure is shown under a turn
   * that is safely stored and can be retried without typing it again.
   */
  protected async send(text: string): Promise<void> {
    const chatId = this.chatId();

    if (this.sending() || this.running()) {
      this.draft.set(text);
      return;
    }

    this.sending.set(true);
    this.runs.dismiss(chatId);

    try {
      const message = await firstValueFrom(this.messagesApi.create(chatId, { content: text }));

      // The user may have opened another chat while this was in flight.
      if (this.chatId() === chatId) {
        this.messages.update((current) => [...current, message]);
        this.messageTotal.update((total) => total + 1);
        this.pinned.set(true);
        this.scrollToLatest();
      }

      this.conversations.touch(chatId);
      this.runs.start(chatId);
    } catch (error) {
      // Nothing was stored, so the turn goes back where it was typed.
      this.draft.set(text);
      this.notify.error(error, 'Could not send the message.');
    } finally {
      this.sending.set(false);
    }
  }

  /** Asks for the reply to what is already there: a retry, or a resumed turn. */
  protected requestReply(): void {
    const chatId = this.chatId();

    this.runs.dismiss(chatId);
    this.pinned.set(true);
    this.runs.start(chatId);
    this.scrollToLatest();
  }

  protected stop(): void {
    this.runs.stop(this.chatId());
  }

  protected dismissFailure(): void {
    this.runs.dismiss(this.chatId());
  }

  /**
   * Reads the turns a run stored and swaps them in for its drafts.
   *
   * Asked for by sequence, after the last turn on screen, so it is correct
   * whether the run stored one turn, several, or none before failing.
   */
  private async afterRun(stopped: boolean): Promise<void> {
    const chatId = this.chatId();
    // Rows the run opened may already be in hand, still empty; they are read
    // again rather than trusted.
    const drafted = new Set(this.heldDrafts().map((draft) => draft.messageId));
    const settledTurns = this.messages().filter((message) => !drafted.has(message.id));
    const last = settledTurns[settledTurns.length - 1];

    try {
      if (stopped) {
        // Stopping closes the connection; the API notices, then writes down
        // what had been generated. Reading at once would beat it to the row.
        await new Promise((resolve) => setTimeout(resolve, STOP_SETTLE_MS));
      }

      const page = await firstValueFrom(
        this.messagesApi.list(chatId, {
          limit: MESSAGE_PAGE_SIZE,
          order: 'asc',
          ...(last ? { after: last.sequence } : {}),
        }),
      );

      if (this.chatId() !== chatId) {
        return;
      }

      this.messages.set([...settledTurns, ...page.items]);
      // The envelope counts the whole chat, whatever the cursor selected.
      this.messageTotal.set(page.total);
    } catch {
      // The drafts stay where they are; a reload reads the stored turns.
    } finally {
      if (this.chatId() === chatId) {
        if (!this.running()) {
          this.heldDrafts.set([]);
        }

        this.revision.update((revision) => revision + 1);
        this.contextLoads.next(chatId);
        this.conversations.touch(chatId);
        this.followIfPinned();
      }
    }
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

  /** Notes whether the reader is at the end, which decides whether to follow. */
  protected onScroll(): void {
    const element = this.scroller()?.nativeElement;

    if (element) {
      this.pinned.set(
        element.scrollHeight - element.scrollTop - element.clientHeight < PINNED_THRESHOLD,
      );
    }
  }

  protected jumpToLatest(): void {
    this.pinned.set(true);
    this.scrollToLatest();
  }

  private followIfPinned(): void {
    if (this.pinned()) {
      this.scrollToLatest();
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

  protected toggleInspector(): void {
    this.inspectorOpen.update((open) => {
      try {
        localStorage.setItem(INSPECTOR_KEY, open ? 'closed' : 'open');
      } catch {
        // Without storage the panel simply starts closed next time.
      }

      return !open;
    });
  }

  /** Takes the chat as compaction returned it, and re-reads what it changed. */
  protected onCompacted(chat: Chat): void {
    this.chat.set(chat);
    this.conversations.upsert(chat);
    this.contextLoads.next(chat.id);
  }

  protected rename(): void {
    const chat = this.chat();
    if (!chat) {
      return;
    }

    const ref = this.dialog.open<ChatRenameDialog, ChatRenameData, Chat>(ChatRenameDialog, {
      data: { chat },
    });

    ref.afterClosed().subscribe((updated) => {
      if (updated) {
        this.chat.set(updated);
        this.conversations.upsert(updated);
      }
    });
  }

  /**
   * Files the chat under a project, or takes it out of one with `null`.
   *
   * Not confirmed: it moves a reference, nothing is lost, and the same menu
   * moves it back.
   */
  protected async moveToProject(projectId: string | null): Promise<void> {
    const chat = this.chat();
    if (!chat || (chat.projectId ?? null) === projectId) {
      return;
    }

    try {
      const updated = await firstValueFrom(this.chats.update(chat.id, { projectId }));
      this.chat.set(updated);
      this.conversations.upsert(updated);
      // Both projects' counts changed.
      this.conversations.refreshProjects();
      this.notify.success(
        projectId ? 'Chat moved to the project.' : 'Chat removed from its project.',
      );
    } catch (error) {
      this.notify.error(error, 'Could not move the chat.');
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
      // A run writing into a chat that is about to go would fail noisily.
      this.runs.stop(chat.id);
      await firstValueFrom(this.chats.remove(chat.id));
      this.runs.dismiss(chat.id);
      this.conversations.drop(chat.id);
      this.notify.success('Chat deleted.');
      void this.router.navigate(['/chats/new']);
    } catch (error) {
      this.notify.error(error, 'Could not delete the chat.');
    }
  }

  protected async copy(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      this.notify.success('Copied.');
    } catch (error) {
      this.notify.error(error, 'Could not copy to the clipboard.');
    }
  }

  protected describe(error: ApiError): string {
    return describeApiError(error);
  }

  /**
   * Whether a failed run is something the owner's configuration would fix.
   *
   * The API answers 422 when the chat cannot run as configured — no model, a
   * disabled provider, a missing credential — and those are fixed on the
   * agent's or team's page rather than by trying again.
   */
  protected needsConfiguring(error: ApiError): boolean {
    return error.status === 422;
  }

  /** Which pill a message status is drawn as. */
  protected statusTone(status: MessageStatus): 'warn' | 'error' | 'idle' {
    if (status === 'error') {
      return 'error';
    }

    return status === 'complete' ? 'idle' : 'warn';
  }
}
