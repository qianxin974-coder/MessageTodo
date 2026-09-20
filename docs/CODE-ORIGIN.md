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

## Phase 3 (MessageTodo data model + RLS) — new code
- `supabase/migrations/013_message_todo_models.sql` — **new** MessageTodo data model:
  `settings`, `task_sources`, `reminders`, `attachments`; strict `auth.uid() = user_id`
  RLS; `tasks` soft-delete (`deleted_at`) + optimistic-lock (`version`) columns;
  `tasks_delete` policy; `set_owner_user_id()` trigger; `get_user_settings()` helper.
  Written for MessageTodo (DoFirst had no such tables); only its SQL *style* follows
  the inherited migrations.
- `supabase/tests/rls_phase3.sql` — **new** cross-user RLS test (requires Supabase/Postgres).
- `packages/db/schemas.ts` — Phase 3 **additions**: `TaskSourceCreateSchema`,
  `ReminderCreateSchema/UpdateSchema`, `SettingsUpsertSchema`, `AttachmentCreateSchema`;
  also **fixed** the inherited `TaskUpdateSchema.priority` range (1–5 → 1–10).
- `packages/db/schemas.test.ts`, `packages/db/rls.test.ts` — **new** tests.
- `docs/PHASE3_DB_NOTES.md` — **new** design + difference note vs Phase 1 §13.
- API privacy fixes (no raw message / request body in logs):
  `apps/web/app/api/tasks.quickAdd|remindMe|unsnooze|delete/route.ts`,
  `apps/web/app/api/cron/nag/route.ts` — edits on inherited files.

> This document is a living list. Every future change that copies code from
> another project MUST add an entry here and in `THIRD_PARTY_NOTICES.md`.
