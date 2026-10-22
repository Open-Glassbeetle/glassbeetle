#!/usr/bin/env node
/**
 * Cross-platform entry for `npm run stop`.
 *
 * On macOS/Linux this delegates to the existing `scripts/stop.sh` so POSIX
 * behaviour stays exactly as it is today. On Windows — where bash/lsof/ps are
 * not available — it runs a Node implementation of the same contract:
 * find listeners on API_PORT/WEB_PORT, walk toolchain supervisors, never kill
 * this process or its ancestors, honour --dry-run, and leave other projects alone.
 *
 * Usage:
 *   npm run stop
 *   npm run stop -- --dry-run
 *   API_PORT=3001 npm run stop
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const STOP_SH = path.join(__dirname, 'stop.sh');

const API_PORT = Number.parseInt(process.env.API_PORT || process.env.PORT || '3000', 10);
const WEB_PORT = Number.parseInt(process.env.WEB_PORT || '4200', 10);
const GRACE_SECONDS = Number.parseInt(process.env.GRACE_SECONDS || '5', 10);

function parseArgs(argv) {
  let dryRun = false;
  for (const arg of argv) {
    if (arg === '-n' || arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (arg === '-h' || arg === '--help') {
      console.log(`Stops everything \`npm run dev\` starts: the NestJS API, the Angular
dev server and the Tauri window — including the watchers that would
otherwise restart them.

Processes are found by the ports they listen on rather than by name, so
this also cleans up a server left behind by a crashed terminal.

Usage:
  npm run stop
  npm run stop -- --dry-run      # list what would be stopped, kill nothing
  API_PORT=3001 npm run stop     # non-default ports

Exits 0 when nothing was running: this is meant to be safe to run twice.`);
      process.exit(0);
    }
    console.error(`stop: unknown option '${arg}' (try --help)`);
    process.exit(64);
  }
  return { dryRun };
}

function runPosix(argv) {
  const result = spawnSync('bash', [STOP_SH, ...argv], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    env: process.env,
  });
  if (result.error) {
    console.error(`stop: failed to run bash scripts/stop.sh: ${result.error.message}`);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}

// ── Windows helpers ───────────────────────────────────────────────────────

function runCapture(command, args) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.error) {
    return { status: 1, stdout: '', stderr: String(result.error.message) };
  }
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function listenersOnPort(port) {
  const { stdout } = runCapture('netstat', ['-ano', '-p', 'tcp']);
  const pids = new Set();
  for (const line of stdout.split(/\r?\n/)) {
    // TCP    0.0.0.0:3000    0.0.0.0:0    LISTENING    1234
    // TCP    [::]:3000       [::]:0       LISTENING    1234
    // TCP    127.0.0.1:3000  0.0.0.0:0    LISTENING    1234
    const match = line.match(
      /^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i,
    );
    if (!match) continue;
    if (Number.parseInt(match[1], 10) !== port) continue;
    const pid = Number.parseInt(match[2], 10);
    if (pid > 0) pids.add(pid);
  }
  return [...pids];
}

const processInfoCache = new Map();
let processTableLoaded = false;

function loadProcessTable() {
  if (processTableLoaded) return;
  processTableLoaded = true;
  // One CIM scan for parent + command line — far cheaper than a PowerShell
  // round-trip per PID while walking supervisor chains.
  const ps = runCapture('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    "Get-CimInstance Win32_Process | ForEach-Object { $cmd = if ($_.CommandLine) { ($_.CommandLine -replace '[\\r\\n|]+',' ') } else { '' }; Write-Output ($_.ProcessId.ToString() + '|' + $_.ParentProcessId.ToString() + '|' + $cmd) }",
  ]);
  if (ps.status !== 0) return;
  for (const line of ps.stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const first = line.indexOf('|');
    const second = line.indexOf('|', first + 1);
    if (first === -1 || second === -1) continue;
    const pid = Number.parseInt(line.slice(0, first), 10);
    const parent = Number.parseInt(line.slice(first + 1, second), 10) || 0;
    const command = line.slice(second + 1).trim();
    if (Number.isFinite(pid) && pid > 0) {
      processInfoCache.set(pid, { parent, command });
    }
  }
}

function processInfo(pid) {
  loadProcessTable();
  if (processInfoCache.has(pid)) {
    return processInfoCache.get(pid);
  }
  const info = { parent: 0, command: '' };
  processInfoCache.set(pid, info);
  return info;
}

function commandOf(pid) {
  return processInfo(pid).command;
}

function parentOf(pid) {
  return processInfo(pid).parent;
}

function collectAncestors(startPid) {
  const chain = [];
  let pid = startPid;
  const seen = new Set();
  while (pid && pid !== 0 && !seen.has(pid)) {
    seen.add(pid);
    chain.push(pid);
    pid = parentOf(pid);
  }
  return chain;
}

function isProtected(pid, protectedSet) {
  return protectedSet.has(pid);
}

function isToolchain(pid) {
  const command = commandOf(pid);
  if (!command) return false;
  return /node|npm|nest|ng serve|concurrently|wait-on|tauri|cargo/i.test(command);
}

function withSupervisors(pid, protectedSet) {
  const chain = [pid];
  let parent = parentOf(pid);
  const seen = new Set([pid]);
  while (parent && parent !== 0 && parent !== 1 && !seen.has(parent)) {
    if (isProtected(parent, protectedSet)) break;
    if (!isToolchain(parent)) break;
    chain.push(parent);
    seen.add(parent);
    parent = parentOf(parent);
  }
  return chain;
}

function tauriPids() {
  loadProcessTable();
  const needle = path.join(REPO_ROOT, 'apps', 'desktop', 'src-tauri', 'target');
  const needleAlt = needle.replaceAll('\\', '/');
  const found = [];
  for (const [pid, info] of processInfoCache) {
    const cmd = info.command || '';
    if (!cmd) continue;
    if (cmd.includes(needle) || cmd.includes(needleAlt) || /tauri\s+dev/i.test(cmd)) {
      found.push(pid);
    }
  }
  return found;
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function terminate(pid) {
  // Node's process.kill on Windows maps SIGTERM to TerminateProcess, which is
  // the practical equivalent of the POSIX SIGTERM→wait→SIGKILL sequence for
  // console servers that do not handle WM_CLOSE.
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    runCapture('taskkill', ['/PID', String(pid)]);
  }
}

function forceKill(pid) {
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    runCapture('taskkill', ['/F', '/PID', String(pid)]);
  }
}

function sleepSync(ms) {
  spawnSync(process.execPath, ['-e', `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,${ms})`], {
    windowsHide: true,
  });
}

let STOPPED = false;

function stopPids(label, pids, dryRun, protectedSet) {
  const unique = [];
  for (const pid of pids) {
    if (!pid) continue;
    if (!isAlive(pid)) continue;
    if (isProtected(pid, protectedSet)) continue;
    if (unique.includes(pid)) continue;
    unique.push(pid);
  }
  if (unique.length === 0) return;

  for (const pid of unique) {
    const cmd = commandOf(pid).slice(0, 90);
    console.log(`  ${String(pid).padEnd(6)} ${cmd}`);
  }

  if (dryRun) return;

  for (const pid of unique) {
    terminate(pid);
  }

  let waited = 0;
  while (waited < GRACE_SECONDS) {
    if (unique.every((pid) => !isAlive(pid))) break;
    sleepSync(1000);
    waited += 1;
  }

  for (const pid of unique) {
    if (isAlive(pid)) {
      console.log(`  ${pid} did not exit after ${GRACE_SECONDS}s; killing it`);
      forceKill(pid);
    }
  }

  STOPPED = true;
  console.log(`  stopped ${label}`);
}

function stopPort(label, port, dryRun, protectedSet) {
  const listeners = listenersOnPort(port);
  if (listeners.length === 0) {
    console.log(`${label} (port ${port}): not running`);
    return;
  }

  console.log(`${label} (port ${port}):`);
  const all = [];
  for (const pid of listeners) {
    all.push(...withSupervisors(pid, protectedSet));
  }
  stopPids(label, all, dryRun, protectedSet);
}

function runWindows(argv) {
  const { dryRun } = parseArgs(argv);
  const protectedSet = new Set(collectAncestors(process.pid));

  if (dryRun) {
    console.log('Dry run — nothing will be stopped.');
    console.log();
  }

  stopPort('API', API_PORT, dryRun, protectedSet);
  stopPort('Web', WEB_PORT, dryRun, protectedSet);

  const tauri = tauriPids().filter((pid) => !isProtected(pid, protectedSet));
  if (tauri.length > 0) {
    console.log('Desktop window:');
    stopPids('Tauri', tauri, dryRun, protectedSet);
  } else {
    console.log('Desktop window: not running');
  }

  console.log();

  if (dryRun) {
    process.exit(0);
  }

  let failed = false;
  for (const [label, port] of [
    ['API', API_PORT],
    ['Web', WEB_PORT],
  ]) {
    const still = listenersOnPort(port);
    if (still.length > 0) {
      console.log(`Port ${port} (${label}) is still in use by:`);
      for (const pid of still) {
        console.log(`  ${String(pid).padEnd(6)} ${commandOf(pid).slice(0, 90)}`);
      }
      failed = true;
    }
  }

  if (failed) {
    console.log();
    console.error('Something outside this project is holding a port. Stop it yourself, or');
    console.error('run the app elsewhere: API_PORT=3001 npm run dev');
    process.exit(1);
  }

  if (STOPPED) {
    console.log(`Ports ${API_PORT} and ${WEB_PORT} are free. You can run npm run dev again.`);
  } else {
    console.log(`Nothing was running. Ports ${API_PORT} and ${WEB_PORT} are free.`);
  }
}

// ── Entry ─────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
if (process.platform === 'win32') {
  runWindows(argv);
} else {
  runPosix(argv);
}
