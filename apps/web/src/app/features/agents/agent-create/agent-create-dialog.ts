import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';

import type { Agent } from '../../../core/api/agents.models';
import { AgentsService } from '../../../core/api/agents.service';
import { NotificationService } from '../../../core/notifications/notification.service';

/**
 * Creates an agent from the one field the API requires.
 *
 * Everything else is configured on the agent's own page, which is where the
 * model, prompt, sampling settings and memories live. Asking for all of that
 * up front would be a long form in which only one field could be filled in
 * wrongly.
 */
@Component({
  selector: 'app-agent-create-dialog',
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
    <h2 mat-dialog-title>New agent</h2>

    @if (saving()) {
      <mat-progress-bar mode="indeterminate" />
    }

    <mat-dialog-content>
      <form class="form" [formGroup]="form" (ngSubmit)="create()">
        <mat-form-field class="form__field">
          <mat-label>Name</mat-label>
          <input matInput formControlName="name" placeholder="Research Assistant" cdkFocusInitial />
          <mat-hint> You can set the prompt, model and sampling options next. </mat-hint>
          @if (form.controls.name.hasError('required')) {
            <mat-error>A name is required.</mat-error>
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
export class AgentCreateDialog {
  private readonly agents = inject(AgentsService);
  private readonly notify = inject(NotificationService);
  private readonly formBuilder = inject(FormBuilder);

  protected readonly dialogRef = inject<MatDialogRef<AgentCreateDialog, Agent>>(MatDialogRef);

  protected readonly saving = signal(false);

  protected readonly form = this.formBuilder.nonNullable.group({
    name: ['', [Validators.required]],
  });

  protected create(): void {
    if (this.form.invalid || this.saving()) {
      this.form.markAllAsTouched();
      return;
    }

    this.saving.set(true);

    this.agents.create({ name: this.form.getRawValue().name.trim() }).subscribe({
      next: (agent) => {
        this.saving.set(false);
        this.notify.success(`“${agent.name}” created.`);
        this.dialogRef.close(agent);
      },
      error: (error: unknown) => {
        this.saving.set(false);
        this.notify.error(error, 'Could not create the agent.');
      },
    });
  }
}
