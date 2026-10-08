import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { ApiClient } from './api-base';
import type { UpdateUserProfileInput, UserProfile } from './user.models';

/** `/api/v1/user` — the local user profile and its picture. */
@Injectable({ providedIn: 'root' })
export class UserService extends ApiClient {
  /**
   * Reads the profile.
   *
   * Never 404s: there is no sign-up, so the API provisions the profile on the
   * first read. A client does not have to handle "no user yet".
   */
  get(): Observable<UserProfile> {
    return this.http.get<UserProfile>(this.url('/user'));
  }

  /**
   * Partial update. Keys absent from `input` are left untouched; an explicit
   * `null` clears the field. An empty body is a no-op the API answers with the
   * unchanged profile.
   */
  update(input: UpdateUserProfileInput): Observable<UserProfile> {
    return this.http.patch<UserProfile>(this.url('/user'), input);
  }

  /**
   * Replaces the picture (`PUT`, so it is idempotent).
   *
   * JPEG, PNG, WebP and GIF are permitted — SVG is rejected server-side to
   * keep stored XSS out of the Tauri webview.
   */
  uploadPicture(file: File): Observable<UserProfile> {
    const body = new FormData();
    body.append('file', file, file.name);

    return this.http.put<UserProfile>(this.url('/user/picture'), body);
  }

  /** Idempotent: removing a picture when none is stored still succeeds. */
  removePicture(): Observable<void> {
    return this.http.delete<void>(this.url('/user/picture'));
  }

  /**
   * URL of the stored picture, or null when none is stored.
   *
   * The endpoint serves one stable URL and revalidates with an `ETag`, so
   * `pictureUpdatedAt` is carried as a query parameter: it changes the URL the
   * moment the picture is replaced, which is what makes the new image appear
   * without waiting for a conditional request to come back.
   */
  pictureUrl(profile: UserProfile | null): string | null {
    if (!profile?.hasPicture) {
      return null;
    }

    const version = profile.pictureUpdatedAt ?? profile.updatedAt;
    return this.url(`/user/picture?v=${encodeURIComponent(version)}`);
  }
}
