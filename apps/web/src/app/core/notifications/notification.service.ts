import { Injectable, inject } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';

import { describeApiError, toApiError } from '../api/api-error';

/**
 * Transient feedback for completed actions and failed requests.
 *
 * Errors stay on screen noticeably longer than confirmations and carry a
 * dismiss action: a failure the user misses leaves them believing a write
 * succeeded, whereas a missed "Saved" costs nothing.
 */
@Injectable({ providedIn: 'root' })
export class NotificationService {
  private readonly snackBar = inject(MatSnackBar);

  success(message: string): void {
    this.snackBar.open(message, undefined, { duration: 3000 });
  }

  /** Reports a failed request, preferring the API's validation details. */
  error(error: unknown, fallback = 'The request failed.'): void {
    const apiError = toApiError(error);
    const message = describeApiError(apiError) || fallback;

    this.snackBar.open(message, 'Dismiss', {
      duration: 8000,
      panelClass: 'gb-snackbar--error',
    });
  }
}
