import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { Observable } from 'rxjs';

import {
  MEMORY_CONTENT_MAX_LENGTH,
  type CreateMemoryInput,
  type Memory,
  type UpdateMemoryInput,
} from '../../core/api/memories.models';
import { NotificationService } from '../../core/notifications/notification.service';
import { TagInput } from '../../shared/tag-input/tag-input';

/**
 * Data for the memory dialog.
 *
 * The caller supplies the write, because agent memories and shared memories
 * are the same resource at two different paths. Everything else about editing
 * them is identical, so the dialog is shared and only the request differs.
 */
export interface MemoryFormData {
  /** The memory being edited, or `null` to create one. */
  readonly memory: Memory | null;
  /** Shown as the dialog subtitle, e.g. the owning agent's name. */
  readonly scopeLabel: string;
  readonly create: (input: CreateMemoryInput) => Observable<Memory>;
  readonly update: (memoryId: string, input: UpdateMemoryInput) => Observable<Memory>;
}

@Component({
  selector: 'app-memory-form',
  imports: [
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
    ReactiveFormsModule,
    TagInput,
  ],
  templateUrl: './memory-form.html',
  styleUrl: './memory-form.scss',
})
export class MemoryForm {
  private readonly notify = inject(NotificationService);
  private readonly formBuilder = inject(FormBuilder);

  protected readonly dialogRef = inject<MatDialogRef<MemoryForm, Memory>>(MatDialogRef);
  protected readonly data = inject<MemoryFormData>(MAT_DIALOG_DATA);

  protected readonly maxLength = MEMORY_CONTENT_MAX_LENGTH;
  protected readonly editing = this.data.memory !== null;
  protected readonly saving = signal(false);

  protected readonly tags = signal<string[]>([...(this.data.memory?.tags ?? [])]);

  protected readonly form = this.formBuilder.nonNullable.group({
    content: [
      this.data.memory?.content ?? '',
      [Validators.required, Validators.maxLength(MEMORY_CONTENT_MAX_LENGTH)],
    ],
  });

  protected readonly contentLength = signal(this.data.memory?.content.length ?? 0);

  protected readonly title = computed(() => (this.editing ? 'Edit memory' : 'New memory'));

  protected onContentInput(value: string): void {
    this.contentLength.set(value.length);
  }

  protected save(): void {
    if (this.form.invalid || this.saving()) {
      this.form.markAllAsTouched();
      return;
    }

    const content = this.form.getRawValue().content;
    const tags = this.tags();
    const existing = this.data.memory;
    this.saving.set(true);

    const request = existing
      ? this.data.update(existing.id, {
          ...(content !== existing.content ? { content } : {}),
          // An empty array clears the tags, which is a real edit, so it is sent
          // whenever the set differs rather than only when it is non-empty.
          ...(sameTags(tags, existing.tags) ? {} : { tags }),
        })
      : this.data.create({
          content,
          ...(tags.length > 0 ? { tags } : {}),
        });

    request.subscribe({
      next: (memory) => {
        this.saving.set(false);
        this.notify.success(existing ? 'Memory saved.' : 'Memory added.');
        this.dialogRef.close(memory);
      },
      error: (error: unknown) => {
        this.saving.set(false);
        this.notify.error(error, 'Could not save the memory.');
      },
    });
  }
}

/** Order-insensitive comparison; tags are a set, not a sequence. */
function sameTags(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }

  const left = [...a].sort();
  const right = [...b].sort();

  return left.every((tag, index) => tag === right[index]);
}
