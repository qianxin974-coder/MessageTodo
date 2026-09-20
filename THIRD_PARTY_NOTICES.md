# Third-Party Notices

MessageTodo reuses and adapts code from third parties. This file records source,
license and usage for each piece, as required for a commercial product.

## DoFirst (MIT) — technical base

- **Project:** DoFirst — https://github.com/tettertotter/dofirst
- **License:** MIT, Copyright (c) 2025
- **Commit used:** 97eda7f (single squashed commit at analysis time)
- **Usage:** Migrated and adapted as the technical base, then rebranded.
  Full details of which files derive from DoFirst are listed in `docs/CODE-ORIGIN.md`.

### Migrated/adapted from DoFirst (with package rename `@todaypool/*` -> `@messagetodo/*`)

| Area | Notes |
|---|---|
| `packages/nagging` | Reminder/nagging scheduler algorithm (Due-style cadence, quiet hours, catch-up). Pure TS, unmodified. |
| `packages/recurrence` | Recurring-task next-instance computation. Pure TS, unmodified. |
| `packages/rate-limit` | Token-bucket rate limiter + Next middleware. Adapted imports. |
| `packages/logging` | Structured logging + sensitive-field redaction. Adapted imports. |
| `packages/notifications` | Platform notification adapter interface + Web adapter + service-worker payload types. Phase 2 ships the Web adapter only. |
| `packages/db` | Zod request schemas. Adapted (priority range fixed to 1–10). |
| `packages/design-system` | Web component library + design tokens + hooks. Adapted imports. |
| `apps/web` | Next.js 15 web app skeleton: layout/shell, auth (magic link), Today/Inbox/Settings pages, task API routes, Web Push, cron nag. Trimmed (collaboration pages/routes removed) and rebranded to MessageTodo. |
| `supabase/migrations/001–012` | Baseline PostgreSQL schema + RLS from DoFirst. Phase 3 will extend/reshape. |
| `supabase/seed_test_tasks.sql` | Test seed data. |

## DaySpark (GPLv3) — NOT used

- **Project:** DaySpark — https://github.com/liuchangchxy/dayspark
- **License:** GPL-3.0
- **Usage:** None. Referenced only for product/UX ideas. No code, SQL or
  configuration was copied, per the licensing constraint in our project policy.

## npm dependencies

All runtime/build dependencies are declared in each package's `package.json`.
Key ones and their licenses:

| Dependency | License | Purpose |
|---|---|---|
| next | MIT | Web framework |
| react / react-dom | MIT | UI |
| @supabase/supabase-js, @supabase/ssr | MIT | Supabase client |
| web-push | MIT | Web Push (VAPID) |
| zod | MIT | Input validation |
| framer-motion | MIT | Animations |
| vitest | MIT | Testing |
| eslint / eslint-config-next | MIT | Linting |
| typescript | Apache-2.0 | Language tooling |

> Verify the exact license of each version installed via `pnpm licenses list`
> before commercial release; the table above reflects common versions at the
> time of writing and is not a substitute for a final license audit.
