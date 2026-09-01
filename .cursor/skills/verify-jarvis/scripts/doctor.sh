#!/usr/bin/env bash
# Read-only check: is this Jarvis checkout safe to drive with the CI harness?
# Never prints secret values. Never sources .env. Fail closed on live Discord,
# register-commands, production .env, or GAMING-BRO targeting.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: doctor.sh [--intent TEXT]... [--env-file PATH] [--skip-modules]

Fail closed if this checkout or process looks like a live Discord ship.
Does not start Jarvis, register commands, or source .env.
EOF
}

INTENTS=()
ENV_FILES=()
SKIP_MODULES=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --intent)
      INTENTS+=("${2-}")
      shift 2
      ;;
    --env-file)
      ENV_FILES+=("${2-}")
      shift 2
      ;;
    --skip-modules)
      SKIP_MODULES=1
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "doctor: unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

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
  echo "doctor: could not find jarvis-discord-bot package.json above $SCRIPT_DIR" >&2
  exit 1
}

FAILURES=()

fail() {
  FAILURES+=("$1")
}

env_has_nonempty() {
  local name="$1"
  [[ -n "${!name-}" ]]
}

# Read KEY=value lines without printing values. Sets:
#   envfile_<KEY>=1 if the key is present with a non-empty value
#   envfile_value_<KEY> holds the value only for allowlisted non-secret keys.
load_env_file_markers() {
  local path="$1"
  local prefix="$2"
  [[ -f "$path" ]] || return 0

  local line key raw
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ -z "$line" || "$line" == \#* ]] && continue
    [[ "$line" != *=* ]] && continue
    key="${line%%=*}"
    raw="${line#*=}"
    key="${key#"${key%%[![:space:]]*}"}"
    key="${key%"${key##*[![:space:]]}"}"
    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    raw="${raw#"${raw%%[![:space:]]*}"}"
    raw="${raw%"${raw##*[![:space:]]}"}"
    if [[ "$raw" == \"*\" && "$raw" == *\" ]]; then
      raw="${raw:1:${#raw}-2}"
    elif [[ "$raw" == \'*\' && "$raw" == *\' ]]; then
      raw="${raw:1:${#raw}-2}"
    fi
    if [[ -n "$raw" ]]; then
      eval "${prefix}${key}=1"
      case "$key" in
        JARVIS_ENVIRONMENT | JARVIS_VERSION | DATABASE_PATH)
          eval "${prefix}value_${key}=\"\${raw}\""
          ;;
      esac
    fi
  done <"$path"
}

FORBIDDEN_INTENT_RE='register-commands|[[:space:]]start$|^start$|npm[[:space:]]+start|npm[[:space:]]+run[[:space:]]+start|npm[[:space:]]+run[[:space:]]+dev|[[:space:]]dev$|^dev$|gaming-bro|live[[:space:]]+discord|live[[:space:]]+guild|discord\.com/api|sites:publish|dependabot'

intent_is_forbidden() {
  local text="$1"
  local folded
  folded="$(printf '%s' "$text" | tr '[:upper:]' '[:lower:]')"
  # Focused Vitest of the registration *tests* is allowed. The live script is not.
  if [[ "$folded" == *'register-commands.test.ts'* ]]; then
    return 1
  fi
  if [[ "$folded" =~ $FORBIDDEN_INTENT_RE ]]; then
    return 0
  fi
  return 1
}

echo "doctor: repo=$REPO_ROOT"

if [[ ! -f "$REPO_ROOT/package-lock.json" ]]; then
  fail "package-lock.json is missing; verification needs the committed lockfile"
fi

if ! command -v node >/dev/null 2>&1; then
  fail "node is not on PATH; need Node.js 22 or newer"
else
  NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
  if [[ "$NODE_MAJOR" -lt 22 ]]; then
    fail "Node.js $NODE_MAJOR is too old; need 22 or newer"
  else
    echo "doctor: node=$(node -v)"
  fi
fi

if env_has_nonempty DISCORD_TOKEN; then
  fail "DISCORD_TOKEN is set in the process environment; refuse live Discord"
fi
if env_has_nonempty DISCORD_CLIENT_ID && env_has_nonempty DISCORD_GUILD_ID; then
  fail "DISCORD_CLIENT_ID and DISCORD_GUILD_ID are set; refuse live guild targeting"
fi

PROCESS_ENV_NAME="$(printf '%s' "${JARVIS_ENVIRONMENT-}" | tr '[:upper:]' '[:lower:]')"
case "$PROCESS_ENV_NAME" in
  production | prod | live)
    fail "JARVIS_ENVIRONMENT=${PROCESS_ENV_NAME} in the process environment; refuse production"
    ;;
esac

if [[ -n "${VERIFY_JARVIS_ALLOW_LIVE-}" || -n "${VERIFY_JARVIS_ALLOW_DISCORD-}" ]]; then
  fail "live-Discord override variables are set; doctor has no override and fails closed"
fi

REPO_ENV="$REPO_ROOT/.env"
if [[ -f "$REPO_ENV" ]]; then
  echo "doctor: .env is present (values not printed; file is not sourced)"
  load_env_file_markers "$REPO_ENV" "repoenv_"
  if [[ -n "${repoenv_DISCORD_TOKEN-}" ]]; then
    fail "repo .env has a non-empty DISCORD_TOKEN; refuse live Discord credentials"
  fi
  REPO_ENV_NAME="$(printf '%s' "${repoenv_value_JARVIS_ENVIRONMENT-}" | tr '[:upper:]' '[:lower:]')"
  case "$REPO_ENV_NAME" in
    production | prod | live)
      fail "repo .env is a production environment (JARVIS_ENVIRONMENT=${REPO_ENV_NAME})"
      ;;
  esac
fi

for extra in "${ENV_FILES[@]+"${ENV_FILES[@]}"}"; do
  if [[ ! -f "$extra" ]]; then
    fail "env-file not found: $extra"
    continue
  fi
  echo "doctor: inspecting extra env-file (path only; values not printed)"
  unset extraenv_DISCORD_TOKEN extraenv_value_JARVIS_ENVIRONMENT || true
  load_env_file_markers "$extra" "extraenv_"
  if [[ -n "${extraenv_DISCORD_TOKEN-}" ]]; then
    fail "env-file has a non-empty DISCORD_TOKEN; refuse live Discord credentials"
  fi
  EXTRA_ENV_NAME="$(printf '%s' "${extraenv_value_JARVIS_ENVIRONMENT-}" | tr '[:upper:]' '[:lower:]')"
  case "$EXTRA_ENV_NAME" in
    production | prod | live)
      fail "env-file is a production environment (JARVIS_ENVIRONMENT=${EXTRA_ENV_NAME})"
      ;;
  esac
done

NPM_EVENT="$(printf '%s' "${npm_lifecycle_event-}" | tr '[:upper:]' '[:lower:]')"
if [[ "$NPM_EVENT" == "register-commands" || "$NPM_EVENT" == "start" || "$NPM_EVENT" == "dev" ]]; then
  fail "npm lifecycle event is $NPM_EVENT; refuse live ship commands"
fi

for intent in "${INTENTS[@]+"${INTENTS[@]}"}"; do
  if intent_is_forbidden "$intent"; then
    fail "forbidden verification intent (live Discord, register-commands, production start, GAMING-BRO, or Sites publish)"
  fi
done

if [[ "$SKIP_MODULES" -eq 0 ]]; then
  if [[ ! -x "$REPO_ROOT/node_modules/.bin/vitest" ]]; then
    fail "vitest is missing; launch first with: npm ci --legacy-peer-deps"
  else
    echo "doctor: vitest=present"
  fi
fi

if [[ ${#FAILURES[@]} -gt 0 ]]; then
  echo "doctor: FAIL closed" >&2
  for item in "${FAILURES[@]}"; do
    echo "doctor: - $item" >&2
  done
  exit 1
fi

echo "doctor: PASS"
echo "doctor: surface=ci-harness"
echo "doctor: live-discord=refused"
echo "doctor: register-commands=refused"
echo "doctor: production-env=refused"
echo "doctor: pwsh=$(command -v pwsh >/dev/null 2>&1 && echo present || echo absent)"
exit 0
