#!/usr/bin/env bash
#
# Stops everything `npm run dev` starts: the NestJS API, the Angular dev server
# and the Tauri window — including the watchers that would otherwise restart
# them.
#
# Processes are found by the ports they listen on rather than by name, so this
# also cleans up a server left behind by a crashed terminal, an editor's run
# configuration, or a detached background job whose PID nobody wrote down.
#
# Usage:
#   npm run stop
#   npm run stop -- --dry-run      # list what would be stopped, kill nothing
#   API_PORT=3001 npm run stop     # non-default ports
#
# Exits 0 when nothing was running: this is meant to be safe to run twice.

set -euo pipefail

API_PORT="${API_PORT:-${PORT:-3000}}"
WEB_PORT="${WEB_PORT:-4200}"

# How long a process gets to shut down cleanly before it is killed outright.
# The API closes its SQLite handle on SIGTERM, so it is worth waiting.
GRACE_SECONDS="${GRACE_SECONDS:-5}"

DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    -n | --dry-run) DRY_RUN=1 ;;
    -h | --help)
      sed -n '3,20p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "stop: unknown option '$arg' (try --help)" >&2
      exit 64
      ;;
  esac
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v lsof >/dev/null 2>&1; then
  echo "stop: lsof is required to find the running servers." >&2
  echo "      On Debian/Ubuntu: sudo apt install lsof" >&2
  exit 1
fi

# ── Guards ────────────────────────────────────────────────────────────────
#
# Never kill this script, the shell that launched it, or anything further up
# that chain. Without this, running the script from a process that happens to
# be part of the toolchain — an npm script, which is exactly how it is meant to
# be run — would have it terminate itself halfway through.

SELF_AND_ANCESTORS=""
_pid=$$
while [ -n "$_pid" ] && [ "$_pid" != "0" ] && [ "$_pid" != "1" ]; do
  SELF_AND_ANCESTORS="$SELF_AND_ANCESTORS $_pid"
  _pid="$(ps -o ppid= -p "$_pid" 2>/dev/null | tr -d ' ' || true)"
done

is_protected() {
  case " $SELF_AND_ANCESTORS " in
    *" $1 "*) return 0 ;;
    *) return 1 ;;
  esac
}

# ── Process discovery ─────────────────────────────────────────────────────

command_of() {
  ps -o command= -p "$1" 2>/dev/null | head -1 || true
}

listeners_on_port() {
  lsof -nP -tiTCP:"$1" -sTCP:LISTEN 2>/dev/null || true
}

# True for the supervisors that would restart a server after it is killed:
# `nest start --watch`, `ng serve`, `concurrently`, and the npm scripts around
# them. Deliberately narrow — a shell or an editor must not match, or stopping
# the API would take the terminal with it.
is_toolchain() {
  local command
  command="$(command_of "$1")"
  [ -n "$command" ] || return 1

  case "$command" in
    *node*|*npm*|*nest*|*"ng serve"*|*concurrently*|*wait-on*|*tauri*|*cargo*) return 0 ;;
    *) return 1 ;;
  esac
}

# A server's listening process is usually a child of the watcher that spawned
# it, so killing only the listener lets the watcher start a replacement and the
# port stays busy. This walks up while the ancestors are still part of the
# toolchain and stops at the first one that is not — the shell, or the app that
# launched it.
with_supervisors() {
  local pid="$1"
  local chain="$pid"
  local parent

  parent="$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ' || true)"
  while [ -n "$parent" ] && [ "$parent" != "0" ] && [ "$parent" != "1" ]; do
    is_protected "$parent" && break
    is_toolchain "$parent" || break

    chain="$chain $parent"
    parent="$(ps -o ppid= -p "$parent" 2>/dev/null | tr -d ' ' || true)"
  done

  echo "$chain"
}

