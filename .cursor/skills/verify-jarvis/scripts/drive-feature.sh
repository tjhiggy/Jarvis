#!/usr/bin/env bash
# Drive one mapped verify-jarvis feature through the CI harness and capture
# stdout/stderr plus the exit code under the named artifacts path.
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

usage() {
  cat <<'EOF'
Usage: drive-feature.sh <feature-id>

feature-id is one of:
  rss-digest
  delegated-posts
  command-deck-confirm
  discord-journey-matrix
EOF
}

FEATURE="${1-}"
if [[ -z "$FEATURE" ]]; then
  usage >&2
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(find_repo_root "$SCRIPT_DIR")" || {
  echo "drive: could not find jarvis-discord-bot package.json above $SCRIPT_DIR" >&2
  exit 1
}

ARTIFACTS="$REPO_ROOT/.cursor/skills/verify-jarvis/artifacts/$FEATURE"
mkdir -p "$ARTIFACTS"
LOG="$ARTIFACTS/verify.txt"
META="$ARTIFACTS/meta.txt"
SECOND_COMMAND=()

case "$FEATURE" in
  rss-digest)
    COMMAND=(npm test -- tests/rss-scheduler.test.ts --reporter=verbose)
    ;;
  delegated-posts)
    COMMAND=(npm test -- tests/delegated-posts.test.ts --reporter=verbose)
    ;;
  command-deck-confirm)
    COMMAND=(npm test -- tests/command-deck-mutations.test.ts --reporter=verbose)
    ;;
  discord-journey-matrix)
    COMMAND=(npm run journeys:check)
    SECOND_COMMAND=(npm run journeys:verify)
    ;;
  *)
    echo "drive: unknown feature-id: $FEATURE" >&2
    usage >&2
    exit 2
    ;;
esac

cd "$REPO_ROOT"
{
  echo "feature=$FEATURE"
  echo "repo=$REPO_ROOT"
  echo "started=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "command=${COMMAND[*]}"
  if [[ -n "${SECOND_COMMAND[*]-}" ]]; then
    echo "command2=${SECOND_COMMAND[*]}"
  fi
} >"$META"

set +e
{
  echo "+ ${COMMAND[*]}"
  "${COMMAND[@]}"
  first_status=$?
  if [[ -n "${SECOND_COMMAND[*]-}" ]]; then
    echo "+ ${SECOND_COMMAND[*]}"
    "${SECOND_COMMAND[@]}"
    second_status=$?
  else
    second_status=0
  fi
} >"$LOG" 2>&1
set -e

{
  echo "finished=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "exit=${first_status}"
  if [[ -n "${SECOND_COMMAND[*]-}" ]]; then
    echo "exit2=${second_status}"
  fi
  echo "log=$LOG"
} >>"$META"

echo "drive: log=$LOG"
if [[ "$first_status" -ne 0 || "$second_status" -ne 0 ]]; then
  echo "drive: FAIL feature=$FEATURE" >&2
  exit 1
fi
echo "drive: PASS feature=$FEATURE"
exit 0
