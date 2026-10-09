import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';

import { MAX_TEAM_NAME_LENGTH, type Team } from '../../../core/api/teams.models';
import { TeamsService } from '../../../core/api/teams.service';
import { NotificationService } from '../../../core/notifications/notification.service';

/**
 * Creates a team from the one field the API requires.
 *
 * The roster is assembled on the team's own page. Picking agents here would
 * mean a create form that can fail halfway — the team made, the agents not —
 * and the page you land on is where you would adjust the order anyway.
 */
@Component({
  selector: 'app-team-create-dialog',
  imports: [
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
    ReactiveFormsModule,
  ],
  template: `
    <h2 mat-dialog-title>New team</h2>

    @if (saving()) {
      <mat-progress-bar mode="indeterminate" />
    }

    <mat-dialog-content>
      <form class="form" [formGroup]="form" (ngSubmit)="create()">
        <mat-form-field class="form__field">
          <mat-label>Name</mat-label>
          <input matInput formControlName="name" placeholder="Research Desk" cdkFocusInitial />
          <mat-hint>You can add agents and set their order next.</mat-hint>
          @if (form.controls.name.hasError('required')) {
            <mat-error>A name is required.</mat-error>
          }
          @if (form.controls.name.hasError('maxlength')) {
            <mat-error>A name may be at most {{ maxNameLength }} characters.</mat-error>
          }
        </mat-form-field>
      </form>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button matButton [disabled]="saving()" (click)="dialogRef.close()">Cancel</button>
      <button matButton="filled" [disabled]="saving() || form.invalid" (click)="create()">
        <mat-icon>add</mat-icon>
        Create
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .form {
      padding-top: 0.5rem;
      min-width: min(26rem, 70vw);
    }

    .form__field {
      width: 100%;
    }
  `,
})
export class TeamCreateDialog {
  private readonly teams = inject(TeamsService);
  private readonly notify = inject(NotificationService);
  private readonly formBuilder = inject(FormBuilder);

  protected readonly dialogRef = inject<MatDialogRef<TeamCreateDialog, Team>>(MatDialogRef);

  protected readonly saving = signal(false);
  protected readonly maxNameLength = MAX_TEAM_NAME_LENGTH;

  protected readonly form = this.formBuilder.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(MAX_TEAM_NAME_LENGTH)]],
  });

  protected create(): void {
    if (this.form.invalid || this.saving()) {
      this.form.markAllAsTouched();
      return;
    }

    this.saving.set(true);

    this.teams.create({ name: this.form.getRawValue().name.trim() }).subscribe({
      next: (team) => {
        this.saving.set(false);
        this.notify.success(`“${team.name}” created.`);
        this.dialogRef.close(team);
      },
      error: (error: unknown) => {
        this.saving.set(false);
        this.notify.error(error, 'Could not create the team.');
      },
    });
  }
}
