import { CdkTextareaAutosize, TextFieldModule } from '@angular/cdk/text-field';
import {
  Component,
  ElementRef,
  booleanAttribute,
  effect,
  input,
  model,
  output,
  viewChild,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

/**
 * Where a turn is written.
 *
 * One component for the new-chat screen and for an open conversation, so
 * typing to an agent is the same act in both. Whatever sits beside the send
 * button — who the turn goes to, which project — is projected in, because
 * that differs between the two and the field itself does not.
 *
 * Enter sends and Shift+Enter breaks the line, which is what every tool this
 * sits beside does. Enter is left alone while an input method is composing,
 * so confirming a candidate does not send half a sentence.
 */
@Component({
  selector: 'gb-composer',
  imports: [MatIconModule, MatTooltipModule, TextFieldModule],
  template: `
    <div class="composer" [class.composer--disabled]="disabled()">
      <!-- The padding is the wrapper's, not the field's: the autosize measures
           the textarea itself, and padding inside it would be counted as
           rows. -->
      <div class="composer__input">
        <textarea
          #field
          class="composer__field"
          cdkTextareaAutosize
          [cdkAutosizeMinRows]="minRows()"
          [cdkAutosizeMaxRows]="maxRows()"
          [placeholder]="placeholder()"
          [attr.aria-label]="label()"
          [disabled]="disabled()"
          (input)="text.set($any($event.target).value)"
          (keydown)="onKeydown($event)"
        ></textarea>
      </div>

      <div class="composer__bar">
        <div class="composer__context">
          <ng-content />
        </div>

        @if (busy()) {
          <button
            class="composer__send composer__send--stop"
            type="button"
            aria-label="Stop"
            matTooltip="Stop"
            (click)="stopped.emit()"
          >
            <mat-icon>stop</mat-icon>
          </button>
        } @else {
          <button
            class="composer__send"
            type="button"
            aria-label="Send"
            [matTooltip]="canSend() ? 'Send  ↵' : ''"
            [disabled]="!canSend()"
            (click)="send()"
          >
            <mat-icon>arrow_upward</mat-icon>
          </button>
        }
      </div>
    </div>
  `,
  styleUrl: './composer.scss',
})
export class Composer {
  /** What is typed. Two-way, so the owner can restore a turn that failed to send. */
  readonly text = model('');

  readonly placeholder = input('Message');
  readonly label = input('Message');
  readonly minRows = input(1);
  readonly maxRows = input(12);

  /** True while a run is in flight: the send button becomes the stop button. */
  readonly busy = input(false, { transform: booleanAttribute });
  /** True when nothing can be sent at all, whatever is typed. */
  readonly disabled = input(false, { transform: booleanAttribute });
  /** True when typing is allowed but sending is not, such as while a turn is being stored. */
  readonly blocked = input(false, { transform: booleanAttribute });

  /** The trimmed turn, emitted once per send. The field is cleared as it goes. */
  readonly submitted = output<string>();
  readonly stopped = output<void>();

  private readonly field = viewChild.required<ElementRef<HTMLTextAreaElement>>('field');
  private readonly autosize = viewChild.required(CdkTextareaAutosize);

  constructor() {
    // The field is written to directly, whenever it differs from `text`,
    // rather than through a `[value]` binding. A binding only writes when the
    // bound value changed since the last render — so typing and Enter landing
    // in the same render would look like "empty, then empty" and leave the
    // sent turn sitting in the field.
    effect(() => {
      const text = this.text();
      const element = this.field().nativeElement;

      if (element.value !== text) {
        element.value = text;
        // The autosize only hears typing; a value set from here needs telling.
        this.autosize().resizeToFitContent(true);
      }
    });
  }

  protected canSend(): boolean {
    return !this.disabled() && !this.blocked() && !this.busy() && this.text().trim() !== '';
  }

  focus(): void {
    this.field().nativeElement.focus();
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) {
      return;
    }

    // Enter never breaks the line: a turn that cannot be sent yet stays as it
    // is rather than quietly gaining a newline.
    event.preventDefault();
    this.send();
  }

  protected send(): void {
    if (!this.canSend()) {
      return;
    }

    const text = this.text().trim();
    this.text.set('');
    this.submitted.emit(text);
  }
}
