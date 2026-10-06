import { Component } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-not-found',
  imports: [MatButtonModule, MatIconModule, RouterLink],
  template: `
    <div class="view">
      <div class="blank">
        <mat-icon class="blank__icon">explore_off</mat-icon>
        <p class="blank__title">Page not found</p>
        <p class="blank__text">That route does not exist in this build.</p>
        <a matButton="filled" routerLink="/overview">
          <mat-icon>space_dashboard</mat-icon>
          Back to the workspace
        </a>
      </div>
    </div>
  `,
  styleUrl: './not-found.scss',
})
export class NotFound {}
