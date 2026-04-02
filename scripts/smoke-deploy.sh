#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

if command -v docker >/dev/null 2>&1; then
  echo "Docker detected. Running containerized deployment smoke test..."
  docker compose up --build -d
  trap 'docker compose down -v >/dev/null 2>&1 || true' EXIT

  for _ in {1..60}; do
    if curl -fsS "http://127.0.0.1:3000/api/healthz" >/tmp/fd-docker-health.json 2>/dev/null; then
      break
    fi
    sleep 1
  done

  curl -fsS "http://127.0.0.1:3000/api/healthz" >/tmp/fd-docker-health.json
  grep -q '"status":"ok"' /tmp/fd-docker-health.json

  echo "Containerized deployment smoke checks passed."
else
  echo "Docker not available. Falling back to local production smoke deployment test."
  bash ./scripts/smoke-deploy-local.sh
fi
