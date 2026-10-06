import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';

import { NotificationService } from '../../core/notifications/notification.service';
import { SystemPromptsService } from '../../core/api/system-prompts.service';
import type { SystemPrompt } from '../../core/api/system-prompts.models';

export interface SystemPromptFormData {
  /** The prompt being edited. Absent or `null` opens the dialog in create mode. */
  readonly prompt?: SystemPrompt | null;

  /**
   * Values to seed a *new* prompt with, used by "Duplicate". Kept separate from
   * `prompt` so a seeded dialog still creates a row instead of patching the one
   * it was copied from.
   */
  readonly prefill?: { readonly name: string; readonly content: string };
}

/**
 * Create / edit dialog for a system prompt.
 *
 * On edit it sends only the fields the user actually changed: the API treats an
 * empty PATCH body as a no-op and leaves `updatedAt` alone, so an unchanged
 * save does not bump the timestamp.
 */
@Component({
  selector: 'app-system-prompt-form',
  imports: [
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
    ReactiveFormsModule,
  ],
  templateUrl: './system-prompt-form.html',
  styleUrl: './system-prompt-form.scss',
})
export class SystemPromptForm {
  private readonly prompts = inject(SystemPromptsService);
  private readonly notify = inject(NotificationService);
  private readonly formBuilder = inject(FormBuilder);

  protected readonly dialogRef = inject<MatDialogRef<SystemPromptForm, SystemPrompt>>(MatDialogRef);
  protected readonly data = inject<SystemPromptFormData>(MAT_DIALOG_DATA);

  /** The row to PATCH, or `null` when this dialog creates one. */
  private readonly existing = this.data.prompt ?? null;

  protected readonly editing = this.existing !== null;
  protected readonly saving = signal(false);

  private readonly initial = this.existing ?? this.data.prefill ?? null;

  protected readonly form = this.formBuilder.nonNullable.group({
    name: [this.initial?.name ?? '', [Validators.required]],
    content: [this.initial?.content ?? '', [Validators.required]],
  });

  protected readonly contentLength = signal(this.initial?.content.length ?? 0);

  protected readonly title = computed(() =>
    this.editing ? 'Edit system prompt' : 'New system prompt',
  );

  protected onContentInput(value: string): void {
    this.contentLength.set(value.length);
  }

  protected save(): void {
    if (this.form.invalid || this.saving()) {
      this.form.markAllAsTouched();
      return;
    }

    const { name, content } = this.form.getRawValue();
    const existing = this.existing;
    this.saving.set(true);

    const request = existing
      ? this.prompts.update(existing.id, {
          ...(name !== existing.name ? { name: name.trim() } : {}),
          ...(content !== existing.content ? { content } : {}),
        })
      : this.prompts.create({ name: name.trim(), content });

    request.subscribe({
      next: (prompt) => {
        this.saving.set(false);
        this.notify.success(existing ? 'System prompt saved.' : 'System prompt created.');
        this.dialogRef.close(prompt);
      },
      error: (error: unknown) => {
        this.saving.set(false);
        this.notify.error(error, 'Could not save the system prompt.');
      },
    });
  }
}
