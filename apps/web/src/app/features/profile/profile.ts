import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';

import { ACCEPTED_PICTURE_TYPES } from '../../core/api/agents.models';
import { toApiError, type ApiError } from '../../core/api/api-error';
import { MAX_ABOUT_LENGTH, type UpdateUserProfileInput } from '../../core/api/user.models';
import { UserService } from '../../core/api/user.service';
import { NotificationService } from '../../core/notifications/notification.service';
import { UserProfileService } from '../../core/workspace/user-profile.service';
import { confirm } from '../../shared/confirm-dialog/confirm-dialog';
import { RelativeTimePipe } from '../../shared/relative-time/relative-time.pipe';
import { Avatar } from '../../shared/ui/avatar';
import { Panel } from '../../shared/ui/panel';
import { Skeleton } from '../../shared/ui/skeleton';
import { MatDialog } from '@angular/material/dialog';
import { knownTimezones, localeValidator, timezoneValidator } from './intl.validators';

/**
 * The user's own profile.
 *
 * This is the one screen about the person rather than about the workspace, and
 * everything on it is local: there is no account, no sign-in and nothing to
 * recover. What it does carry is the material agents read — a name, pronouns
 * and free text — which is why the prompt-sharing switch states its
 * consequence here rather than hiding in a privacy page.
 */
@Component({
  selector: 'app-profile',
  imports: [
    Avatar,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatMenuModule,
    MatSlideToggleModule,
    MatTooltipModule,
    Panel,
    ReactiveFormsModule,
    RelativeTimePipe,
    Skeleton,
  ],
  templateUrl: './profile.html',
  styleUrl: './profile.scss',
})
export class Profile {
  private readonly api = inject(UserService);
  private readonly store = inject(UserProfileService);
  private readonly notify = inject(NotificationService);
  private readonly dialog = inject(MatDialog);
  private readonly formBuilder = inject(FormBuilder);

  protected readonly profile = this.store.profile;
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly uploading = signal(false);
  protected readonly error = signal<ApiError | null>(null);

  protected readonly maxAbout = MAX_ABOUT_LENGTH;
  protected readonly acceptedTypes = ACCEPTED_PICTURE_TYPES.join(',');
  protected readonly timezones = knownTimezones();

  /** What the machine reports, offered as a one-click fill. */
  private readonly machine = Intl.DateTimeFormat().resolvedOptions();

  protected readonly form = this.formBuilder.nonNullable.group({
    displayName: ['', [Validators.maxLength(120)]],
    pronouns: ['', [Validators.maxLength(60)]],
    about: ['', [Validators.maxLength(MAX_ABOUT_LENGTH)]],
    locale: ['', [localeValidator]],
    timezone: ['', [timezoneValidator]],
    includeInPrompts: [true],
  });

  protected readonly avatarName = this.store.displayName;
  protected readonly avatarUrl = this.store.pictureUrl;

  protected readonly aboutLength = signal(0);

  /** How the machine's own settings differ from what is stored, if at all. */
  protected readonly machineDiffers = computed(() => {
    const profile = this.profile();
    if (!profile) {
      return false;
    }

    return profile.locale !== this.machine.locale || profile.timezone !== this.machine.timeZone;
  });

  constructor() {
    this.load();

    this.form.controls.about.valueChanges.subscribe((value) => this.aboutLength.set(value.length));
  }

  protected load(): void {
    this.loading.set(true);
    this.error.set(null);

    this.api.get().subscribe({
      next: (profile) => {
        this.store.set(profile);
        this.reset();
        this.loading.set(false);
      },
      error: (error: unknown) => {
        this.error.set(toApiError(error));
        this.loading.set(false);
      },
    });
  }

  /** Refills the form from the stored profile, discarding unsaved edits. */
  protected reset(): void {
    const profile = this.profile();
    if (!profile) {
      return;
    }

    this.form.reset({
      displayName: profile.displayName ?? '',
      pronouns: profile.pronouns ?? '',
      about: profile.about ?? '',
      locale: profile.locale ?? '',
      timezone: profile.timezone ?? '',
      includeInPrompts: profile.includeInPrompts,
    });
    this.aboutLength.set(profile.about?.length ?? 0);
  }

  /** Fills the language and time zone fields from the machine's own settings. */
  protected useMachineSettings(): void {
    this.form.patchValue({
      locale: this.machine.locale,
      timezone: this.machine.timeZone,
    });
    this.form.markAsDirty();
  }

  protected save(): void {
    if (this.form.invalid || this.saving()) {
      this.form.markAllAsTouched();
      return;
    }

    const patch = this.buildPatch();

    if (Object.keys(patch).length === 0) {
      this.notify.success('Nothing to save.');
      return;
    }

    this.saving.set(true);

    this.api.update(patch).subscribe({
      next: (profile) => {
        this.saving.set(false);
        this.store.set(profile);
        this.form.markAsPristine();
        this.reset();
        this.notify.success('Profile saved.');
      },
      error: (error: unknown) => {
        this.saving.set(false);
        this.notify.error(error, 'Could not save the profile.');
      },
    });
  }

  /**
   * Builds the PATCH body.
   *
   * A field left as it was is omitted, so the API's "empty body is a no-op"
   * rule keeps `updatedAt` honest. A field the user emptied is sent as `null`,
   * which is what clears it — `''` would be stored as an empty string the API
   * then reports as set.
   */
  private buildPatch(): UpdateUserProfileInput {
    const value = this.form.getRawValue();
    const profile = this.profile();
    const patch: UpdateUserProfileInput = {};

    if (!profile) {
      return patch;
    }

    const text = (field: 'displayName' | 'pronouns' | 'about' | 'locale' | 'timezone'): void => {
      const next = value[field].trim() || null;
      if (next !== profile[field]) {
        patch[field] = next;
      }
    };

    text('displayName');
    text('pronouns');
    text('about');
    text('locale');
    text('timezone');

    if (value.includeInPrompts !== profile.includeInPrompts) {
      patch.includeInPrompts = value.includeInPrompts;
    }

    return patch;
  }

  /**
   * Uploads a picture.
   *
   * The type is checked here as well as on the server so an obviously wrong
   * file is rejected before it is read and sent; the server's check, which
   * reads the file's magic bytes, is the one that matters.
   */
  protected async onPictureSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    // Clearing lets the same file be chosen again after a failure.
    input.value = '';

    if (!file) {
      return;
    }

    if (!ACCEPTED_PICTURE_TYPES.includes(file.type)) {
      this.notify.error(null, 'Pictures must be JPEG, PNG, WebP or GIF. SVG is not accepted.');
      return;
    }

    this.uploading.set(true);

    try {
      this.store.set(await firstValueFrom(this.api.uploadPicture(file)));
      this.notify.success('Picture uploaded.');
    } catch (error) {
      this.notify.error(error, 'Could not upload the picture.');
    } finally {
      this.uploading.set(false);
    }
  }

  protected async removePicture(): Promise<void> {
    const profile = this.profile();
    if (!profile) {
      return;
    }

    const confirmed = await confirm(this.dialog, {
      title: 'Remove the picture?',
      message: 'The stored image is deleted from this machine.',
      confirmLabel: 'Remove',
      destructive: true,
    });

    if (!confirmed) {
      return;
    }

    this.uploading.set(true);

    try {
      await firstValueFrom(this.api.removePicture());
      this.store.set({ ...profile, hasPicture: false, pictureUpdatedAt: null });
      this.notify.success('Picture removed.');
    } catch (error) {
      this.notify.error(error, 'Could not remove the picture.');
    } finally {
      this.uploading.set(false);
    }
  }
}
