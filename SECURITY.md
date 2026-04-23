# Security Notes

This repo now assumes a privacy-first deployment stance:

- public respondents should not be able to look up other respondents from the server
- respondent details should not be silently stored on shared devices
- admin state-changing routes should be same-origin protected
- production secrets should live in a local `.env.production`, not in Git

## Launch checklist

1. Copy `.env.production.example` to `.env.production`.
2. Set strong values for `POSTGRES_PASSWORD` and `SESSION_SECRET`.
3. Generate `ADMIN_USERS_JSON` with a strong password hash.
4. Start the stack with:

```bash
docker compose --env-file .env.production up --build -d
```

5. Apply the database schema with:

```bash
docker compose --env-file .env.production exec app pnpm --filter @workspace/db run push
```

6. Put Caddy in front of the app and keep `TRUST_PROXY=true`.

## What is hardened

- Admin session cookies are HTTP-only, `SameSite=Strict`, and use the `__Host-` prefix when secure cookies are enabled.
- Protected admin routes send `Cache-Control: no-store`.
- Respondent create, update, and delete routes now require same-origin browser requests.
- Public survey submission now enforces server-side validation and waiver acceptance.
- Public survey submissions deduplicate shift IDs and write inside a database transaction.
- Allocation adjustment now validates that every shift belongs to the active survey before writing.
- Database uniqueness rules now protect respondent emails, per-respondent shift responses, and per-survey shift allocations.
- The frontend no longer depends on Google Fonts, which keeps production CSP tight and avoids external font requests.

## Privacy boundaries

- Public users can submit availability for a survey token, but they should not be able to search prior respondents from the server.
- “Remember my details” is now device-local and opt-in. It should stay off on shared machines.
- `.env.production` is git-ignored and should never be pasted into tickets, chat logs, or screenshots.

## If something is exposed

Rotate immediately if any of these leak:

- `SESSION_SECRET`
- admin passwords and the resulting `ADMIN_USERS_JSON`
- `POSTGRES_PASSWORD`
- the public host if your DNS or reverse proxy is compromised

Then:

1. redeploy with fresh secrets
2. invalidate old admin sessions by rotating `SESSION_SECRET`
3. review reverse-proxy logs and database access
4. confirm `/admin/login`, `/api/healthz`, and one real survey route behave normally
