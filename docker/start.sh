#!/usr/bin/env bash
#
# Entrypoint for the single-container G3 backend. Runs two processes:
#
#   [python]  FastAPI enrichment service, bound to 127.0.0.1 (private)
#   [node]    Express API, bound to 0.0.0.0:$PORT (public)
#
# bash is required, not sh: `wait -n` does not exist in dash, which is what
# /bin/sh is on Debian. A #!/bin/sh shebang fails with "wait: Illegal option -n".
#
# NOTE on `set -e`: it is deliberately NOT enabled around the wait loop. With
# -e, a trapped SIGTERM makes `wait` return 143 and the shell exits
# immediately -- killing uvicorn before it can use any of its
# timeout_graceful_shutdown=25 window. We handle failures explicitly instead.
set -uo pipefail

PORT="${PORT:-5001}"
ENRICHMENT_PORT="${ENRICHMENT_PORT:-8001}"
SERVER_DIR="${SERVER_DIR:-/app/server}"
ENRICHMENT_DIR="${ENRICHMENT_DIR:-/app/enrichment_pipeline}"
PYTHON_BIN="${PYTHON_BIN:-/opt/venv/bin/python}"

# How many times Python may die before we give up and take the container
# down. Restarting Python in place keeps the API serving through a transient
# crash; flapping forever would instead hide a genuinely broken deploy behind
# a container that still reports healthy.
PY_MAX_RESTARTS="${PY_MAX_RESTARTS:-5}"
PY_RESTART_WINDOW_SECONDS="${PY_RESTART_WINDOW_SECONDS:-60}"

PY_PID=""
NODE_PID=""
shutting_down=0

log() { echo "[start] $*"; }

# --------------------------------------------------------------------------
# Signal handling
# --------------------------------------------------------------------------
# A trap only runs promptly while bash is blocked in `wait`. If SIGTERM
# arrives during the foreground `prisma migrate deploy`, handling is deferred
# until that command returns -- acceptable, but worth knowing.
on_term() {
  shutting_down=1
  log "received shutdown signal, stopping children"
  kill -TERM "$PY_PID" "$NODE_PID" 2>/dev/null || true
}
trap on_term TERM INT

graceful_exit() {
  # uvicorn is configured with timeout_graceful_shutdown=25; give both
  # children a bounded window to finish before hard-killing.
  local waited=0
  while [ "$waited" -lt 30 ]; do
    if ! kill -0 "$PY_PID" 2>/dev/null && ! kill -0 "$NODE_PID" 2>/dev/null; then
      break
    fi
    sleep 1
    waited=$((waited + 1))
  done
  kill -KILL "$PY_PID" "$NODE_PID" 2>/dev/null || true
  wait 2>/dev/null || true
  log "shutdown complete"
  exit 0
}

# --------------------------------------------------------------------------
# Python enrichment service
# --------------------------------------------------------------------------
# Bound to 127.0.0.1 so it is unreachable from outside the container even if
# a port were published: the published-port proxy connects from outside this
# network namespace and cannot reach a loopback-only listener. main.py's
# --host defaults to 0.0.0.0, so passing this explicitly is required.
#
# --port is given $ENRICHMENT_PORT, never $PORT. main.py does not read $PORT
# itself, and $PORT is Node's (Render commonly injects 10000).
#
# Process substitution rather than `| sed`: with a pipe, $! would capture
# sed's PID, not Python's, silently breaking both the liveness checks and
# the kill in on_term.
# Runs in a subshell so the `cd` cannot leak into the rest of the script --
# this function is called again on every restart, and a stray working
# directory change would outlive it. `exec` replaces the subshell with
# Python, so $! is Python's real pid and not a wrapper's.
start_python() {
  ( cd "$ENRICHMENT_DIR" && exec "$PYTHON_BIN" main.py --serve \
      --host 127.0.0.1 --port "$ENRICHMENT_PORT" ) \
    > >(sed -u 's/^/[python] /') 2>&1 &
  PY_PID=$!
  log "python started (pid $PY_PID) on 127.0.0.1:$ENRICHMENT_PORT"
}

# Readiness gate. Bounded, and aborts early if the process is already gone --
# an unbounded loop would hang forever when Python dies at import (config
# errors exit 2), leaving the platform to kill the container with no useful
# diagnostic.
#
# This proves only that the port is bound. main.py calls
# load_config(require_keys=False), so Python reports healthy with zero
# provider keys configured; /health's providers_configured map is what
# actually tells you what is wired up.
wait_for_python() {
  local i
  for i in $(seq 1 60); do
    if curl -fsS "http://127.0.0.1:${ENRICHMENT_PORT}/health" >/dev/null 2>&1; then
      log "python healthy after ${i}s"
      return 0
    fi
    if ! kill -0 "$PY_PID" 2>/dev/null; then
      log "FATAL: python exited during startup"
      return 1
    fi
    sleep 1
  done
  log "FATAL: python /health not ready after 60s"
  return 1
}

