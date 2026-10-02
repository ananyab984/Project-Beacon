#!/usr/bin/env bash
#
# Self-check for docker/start.sh's supervision loop.
#
#   ./docker/start.test.sh
#
# No framework, no fixtures: it builds stub python/node/prisma/curl binaries
# in a temp dir, points start.sh at them via its *_DIR / PYTHON_BIN env vars,
# and asserts the four behaviours the loop exists to provide.
#
# This exists because the loop's first implementation (`wait -n`) passed
# review and still failed case 1: when Python dies before the loop's first
# wait, bash has already reaped it, `wait -n` blocks on the sed process
# substitutions instead, and the crash is never noticed. That is exactly the
# bug class a reader cannot see by inspection, so it gets a test.
#
# Requires bash 4+ for the harness itself (macOS /bin/bash is 3.2; use
# `brew`'s bash or run this in the container).
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
START_SH="$SCRIPT_DIR/start.sh"
D="$(mktemp -d)"
trap 'rm -rf "$D"; pkill -9 -f "$D/bin/" 2>/dev/null || true' EXIT

mkdir -p "$D"/{bin,srv/node_modules/.bin,enr}
printf '#!/usr/bin/env bash\nexit 0\n'                             > "$D/bin/curl"
printf '#!/usr/bin/env bash\necho "migrations applied (stub)"\n'   > "$D/srv/node_modules/.bin/prisma"
printf '#!/usr/bin/env bash\necho "python up"\nsleep 300\n'        > "$D/bin/fakepy"
printf '#!/usr/bin/env bash\necho "node up"\nsleep 300\n'          > "$D/bin/node"
printf '#!/usr/bin/env bash\nsleep 0.3\nexit 3\n'                  > "$D/bin/crashpy"
chmod +x "$D/bin/"* "$D/srv/node_modules/.bin/prisma"

pass=0; fail=0
ok()   { echo "  PASS: $1"; pass=$((pass+1)); }
bad()  { echo "  FAIL: $1"; fail=$((fail+1)); }
alive(){ kill -0 "$1" 2>/dev/null; }
npid() { pgrep -f "$1" | head -1; }

# Sets $SUP rather than echoing it: launching via $(...) would start the job
# inside a command-substitution subshell, so it would not be a child of this
# shell and every `wait "$SUP"` would return 127 instead of the real status.
SUP=""
run_start() {
  PATH="$D/bin:$PATH" PYTHON_BIN="${1:-$D/bin/fakepy}" \
  SERVER_DIR="$D/srv" ENRICHMENT_DIR="$D/enr" \
  PY_MAX_RESTARTS="${2:-5}" PY_RESTART_WINDOW_SECONDS="${3:-60}" \
    bash "$START_SH" > "$D/out.log" 2>&1 &
  SUP=$!
}

echo "1. python crash -> restarted in place, API stays up"
run_start; sleep 4
PY1=$(npid "$D/bin/fakepy"); kill -9 "$PY1" 2>/dev/null; sleep 4
PY2=$(npid "$D/bin/fakepy"); NODE=$(npid "$D/bin/node")
if alive "$SUP" && [ -n "$PY2" ] && [ "$PY1" != "$PY2" ] && [ -n "$NODE" ]; then
  ok "python restarted ($PY1 -> $PY2), node and supervisor untouched"
else
  bad "expected a new python pid with node+supervisor alive"
fi
kill -9 "$SUP" 2>/dev/null; pkill -9 -f "$D/bin/" 2>/dev/null; sleep 1

echo "2. node crash -> container goes down, python cleaned up"
run_start; sleep 4
kill -9 "$(npid "$D/bin/node")" 2>/dev/null; sleep 3
if alive "$SUP"; then bad "supervisor should have exited"; kill -9 "$SUP"
else
  wait "$SUP" 2>/dev/null; st=$?
  left=$(pgrep -f "$D/bin/fakepy" | wc -l | tr -d ' ')
  [ "$st" -ne 0 ] && [ "$left" -eq 0 ] \
    && ok "exited non-zero ($st), no orphaned python" \
    || bad "exit=$st leftover_python=$left"
fi
pkill -9 -f "$D/bin/" 2>/dev/null; sleep 1

echo "3. python flapping -> restart budget exhausts, container gives up"
run_start "$D/bin/crashpy" 3 60; sleep 15
if alive "$SUP"; then bad "supervisor should have given up"; kill -9 "$SUP"
else
  wait "$SUP" 2>/dev/null; st=$?
  grep -q "FATAL: python died" "$D/out.log" \
    && [ "$st" -ne 0 ] \
    && ok "gave up with status $st after exhausting the budget" \
    || bad "exit=$st, no FATAL line"
fi
pkill -9 -f "$D/bin/" 2>/dev/null; sleep 1

echo "4. SIGTERM -> both children stopped, clean exit"
run_start; sleep 4
kill -TERM "$SUP"; sleep 4
if alive "$SUP"; then bad "supervisor hung on SIGTERM"; kill -9 "$SUP"
else
  wait "$SUP" 2>/dev/null; st=$?
  left=$(( $(pgrep -f "$D/bin/fakepy" | wc -l) + $(pgrep -f "$D/bin/node" | wc -l) ))
  [ "$st" -eq 0 ] && [ "$left" -eq 0 ] \
    && ok "exited 0 with no orphaned children" \
    || bad "exit=$st leftover=$left"
fi

echo
echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
