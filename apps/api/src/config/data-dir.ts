import { homedir } from 'node:os';
import { posix, win32 } from 'node:path';

/**
 * Directory name used on platforms that expect a human-readable application
 * folder (macOS, Windows).
 */
const DISPLAY_DIR_NAME = 'Glassbeetle';

/**
 * Directory name used on platforms that expect a lowercase folder (Linux).
 */
const UNIX_DIR_NAME = 'glassbeetle';

/**
 * Resolves the per-user directory holding the database, uploaded files,
 * artifacts and backups.
 *
 * Glassbeetle ships as a Tauri desktop build, which runs from a read-only
 * application bundle. The data directory must therefore never be derived from
 * the executable's location — it is always resolved against the user's own
 * profile.
 *
 * - macOS: `~/Library/Application Support/Glassbeetle`
 * - Windows: `%APPDATA%\Glassbeetle`
 * - Linux and other platforms: `$XDG_DATA_HOME/glassbeetle`, falling back to
 *   `~/.local/share/glassbeetle`
 *
 * The platform, environment and home directory are injectable so the resolution
 * can be tested for all three targets on any one of them.
 */
export function resolveDefaultDataDir(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): string {
  const pathModule = platform === 'win32' ? win32 : posix;

  if (platform === 'darwin') {
    return pathModule.join(home, 'Library', 'Application Support', DISPLAY_DIR_NAME);
  }

  if (platform === 'win32') {
    const appData = env.APPDATA ?? pathModule.join(home, 'AppData', 'Roaming');

    return pathModule.join(appData, DISPLAY_DIR_NAME);
  }

  const xdgDataHome = env.XDG_DATA_HOME ?? pathModule.join(home, '.local', 'share');

  return pathModule.join(xdgDataHome, UNIX_DIR_NAME);
}

/**
 * Default filename of the SQLite database inside the data directory.
 */
export const DATABASE_FILE_NAME = 'glassbeetle.db';

/**
 * Resolves the default database path for a given data directory.
 */
export function resolveDefaultDatabasePath(dataDir: string): string {
  const pathModule = dataDir.includes('\\') ? win32 : posix;
  return pathModule.join(dataDir, DATABASE_FILE_NAME);
}

