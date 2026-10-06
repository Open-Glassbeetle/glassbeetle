import { Component } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';

import { EmptyState } from '../../shared/empty-state/empty-state';

@Component({
  selector: 'app-not-found',
  imports: [EmptyState, MatButtonModule, MatIconModule, RouterLink],
  template: `
    <div class="page">
      <app-empty-state
        icon="explore_off"
        title="Page not found"
        message="That route does not exist in this build."
      >
        <a matButton="tonal" routerLink="/dashboard">
          <mat-icon>space_dashboard</mat-icon>
          Back to the dashboard
        </a>
      </app-empty-state>
    </div>
  `,
})
export class NotFound {}
