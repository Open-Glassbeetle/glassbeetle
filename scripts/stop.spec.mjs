/**
 * Regression tests for `npm run stop` (issue #151).
 *
 * These pin the cross-platform contract: the stop entrypoint must work without
 * bash/lsof, and `--dry-run` must be safe to run when nothing is listening.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function runStop(args = []) {
  return spawnSync('npm', ['run', 'stop', '--', ...args], {
    cwd: root,
    encoding: 'utf8',
    shell: true,
    env: { ...process.env },
  });
}

describe('npm run stop', () => {
  it('does not invoke bash directly from package.json', () => {
    const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
    assert.match(pkg.scripts.stop, /\bnode\b/, 'stop script should run via node');
    assert.doesNotMatch(
      pkg.scripts.stop,
      /^bash\b/,
      'stop script must not require bash on PATH (breaks Windows)',
    );
  });

  it('exits 0 with --dry-run when nothing is listening', () => {
    const result = runStop(['--dry-run']);
    assert.equal(
      result.status,
      0,
      `expected exit 0, got ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
    assert.match(result.stdout, /Dry run/i);
    assert.match(result.stdout, /API \(port /);
    assert.match(result.stdout, /Web \(port /);
  });

  it('honours API_PORT for dry-run reporting', () => {
    const result = spawnSync('npm', ['run', 'stop', '--', '--dry-run'], {
      cwd: root,
      encoding: 'utf8',
      shell: true,
      env: { ...process.env, API_PORT: '3001' },
    });
    assert.equal(
      result.status,
      0,
      `expected exit 0, got ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
    assert.match(result.stdout, /API \(port 3001\)/);
  });
});