# The Tauri window binds no port of its own, so it is matched by the binary
# path Cargo builds it to — scoped to this checkout, so a Tauri app from
# another project on the same machine is left alone.
tauri_pids() {
  pgrep -f "$REPO_ROOT/apps/desktop/src-tauri/target" 2>/dev/null || true
  pgrep -f "tauri dev" 2>/dev/null || true
}

# ── Stopping ──────────────────────────────────────────────────────────────

STOPPED=0

stop_pids() {
  local label="$1"
  shift
  local pids=""

  # Collapse duplicates: a watcher supervising two ports appears twice.
  for pid in "$@"; do
    [ -n "$pid" ] || continue
    kill -0 "$pid" 2>/dev/null || continue
    is_protected "$pid" && continue
    case " $pids " in *" $pid "*) continue ;; esac
    pids="$pids $pid"
  done

  [ -n "${pids// /}" ] || return 0

  for pid in $pids; do
    printf '  %-6s %s\n' "$pid" "$(command_of "$pid" | cut -c1-90)"
  done

  if [ "$DRY_RUN" -eq 1 ]; then
    return 0
  fi

  # Children before parents, so a watcher does not get the chance to respawn
  # the server it supervises while we are still working through the list.
  for pid in $pids; do
    kill -TERM "$pid" 2>/dev/null || true
  done

  local waited=0
  while [ "$waited" -lt "$GRACE_SECONDS" ]; do
    local alive=0
    for pid in $pids; do
      kill -0 "$pid" 2>/dev/null && alive=1
    done
    [ "$alive" -eq 0 ] && break
    sleep 1
    waited=$((waited + 1))
  done

  for pid in $pids; do
    if kill -0 "$pid" 2>/dev/null; then
      echo "  $pid did not exit after ${GRACE_SECONDS}s; killing it"
      kill -KILL "$pid" 2>/dev/null || true
    fi
  done

  STOPPED=1
  echo "  stopped $label"
}

stop_port() {
  local label="$1" port="$2"
  local listeners
  listeners="$(listeners_on_port "$port")"

  if [ -z "$listeners" ]; then
    echo "$label (port $port): not running"
    return 0
  fi

  echo "$label (port $port):"

  local all=""
  for pid in $listeners; do
    all="$all $(with_supervisors "$pid")"
  done

  # shellcheck disable=SC2086
  stop_pids "$label" $all
}

if [ "$DRY_RUN" -eq 1 ]; then
  echo "Dry run — nothing will be stopped."
  echo
fi

stop_port "API" "$API_PORT"
stop_port "Web" "$WEB_PORT"

TAURI="$(tauri_pids)"
if [ -n "$TAURI" ]; then
  echo "Desktop window:"
  # shellcheck disable=SC2086
  stop_pids "Tauri" $TAURI
else
  echo "Desktop window: not running"
fi

echo

if [ "$DRY_RUN" -eq 1 ]; then
  exit 0
fi

# Report the ports rather than the processes: a free port is what the next
# `npm run dev` actually needs, and it catches anything the walk above missed.
FAILED=0
for entry in "API:$API_PORT" "Web:$WEB_PORT"; do
  label="${entry%%:*}"
  port="${entry##*:}"

  if [ -n "$(listeners_on_port "$port")" ]; then
    echo "Port $port ($label) is still in use by:"
    for pid in $(listeners_on_port "$port"); do
      printf '  %-6s %s\n' "$pid" "$(command_of "$pid" | cut -c1-90)"
    done
    FAILED=1
  fi
done

if [ "$FAILED" -eq 1 ]; then
  echo
  echo "Something outside this project is holding a port. Stop it yourself, or"
  echo "run the app elsewhere: API_PORT=3001 npm run dev" >&2
  exit 1
fi

if [ "$STOPPED" -eq 1 ]; then
  echo "Ports $API_PORT and $WEB_PORT are free. You can run npm run dev again."
else
  echo "Nothing was running. Ports $API_PORT and $WEB_PORT are free."
fi
