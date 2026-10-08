import { Component, computed, input, signal } from '@angular/core';

/**
 * A round avatar: a stored picture when there is one, initials when there is
 * not.
 *
 * The initials and their colour are derived from the name rather than stored,
 * so the same subject keeps the same badge across sessions without the server
 * holding a palette. A picture that fails to load falls back to them: the API
 * can legitimately answer 404 for a profile whose file did not survive a
 * restore, and a broken-image glyph would be a worse answer than initials.
 *
 * Content projected into it is positioned over the bottom-right corner, for
 * callers that overlay a badge.
 */
@Component({
  selector: 'gb-avatar',
  template: `
    <span
      class="avatar"
      [class.avatar--large]="size() === 'large'"
      [class.avatar--small]="size() === 'small'"
      [style.--avatar-hue]="hue()"
      aria-hidden="true"
    >
      @if (picture()) {
        <img class="avatar__image" [src]="picture()" alt="" (error)="onImageError()" />
      } @else {
        {{ initials() }}
      }

      <ng-content />
    </span>
  `,
  styles: `
    /* Explicit, so the element's box is exactly the circle: callers draw rings
       and overlap avatars against this host. */
    :host {
      display: inline-flex;
    }

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

    .avatar--small {
      width: 1.5rem;
      height: 1.5rem;
      font-size: 0.625rem;
      font-weight: 600;
    }

    .avatar--large {
      width: 3.5rem;
      height: 3.5rem;
      font: var(--mat-sys-title-large);
      font-weight: 600;
    }

    .avatar__image {
      width: 100%;
      height: 100%;
      border-radius: inherit;
      object-fit: cover;
      /* The picture is the avatar, so it has to clip to the same circle rather
         than sit inside it. */
      display: block;
    }
  `,
})
export class Avatar {
  /** The subject's name, which the initials and the hue come from. */
  readonly name = input.required<string>();

  /** URL of the stored picture, or null to show initials. */
  readonly imageUrl = input<string | null>(null);

  readonly size = input<'small' | 'normal' | 'large'>('normal');

  private readonly failedUrl = signal<string | null>(null);

  /** The picture to draw, unless loading this exact URL already failed. */
  protected readonly picture = computed(() => {
    const url = this.imageUrl();
    return url && url !== this.failedUrl() ? url : null;
  });

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
   * A stable hue per name, so the same subject keeps the same colour across
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

  /**
   * Records the URL that failed rather than a boolean, so a replacement
   * picture — which arrives at a new URL — is attempted instead of being
   * suppressed by an earlier failure.
   */
  protected onImageError(): void {
    this.failedUrl.set(this.imageUrl());
  }
}
