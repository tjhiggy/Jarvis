#!/usr/bin/env bash
# Tear down scratch created by a verify-jarvis run.
# Never deletes proof artifacts under .cursor/skills/verify-jarvis/artifacts/.
set -euo pipefail

find_repo_root() {
  local dir="$1"
  while [[ "$dir" != "/" ]]; do
    if [[ -f "$dir/package.json" ]] && grep -q '"name": "jarvis-discord-bot"' "$dir/package.json"; then
      printf '%s\n' "$dir"
      return 0
    fi
    dir="$(dirname "$dir")"
  done
  return 1
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(find_repo_root "$SCRIPT_DIR")" || {
  echo "cleanup: could not find jarvis-discord-bot package.json above $SCRIPT_DIR" >&2
  exit 1
}

ARTIFACTS="$REPO_ROOT/.cursor/skills/verify-jarvis/artifacts"
SCRATCH_ROOT="${TMPDIR:-/tmp}/verify-jarvis-scratch"

echo "cleanup: repo=$REPO_ROOT"
echo "cleanup: preserving artifacts at $ARTIFACTS"

if [[ -d "$SCRATCH_ROOT" ]]; then
  rm -rf "$SCRATCH_ROOT"
  echo "cleanup: removed $SCRATCH_ROOT"
else
  echo "cleanup: no scratch directory at $SCRATCH_ROOT"
fi

# Only kill PIDs this run recorded. Never kill by process name.
PID_FILE="$SCRATCH_ROOT.pids"
if [[ -f "$PID_FILE" ]]; then
  while IFS= read -r pid || [[ -n "$pid" ]]; do
    [[ -z "$pid" ]] && continue
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      echo "cleanup: stopped recorded pid $pid"
    fi
  done <"$PID_FILE"
  rm -f "$PID_FILE"
fi

if [[ ! -d "$ARTIFACTS" ]]; then
  echo "cleanup: WARNING artifacts directory missing after teardown: $ARTIFACTS" >&2
  exit 1
fi

echo "cleanup: artifacts remain at $ARTIFACTS"
exit 0
