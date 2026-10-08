import { Component, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

import { Avatar } from '../../../shared/ui/avatar';

/**
 * An agent's avatar.
 *
 * The agents endpoint has no counterpart to `GET /user/picture` yet, so an
 * agent's stored picture still cannot be read back — `hasPicture` is all a
 * client gets. It therefore shows as a badge on the initials rather than as
 * the picture itself; when the download endpoint lands, this component passes
 * its URL to `imageUrl` and the badge goes away.
 */
@Component({
  selector: 'app-agent-avatar',
  imports: [Avatar, MatIconModule, MatTooltipModule],
  template: `
    <gb-avatar [name]="name()" [size]="size()">
      <!-- A 1.5rem avatar has no room for a badge beside the initials. -->
      @if (hasPicture() && size() !== 'small') {
        <span
          class="badge"
          matTooltip="A profile picture is stored. The API does not serve it back yet."
        >
          <mat-icon>photo_camera</mat-icon>
        </span>
      }
    </gb-avatar>
  `,
  styles: `
    .badge {
      position: absolute;
      right: -0.15rem;
      bottom: -0.15rem;
      display: grid;
      place-items: center;
      width: 1.1rem;
      height: 1.1rem;
      border-radius: var(--mat-sys-corner-full);
      background: var(--mat-sys-surface-container-highest);
      color: var(--mat-sys-on-surface-variant);
      font-size: 0.7rem;

      .mat-icon {
        width: 0.7rem;
        height: 0.7rem;
        font-size: 0.7rem;
      }
    }
  `,
})
export class AgentAvatar {
  readonly name = input.required<string>();
  readonly hasPicture = input(false);
  readonly size = input<'small' | 'normal' | 'large'>('normal');
}
