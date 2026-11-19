#!/usr/bin/env bash
# Run the server locally in watch mode: tsc rebuilds on save, node restarts on rebuild.
# Usage: scripts/run.sh [env]   (no env → pick one of .env/<env>/server.env)
set -euo pipefail
cd "$(dirname "$0")/.."

NODE_VERSION=$(cat .nvmrc)
if [ "$(node -v 2>/dev/null)" != "v$NODE_VERSION" ] && [ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "${NVM_DIR:-$HOME/.nvm}/nvm.sh"
  nvm use --silent "$NODE_VERSION"
fi
if [ "$(node -v)" != "v$NODE_VERSION" ]; then
  echo "Node v$NODE_VERSION is required (found $(node -v))." >&2
  exit 1
fi

ENVS=()
for file in .env/*/server.env; do
  ENVS+=("$(basename "$(dirname "$file")")")
done

APP_ENV=${1:-}
if [ -z "$APP_ENV" ]; then
  PS3="Environment: "
  select APP_ENV in "${ENVS[@]}"; do
    [ -n "$APP_ENV" ] && break
  done
fi
if [ ! -f ".env/$APP_ENV/server.env" ]; then
  echo "Unknown environment: $APP_ENV (available: ${ENVS[*]})" >&2
  exit 1
fi

npx tsc -p tsconfig.build.json
npx tsc -p tsconfig.build.json --watch --preserveWatchOutput &
TSC_PID=$!
trap 'kill "$TSC_PID" 2>/dev/null' EXIT

APP_ENV="$APP_ENV" node --watch dist/main.js
