#!/bin/sh
# Wrapper: start pnpm dev in the background, wait for it to be responsive,
# then exec claude. Ensures HTTP MCP servers (tidewave) connect at startup.
# Used by the host sandbox entrypoint when /workspace/scripts/dev-claude.sh exists.
set -e

LOG=/tmp/dev.log
PIDFILE=/tmp/dev.pid

# Clean up any prior dev server (crashed previous session, etc.)
if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  kill "$(cat "$PIDFILE")" 2>/dev/null || true
  sleep 1
fi

echo "[dev-claude] Starting pnpm dev (logs: $LOG)..."
pnpm dev > "$LOG" 2>&1 &
echo $! > "$PIDFILE"
trap 'kill $(cat "$PIDFILE") 2>/dev/null || true' EXIT INT TERM

# Wait up to 60s for the dev server to respond on /ping
# (proxy.ts already short-circuits /ping with a "pong" response — no auth needed)
for i in $(seq 1 60); do
  if curl -fsS http://localhost:3000/ping > /dev/null 2>&1; then
    echo "[dev-claude] Next dev ready (pid $(cat "$PIDFILE")) — starting claude"
    break
  fi
  if [ "$i" -eq 60 ]; then
    echo "[dev-claude] Timed out waiting for next dev. Last 50 lines of $LOG:"
    tail -50 "$LOG" || true
    echo "[dev-claude] Continuing anyway — Tidewave MCP may not connect."
  fi
  sleep 1
done

exec claude "$@"
