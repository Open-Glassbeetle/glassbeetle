import { userInfo } from 'node:os';

/**
 * Values the profile row is created with on first read.
 */
export interface UserProfileSeed {
  readonly displayName: string | null;
  readonly locale: string | null;
  readonly timezone: string | null;
}

/**
 * Derives the profile's initial values from the machine it runs on.
 *
 * This is what makes the resource local-first rather than merely offline: there
 * is no sign-up, so there is no form standing between a fresh installation and
 * a usable application. The machine already knows whose machine it is and which
 * locale and time zone it keeps, and all three are far more likely to be right
 * than empty.
 *
 * Every value is a seed and not a lock. The first `PATCH` replaces it and
 * nothing re-seeds afterwards, so a user who renames themselves stays renamed
 * even if the OS account is called something else.
 *
 * @param configuredName `GLASSBEETLE_USER_NAME`, which wins over the OS
 *   account. It exists for runs where `os.userInfo()` reports something
 *   unhelpful, such as `root` in a container.
 */
export function resolveUserProfileSeed(
  configuredName?: string | null,
): UserProfileSeed {
  return {
    displayName: configuredName?.trim() || resolveOsUserName(),
    locale: resolveIntlOption('locale'),
    timezone: resolveIntlOption('timeZone'),
  };
}

/**
 * The operating system account name, or null when it cannot be determined.
 *
 * `userInfo()` throws when the effective uid has no passwd entry, which happens
 * in some container images. A missing name is not a reason to fail the request
 * that was only reading a profile.
 */
function resolveOsUserName(): string | null {
  try {
    const name = userInfo().username?.trim();
    return name && name.length > 0 ? name : null;
  } catch {
    return null;
  }
}

/**
 * One resolved `Intl` option, or null when ICU cannot supply it.
 */
function resolveIntlOption(option: 'locale' | 'timeZone'): string | null {
  try {
    const resolved = Intl.DateTimeFormat().resolvedOptions()[option];
    return typeof resolved === 'string' && resolved.length > 0
      ? resolved
      : null;
  } catch {
    return null;
  }
}
