import { createReadStream, createWriteStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import {
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service.js';
import { resolveDefaultDataDir } from '../config/data-dir.js';
import { newId } from '../common/persistence/identifiers.js';
import { detectContentType, validateFile } from './content-type.js';
import {
  FileNotFoundError,
  FilePayloadTooLargeError,
  InvalidPathError,
} from './file-storage.errors.js';
import {
  KNOWN_STORAGE_BUCKETS,
  type DetectedContentType,
  type FileStat,
  type FileValidationOptions,
  type StorageBucket,
  type StoredFileResult,
  type WriteFileOptions,
} from './file-storage.types.js';
import { verifyStoragePathContainment } from './path-safety.js';

/**
 * Injection token for overriding the file storage root directory in tests or custom setups.
 *
 * Takes precedence over configuration and the environment, so an integration
 * test can point storage at a temporary directory and leave the user's own
 * files untouched.
 */
export const FILE_STORAGE_ROOT_OVERRIDE = 'FILE_STORAGE_ROOT_OVERRIDE';

/**
 * Single, safe abstraction for reading, writing, streaming, stating, and deleting
 * user files and blobs on disk.
 *
 * ## Stored References & Database Conventions
 * Stored paths returned by `write` are always POSIX-formatted relative references
 * (e.g. `pictures/018f3a9e-0000-7000-8000-000000000001.jpg`), never absolute filesystem paths.
 *
 * **Why relative references?**
 * 1. Portability: When the user moves their data directory or restores a backup on another machine,
 *    stored references remain valid.
 * 2. Privacy & Security: Absolute paths leak the local machine's filesystem layout (e.g. `/Users/username/...`)
 *    into database records and potentially API responses.
 *
 * ## Orphaned Files Lifecycle Note
 * Database operations such as `ON DELETE CASCADE` or `ON DELETE SET NULL` clean up database rows
 * but do not trigger filesystem unlinks. Application services / deletion endpoints are expected to
 * invoke `fileStorageService.delete(reference)` when removing entities with associated stored files.
 */
@Injectable()
export class FileStorageService implements OnModuleInit {
  private readonly logger = new Logger(FileStorageService.name);
  private readonly configuredRoot: string;

  /**
   * Resolves the storage root, in order of precedence.
   *
   * An injected {@link FILE_STORAGE_ROOT_OVERRIDE}, then
   * `GLASSBEETLE_STORAGE_ROOT`, then a `storage` directory below the configured
   * data directory, then the same below the per-user default. The result is
   * always absolute, since every containment check resolves against it.
   *
   * No directory is created here; see {@link onModuleInit}.
   */
  constructor(
    @Optional() private readonly appConfigService?: AppConfigService,
    @Optional()
    @Inject(FILE_STORAGE_ROOT_OVERRIDE)
    storageRootOverride?: string,
  ) {
    if (storageRootOverride) {
      this.configuredRoot = path.resolve(storageRootOverride);
    } else if (process.env.GLASSBEETLE_STORAGE_ROOT?.trim()) {
      this.configuredRoot = path.resolve(
        process.env.GLASSBEETLE_STORAGE_ROOT.trim(),
      );
    } else if (this.appConfigService?.dataDir) {
      this.configuredRoot = path.resolve(
        this.appConfigService.dataDir,
        'storage',
      );
    } else {
      this.configuredRoot = path.resolve(resolveDefaultDataDir(), 'storage');
    }
  }

  /**
   * Root directory on disk where all storage buckets and files reside.
   */
  get storageRoot(): string {
    return this.configuredRoot;
  }

  /**
   * Lifecycle hook to initialize storage root and predefined bucket directories on startup.
   *
   * Created eagerly so that a first upload does not also have to be the thing
   * that discovers the data directory is not writable.
   */
  async onModuleInit(): Promise<void> {
    await this.ensureDirectories();
  }

  /**
   * Ensures that the storage root directory and all known bucket directories exist on disk.
   *
   * Idempotent, since every `mkdir` is recursive.
   *
   * @param buckets - Bucket directories to create; defaults to
   * {@link KNOWN_STORAGE_BUCKETS}.
   */
  async ensureDirectories(
    buckets: readonly string[] = KNOWN_STORAGE_BUCKETS,
  ): Promise<void> {
    await fs.mkdir(this.configuredRoot, { recursive: true });

    for (const bucket of buckets) {
      const bucketPath = path.join(this.configuredRoot, bucket);
      await fs.mkdir(bucketPath, { recursive: true });
    }
  }

  /**
   * Validates a bucket name to prevent directory traversal or separator injection.
   *
   * A bucket is one path segment, so any separator, `..`, or null byte is
   * rejected outright rather than normalised. {@link StorageBucket} permits an
   * arbitrary name, and this is what keeps that from becoming a way to write
   * outside the storage root.
   *
   * @returns The trimmed bucket name.
   * @throws InvalidPathError (400) when the name is empty or not a single safe
   * segment.
   */
  private assertValidBucket(bucket: string): string {
    if (typeof bucket !== 'string' || bucket.trim().length === 0) {
      throw new InvalidPathError('Bucket name must be a non-empty string');
    }

    const trimmed = bucket.trim();
    if (
      trimmed.includes('/') ||
      trimmed.includes('\\') ||
      trimmed.includes('..') ||
      trimmed.includes('\0')
    ) {
      throw new InvalidPathError(`Invalid bucket name: "${bucket}"`);
    }

    return trimmed;
  }

  /**
   * Writes content (Buffer, Uint8Array, string, or Readable stream) to a storage bucket.
   *
   * Stored filenames are generated internally using UUIDv7 + canonical extension derived
   * from detected content bytes. Client-supplied filenames are never used for disk paths.
   *
   * Writes are atomic: content is written to a temporary file in the same directory and renamed.
   *
   * Generating the name rather than reusing the client's removes a whole class
   * of problem at once — traversal in a filename, a collision overwriting
   * someone else's file, a case-insensitive filesystem merging two names, and a
   * misleading extension. The rename is within one directory, so it is atomic
   * on every supported platform: a reader sees either no file or the complete
   * one, never a partial write.
   *
   * @param bucket - Target bucket; created if absent.
   * @param options - Size ceiling and allowed MIME types, both checked against
   * the actual bytes.
   * @returns The relative reference to store in the database, the size written,
   * and the detected content type.
   * @throws InvalidPathError (400) when the bucket name is unsafe.
   * @throws FilePayloadTooLargeError (413) when the content exceeds
   * `options.maxBytes`.
   * @throws UnsupportedMediaTypeError (415) when the detected type is not
   * allowed. No file is left behind in either case.
   */
  async write(
    bucket: StorageBucket,
    content: Buffer | Uint8Array | NodeJS.ReadableStream | string,
    options?: WriteFileOptions,
  ): Promise<StoredFileResult> {
    const validBucket = this.assertValidBucket(bucket);
    const bucketDir = path.join(this.configuredRoot, validBucket);

    await fs.mkdir(bucketDir, { recursive: true });

    if (isReadableStream(content)) {
      return this.writeStreamInternal(validBucket, bucketDir, content, options);
    }

    let buffer: Buffer;
    if (typeof content === 'string') {
      buffer = Buffer.from(content, 'utf-8');
    } else if (Buffer.isBuffer(content)) {
      buffer = content;
    } else {
      buffer = Buffer.from(
        content.buffer,
        content.byteOffset,
        content.byteLength,
      );
    }

    // Validate size and detect MIME type from actual bytes
    const detected = validateFile(buffer, {
      maxBytes: options?.maxBytes,
      allowedMimeTypes: options?.allowedMimeTypes,
    });

    const fileId = newId();
    const fileName = `${fileId}${detected.extension}`;
    const targetPath = path.join(bucketDir, fileName);
    const tempPath = path.join(bucketDir, `.tmp-${fileId}`);

    // Atomic write via temp file + rename
    try {
      await fs.writeFile(tempPath, buffer);
      await fs.rename(tempPath, targetPath);
    } catch (err) {
      await fs.unlink(tempPath).catch(() => {});
      throw err;
    }

    const relativeReference = `${validBucket}/${fileName}`;

    return {
      reference: relativeReference,
      size: buffer.length,
      contentType: detected.mime,
    };
  }

  /**
   * Internal implementation for writing streaming input with size and MIME validation.
   *
   * A stream cannot be inspected before it is consumed, so this writes to the
   * temporary file while it checks: the running total is compared against
   * `maxBytes` on every chunk and the stream is destroyed the moment it is
   * exceeded, which is what keeps an oversized upload from being buffered or
   * fully written. The first 4 KiB are kept aside for content-type detection,
   * which is all the signatures need.
   *
   * Backpressure is honoured by pausing the source until the write stream
   * drains, so a large file does not accumulate in memory.
   *
   * The temporary file is removed on every failure path, and the rename into
   * place happens only once size and type have both passed.
   */
  private async writeStreamInternal(
    bucket: string,
    bucketDir: string,
    stream: NodeJS.ReadableStream,
    options?: WriteFileOptions,
  ): Promise<StoredFileResult> {
    const fileId = newId();
    const tempPath = path.join(bucketDir, `.tmp-${fileId}`);

    const writeStream = createWriteStream(tempPath);
    const initialChunks: Buffer[] = [];
    let initialBytesCount = 0;
    let totalBytes = 0;
    const maxHeaderBytes = 4096;

    const readable =
      stream instanceof Readable ? stream : Readable.from(stream);

    const cleanupTemp = async () => {
      await fs.unlink(tempPath).catch(() => {});
    };

    try {
      await new Promise<void>((resolve, reject) => {
        writeStream.on('error', (err) => {
          reject(err);
        });

        readable.on('data', (chunk: Buffer | Uint8Array | string) => {
          const buf = Buffer.isBuffer(chunk)
            ? chunk
            : typeof chunk === 'string'
              ? Buffer.from(chunk)
              : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);

          totalBytes += buf.length;

          if (
            options?.maxBytes !== undefined &&
            totalBytes > options.maxBytes
          ) {
            readable.destroy();
            writeStream.destroy();
            reject(new FilePayloadTooLargeError(options.maxBytes, totalBytes));
            return;
          }

          if (initialBytesCount < maxHeaderBytes) {
            const needed = maxHeaderBytes - initialBytesCount;
            const slice = buf.subarray(0, needed);
            initialChunks.push(slice);
            initialBytesCount += slice.length;
          }

          if (!writeStream.write(buf)) {
            readable.pause();
            writeStream.once('drain', () => readable.resume());
          }
        });

        readable.on('end', () => {
          writeStream.end();
        });

        readable.on('error', (err) => {
          writeStream.destroy();
          reject(err);
        });

        writeStream.on('finish', () => {
          resolve();
        });
      });
    } catch (err) {
      await cleanupTemp();
      throw err;
    }

    const headerBuffer = Buffer.concat(initialChunks);
    const detected = detectContentType(headerBuffer);

    // Validate allowed MIME types
    if (options?.allowedMimeTypes && options.allowedMimeTypes.length > 0) {
      try {
        validateFile(headerBuffer, {
          allowedMimeTypes: options.allowedMimeTypes,
        });
      } catch (err) {
        await cleanupTemp();
        throw err;
      }
    }

    const fileName = `${fileId}${detected.extension}`;
    const targetPath = path.join(bucketDir, fileName);

    try {
      await fs.rename(tempPath, targetPath);
    } catch (err) {
      await cleanupTemp();
      throw err;
    }

    const relativeReference = `${bucket}/${fileName}`;

    return {
      reference: relativeReference,
      size: totalBytes,
      contentType: detected.mime,
    };
  }

  /**
   * Reads an entire stored file into memory as a Buffer.
   *
   * For files of known, modest size. Use {@link createReadStream} for artifacts
   * and backup archives.
   *
   * @throws InvalidPathError (400) when the reference is unsafe or escapes the
   * storage root.
   * @throws FileNotFoundError (404) when nothing is stored there, or the
   * reference names a directory.
   */
  async read(reference: string): Promise<Buffer> {
    const resolvedPath = await this.resolveAndVerify(reference);

    try {
      const stat = await fs.stat(resolvedPath);
      if (stat.isDirectory()) {
        throw new FileNotFoundError(reference);
      }
      return await fs.readFile(resolvedPath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new FileNotFoundError(reference);
      }
      throw err;
    }
  }

  /**
   * Streams a stored file from disk as a Readable stream.
   *
   * Recommended for large files (artifacts, backup archives) to avoid loading whole files into memory.
   *
   * @see createReadStream, which this delegates to; the two differ only in
   * their declared return type.
   */
  async stream(reference: string): Promise<Readable> {
    return this.createReadStream(reference);
  }

  /**
   * Creates a filesystem read stream for a stored file.
   *
   * Existence is checked before the stream is created, so a missing file
   * produces a 404 the exception filter can turn into the usual envelope rather
   * than an error event on a response that has already started streaming.
   *
   * @throws InvalidPathError (400) when the reference is unsafe or escapes the
   * storage root.
   * @throws FileNotFoundError (404) when nothing is stored there, or the
   * reference names a directory.
   */
  async createReadStream(
    reference: string,
  ): Promise<ReturnType<typeof createReadStream>> {
    const resolvedPath = await this.resolveAndVerify(reference);

    try {
      const stat = await fs.stat(resolvedPath);
      if (stat.isDirectory()) {
        throw new FileNotFoundError(reference);
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new FileNotFoundError(reference);
      }
      throw err;
    }

    return createReadStream(resolvedPath);
  }

  /**
   * Returns metadata for a stored file: size, detected content type, and timestamps.
   *
   * The content type is detected from the file's first 4 KiB rather than from
   * its extension, so it describes what the file is even if it was renamed on
   * disk. A failure to read the header is not fatal: detection then falls back
   * to `application/octet-stream`.
   *
   * `createdAt` comes from `birthtime`, which not every filesystem records; it
   * can equal the modification time.
   *
   * @throws InvalidPathError (400) when the reference is unsafe or escapes the
   * storage root.
   * @throws FileNotFoundError (404) when nothing is stored there, or the
   * reference names a directory.
   */
  async stat(reference: string): Promise<FileStat> {
    const resolvedPath = await this.resolveAndVerify(reference);

    let statResult;
    try {
      statResult = await fs.stat(resolvedPath);
      if (statResult.isDirectory()) {
        throw new FileNotFoundError(reference);
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new FileNotFoundError(reference);
      }
      throw err;
    }

    // Read header to detect MIME type from actual bytes
    let header = Buffer.alloc(0);
    try {
      const handle = await fs.open(resolvedPath, 'r');
      try {
        const buf = Buffer.alloc(Math.min(statResult.size, 4096));
        const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
        header = buf.subarray(0, bytesRead);
      } finally {
        await handle.close();
      }
    } catch {
      // Fallback
    }

    const detected = detectContentType(header);

    return {
      size: statResult.size,
      contentType: detected.mime,
      modifiedAt: statResult.mtime,
      createdAt: statResult.birthtime,
    };
  }

  /**
   * Deletes a stored file.
   *
   * Deleting an already-missing file is treated as a success and returns silently.
   * Path containment is still enforced; traversal attempts will be rejected.
   *
   * Tolerating a missing file matters because deletion is a cleanup step after
   * the database row is gone: failing here would report an error for a request
   * that has already succeeded, and callers log rather than propagate.
   *
   * @throws InvalidPathError (400) when the reference is unsafe, escapes the
   * storage root, or names a directory.
   */
  async delete(reference: string): Promise<void> {
    const resolvedPath = await this.resolveAndVerify(reference);

    try {
      const stat = await fs.stat(resolvedPath);
      if (stat.isDirectory()) {
        throw new InvalidPathError(
          `Cannot delete directory as a file: "${reference}"`,
        );
      }
      await fs.unlink(resolvedPath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return;
      }
      throw err;
    }
  }

  /**
   * Checks whether a stored file exists.
   *
   * @returns `true` only for a regular file; a directory at that reference
   * reports `false`.
   * @throws InvalidPathError (400) when the reference is unsafe or escapes the
   * storage root.
   */
  async exists(reference: string): Promise<boolean> {
    const resolvedPath = await this.resolveAndVerify(reference);

    try {
      const stat = await fs.stat(resolvedPath);
      return stat.isFile();
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return false;
      }
      throw err;
    }
  }

  /**
   * Validates a byte buffer against caller-specified size and MIME constraints.
   *
   * Exposed so a caller that validates without writing — rejecting an upload
   * before any other work — does not have to import the helper itself.
   *
   * @see validateFile for the exceptions this raises.
   */
  validate(
    data: Buffer | Uint8Array,
    options?: FileValidationOptions,
  ): DetectedContentType {
    return validateFile(data, options);
  }

  /**
   * Sniffs the content type of a byte buffer.
   */
  detectContentType(data: Buffer | Uint8Array): DetectedContentType {
    return detectContentType(data);
  }

  /**
   * Resolves a relative reference to an absolute path and verifies containment.
   *
   * Every read, write, stat and delete goes through this, which is the single
   * point at which a reference out of the database or a request is checked
   * against the storage root.
   *
   * @throws InvalidPathError (400) when the reference is unsafe, escapes the
   * root, or passes through a symlink that leaves it.
   */
  async resolveAndVerify(reference: string): Promise<string> {
    return verifyStoragePathContainment(this.configuredRoot, reference);
  }
}

/**
 * Checks if a value is a readable stream.
 *
 * Duck-typed on `pipe` or async iteration rather than on `instanceof Readable`,
 * so a stream from another realm or a plain async iterable is recognised too.
 * Buffers and typed arrays are excluded explicitly, so that a future change to
 * either predicate cannot start routing in-memory content down the streaming
 * path.
 */
function isReadableStream(value: unknown): value is NodeJS.ReadableStream {
  return (
    typeof value === 'object' &&
    value !== null &&
    (typeof (value as any).pipe === 'function' ||
      typeof (value as any)[Symbol.asyncIterator] === 'function') &&
    !Buffer.isBuffer(value) &&
    !(value instanceof Uint8Array)
  );
}
