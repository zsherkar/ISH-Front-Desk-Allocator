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