# --------------------------------------------------------------------------
# Database migrations
# --------------------------------------------------------------------------
# Calls the local binary directly rather than `npx prisma`: npx falls back to
# installing from the registry when local resolution fails, and does so
# without prompting in a non-TTY -- a hidden network dependency on the boot
# path.
#
# Retried because Neon can refuse or drop a first connection after idle, and
# a bare failure here means a crash loop that re-attempts 27 migrations on
# every restart. Prisma takes a Postgres advisory lock, so concurrent runs
# during an overlapping deploy serialise safely.
run_migrations() {
  local attempt
  for attempt in 1 2 3; do
    log "running prisma migrate deploy (attempt $attempt/3)"
    if "$SERVER_DIR/node_modules/.bin/prisma" migrate deploy \
         --schema="$SERVER_DIR/prisma/schema.prisma" 2>&1 | sed -u 's/^/[prisma] /'; then
      log "migrations applied"
      return 0
    fi
    [ "$attempt" -eq 3 ] && { log "FATAL: migrate deploy failed after 3 attempts"; return 1; }
    sleep 5
  done
}

# --------------------------------------------------------------------------
# Node API
# --------------------------------------------------------------------------
start_node() {
  ( cd "$SERVER_DIR" && exec node dist/index.js ) \
    > >(sed -u 's/^/[node] /') 2>&1 &
  NODE_PID=$!
  log "node started (pid $NODE_PID) on 0.0.0.0:$PORT"
}

# --------------------------------------------------------------------------
# Boot
# --------------------------------------------------------------------------
log "container starting (node port=$PORT, enrichment port=$ENRICHMENT_PORT, TZ=${TZ:-unset})"

start_python
wait_for_python || { kill -TERM "$PY_PID" 2>/dev/null; exit 1; }
run_migrations  || { kill -TERM "$PY_PID" 2>/dev/null; exit 1; }
start_node

# --------------------------------------------------------------------------
# Supervision loop
# --------------------------------------------------------------------------
# Asymmetric on purpose:
#
#   node dies   -> exit, so the platform restarts the whole container. Node
#                  is the front door; without it the container serves nothing.
#   python dies -> restart python alone and keep the API up. Merging the two
#                  services into one container would otherwise mean every
#                  Python crash is a full API outage, and every restart
#                  re-runs migrate deploy against the database.
# Implemented as an explicit liveness poll rather than `wait -n`, after
# `wait -n` was observed failing in exactly the case this loop exists for.
# Two reasons it is the wrong primitive here:
#
#  1. Reaping. If a child dies BEFORE the loop first calls `wait -n` (e.g.
#     Python crashes during the migrate step above), bash may already have
#     reaped it and reported it as a job notification. `wait -n` then has
#     nothing to return for it and blocks -- so the crash is never noticed
#     and Python is never restarted. Reproduced directly.
#  2. Stray jobs. The `> >(sed ...)` process substitutions are themselves
#     background jobs, so a bare `wait -n` also returns for those.
#
# Polling `kill -0` has neither problem, and works identically on bash 3.2
# and 5.x. Cost is up to 1s to notice an exit, which is irrelevant here.
# Note a trap fires only after the foreground `sleep` returns, so shutdown
# is likewise handled within ~1s.
py_restarts=0
py_window_start=$(date +%s)

while true; do
  sleep 1

  [ "$shutting_down" -eq 1 ] && graceful_exit

  if ! kill -0 "$NODE_PID" 2>/dev/null; then
    # Best-effort status: returns the real exit code if bash has not already
    # reaped it, 127 otherwise. Either way the container must go down.
    wait "$NODE_PID" 2>/dev/null
    exited_status=$?
    log "node exited with status $exited_status; taking the container down"
    kill -TERM "$PY_PID" 2>/dev/null || true
    wait 2>/dev/null || true
    [ "$exited_status" -eq 0 ] && exited_status=1
    exit "$exited_status"
  fi

  if ! kill -0 "$PY_PID" 2>/dev/null; then
    wait "$PY_PID" 2>/dev/null
    exited_status=$?
    now=$(date +%s)
    # Reset the budget if the last failure was long enough ago; what we want
    # to catch is rapid flapping, not one crash a week.
    if [ $((now - py_window_start)) -gt "$PY_RESTART_WINDOW_SECONDS" ]; then
      py_restarts=0
      py_window_start=$now
    fi
    py_restarts=$((py_restarts + 1))

    if [ "$py_restarts" -gt "$PY_MAX_RESTARTS" ]; then
      log "FATAL: python died $py_restarts times in ${PY_RESTART_WINDOW_SECONDS}s; giving up"
      kill -TERM "$NODE_PID" 2>/dev/null || true
      wait 2>/dev/null || true
      exit 1
    fi

    log "WARNING: python exited with status $exited_status; restarting it (${py_restarts}/${PY_MAX_RESTARTS}). API stays up."
    start_python
  fi
done
