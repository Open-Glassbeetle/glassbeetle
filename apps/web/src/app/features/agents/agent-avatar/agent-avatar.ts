import { Component, computed, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

/**
 * An agent's avatar, drawn from its initials.
 *
 * The API deliberately never exposes `agents.picture_path`, and there is no
 * endpoint that serves the stored image back — `hasPicture` is all a client
 * gets. So an uploaded picture shows as a badge on the initials rather than as
 * the picture itself; when a download endpoint is added, this is the one place
 * that has to change.
 */
@Component({
  selector: 'app-agent-avatar',
  imports: [MatIconModule, MatTooltipModule],
  template: `
    <span
      class="avatar"
      [class.avatar--large]="size() === 'large'"
      [style.--avatar-hue]="hue()"
      aria-hidden="true"
    >
      {{ initials() }}

      @if (hasPicture()) {
        <span
          class="avatar__badge"
          matTooltip="A profile picture is stored. The API does not serve it back yet."
        >
          <mat-icon>photo_camera</mat-icon>
        </span>
      }
    </span>
  `,
  styles: `
    .avatar {
      position: relative;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: none;
      width: 2.25rem;
      height: 2.25rem;
      border-radius: var(--mat-sys-corner-full);
      background: oklch(0.65 0.12 var(--avatar-hue, 250));
      color: oklch(0.18 0.04 var(--avatar-hue, 250));
      font: var(--mat-sys-label-large);
      font-weight: 600;
      user-select: none;
    }

    .avatar--large {
      width: 3.5rem;
      height: 3.5rem;
      font: var(--mat-sys-title-large);
      font-weight: 600;
    }

    .avatar__badge {
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
  readonly size = input<'normal' | 'large'>('normal');

  /** Up to two initials, taken from the first and last word of the name. */
  protected readonly initials = computed(() => {
    const words = this.name().trim().split(/\s+/).filter(Boolean);

    if (words.length === 0) {
      return '?';
    }

    const first = words[0]![0] ?? '';
    const last = words.length > 1 ? (words.at(-1)![0] ?? '') : '';

    return (first + last).toUpperCase();
  });

  /**
   * A stable hue per name, so the same agent keeps the same colour across
   * sessions without the server storing one.
   */
  protected readonly hue = computed(() => {
    const name = this.name();
    let hash = 0;

    for (let index = 0; index < name.length; index += 1) {
      hash = (hash * 31 + name.charCodeAt(index)) % 360;
    }

    return hash;
  });
}
