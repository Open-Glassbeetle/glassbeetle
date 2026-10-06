import { Component, OnInit, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';

import { ApiStatusService } from './api-status.service';

/**
 * Toolbar indicator for backend reachability.
 *
 * Clicking it re-runs the health check: when the API is down, the first thing
 * a user does after starting it is ask the UI to look again.
 */
@Component({
  selector: 'app-api-status-indicator',
  imports: [MatButtonModule, MatIconModule, MatProgressSpinnerModule, MatTooltipModule],
  template: `
    <button
      matButton
      class="status"
      [class.status--online]="status.state() === 'online'"
      [class.status--degraded]="status.state() === 'degraded'"
      [class.status--offline]="status.state() === 'offline'"
      [matTooltip]="tooltip()"
      (click)="status.refresh()"
    >
      @if (status.state() === 'checking') {
        <mat-spinner diameter="14" />
      } @else {
        <span class="status__dot" aria-hidden="true"></span>
      }
      <span class="status__label">{{ label() }}</span>
    </button>
  `,
  styles: `
    .status {
      --mat-button-text-label-text-color: var(--mat-sys-on-surface-variant);

      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      font: var(--mat-sys-label-large);
    }

    .status__dot {
      width: 0.5rem;
      height: 0.5rem;
      border-radius: 50%;
      background: var(--mat-sys-outline);
    }

    .status--online .status__dot {
      background: var(--mat-sys-primary);
    }

    .status--degraded .status__dot {
      background: var(--mat-sys-tertiary);
    }

    .status--offline {
      --mat-button-text-label-text-color: var(--mat-sys-error);
    }

    .status--offline .status__dot {
      background: var(--mat-sys-error);
    }

    .status__label {
      @media (max-width: 40rem) {
        display: none;
      }
    }
  `,
})
export class ApiStatusIndicator implements OnInit {
  protected readonly status = inject(ApiStatusService);

  protected readonly label = computed(() => {
    switch (this.status.state()) {
      case 'checking':
        return 'Checking…';
      case 'online':
        return 'API online';
      case 'degraded':
        return 'API degraded';
      case 'offline':
        return 'API offline';
    }
  });

  protected readonly tooltip = computed(() => {
    const state = this.status.state();

    if (state === 'offline') {
      return this.status.error() ?? 'The API could not be reached.';
    }

    if (state === 'degraded') {
      const database = this.status.health()?.checks?.database;
      return database?.error
        ? `Database ${database.status}: ${database.error}`
        : 'A dependency check is failing.';
    }

    return 'Re-check the API';
  });

  ngOnInit(): void {
    this.status.refresh();
  }
}
