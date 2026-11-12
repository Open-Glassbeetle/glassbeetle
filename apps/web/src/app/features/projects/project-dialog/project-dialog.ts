import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';

import {
  MAX_PROJECT_NAME_LENGTH,
  type Project,
  type UpdateProjectInput,
} from '../../../core/api/projects.models';
import { ProjectsService } from '../../../core/api/projects.service';
import { NotificationService } from '../../../core/notifications/notification.service';
import { ConversationsService } from '../../../core/workspace/conversations.service';

/** Present when the dialog edits a project rather than creating one. */
export interface ProjectDialogData {
  readonly project?: Project;
}

/**
 * Creates a project, or edits one's name and description.
 *
 * One dialog for both because they are the same two fields; an edit sends
 * only what changed, as every PATCH here does.
 */
@Component({
  selector: 'app-project-dialog',
  imports: [
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressBarModule,
    ReactiveFormsModule,
  ],
  template: `
    <h2 mat-dialog-title>{{ editing ? 'Edit project' : 'New project' }}</h2>

    @if (saving()) {
      <mat-progress-bar mode="indeterminate" />
    }

    <mat-dialog-content>
      <form class="form" [formGroup]="form" (ngSubmit)="save()">
        <mat-form-field class="form__field">
          <mat-label>Name</mat-label>
          <input matInput formControlName="name" cdkFocusInitial />
          @if (form.controls.name.hasError('required')) {
            <mat-error>A project needs a name.</mat-error>
          }
          @if (form.controls.name.hasError('maxlength')) {
            <mat-error>A name may be at most {{ maxNameLength }} characters.</mat-error>
          }
        </mat-form-field>

        <mat-form-field class="form__field">
          <mat-label>Description</mat-label>
          <textarea matInput formControlName="description" rows="3"></textarea>
          <mat-hint>Optional. What the work in this project is for.</mat-hint>
        </mat-form-field>
      </form>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button matButton [disabled]="saving()" (click)="dialogRef.close()">Cancel</button>
      <button matButton="filled" [disabled]="saving() || form.invalid" (click)="save()">
        {{ editing ? 'Save' : 'Create' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .form {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      padding-top: 0.5rem;
      min-width: min(26rem, 70vw);
    }

    .form__field {
      width: 100%;
    }
  `,
})
export class ProjectDialog {
  private readonly projects = inject(ProjectsService);
  private readonly conversations = inject(ConversationsService);
  private readonly notify = inject(NotificationService);
  private readonly formBuilder = inject(FormBuilder);

  protected readonly dialogRef = inject<MatDialogRef<ProjectDialog, Project>>(MatDialogRef);
  private readonly data = inject<ProjectDialogData | null>(MAT_DIALOG_DATA, { optional: true });

  private readonly project = this.data?.project ?? null;
  protected readonly editing = this.project !== null;
  protected readonly saving = signal(false);
  protected readonly maxNameLength = MAX_PROJECT_NAME_LENGTH;

  protected readonly form = this.formBuilder.nonNullable.group({
    name: [
      this.project?.name ?? '',
      [Validators.required, Validators.maxLength(MAX_PROJECT_NAME_LENGTH)],
    ],
    description: [this.project?.description ?? ''],
  });

  protected save(): void {
    if (this.form.invalid || this.saving()) {
      this.form.markAllAsTouched();
      return;
    }

    const raw = this.form.getRawValue();
    const name = raw.name.trim();
    const description = raw.description.trim() || null;

    if (!name) {
      this.form.controls.name.setErrors({ required: true });
      return;
    }

    const project = this.project;
    let request;

    if (project) {
      const changes: UpdateProjectInput = {
        ...(name !== project.name ? { name } : {}),
        ...(description !== (project.description ?? null) ? { description } : {}),
      };

      // Nothing changed, so there is nothing to send or to report.
      if (Object.keys(changes).length === 0) {
        this.dialogRef.close();
        return;
      }

      request = this.projects.update(project.id, changes);
    } else {
      // An absent description is left out: there is nothing to clear yet.
      request = this.projects.create({ name, ...(description ? { description } : {}) });
    }

    this.saving.set(true);

    request.subscribe({
      next: (saved) => {
        this.saving.set(false);
        this.conversations.refreshProjects();
        this.notify.success(project ? 'Project saved.' : 'Project created.');
        this.dialogRef.close(saved);
      },
      error: (error: unknown) => {
        this.saving.set(false);
        this.notify.error(
          error,
          project ? 'Could not save the project.' : 'Could not create the project.',
        );
      },
    });
  }
}
