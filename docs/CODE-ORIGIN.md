# Code Origin

Which files come from DoFirst vs. are newly written for MessageTodo.

## Derived from DoFirst (MIT)
- `packages/nagging/*`, `packages/recurrence/*` — pure logic, unmodified
- `packages/rate-limit/*`, `packages/logging/*`, `packages/notifications/*` (web part)
- `packages/db/schemas.ts` (adapted), `packages/design-system/*`
- `apps/web/*` — skeleton (shell, auth, pages, API routes) rebranded and trimmed
- `supabase/migrations/001_init.sql` … `012_add_completed_at.sql` (baseline)
- `supabase/seed_test_tasks.sql`

## Newly written for MessageTodo
- Repository scaffolding: `pnpm-workspace.yaml`, root `package.json`,
  `vitest.config.ts`, `eslint.config.mjs`, `.gitignore`, `.env.example`
- `LICENSE` (MIT, includes DoFirst attribution), `THIRD_PARTY_NOTICES.md`, `README.md`
- `supabase/config.toml`, `supabase/README.md`
- Rebranding edits throughout `apps/web` (title "MessageTodo", nav Today/Inbox/Settings)
- Removed collaboration features (Pool/People pages, today.* and members.* API routes)

> This document is a living list. Every future change that copies code from
> another project MUST add an entry here and in `THIRD_PARTY_NOTICES.md`.
