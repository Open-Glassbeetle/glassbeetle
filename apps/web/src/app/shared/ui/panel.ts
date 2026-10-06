import { Component, booleanAttribute, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

/**
 * The workspace's surface primitive.
 *
 * Panels are separated by a hairline and a flat fill rather than by elevation.
 * A screen here shows several at once, and stacked Material cards with shadows
 * read as a pile of documents instead of as regions of one workspace.
 *
 * ```html
 * <gb-panel title="Roster" subtitle="4 agents">
 *   <ng-container panel-actions><button matIconButton>…</button></ng-container>
 *   …body…
 * </gb-panel>
 * ```
 */
@Component({
  selector: 'gb-panel',
  imports: [MatIconModule],
  template: `
    <section class="panel" [class.panel--flush]="flush()">
      @if (title() || icon()) {
        <header class="panel__head">
          @if (icon()) {
            <mat-icon class="panel__icon">{{ icon() }}</mat-icon>
          }

          <div class="panel__titles">
            <h2 class="panel__title">{{ title() }}</h2>
            @if (subtitle()) {
              <p class="panel__subtitle">{{ subtitle() }}</p>
            }
          </div>

          <div class="panel__actions">
            <ng-content select="[panel-actions]" />
          </div>
        </header>
      }

      <div class="panel__body">
        <ng-content />
      </div>
    </section>
  `,
  styles: `
    .panel {
      display: flex;
      flex-direction: column;
      min-width: 0;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 10px;
      background: var(--mat-sys-surface-container-low);
      box-shadow: var(--gb-shadow-panel);
      overflow: hidden;
    }

    .panel__head {
      display: flex;
      align-items: center;
      gap: 0.625rem;
      padding: 0.625rem 0.875rem;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
      background: var(--mat-sys-surface-container);
    }

    .panel__icon {
      flex: none;
      font-size: 1rem;
      width: 1rem;
      height: 1rem;
      color: var(--mat-sys-on-surface-variant);
    }

    .panel__titles {
      min-width: 0;
      flex: 1;
    }

    .panel__title {
      margin: 0;
      font-size: 0.8125rem;
      font-weight: 600;
      letter-spacing: 0.01em;
      line-height: 1.3;
    }

    .panel__subtitle {
      margin: 0;
      color: var(--mat-sys-on-surface-variant);
      font-size: 0.75rem;
      line-height: 1.3;
    }

    .panel__actions {
      display: flex;
      align-items: center;
      gap: 0.125rem;
      flex: none;
      margin: -0.375rem -0.375rem -0.375rem 0;
    }

    .panel__body {
      min-width: 0;
      padding: 0.875rem;
    }

    .panel--flush .panel__body {
      padding: 0;
    }
  `,
})
export class Panel {
  readonly title = input<string>();
  readonly subtitle = input<string>();
  readonly icon = input<string>();
  /** Removes the body padding, for panels whose content manages its own. */
  readonly flush = input(false, { transform: booleanAttribute });
}
