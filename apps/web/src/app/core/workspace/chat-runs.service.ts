import { Injectable, computed, inject, signal } from '@angular/core';
import { Subject, type Subscription } from 'rxjs';

import { toApiError, type ApiError } from '../api/api-error';
import type { CompletionEvent, TokenUsage } from '../api/completions.models';
import { CompletionsService } from '../api/completions.service';

/** One turn as it is being written, before the API has stored the whole of it. */
export interface RunDraft {
  readonly messageId: string;
  readonly agentId: string | null;
  readonly agentName: string | null;
  readonly text: string;
  /** Reasoning the model emitted ahead of its answer, when it emits any. */
  readonly thought: string;
  readonly complete: boolean;
}

/**
 * A request for the next turn of one chat, from when it was asked for until
 * its outcome has been seen.
 *
 * `failed` is kept, with what was written before the failure, until it is
 * dismissed or retried: a run that failed in a chat nobody was looking at
 * still has to be found when they come back.
 */
export interface ChatRun {
  readonly chatId: string;
  readonly status: 'running' | 'failed';
  readonly startedAt: number;
  readonly drafts: readonly RunDraft[];
  readonly usage: TokenUsage | null;
  readonly error: ApiError | null;
}

/** How a run ended, announced so an open transcript can read what was stored. */
export interface RunOutcome {
  readonly chatId: string;
  readonly result: 'complete' | 'failed' | 'stopped';
}

/**
 * The runs in flight, across every chat.
 *
 * Owned by a root service rather than by the chat screen because a run
 * outlives the screen that started it: an agent keeps working when the user
 * opens another conversation, the sidebar shows which chats are busy, and
 * coming back finds the turn where it has got to instead of a dropped
 * request. The screen only renders what is here.
 */
@Injectable({ providedIn: 'root' })
export class ChatRunsService {
  private readonly completions = inject(CompletionsService);

  private readonly _runs = signal<ReadonlyMap<string, ChatRun>>(new Map());
  private readonly _unseen = signal<ReadonlySet<string>>(new Set());
  private readonly subscriptions = new Map<string, Subscription>();
  private readonly outcomes = new Subject<RunOutcome>();

  /** The chat currently on screen, whose finished runs need no flag. */
  private viewing: string | null = null;

  /** Every run that ended, in order. */
  readonly settled = this.outcomes.asObservable();

  readonly runs = this._runs.asReadonly();

  /** Chats where a run finished while another chat was on screen. */
  readonly unseen = this._unseen.asReadonly();

  readonly runningCount = computed(
    () => [...this._runs().values()].filter((run) => run.status === 'running').length,
  );

  /** The run for a chat, if it has one. Reads a signal, so it can be computed on. */
  runFor(chatId: string): ChatRun | null {
    return this._runs().get(chatId) ?? null;
  }

  isRunning(chatId: string): boolean {
    return this.runFor(chatId)?.status === 'running';
  }

  /**
   * Asks the chat's agent or team for its next turn.
   *
   * Ignored while that chat already has a run going: two would interleave
   * their turns in one conversation.
   */
  start(chatId: string): void {
    if (this.isRunning(chatId)) {
      return;
    }

    this.set(chatId, {
      chatId,
      status: 'running',
      startedAt: Date.now(),
      drafts: [],
      usage: null,
      error: null,
    });

    let finished = false;

    const subscription = this.completions.stream(chatId).subscribe({
      next: (event) => {
        if (finished) {
          return;
        }

        if (event.type === 'error') {
          finished = true;
          this.fail(chatId, {
            status: 0,
            code: event.data.code,
            message: event.data.message,
            details: [],
            offline: false,
          });
          return;
        }

        if (event.type === 'done') {
          finished = true;
          this.finish(chatId, 'complete');
          return;
        }

        this.apply(chatId, event);
      },
      error: (error: unknown) => {
        if (!finished) {
          finished = true;
          this.fail(chatId, toApiError(error));
        }
      },
      // A stream that closes without its `done` still ended; whatever was
      // stored is the outcome.
      complete: () => {
        if (!finished) {
          finished = true;
          this.finish(chatId, 'complete');
        }
      },
    });

    this.subscriptions.set(chatId, subscription);
  }

  /**
   * Stops a run. Closing the connection cancels the model call on the API, so
   * this stops the work rather than only hiding it.
   */
  stop(chatId: string): void {
    if (this.isRunning(chatId)) {
      this.finish(chatId, 'stopped');
    }
  }

  /** Clears a failed run once it has been read. */
  dismiss(chatId: string): void {
    if (this.runFor(chatId)?.status === 'failed') {
      this.remove(chatId);
    }
  }

  /** Records which chat is on screen, and clears its finished flag. */
  view(chatId: string | null): void {
    this.viewing = chatId;

    if (chatId && this._unseen().has(chatId)) {
      this._unseen.update((unseen) => {
        const next = new Set(unseen);
        next.delete(chatId);
        return next;
      });
    }
  }

  private apply(chatId: string, event: CompletionEvent): void {
    const run = this.runFor(chatId);
    if (!run) {
      return;
    }

    switch (event.type) {
      case 'message_start':
        this.set(chatId, {
          ...run,
          drafts: [
            ...run.drafts,
            {
              messageId: event.data.messageId,
              agentId: event.data.agentId,
              agentName: event.data.agentName ?? null,
              text: '',
              thought: '',
              complete: false,
            },
          ],
        });
        break;

      case 'token':
        this.patchDraft(run, event.data.messageId, (draft) => ({
          ...draft,
          text: draft.text + event.data.text,
        }));
        break;

      case 'thought':
        this.patchDraft(run, event.data.messageId, (draft) => ({
          ...draft,
          thought: draft.thought + event.data.thought,
        }));
        break;

      case 'message_complete':
        this.patchDraft(run, event.data.messageId, (draft) => ({ ...draft, complete: true }));
        break;

      case 'usage':
        this.set(chatId, { ...run, usage: event.data });
        break;
    }
  }

  private patchDraft(run: ChatRun, messageId: string, change: (draft: RunDraft) => RunDraft): void {
    this.set(run.chatId, {
      ...run,
      drafts: run.drafts.map((draft) => (draft.messageId === messageId ? change(draft) : draft)),
    });
  }

  private fail(chatId: string, error: ApiError): void {
    const run = this.runFor(chatId);
    this.release(chatId);

    if (run) {
      this.set(chatId, { ...run, status: 'failed', error });
    }

    this.announce(chatId, 'failed');
  }

  private finish(chatId: string, result: 'complete' | 'stopped'): void {
    this.release(chatId);
    this.remove(chatId);
    this.announce(chatId, result);
  }

  private announce(chatId: string, result: RunOutcome['result']): void {
    if (result !== 'stopped' && this.viewing !== chatId) {
      this._unseen.update((unseen) => new Set(unseen).add(chatId));
    }

    this.outcomes.next({ chatId, result });
  }

  private release(chatId: string): void {
    this.subscriptions.get(chatId)?.unsubscribe();
    this.subscriptions.delete(chatId);
  }

  private set(chatId: string, run: ChatRun): void {
    this._runs.update((runs) => new Map(runs).set(chatId, run));
  }

  private remove(chatId: string): void {
    this._runs.update((runs) => {
      const next = new Map(runs);
      next.delete(chatId);
      return next;
    });
  }
}
