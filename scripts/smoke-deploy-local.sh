#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

PORT="${PORT:-4310}"
DATABASE_URL="${DATABASE_URL:-postgresql://fd_admin:fd_password_change_me@127.0.0.1:5432/fd_allocator}"

echo "Building production frontend and API..."
pnpm --filter @workspace/shift-scheduler run build >/tmp/shift-build.log
pnpm --filter @workspace/api-server run build >/tmp/api-build.log

echo "Starting production server on port ${PORT} for smoke checks..."
NODE_ENV=production PORT="$PORT" DATABASE_URL="$DATABASE_URL" \
  node artifacts/api-server/dist/index.cjs >/tmp/fd-smoke-server.log 2>&1 &
SERVER_PID=$!

cleanup() {
  kill "$SERVER_PID" >/dev/null 2>&1 || true
}
trap cleanup EXIT

for _ in {1..40}; do
  if curl -fsS "http://127.0.0.1:${PORT}/api/healthz" >/tmp/fd-health.json 2>/dev/null; then
    break
  fi
  sleep 0.25
done

curl -fsS "http://127.0.0.1:${PORT}/api/healthz" >/tmp/fd-health.json
grep -q '"status":"ok"' /tmp/fd-health.json

curl -fsS "http://127.0.0.1:${PORT}/" >/tmp/fd-index.html
grep -qi "<!doctype html>" /tmp/fd-index.html

echo "Smoke deploy checks passed."
