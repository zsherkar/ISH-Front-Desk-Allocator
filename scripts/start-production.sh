#!/bin/sh
set -eu

echo "Applying database schema..."
pnpm --filter @workspace/db run push

echo "Starting API server..."
exec node artifacts/api-server/dist/index.cjs
