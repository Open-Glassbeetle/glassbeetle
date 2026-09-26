/**
 * Predefined concern buckets.
 *
 * Each bucket corresponds to a specific domain requirement:
 * - `pictures`: Agent profile pictures (referenced by `agents.picture_path`)
 * - `project-images`: Project cover images (referenced by `projects.image_path`)
 * - `artifacts`: Large or binary artifact blobs (referenced by `artifacts.file_path`)
 * - `backups`: Database and application backup archives (referenced by `backups.file_path`)
 */
export const KNOWN_STORAGE_BUCKETS = [
  'pictures',
  'project-images',
  'artifacts',
  'backups',
] as const;

export type KnownStorageBucket = (typeof KNOWN_STORAGE_BUCKETS)[number];

/**
 * Storage bucket identifier. Allows predefined buckets as well as custom namespaces.
 */
export type StorageBucket = KnownStorageBucket | (string & {});

/**
 * Result returned after writing a file to storage.
 */
export interface StoredFileResult {
  /**
   * Relative reference within the storage root, e.g. `pictures/018f3a9e-0000-7000-8000-000000000001.jpg`.
   * This POSIX-formatted relative reference is what must be stored in the database.
   */
  readonly reference: string;

  /** Total size of the stored file in bytes. */
  readonly size: number;

  /** Content type detected from the file's magic bytes. */
  readonly contentType: string;
}

/**
 * Metadata for a stored file returned by `stat`.
 */
export interface FileStat {
  /** Size in bytes. */
  readonly size: number;

  /** Content type detected from the file's magic bytes. */
  readonly contentType: string;

  /** Timestamp of last modification. */
  readonly modifiedAt: Date;

  /** Timestamp of file creation. */
  readonly createdAt: Date;
}

/**
 * Options for writing a file.
 */
export interface WriteFileOptions {
  /**
   * Maximum allowed file size in bytes.
   * If the payload exceeds this threshold, the write is aborted and rejected.
   */
  readonly maxBytes?: number;

  /**
   * Allowed MIME types (e.g. `['image/jpeg', 'image/png', 'image/webp']`).
   * Content type is detected from the file's actual bytes.
   * If the detected type is not in this list, the write is aborted and rejected.
   */
  readonly allowedMimeTypes?: readonly string[];
}

/**
 * Result of content type sniffing.
 */
export interface DetectedContentType {
  /** MIME type string, e.g. `image/png`, `application/pdf`, `application/octet-stream`. */
  readonly mime: string;

  /** Canonical file extension with leading dot, e.g. `.png`, `.pdf`, `.bin`. */
  readonly extension: string;
}

/**
 * Options for validating a buffer before or during write.
 */
export interface FileValidationOptions {
  /** Maximum allowed size in bytes. */
  readonly maxBytes?: number;

  /** Allowed MIME types. */
  readonly allowedMimeTypes?: readonly string[];
}
