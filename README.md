# ISH Front Desk Allocator

A small, practical shift allocation app for humans who are tired of spreadsheet gymnastics.

Originally built for **International Student House, Washington DC** front desk operations, now open sourced so anyone can fork it and adapt it for other shift-based workflows: residence desks, labs, student orgs, clinics, events, support teams, and more.

## What It Does

- Creates monthly availability surveys with weekday/weekend shifts.
- Collects responses and manages respondent pools.
- Supports admin-side allocation and manual adjustments.
- Exports schedule outputs (including printable formats).
- Includes respondent-level stats and allocation analytics.
- Supports admin authentication for protected dashboard access.

## Why This Exists

Because “just one more shared sheet” is how civilizations collapse.

## Quick Start

```bash
pnpm install
pnpm build
pnpm --filter @workspace/api-server start
```

Then open:

- Admin: `http://localhost:3000/admin/login`
- Public survey links: `http://localhost:3000/respond/<token>`

For full deployment options (including no-cost self-hosting), see:

- `DEPLOYMENT.md`
- `ZERO_COST_SELF_HOSTING.md`

## Open Source + Copyright

Copyright (c) 2026 Ziauddin Sherkar.

This project is licensed under the MIT License. You are free to use, copy, modify, and distribute it, including for your own organization.

## Liability Waiver

This software is provided **"as is"**, without warranties or guarantees of any kind. By using this repository, you agree that the author and contributors are not liable for claims, damages, data loss, scheduling decisions, missed shifts, or other consequences resulting from use or misuse of this software.

In short: use it freely, customize it boldly, and sanity-check your schedules before publishing.

## Contributing

Fork it, improve it, and make shift planning less painful for everyone.
