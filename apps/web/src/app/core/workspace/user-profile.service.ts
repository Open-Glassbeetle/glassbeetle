import { Injectable, computed, inject, signal } from '@angular/core';

import { UserService } from '../api/user.service';
import type { UserProfile } from '../api/user.models';

/**
 * The person the workspace belongs to.
 *
 * Held in a root service for the same reason the agent roster is: the name and
 * the avatar are in the window chrome on every route, and refetching them per
 * navigation would make the deck flicker. Unlike the roster, this changes about
 * once a year — the profile screen calls `set()` after a save rather than
 * asking the shell to refetch.
 */
@Injectable({ providedIn: 'root' })
export class UserProfileService {
  private readonly api = inject(UserService);

  private readonly _profile = signal<UserProfile | null>(null);
  private readonly _loaded = signal(false);

  readonly profile = this._profile.asReadonly();
  readonly loaded = this._loaded.asReadonly();

  /**
   * The name to show, falling back to "You".
   *
   * The profile is seeded from the OS account, so this is almost always a real
   * name; "You" covers the user who deliberately cleared it.
   */
  readonly displayName = computed(() => this._profile()?.displayName?.trim() || 'You');

  /** The avatar URL, or null when no picture is stored. */
  readonly pictureUrl = computed(() => this.api.pictureUrl(this._profile()));

  refresh(): void {
    this.api.get().subscribe({
      next: (profile) => {
        this._profile.set(profile);
        this._loaded.set(true);
      },
      // The deck falls back to "You" and initials; a profile that cannot be
      // read is reported by the profile screen, not by the chrome.
      error: () => this._loaded.set(true),
    });
  }

  /** Records a profile the user just saved, so the chrome follows immediately. */
  set(profile: UserProfile): void {
    this._profile.set(profile);
    this._loaded.set(true);
  }
}
