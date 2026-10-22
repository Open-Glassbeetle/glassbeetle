import { promises as fs } from 'node:fs';
import path from 'node:path';
import { InvalidPathError } from './file-storage.errors.js';

/**
 * Validates that a reference is a safe, non-empty, relative string without null bytes
 * or path-traversal escapes.
 *
 * References reach this code from the database and from request parameters, and
 * the checks are ordered so that each one cannot be bypassed by the trick the
 * next one catches: null bytes first, since they truncate paths in native
 * calls; then one round of percent-decoding, so `%2e%2e%2f` is judged as the
 * `../` it becomes; then absolute forms, including Windows drive letters and
 * UNC prefixes, which `path.resolve` would otherwise honour over the storage
 * root.
 *
 * @returns The percent-decoded reference, which is what callers must resolve —
 * resolving the raw string instead would undo the decoding step.
 * @throws InvalidPathError (400) when the reference is empty, not a string,
 * carries a null byte, is malformed percent-encoding, or is absolute.
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
 *
 * Containment is asserted twice over, because neither check is sufficient on
 * its own: the relative path from the root must not start with `..`, and the
 * resolved path must begin with the root *plus a separator*. Without the
 * separator, a root of `/storage` would accept `/storage-evil/x`.
 *
 * Comparison is case-insensitive on Windows, where two spellings of a path name
 * the same file.
 *
 * This is a purely syntactic check; it does not look at the filesystem, so a
 * symlink inside the root can still point outside it. Use
 * {@link verifyStoragePathContainment} where that matters.
 *
 * @param options - `allowRoot` permits the reference to resolve to the storage
 * root itself, which directory-level operations need and file operations must
 * not allow.
 * @returns The absolute path, guaranteed to be inside the root.
 * @throws InvalidPathError (400) when the reference is unsafe or escapes the
 * root.
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
 *
 * {@link resolveStoragePath} can only reason about the text of a path. A
 * symlink placed inside the storage root — by another program, or by the user —
 * makes a syntactically contained path reach anywhere on the disk, which for a
 * read endpoint means serving arbitrary files and for a write means
 * overwriting them.
 *
 * Each existing path segment from the target up to the root is `lstat`ed, and
 * any symlink among them must resolve to a location still inside the root's own
 * real path. Segments that do not exist yet are skipped, so this can be called
 * before a write as well as before a read.
 *
 * @returns The absolute path, verified against the filesystem as it is now.
 * Nothing stops a symlink from appearing between this check and the operation
 * that follows it.
 * @throws InvalidPathError (400) when the reference is unsafe, escapes the
 * root, or passes through a symlink that leaves it.
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
