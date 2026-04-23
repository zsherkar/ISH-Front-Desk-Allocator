# Zero-Cost, No-Tier-Limit Deployment (Self-Hosted)

This project can be run end to end using only open-source software that you control.

## What "zero-cost forever" means here

- No paid API dependencies are required by this app.
- No managed cloud free tier is required.
- You run the service on hardware you control: a home server, office mini-PC, or old laptop.

You still need electricity and internet access, but there is no vendor usage cap that forces an upgrade.

## Stack used

- App runtime: Node.js
- Frontend build: Vite
- API server: Express
- Database: PostgreSQL
- Orchestration: Docker + Docker Compose
- HTTPS reverse proxy: Caddy
- Free public hostname: Duck DNS

## Quick start

1. Clone the repo and open the folder.
2. Copy `.env.production.example` to `.env.production`.
3. Fill in every placeholder in `.env.production`, especially:
   - `POSTGRES_PASSWORD`
   - `SESSION_SECRET`
   - `ADMIN_USERS_JSON`
   - `PUBLIC_APP_URL`
4. Start the stack with the env file:

   ```bash
   docker compose --env-file .env.production up --build -d
   ```

5. Apply the current database schema once the database is up:

   ```bash
   docker compose --env-file .env.production exec app pnpm --filter @workspace/db run push
   ```

The admin desk uses `PUBLIC_APP_URL` when you click `Copy Link`, so copied survey links stay externally shareable.

## Public access

Once you point Duck DNS at your machine and put Caddy in front of the app, your URLs look like this:

- Admin: `https://your-subdomain.duckdns.org/admin/login`
- Survey: `https://your-subdomain.duckdns.org/respond/<token>`

## Notes

- Keep the machine online.
- Forward ports `80` and `443` to the machine running the app.
- Leave `COOKIE_SECURE` unset in production.
- Set `TRUST_PROXY=true` when running behind Caddy or another reverse proxy.
- `.env.production` is intentionally git-ignored. Keep it local.
