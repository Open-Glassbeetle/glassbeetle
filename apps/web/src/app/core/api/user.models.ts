/**
 * The user profile as the API represents it (`GET /api/v1/user`).
 *
 * A singleton: there is one person, no collection, and no id in the URL. Every
 * nullable field is always present and explicitly `null`, so "not set" is
 * distinguishable from "unknown to this version of the API".
 */
export interface UserProfile {
  readonly id: string;
  /**
   * Seeded from the operating system account on first read, so it is rarely
   * null — but it is nullable, because the user may clear it.
   */
  readonly displayName: string | null;
  readonly pronouns: string | null;
  readonly about: string | null;
  readonly locale: string | null;
  readonly timezone: string | null;
  /**
   * Whether the profile is sent to model providers with each completion. For a
   * remote provider that means a third party, which is why the UI states the
   * consequence beside the switch.
   */
  readonly includeInPrompts: boolean;
  /** Whether a picture is stored. The bytes come from `GET /user/picture`. */
  readonly hasPicture: boolean;
  /**
   * When the picture was last replaced. The download URL is stable, so this is
   * what a client appends to bust its own cache after an upload.
   */
  readonly pictureUpdatedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Body for `PATCH /api/v1/user`.
 *
 * An omitted key leaves the field alone; an explicit `null` clears it. The API
 * also treats a string of only whitespace as `null`, but the UI sends `null`
 * outright rather than relying on that.
 */
export interface UpdateUserProfileInput {
  displayName?: string | null;
  pronouns?: string | null;
  about?: string | null;
  locale?: string | null;
  timezone?: string | null;
  includeInPrompts?: boolean;
}

/** What the API accepts in `about`, which is a prompt budget rather than storage. */
export const MAX_ABOUT_LENGTH = 4000;
