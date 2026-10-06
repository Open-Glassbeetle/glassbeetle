import { Component, input } from '@angular/core';

/**
 * A loading placeholder shaped like the content it stands in for.
 *
 * Preferred over a spinner wherever the shape of the result is known: the
 * layout does not jump when the data lands, and the page reads as already
 * filling in rather than as blocked.
 */
@Component({
  selector: 'gb-skeleton',
  template: '',
  host: {
    '[style.width]': 'width()',
    '[style.height]': 'height()',
    '[style.border-radius]': 'radius()',
    '[attr.aria-hidden]': 'true',
  },
  styles: `
    :host {
      display: block;
      background: linear-gradient(
        90deg,
        var(--mat-sys-surface-container) 25%,
        var(--mat-sys-surface-container-high) 37%,
        var(--mat-sys-surface-container) 63%
      );
      background-size: 400% 100%;
      animation: shimmer 1.4s ease-in-out infinite;
    }

    @keyframes shimmer {
      from {
        background-position: 100% 50%;
      }
      to {
        background-position: 0 50%;
      }
    }
  `,
})
export class Skeleton {
  readonly width = input('100%');
  readonly height = input('0.875rem');
  readonly radius = input('4px');
}
