import { Component, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

/**
 * Placeholder shown where a collection would be.
 *
 * Distinguishes "nothing here yet" from "nothing matched your filters" by
 * message alone — the caller decides which it is, because only the caller knows
 * whether a filter is active.
 */
@Component({
  selector: 'app-empty-state',
  imports: [MatIconModule],
  template: `
    <div class="empty">
      <mat-icon class="empty__icon">{{ icon() }}</mat-icon>
      <p class="empty__title">{{ title() }}</p>
      @if (message()) {
        <p class="empty__message">{{ message() }}</p>
      }
      <ng-content />
    </div>
  `,
  styles: `
    .empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.5rem;
      padding: 3.5rem 1.5rem;
      text-align: center;
    }

    .empty__icon {
      font-size: 2.5rem;
      width: 2.5rem;
      height: 2.5rem;
      color: var(--mat-sys-outline);
    }

    .empty__title {
      margin: 0;
      font: var(--mat-sys-title-medium);
    }

    .empty__message {
      margin: 0;
      max-width: 32rem;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-medium);
    }
  `,
})
export class EmptyState {
  readonly icon = input('inbox');
  readonly title = input.required<string>();
  readonly message = input<string>();
}
