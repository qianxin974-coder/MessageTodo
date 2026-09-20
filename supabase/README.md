# Supabase 本地开发环境

本目录包含 MessageTodo 的数据库迁移与本地配置。

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

## 结构
- `migrations/001_*.sql` … `012_*.sql` — 基线 schema + RLS（源自 DoFirst，MIT）
- `config.toml` — Supabase CLI 配置（本地端口、auth 回调、站点 URL）
- `seed_test_tasks.sql` — 可选测试数据

> 说明：Phase 3 将在此基础上增加 MessageTodo 专属表（TaskSource、Reminder、UserSetting、Attachment 等）
> 并重排权限模型。在此之前请不要手工改生产数据库。
