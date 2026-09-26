import { promises as fs } from 'node:fs';
import path from 'node:path';
import { InvalidPathError } from './file-storage.errors.js';

/**
 * Validates that a reference is a safe, non-empty, relative string without null bytes
 * or path-traversal escapes.
 */
export function assertSafeReference(reference: unknown): string {
  if (typeof reference !== 'string' || reference.trim().length === 0) {
    throw new InvalidPathError('Storage reference must be a non-empty string');
  }

  // Reject embedded null bytes
  if (reference.includes('\0') || reference.includes('%00')) {
    throw new InvalidPathError('Storage reference must not contain null bytes');
  }

  // Attempt URL decoding to catch encoded traversal (e.g., %2e%2e%2f)
  let decodedRef = reference;
  try {
    decodedRef = decodeURIComponent(reference);
  } catch {
    throw new InvalidPathError(
      'Storage reference contains malformed URL encoding',
    );
  }

  if (decodedRef.includes('\0')) {
    throw new InvalidPathError('Storage reference must not contain null bytes');
  }

  // Reject absolute paths across platforms (POSIX slashes, Windows backslashes, drive letters, UNC paths)
  if (
    decodedRef.startsWith('/') ||
    decodedRef.startsWith('\\') ||
    decodedRef.startsWith('//') ||
    decodedRef.startsWith('\\\\') ||
    /^[a-zA-Z]:[/\\]/.test(decodedRef) ||
    /^[a-zA-Z]:$/.test(decodedRef)
  ) {
    throw new InvalidPathError(
      `Storage reference must be relative to storage root, received absolute path: "${reference}"`,
    );
  }

  return decodedRef;
}

/**
 * Resolves a storage reference against the storage root and syntactically asserts
 * that the resulting path is strictly contained within the root.
 *
 * Prevents directory traversal sequences (`../`, `..\`), sibling directory prefix attacks
 * (`/storage-evil` vs `/storage`), and root escapes.
 */
export function resolveStoragePath(
  storageRoot: string,
  reference: string,
  options?: { allowRoot?: boolean },
): string {
  const decodedRef = assertSafeReference(reference);

  const normalizedRoot = path.resolve(storageRoot);

  // Split reference on both POSIX and Windows separators
  const segments = decodedRef.split(/[/\\]+/).filter(Boolean);

  if (segments.length === 0 && !options?.allowRoot) {
    throw new InvalidPathError(
      'Storage reference resolves to the root directory itself',
    );
  }

  // Resolve target against root
  const resolvedPath = path.resolve(normalizedRoot, ...segments);

  // Compute relative path from root to resolved target
  const relative = path.relative(normalizedRoot, resolvedPath);

  const isWindows = process.platform === 'win32';
  const relCheck = isWindows ? relative.toLowerCase() : relative;

  if (
    (relCheck === '' && !options?.allowRoot) ||
    relCheck === '..' ||
    relCheck.startsWith(`..${path.sep}`) ||
    relCheck.startsWith('../') ||
    relCheck.startsWith('..\\') ||
    path.isAbsolute(relative)
  ) {
    throw new InvalidPathError(
      `Storage reference "${reference}" escapes the storage root`,
    );
  }

  // Sibling prefix protection: ensure resolved path starts with root + separator
  const rootWithSep = normalizedRoot.endsWith(path.sep)
    ? normalizedRoot
    : `${normalizedRoot}${path.sep}`;

  const resolvedForPrefix = isWindows
    ? resolvedPath.toLowerCase()
    : resolvedPath;
  const rootForPrefix = isWindows ? rootWithSep.toLowerCase() : rootWithSep;

  if (
    !resolvedForPrefix.startsWith(rootForPrefix) &&
    (!options?.allowRoot ||
      (isWindows
        ? resolvedPath.toLowerCase() !== normalizedRoot.toLowerCase()
        : resolvedPath !== normalizedRoot))
  ) {
    throw new InvalidPathError(
      `Storage reference "${reference}" escapes the storage root boundary`,
    );
  }

  return resolvedPath;
}

/**
 * Resolves a reference against the storage root and verifies real filesystem containment,
 * asserting that no symlinks in the path point outside the storage root.
 */
export async function verifyStoragePathContainment(
  storageRoot: string,
  reference: string,
  options?: { allowRoot?: boolean },
): Promise<string> {
  const resolvedPath = resolveStoragePath(storageRoot, reference, options);
  const normalizedRoot = path.resolve(storageRoot);

  let realRoot: string;
  try {
    realRoot = await fs.realpath(normalizedRoot);
  } catch {
    realRoot = normalizedRoot;
  }

  // Check the resolved path and its existing parent directories down to normalizedRoot for symlink escapes
  let current = resolvedPath;

  while (
    current &&
    current !== normalizedRoot &&
    current !== path.dirname(current)
  ) {
    try {
      const stat = await fs.lstat(current);

      if (stat.isSymbolicLink()) {
        const realCurrent = await fs.realpath(current);
        const rel = path.relative(realRoot, realCurrent);

        const isWindows = process.platform === 'win32';
        const relCheck = isWindows ? rel.toLowerCase() : rel;

        if (
          relCheck === '' ||
          relCheck === '..' ||
          relCheck.startsWith(`..${path.sep}`) ||
          relCheck.startsWith('../') ||
          relCheck.startsWith('..\\') ||
          path.isAbsolute(rel)
        ) {
          throw new InvalidPathError(
            `Symlink in storage path "${reference}" points outside the storage root to "${realCurrent}"`,
          );
        }

        const realRootWithSep = realRoot.endsWith(path.sep)
          ? realRoot
          : `${realRoot}${path.sep}`;
        const realCurrentForPrefix = isWindows
          ? realCurrent.toLowerCase()
          : realCurrent;
        const realRootForPrefix = isWindows
          ? realRootWithSep.toLowerCase()
          : realRootWithSep;

        if (!realCurrentForPrefix.startsWith(realRootForPrefix)) {
          throw new InvalidPathError(
            `Symlink in storage path "${reference}" resolves outside the storage root boundary to "${realCurrent}"`,
          );
        }
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        // Path segment does not exist yet (e.g. before write or missing file); inspect parent
        current = path.dirname(current);
        continue;
      }
      throw err;
    }

    current = path.dirname(current);
  }

  return resolvedPath;
}
