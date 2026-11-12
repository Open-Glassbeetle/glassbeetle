import { DecimalPipe } from '@angular/common';
import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { Subject, catchError, map, of, switchMap } from 'rxjs';

import { artifactIcon, type Artifact } from '../../../core/api/artifacts.models';
import { ArtifactsService } from '../../../core/api/artifacts.service';
import type { Chat } from '../../../core/api/chats.models';
import type { ChatContext } from '../../../core/api/completions.models';
import { CompletionsService } from '../../../core/api/completions.service';
import { NotificationService } from '../../../core/notifications/notification.service';
import { RelativeTimePipe } from '../../../shared/relative-time/relative-time.pipe';

/** How many of a chat's artifacts the inspector lists. */
const ARTIFACT_LIMIT = 20;

interface Layer {
  readonly label: string;
  readonly present: boolean;
}

/**
 * What stands behind a conversation: what the model is being given, the
 * summary earlier turns were folded into, what the chat has produced, and the
 * facts about the chat itself.
 *
 * It is a side panel rather than part of the page because none of it is the
 * conversation. It is what you check when an agent behaves oddly or a long
 * chat slows down — worth one click, not a share of every screen.
 */
@Component({
  selector: 'app-chat-inspector',
  imports: [
    DecimalPipe,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    RelativeTimePipe,
    RouterLink,
  ],
  templateUrl: './chat-inspector.html',
  styleUrl: './chat-inspector.scss',
})
export class ChatInspector {
  private readonly artifactsApi = inject(ArtifactsService);
  private readonly completions = inject(CompletionsService);
  private readonly notify = inject(NotificationService);

  readonly chat = input.required<Chat>();
  /** The assembled context, or `null` while it is unread or could not be read. */
  readonly context = input<ChatContext | null>(null);
  /** How many turns the chat holds, which decides whether compacting makes sense. */
  readonly messageTotal = input(0);
  /** True while a run is in flight, when compacting would race it. */
  readonly busy = input(false);
  /** Bumped by the owner when a run ends, so what the chat produced is re-read. */
  readonly revision = input(0);

  /** The chat as compaction returned it. */
  readonly compacted = output<Chat>();
  readonly closed = output<void>();

  private readonly artifactLoads = new Subject<string>();

  protected readonly artifacts = signal<readonly Artifact[]>([]);
  protected readonly artifactTotal = signal(0);
  protected readonly compacting = signal(false);

  /** How full the model's window is, when the model says how large it is. */
  protected readonly usedFraction = computed(() => {
    const estimate = this.context()?.tokenEstimate;

    return estimate?.contextWindow
      ? Math.min(1, estimate.totalTokens / estimate.contextWindow)
      : null;
  });

  /** The layers of the system prompt, each as present or absent. */
  protected readonly layers = computed<readonly Layer[]>(() => {
    const details = this.context()?.systemDetails;

    return [
      { label: 'System prompt', present: !!details?.promptTemplate },
      { label: 'Personality', present: !!details?.personality },
      { label: 'Instructions', present: !!details?.instructions },
      { label: 'Memory', present: !!details?.memorySeam },
      { label: 'Conversation summary', present: !!details?.contextSummary },
    ];
  });

  protected readonly artifactEntries = computed(() =>
    this.artifacts().map((artifact) => ({ artifact, icon: artifactIcon(artifact.type) })),
  );

  constructor() {
    this.artifactLoads
      .pipe(
        switchMap((chatId) =>
          this.artifactsApi
            .list({ chatId, limit: ARTIFACT_LIMIT, sort: 'updatedAt', order: 'desc' })
            .pipe(
              map((page) => ({ items: page.items, total: page.total })),
              // The panel is secondary; a failed read shows as nothing produced
              // rather than as an error over the conversation.
              catchError(() => of({ items: [] as readonly Artifact[], total: 0 })),
            ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe(({ items, total }) => {
        this.artifacts.set(items);
        this.artifactTotal.set(total);
      });

    effect(() => {
      this.revision();
      this.artifactLoads.next(this.chat().id);
    });
  }

  /**
   * Folds the earlier turns into the summary.
   *
   * The turns stay in the transcript; what changes is what the model is sent.
   */
  protected compact(): void {
    if (this.compacting() || this.busy()) {
      return;
    }

    this.compacting.set(true);

    this.completions.compact(this.chat().id).subscribe({
      next: (chat) => {
        this.compacting.set(false);
        this.notify.success(
          `Compacted ${chat.compactedMessagesCount} ` +
            `${chat.compactedMessagesCount === 1 ? 'message' : 'messages'} into the summary.`,
        );
        this.compacted.emit(chat);
      },
      error: (error: unknown) => {
        this.compacting.set(false);
        this.notify.error(error, 'Could not compact the conversation.');
      },
    });
  }

  protected async copyId(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.chat().id);
      this.notify.success('Identifier copied.');
    } catch (error) {
      this.notify.error(error, 'Could not copy to the clipboard.');
    }
  }
}
