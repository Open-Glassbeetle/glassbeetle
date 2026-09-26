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
   */
  async onModuleInit(): Promise<void> {
    await this.ensureDirectories();
  }

  /**
   * Ensures that the storage root directory and all known bucket directories exist on disk.
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
   */
  async stream(reference: string): Promise<Readable> {
    return this.createReadStream(reference);
  }

  /**
   * Creates a filesystem read stream for a stored file.
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
   */
  async resolveAndVerify(reference: string): Promise<string> {
    return verifyStoragePathContainment(this.configuredRoot, reference);
  }
}

/**
 * Checks if a value is a readable stream.
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
