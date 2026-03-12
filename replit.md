# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **Frontend**: React + Vite + Tailwind CSS + shadcn/ui

## Applications

### Shift Scheduler (`artifacts/shift-scheduler`)
A full-stack shift scheduling and allocation management system.

**Public side:**
- Survey response form at `/respond/:token` — respondents select their available shifts for the month
- Auto-generated shifts per month: weekday (9-11, 11-2, 2-5, 5-8) and weekend (8-12, 12-4, 4-8)

**Admin side (`/` — the main app):**
- **Surveys tab**: Create surveys by selecting month/year (auto-generates all weekday/weekend shifts), list surveys, copy survey link, close surveys
- **Survey Detail**: Manage responses, view stats, run allocation, see post-allocation analysis
  - Responses tab: All respondents, categories (AFP/General), shifts selected
  - Statistics tab: Pre-allocation availability analysis per respondent and shift type
  - Allocation tab: Run auto-allocation (AFP gets 3-4h first, General gets remaining hours equitably), manual adjustments
  - Allocation Stats tab: Post-allocation statistical analysis
- **Respondents tab**: Manage respondent records (name, email, category)

**Allocation rules:**
- AFP category: each AFP member gets 3-4 hours first (configurable)
- General category: remaining shifts distributed so hours are within 1-2 std devs of average
- Everyone only gets shifts they selected as available
- Manual overrides supported with penalty notes

## Structure

```text
artifacts-monorepo/
├── artifacts/
│   ├── api-server/         # Express API server
│   │   └── src/
│   │       ├── routes/     # surveys.ts, allocations.ts, respond.ts, respondents.ts
│   │       └── lib/        # shiftGenerator.ts, allocationEngine.ts
│   └── shift-scheduler/    # React + Vite frontend
├── lib/
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   └── db/
│       └── src/schema/     # surveys, shifts, respondents, responses, allocations
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── tsconfig.json
└── package.json
```

## Database Tables

- `surveys` — month/year surveys with token for public access
- `shifts` — auto-generated shifts per survey (weekday/weekend)
- `respondents` — people who respond (AFP or General category)
- `responses` — which shifts each respondent selected per survey
- `allocations` — final shift assignments per survey (with manual adjustment flag)

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json` which sets `composite: true`. The root `tsconfig.json` lists all packages as project references.

- **Always typecheck from the root** — run `pnpm run typecheck`
- **`emitDeclarationOnly`** — we only emit `.d.ts` files during typecheck

## Root Scripts

- `pnpm run build` — runs `typecheck` first, then recursively runs `build` in all packages
- `pnpm run typecheck` — runs `tsc --build --emitDeclarationOnly`
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API client hooks and Zod schemas
- `pnpm --filter @workspace/db run push` — push DB schema changes
