import { Component, input } from '@angular/core';

/**
 * Title, supporting line and action slot shared by every routed page.
 */
@Component({
  selector: 'app-page-header',
  template: `
    <header class="header">
      <div class="header__text">
        <h1 class="header__title">{{ title() }}</h1>
        @if (subtitle()) {
          <p class="header__subtitle">{{ subtitle() }}</p>
        }
      </div>

      <div class="header__actions">
        <ng-content />
      </div>
    </header>
  `,
  styles: `
    .header {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-end;
      justify-content: space-between;
      gap: 1rem;
      margin-bottom: 1.5rem;
    }

    .header__title {
      margin: 0;
      font: var(--mat-sys-headline-medium);
      letter-spacing: -0.01em;
    }

    .header__subtitle {
      margin: 0.25rem 0 0;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-medium);
    }

    .header__actions {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
  `,
})
export class PageHeader {
  readonly title = input.required<string>();
  readonly subtitle = input<string>();
}
