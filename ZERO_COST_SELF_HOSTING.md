# Zero-Cost, No-Tier-Limit Deployment (Self-Hosted)

This project can be run end-to-end using only open-source software that you control.

## What "zero-cost forever" means here

- No paid API dependencies are required by this app.
- No managed cloud free-tier is required.
- You run the service on hardware you control (home server, office mini-PC, old laptop, etc.).

You still need electricity + internet, but there is no vendor usage cap that forces an upgrade.

## Stack used

- App runtime: Node.js (open source)
- Frontend build: Vite (open source)
- API server: Express (open source)
- Database: PostgreSQL (open source)
- Orchestration: Docker + Docker Compose (open source)

## Quick start (single-machine)

1. Clone repo and open the folder.
2. Update credentials in `docker-compose.yml` (at minimum the Postgres password).
3. Start:

   ```bash
   docker compose up --build -d
   ```

4. Apply database schema (first boot only):

   ```bash
   docker compose exec app pnpm --filter @workspace/db run push
   ```

5. Open:
   - App: `http://localhost:3000`
   - Health check: `http://localhost:3000/api/healthz`

## Smoke test without Docker (fallback)

If Docker is unavailable on your host, you can still verify a production-like run:

```bash
pnpm run smoke:deploy-local
```

This script builds frontend + API, starts the production server, checks `/api/healthz`,
and confirms the root HTML page is served.

## One-command smoke deployment (auto mode)

```bash
pnpm run smoke:deploy
```

- Uses Docker Compose if Docker is installed.
- Automatically falls back to local production smoke test if Docker is unavailable.
- Implemented in Node scripts, so it works in PowerShell/CMD/Bash without requiring `bash`.

## Windows troubleshooting

If you see `Cannot find module @rollup/rollup-win32-x64-msvc` during `pnpm run smoke:deploy`:

1. Ensure `pnpm-workspace.yaml` does not override `rollup-win32-x64-msvc` to `'-'`.
2. Reinstall dependencies cleanly:

```powershell
Remove-Item -Recurse -Force node_modules
pnpm install
```

## Operations checklist

- **Backups**: nightly `pg_dump` of `fd_allocator`.
- **Updates**:

  ```bash
  git pull
  docker compose up --build -d
  ```

- **Restore test**: practice restoring a backup monthly.
- **Security**:
  - put behind a reverse proxy with HTTPS (Caddy/Nginx),
  - keep OS + Docker patched,
  - restrict admin access using network controls/VPN while auth is being added.

## Local development (frontend + API)

Run API and frontend in separate terminals:

```bash
# terminal 1
PORT=4000 pnpm --filter @workspace/api-server run dev

# terminal 2
PORT=3000 API_SERVER_URL=http://127.0.0.1:4000 pnpm --filter @workspace/shift-scheduler run dev
```

The Vite dev server proxies `/api/*` to `API_SERVER_URL` (defaults to `http://127.0.0.1:4000`).

## Why this satisfies the requirement

- Every required runtime component is open source.
- No dependency on any paid API or free-tier quota gates.
