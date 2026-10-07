import { Component, OnInit, inject, signal } from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';

import { DesktopService } from '../../../core/desktop/desktop.service';

/**
 * The window's own controls, drawn by the app.
 *
 * The window is undecorated, so these are not a skin over native buttons —
 * they are the only ones there are. They keep the platform's *position*
 * (left on macOS, right elsewhere) because that is muscle memory worth more
 * than symmetry, while the look is the product's: flat glyphs in a capsule
 * that only take on colour under the cursor, so the chrome stays quiet until
 * you reach for it.
 */
@Component({
  selector: 'app-window-controls',
  imports: [MatTooltipModule],
  template: `
    <div class="controls" role="group" aria-label="Window">
      <button
        class="control control--minimise"
        type="button"
        matTooltip="Minimise"
        matTooltipPosition="below"
        aria-label="Minimise"
        (click)="minimise()"
      >
        <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2 5h6" /></svg>
      </button>

      <button
        class="control control--zoom"
        type="button"
        [matTooltip]="maximised() ? 'Restore' : 'Maximise'"
        matTooltipPosition="below"
        [attr.aria-label]="maximised() ? 'Restore' : 'Maximise'"
        (click)="toggleMaximise()"
      >
        @if (maximised()) {
          <svg viewBox="0 0 10 10" aria-hidden="true">
            <path d="M3 3.5h4.5V8H3z" />
            <path d="M2.5 6.5V2h4.5" />
          </svg>
        } @else {
          <svg viewBox="0 0 10 10" aria-hidden="true">
            <path d="M2.5 2.5h5v5h-5z" />
          </svg>
        }
      </button>

      <button
        class="control control--close"
        type="button"
        matTooltip="Close"
        matTooltipPosition="below"
        aria-label="Close"
        (click)="close()"
      >
        <svg viewBox="0 0 10 10" aria-hidden="true">
          <path d="M2.8 2.8l4.4 4.4M7.2 2.8L2.8 7.2" />
        </svg>
      </button>
    </div>
  `,
  styleUrl: './window-controls.scss',
})
export class WindowControls implements OnInit {
  private readonly desktop = inject(DesktopService);

  protected readonly maximised = signal(false);

  ngOnInit(): void {
    void this.sync();
  }

  protected async minimise(): Promise<void> {
    await this.desktop.minimiseWindow();
  }

  protected async toggleMaximise(): Promise<void> {
    await this.desktop.toggleMaximiseWindow();
    await this.sync();
  }

  protected async close(): Promise<void> {
    await this.desktop.closeWindow();
  }

  /** Keeps the zoom glyph in step with the window's actual state. */
  private async sync(): Promise<void> {
    this.maximised.set(await this.desktop.isWindowMaximised());
  }
}
