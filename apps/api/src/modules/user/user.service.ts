import {
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import type { Readable } from 'node:stream';
import { newId } from '../../common/persistence/identifiers.js';
import { nowIso } from '../../common/persistence/timestamps.js';
import { AppConfigService } from '../../config/app-config.service.js';
import { DEFAULT_MAX_PICTURE_SIZE_BYTES } from '../../config/app.config.js';
import { DatabaseService } from '../../database/database.service.js';
import { FileNotFoundError } from '../../file-storage/file-storage.errors.js';
import { FileStorageService } from '../../file-storage/file-storage.service.js';
import {
  ALLOWED_PICTURE_MIME_TYPES,
  assertUploadablePicture,
} from '../../file-storage/picture-uploads.js';
import type { UpdateUserProfileDto } from './dto/update-user-profile.dto.js';
import type { UserProfileResponseDto } from './dto/user-profile-response.dto.js';
import {
  applyUserProfileUpdates,
  mapUserProfileRowToResponse,
  type UserProfileRow,
} from './dto/user-profile.mapper.js';
import { resolveUserProfileSeed } from './user-profile.seed.js';

/**
 * A stored profile picture, ready to be served.
 *
 * The stream is behind `open()` so a conditional request can be answered from
 * the metadata alone, without opening a file descriptor for bytes that will
 * never be written to the response.
 */
export interface StoredProfilePicture {
  /** Content type detected from the file's own bytes. */
  readonly contentType: string;
  /** Size in bytes. */
  readonly size: number;
  /** Strong entity tag, including its quotes. */
  readonly etag: string;
  /** Opens the file for reading. */
  readonly open: () => Promise<Readable>;
}

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(
    private readonly db: DatabaseService,
    @Optional() private readonly fileStorage?: FileStorageService,
    @Optional() private readonly appConfigService?: AppConfigService,
  ) {}

  /**
   * Reads the profile, creating it on first access.
   */
  async find(): Promise<UserProfileResponseDto> {
    return mapUserProfileRowToResponse(this.readRow());
  }

  /**
   * Applies a partial update to the profile.
   *
   * An empty body is an idempotent no-op: the response is the unchanged profile
   * and `updated_at` is left alone, so a client that saves a form it did not
   * edit does not make the profile look freshly touched.
   */
  async update(dto: UpdateUserProfileDto): Promise<UserProfileResponseDto> {
    const existing = this.readRow();
    const result = applyUserProfileUpdates(existing, dto);

    if (!result.hasChanges) {
      return mapUserProfileRowToResponse(existing);
    }

    this.db.run(
      `UPDATE user_profile SET ${result.setClauses.join(', ')} WHERE id = ?`,
      [...result.setParams, existing.id],
    );

    return mapUserProfileRowToResponse(result.updatedRow);
  }

  /**
   * Stores a new profile picture, replacing and deleting any previous one.
   */
  async uploadPicture(
    file: Express.Multer.File | undefined,
  ): Promise<UserProfileResponseDto> {
    const maxBytes =
      this.appConfigService?.maxPictureSizeBytes ??
      DEFAULT_MAX_PICTURE_SIZE_BYTES;

    assertUploadablePicture(file, maxBytes);

    if (!this.fileStorage) {
      throw new Error('FileStorageService is required for picture uploads');
    }

    const existing = this.readRow();

    // The filename is generated from a UUIDv7 and an extension derived from the
    // verified magic bytes; nothing the client sent names the stored file.
    const stored = await this.fileStorage.write(
      'pictures',
      (file as Express.Multer.File).buffer,
      { maxBytes, allowedMimeTypes: ALLOWED_PICTURE_MIME_TYPES },
    );

    const now = nowIso();

    this.db.run(
      `UPDATE user_profile
          SET picture_path = ?, picture_updated_at = ?, updated_at = ?
        WHERE id = ?`,
      [stored.reference, now, now, existing.id],
    );

    if (existing.picture_path) {
      await this.discardFile(existing.picture_path);
    }

    return mapUserProfileRowToResponse({
      ...existing,
      picture_path: stored.reference,
      picture_updated_at: now,
      updated_at: now,
    });
  }

  /**
   * Describes the stored profile picture and offers a reader for its bytes.
   *
   * A row that names a file the storage root no longer holds reports the same
   * `404` as a profile with no picture at all. A restored database whose files
   * did not come along is a state the user can see and fix; it is not an
   * internal error.
   */
  async openPicture(): Promise<StoredProfilePicture> {
    const row = this.readRow();

    if (!row.picture_path) {
      throw this.pictureNotFound();
    }

    if (!this.fileStorage) {
      throw new Error('FileStorageService is required to serve pictures');
    }

    const reference = row.picture_path;
    const fileStorage = this.fileStorage;

    try {
      const stat = await fileStorage.stat(reference);

      return {
        contentType: stat.contentType,
        size: stat.size,
        // The picture is replaced in place at a stable URL, so the validator
        // has to change when the bytes do. `picture_updated_at` is exactly
        // when they last did; the size guards against a same-millisecond
        // replacement.
        etag: `"${row.picture_updated_at ?? row.updated_at}-${stat.size}"`,
        open: () => fileStorage.createReadStream(reference),
      };
    } catch (err) {
      if (err instanceof FileNotFoundError) {
        this.logger.warn(
          'The user profile names a picture that is no longer in storage',
        );
        throw this.pictureNotFound();
      }
      throw err;
    }
  }

  /**
   * Removes the profile picture and deletes the stored file.
   *
   * Idempotent: a profile with no picture succeeds without error.
   */
  async deletePicture(): Promise<void> {
    const existing = this.readRow();

    if (!existing.picture_path) {
      return;
    }

    const now = nowIso();
    this.db.run(
      `UPDATE user_profile
          SET picture_path = NULL, picture_updated_at = NULL, updated_at = ?
        WHERE id = ?`,
      [now, existing.id],
    );

    await this.discardFile(existing.picture_path);
  }

  /**
   * Reads the single profile row, creating it if the database has none yet.
   *
   * There is no sign-up, so there is no state in which the application holds
   * data but no user, and no endpoint has to answer `404` for the person using
   * it. The insert and the read share one transaction, and `ON CONFLICT` makes
   * the insert a no-op for whichever of two concurrent first requests arrives
   * second — a desktop app issues those routinely, since the shell and the
   * first screen load at once.
   */
  private readRow(): UserProfileRow {
    return this.db.transaction(() => {
      const seed = resolveUserProfileSeed(
        this.appConfigService?.defaultUserName,
      );
      const now = nowIso();

      this.db.run(
        `INSERT INTO user_profile
           (id, singleton, display_name, locale, timezone, created_at, updated_at)
         VALUES (?, 1, ?, ?, ?, ?, ?)
         ON CONFLICT (singleton) DO NOTHING`,
        [newId(), seed.displayName, seed.locale, seed.timezone, now, now],
      );

      const row = this.db.get<UserProfileRow>(
        'SELECT * FROM user_profile WHERE singleton = 1',
      );

      if (!row) {
        // Unreachable: the insert above either wrote this row or found it.
        throw new Error('The user profile could not be provisioned');
      }

      return row;
    });
  }

  /**
   * Deletes a stored file, logging rather than failing the request.
   *
   * The database no longer points at it, so the user's view is already correct;
   * an undeletable file is an orphan to clean up, not a reason to report that
   * removing a picture failed.
   */
  private async discardFile(reference: string): Promise<void> {
    if (!this.fileStorage) {
      return;
    }

    try {
      await this.fileStorage.delete(reference);
    } catch (err) {
      this.logger.warn(
        `Failed to delete the previous profile picture file: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private pictureNotFound(): NotFoundException {
    return new NotFoundException({
      code: 'PICTURE_NOT_FOUND',
      message: 'No profile picture is stored',
    });
  }
}
