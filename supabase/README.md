# Supabase 本地开发环境

本目录包含 MessageTodo 的数据库迁移、测试与本地配置。

## 前置
- Docker Desktop
- Supabase CLI：`winget install supabase.cli` 或 `scoop install supabase`

## 步骤
```bash
# 在仓库根目录
supabase start            # 启动本地堆栈（postgres / api / auth / realtime / storage）
supabase db reset         # 应用 supabase/migrations/*.sql 并可选运行 seed
```
`supabase start` 会输出本地 URL 与 anon/service_role key，
填入 `apps/web/.env.local`（见仓库根 `.env.example`）。

## RLS 交叉用户测试（Phase 3）
```bash
# 在 Supabase SQL Editor / psql 以 postgres 角色运行：
psql "$DATABASE_URL" -f supabase/tests/rls_phase3.sql
# 覆盖：A 读自己 / A 不能读 B / 不能改 B / 不能删 B / 不能经 task_sources 读 B 原文 / 越权写入被拒
```

## 结构
- `migrations/001_*.sql` … `012_*.sql` — DoFirst MIT 基线（保持不变）
- `migrations/013_message_todo_models.sql` — MessageTodo 数据模型（settings / task_sources / reminders / attachments + 严格 RLS）
- `migrations/014_phase3_audit_hardening.sql` — 审计加固：原文保存隐私不变量触发器 + reminders 约束
- `tests/rls_phase3.sql` — 真实 RLS 交叉用户测试
- `config.toml` — Supabase CLI 配置（本地端口、auth 回调、站点 URL）
- `seed_test_tasks.sql` — 可选测试数据
