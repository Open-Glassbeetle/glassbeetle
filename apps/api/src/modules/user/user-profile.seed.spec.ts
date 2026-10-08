import { userInfo } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  isResolvableLocale,
  isResolvableTimezone,
} from './dto/intl-validators.js';
import { resolveUserProfileSeed } from './user-profile.seed.js';

describe('resolveUserProfileSeed', () => {
  it('prefers the configured name', () => {
    expect(resolveUserProfileSeed('Ada').displayName).toBe('Ada');
  });

  it('trims the configured name', () => {
    expect(resolveUserProfileSeed('  Ada  ').displayName).toBe('Ada');
  });

  it.each([undefined, null, '', '   '])(
    'falls back to the operating system account for %o',
    (configured) => {
      expect(resolveUserProfileSeed(configured).displayName).toBe(
        userInfo().username,
      );
    },
  );

  it('seeds a locale and time zone the API would accept back', () => {
    const seed = resolveUserProfileSeed();

    // The seed goes through no validation on its way into the database, so if
    // it were not something `PATCH /user` accepts, a user could be shown a
    // value they are then unable to re-save.
    expect(isResolvableLocale(seed.locale)).toBe(true);
    expect(isResolvableTimezone(seed.timezone)).toBe(true);
  });
});
