import { COMMA, ENTER } from '@angular/cdk/keycodes';
import { Component, computed, input, model, signal } from '@angular/core';
import { MatChipInputEvent, MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';

/**
 * Chip editor for a memory's tags.
 *
 * The API rejects empty strings inside the array, so entries are trimmed and
 * blanks dropped before they reach the model. Duplicates are dropped too —
 * a tag is a set membership, and the same tag twice means nothing.
 */
@Component({
  selector: 'app-tag-input',
  imports: [MatChipsModule, MatFormFieldModule, MatIconModule],
  template: `
    <mat-form-field appearance="outline" class="field">
      <mat-label>{{ label() }}</mat-label>

      <mat-chip-grid #grid [attr.aria-label]="label()">
        @for (tag of tags(); track tag) {
          <mat-chip-row (removed)="remove(tag)">
            {{ tag }}
            <button matChipRemove [attr.aria-label]="'Remove tag ' + tag">
              <mat-icon>cancel</mat-icon>
            </button>
          </mat-chip-row>
        }

        <input
          [matChipInputFor]="grid"
          [matChipInputSeparatorKeyCodes]="separators"
          [placeholder]="tags().length ? '' : placeholder()"
          matChipInputAddOnBlur
          (matChipInputTokenEnd)="add($event)"
        />
      </mat-chip-grid>

      <mat-hint>{{ hint() }}</mat-hint>
    </mat-form-field>
  `,
  styles: `
    .field {
      width: 100%;
    }
  `,
})
export class TagInput {
  readonly tags = model<string[]>([]);
  readonly label = input('Tags');
  readonly placeholder = input('Add a tag and press Enter');
  readonly hint = input('Separate tags with Enter or a comma.');

  protected readonly separators = [ENTER, COMMA] as const;

  protected add(event: MatChipInputEvent): void {
    const value = event.value.trim();
    event.chipInput?.clear();

    if (!value || this.tags().includes(value)) {
      return;
    }

    this.tags.update((tags) => [...tags, value]);
  }

  protected remove(tag: string): void {
    this.tags.update((tags) => tags.filter((entry) => entry !== tag));
  }
}
