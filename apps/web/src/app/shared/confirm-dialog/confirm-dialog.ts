import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialog,
  MatDialogModule,
  MatDialogRef,
} from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';

export interface ConfirmDialogData {
  readonly title: string;
  readonly message: string;
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
  /** Styles the confirm button as destructive. Defaults to `true`. */
  readonly destructive?: boolean;
}

/**
 * Yes/no confirmation for an irreversible action.
 *
 * Cancel is the autofocused control so that a stray Enter dismisses the dialog
 * instead of deleting something.
 */
@Component({
  selector: 'app-confirm-dialog',
  imports: [MatButtonModule, MatDialogModule],
  template: `
    <h2 mat-dialog-title>{{ data.title }}</h2>

    <mat-dialog-content>
      <p class="message">{{ data.message }}</p>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button matButton cdkFocusInitial (click)="dialogRef.close(false)">
        {{ data.cancelLabel ?? 'Cancel' }}
      </button>
      <button
        matButton="filled"
        [class.destructive]="data.destructive !== false"
        (click)="dialogRef.close(true)"
      >
        {{ data.confirmLabel ?? 'Delete' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .message {
      margin: 0;
      max-width: 36rem;
      color: var(--mat-sys-on-surface-variant);
    }

    .destructive {
      --mat-button-filled-container-color: var(--mat-sys-error);
      --mat-button-filled-label-text-color: var(--mat-sys-on-error);
    }
  `,
})
export class ConfirmDialog {
  protected readonly dialogRef = inject<MatDialogRef<ConfirmDialog, boolean>>(MatDialogRef);
  protected readonly data = inject<ConfirmDialogData>(MAT_DIALOG_DATA);
}

/**
 * Opens a confirmation and resolves to whether the user confirmed.
 *
 * Takes the `MatDialog` from the caller so it can be used from a component
 * method without each feature re-implementing the open-and-await dance.
 */
export function confirm(dialog: MatDialog, data: ConfirmDialogData): Promise<boolean> {
  const ref = dialog.open<ConfirmDialog, ConfirmDialogData, boolean>(ConfirmDialog, {
    data,
    width: '28rem',
    autoFocus: 'dialog',
  });

  return firstValueFrom(ref.afterClosed()).then((result) => result === true);
}
