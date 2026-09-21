import {
  resolveDefaultDataDir,
  resolveDefaultDatabasePath,
} from './data-dir.js';

describe('resolveDefaultDataDir', () => {
  it('uses Application Support on macOS', () => {
    expect(resolveDefaultDataDir('darwin', {}, '/Users/ada')).toBe(
      '/Users/ada/Library/Application Support/Glassbeetle',
    );
  });

  it('uses APPDATA on Windows when it is set', () => {
    expect(
      resolveDefaultDataDir(
        'win32',
        { APPDATA: 'C:\\Users\\ada\\AppData\\Roaming' },
        'C:\\Users\\ada',
      ),
    ).toContain('Glassbeetle');
  });

  it('falls back to the conventional Roaming path on Windows without APPDATA', () => {
    expect(resolveDefaultDataDir('win32', {}, '/Users/ada')).toContain(
      'AppData',
    );
  });

  it('honours XDG_DATA_HOME on Linux', () => {
    expect(
      resolveDefaultDataDir(
        'linux',
        { XDG_DATA_HOME: '/custom/share' },
        '/home/ada',
      ),
    ).toBe('/custom/share/glassbeetle');
  });

  it('falls back to ~/.local/share on Linux', () => {
    expect(resolveDefaultDataDir('linux', {}, '/home/ada')).toBe(
      '/home/ada/.local/share/glassbeetle',
    );
  });

  it('never resolves relative to the process working directory', () => {
    // A packaged Tauri build runs from a read-only bundle, so anything relative
    // to the executable or the cwd would be unwritable or scattered.
    for (const platform of ['darwin', 'win32', 'linux'] as NodeJS.Platform[]) {
      expect(resolveDefaultDataDir(platform, {}, '/home/ada')).not.toBe('');
      expect(resolveDefaultDataDir(platform, {}, '/home/ada')).toContain('ada');
    }
  });
});

describe('resolveDefaultDatabasePath', () => {
  it('places the database inside the data directory', () => {
    expect(
      resolveDefaultDatabasePath('/home/ada/.local/share/glassbeetle'),
    ).toBe('/home/ada/.local/share/glassbeetle/glassbeetle.db');
  });
});
