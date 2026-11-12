import { Component, booleanAttribute, computed, inject, input, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

import { NotificationService } from '../../../core/notifications/notification.service';
import { splitContent } from '../chat-detail/message-content';

/**
 * What a turn says: prose as written, and code as code.
 *
 * Content is bound as text throughout — never as HTML — so nothing a model
 * produces can become markup. Code blocks get the three things code needs
 * that prose does not: their own whitespace, a horizontal scroll instead of a
 * wrap, and a way to copy just the block.
 */
@Component({
  selector: 'gb-message-body',
  imports: [MatIconModule],
  template: `
    @for (segment of segments(); track $index; let last = $last) {
      @if (segment.kind === 'text') {
        <p class="prose">
          {{ segment.text }}
          @if (streaming() && last) {
            <span class="caret" aria-hidden="true"></span>
          }
        </p>
      } @else {
        <figure class="code">
          <figcaption class="code__head">
            <span class="code__language mono">{{ segment.language ?? 'text' }}</span>
            <button
              class="code__copy"
              type="button"
              [attr.aria-label]="copied() === $index ? 'Copied' : 'Copy the code'"
              (click)="copy(segment.text, $index)"
            >
              <mat-icon>{{ copied() === $index ? 'check' : 'content_copy' }}</mat-icon>
              {{ copied() === $index ? 'Copied' : 'Copy' }}
            </button>
          </figcaption>
          <pre
            class="code__body"
          ><code>{{ segment.text }}</code>@if (streaming() && last) {<span class="caret" aria-hidden="true"></span>}</pre>
        </figure>
      }
    } @empty {
      @if (streaming()) {
        <p class="prose"><span class="caret" aria-hidden="true"></span></p>
      }
    }
  `,
  styleUrl: './message-body.scss',
})
export class MessageBody {
  private readonly notify = inject(NotificationService);

  readonly content = input.required<string>();
  /** True while the turn is still being written, which draws the caret. */
  readonly streaming = input(false, { transform: booleanAttribute });

  protected readonly segments = computed(() => splitContent(this.content()));

  /** The index of the block that was just copied, for its moment of feedback. */
  protected readonly copied = signal<number | null>(null);

  protected async copy(text: string, index: number): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      this.copied.set(index);
      setTimeout(() => this.copied.update((current) => (current === index ? null : current)), 1600);
    } catch (error) {
      this.notify.error(error, 'Could not copy to the clipboard.');
    }
  }
}
