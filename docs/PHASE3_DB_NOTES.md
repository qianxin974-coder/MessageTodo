# Phase 3 — 数据库改造说明（MessageTodo 数据模型 + RLS）

> 本文记录 Phase 3 的数据库改动、设计决策，以及 **Phase 1 报告第 13 节方案与实际数据库结构之间的差异**。
> 原则：以实际代码与 migration 为准。

## 0. 结论速览

- 新增 migration：`supabase/migrations/013_message_todo_models.sql`（唯一的本阶段 DB 改动）。
- 未修改/删除任何 001–012（DoFirst MIT 基线）历史迁移。
- 新增 4 张表：`settings`、`task_sources`、`reminders`、`attachments`。
- `tasks` 追加 2 个字段：`deleted_at`（软删除墓碑）、`version`（乐观锁）。
- 补齐 `tasks` 缺失的 DELETE 策略（基线只有 read/insert/update）。
- 新增 `supabase/tests/rls_phase3.sql`（真实 RLS 交叉用户测试，需 Supabase/Postgres 环境运行）。
- 新增 `packages/db/rls.test.ts`（静态策略断言，本机 CI 可运行）+ `packages/db/schemas.test.ts`。

## 1. Phase 1 第 13 节方案 vs 实际数据库结构（差异说明）

| 第 13 节方案 | 实际实施 / 差异 |
|---|---|
| 在 `task_submissions` 上追加 `source_type` / `source_metadata` / `keep_original` | **未采用**。按当前 Phase 3 要求，新建独立 `task_sources` 表作为 MessageTodo 的“任务来源/原始消息”模型；DoFirst 的 `task_submissions` 保留不动（现有 Inbox 页面仍在读它，改动会破坏 UI）。 |
| `tasks.source_submission_id` FK 指向 `task_submissions` | **未采用**。改为反向关联：`task_sources.task_id → tasks(id)`，关系 `task → task_source`，更贴近“user → task → task_source → original message”。 |
| `tasks.is_inbox` 显式字段 | **未采用**。Inbox 可由 `due_at IS NULL AND status='open'` 派生（与现有“Unsorted/priority=NULL”语义一致），后续 UI 需要时再加显式字段，避免现在引入冗余列。 |
| `notifications` 扩展 `read_at` / `action` / `task_id` | **推迟**。`reminders` 表已覆盖“提醒状态/投递状态”，`notifications` 表留待通知中心（后续 Phase）再接；本阶段不新增没人消费的字段。 |
| `pools.timezone` 默认改为跟随用户 | **推迟**。时区归属从本阶段起收敛到 `settings.timezone`；`pools.timezone` 是 DoFirst 历史字段，改动会触碰既有页面/API，后续再迁移。 |
| `tasks.deleted_at` + `version` | **已实施**（与方案一致）。供 Phase 8 离线同步/冲突处理使用。 |

## 2. 新增表设计

### settings（user 1 ── 1 settings）
- `user_id` PK（FK auth.users，on delete cascade）
- `timezone`：IANA 时区名，默认 `Asia/Shanghai`（**禁止假设统一时区**；后续由客户端在注册/设置时覆盖）
- `keep_original_text`：原文保存隐私开关（默认 true）
- `default_reminder_offset_minutes`：默认提前提醒分钟数（默认 30）
- `quiet_hours`：免打扰 `{start,end}`（与 `nagging_preferences` 兼容格式）
- `preferences`：JSONB 扩展位

### task_sources（user → task → task_source → original message）
- `task_id` FK（on delete cascade：**删除任务时级联删除原始消息**，满足隐私要求）
- `user_id` FK（RLS 归属）
- `source_type`：枚举 `manual/share/clipboard/email/telegram/slack/discord/whatsapp/wechat/web/api/other`
- `source_metadata`：JSONB（app_name / device / conversation_id / share 平台等）
- `original_text`：**可空**（隐私开关关闭时不落库）
- `keep_original`：该条是否保留原文
- `parsed_title` / `parsed_description`：AI 解析后的必要信息，**即使原文不保存也保留**

### reminders（task 1 ── N reminders）
- `task_id` FK（on delete cascade）、`user_id` FK
- `remind_at`（绝对时间）或 `offset_minutes`（相对 due_at 提前量，如 5/30）——二选一
- `status`：`scheduled/fired/snoozed/dismissed/cancelled/completed`（snooze 即改 remind_at 回到 scheduled）
- `recurrence`：JSONB，周期提醒预留
- `notification_status`：`pending/delivered/failed/cancelled`（Phase 4 投递链路）
- `last_notified_at`

### attachments（task 1 ── N attachments）
- `task_id` FK（on delete cascade）、`user_id` FK
- `storage_path`（Supabase Storage 对象路径）、`file_name`、`mime_type`、`size_bytes`

## 3. tasks 追加字段
- `deleted_at timestamptz`：软删除墓碑（Phase 8 删除同步）
- `version bigint default 0`：乐观锁（Phase 8 冲突处理）
- 索引 `(created_by, deleted_at)`

## 4. RLS 设计（本阶段重点）

新增表一律 **严格用户归属**：

```sql
for all using (auth.uid() = user_id) with check (auth.uid() = user_id)
```

- User A 只能读写自己的 settings/task_sources/reminders/attachments。
- `with check` 阻止写入 `user_id ≠ auth.uid()` 的行 → 无法伪造 user_id 越权。
- 由于归属键是 `user_id` 而非 `task_id`，**无法通过 task_id 间接读取他人原始消息**。
- BEFORE INSERT 触发器 `set_owner_user_id()`：`user_id` 为空时自动填 `auth.uid()`（来自 session），普通客户端省略 user_id 也能正确归属；服务角色（cron）仍可显式指定 user_id（受信路径）。
- `get_user_settings()`：get-or-create，且校验 `p_user_id = auth.uid()`，封堵“传他人 user_id 创建/读取他人设置”。

**tasks 的兼容性说明**：`tasks` 仍沿用 DoFirst 的 pool 归属（`is_member`），以保证现有 Web/API 不破。跨用户隔离通过“每个用户拥有独立 pool + 非成员不可见”保证。补齐了缺失的 `tasks_delete` 策略（creator 或 pool owner 可删，与 `tasks_update` 语义一致），使现有 `tasks.delete` API 在 RLS 下真正生效。

## 5. 身份来源约定
- **user_id 一律从 Supabase Auth session（auth.uid()）取得，客户端提交的 user_id 不可信**。
- 既有 API（quickAdd/update/delete/complete/snooze/remindMe/unsnooze/notifications.*）均从 session/Bearer token 取身份，已在审计中确认。

## 6. API 层最小修复（Phase 3）
1. `packages/db/schemas.ts`：`TaskUpdateSchema.priority` 从 1–5 修正为 **1–10**（数据库 006 迁移早已扩展，属 Phase 2 遗留 bug）。
2. 隐私：移除 `tasks.quickAdd` 的请求体/原始标题日志、`tasks.remindMe`/`tasks.unsnooze` 的请求体日志、`tasks.delete` 的任务标题日志、`cron/nag` 的任务标题日志。**日志不得出现原始消息**。
3. 新增 MessageTodo 模型 zod schema（`TaskSourceCreateSchema` / `ReminderCreateSchema` / `ReminderUpdateSchema` / `SettingsUpsertSchema` / `AttachmentCreateSchema`），供后续 Phase 的 API 使用。

## 7. 测试与验证（本阶段）
- `pnpm test`：98 通过（46 基线 + 21 schema + 31 RLS 静态断言）
- `pnpm -r typecheck`：packages/db 与 web 均通过
- `pnpm lint`：0 error
- `pnpm build`：见构建输出
- `supabase/tests/rls_phase3.sql`：真实 RLS 交叉用户测试（T1–T7），**本机无 Docker/Supabase 未执行**，交付给用户在 Supabase 环境运行。

## 8. 后续建议（Phase 4）
- 把 `reminders` 接到提醒投递链路（cron/nag 改为读 reminders，弃用/迁移 task_nagging_state）。
- 修正 `cron/nag` 中 `tasks(... owner_id ...)` 的字段选择 bug（tasks 无 owner_id 列）。
- 新增 settings / task_sources / reminders / attachments 的 CRUD API（Phase 3 只建模不建 API，避免过度开发）。
- Inbox 页面从 `task_submissions` 迁移到 `task_sources`。

---

## 9. Phase 3 最终验收审计（追加 014，只做最小修正）

### 9.1 tasks 的 ownership / RLS —— 审计结论（未重构，仅记录）
- **结论：当前单用户产品模型下可靠。** `tasks.pool_id` 为 NOT NULL（任务必有 pool，无孤儿任务）；读访问严格要求 `is_member(auth.uid(), pool_id)`；MessageTodo 每人一个私有 pool，跨用户天然隔离。
- **已知风险（继承自 DoFirst，本阶段不修，Phase 4+ 决定）：**
  1. `tasks_update` 策略只有 `using`、**没有 `with check`**：创建者（created_by 匹配）或 pool owner 可把任务改到**任意 pool**（含他人 pool），导致任务被推入他人 pool 从而暴露给对方成员。
  2. 被移出 pool 的成员仍可 update/delete 自己创建的旧任务（策略只看 created_by，不看当前 membership）。
  3. 任务换 pool 后，其 `task_sources/reminders/attachments` 仍绑定原 user_id → 新 pool 成员能看到任务但看不到它的来源/原文（隐私安全但不一致）。
  - 缓解/后续方向：给 tasks 加 user_id + 收紧 update/delete 策略（加 `with check` 与 membership 校验）——**放到 Phase 4/5 再决策，不在此处重构**。

### 9.2 原始消息隐私优先级 —— 已修正（新增 014）
- 最终规则（数据库层强制不变量，`014_phase3_audit_hardening.sql`）：
  - `original_text 非空 ⟹ settings.keep_original_text = true AND task_sources.keep_original = true`
  - settings=false → 无论单条如何设置，都不得保存；settings=true 且 keep_original=true → 可保存；settings=true 且 keep_original=false → 不保存
- 修正前：013 只有字段，**无任何 DB 约束/触发器/API 保证该规则**（Phase 3 尚未新增 API）。
- 修正：`trg_task_sources_privacy`（BEFORE INSERT/UPDATE 强制清空）+ `trg_settings_privacy_scrub`（全局开关转 false 时清除存量原文）。规则在 DB 层闭环，不依赖未来 API 是否自觉。

### 9.3 reminders 数据约束 —— 已修正（新增 014 + zod 对齐）
- `remind_at` 为**权威触发时间**（NOT NULL）；`offset_minutes` 为相对 due_at 的**提前量意图（provenance）**，可同时存在（snooze 只改 remind_at）——不再存在“绝对/相对互斥”的非法组合，规避了原 zod “二选一”与 DB 模型的矛盾。
- 新增 CHECK：`offset_minutes` 必须为 `(0, 525600]`（1 年）；`notification_status` 限定 `pending/delivered/failed/cancelled`（可扩展，新增状态走一次 ALTER）。
- `status` 已是枚举约束；`recurrence` JSONB 预留周期提醒；snooze / 周期 / 投递状态数据模型均足够。Phase 4 若需“完成任务自动取消 reminders”，建议届时用 tasks.status 触发器实现（本阶段不加，避免过度设计）。
- zod 同步：`ReminderCreateSchema` 由“二选一”放宽为“至少其一”，offset 上限对齐 DB（525600）。

### 9.4 RLS 真实测试脚本 —— 已补齐（只改测试脚本）
- 原 `supabase/tests/rls_phase3.sql` 已覆盖用户点名的 6 项；审计后补：
  - [T8] A 不能修改/删除 B 的 settings/task_sources/reminders/attachments（写隔离）
  - [T9] 客户端省略 user_id → 触发器以 auth.uid() 填充归属
  - [T10] 隐私不变量：settings=false 时新原文被清空、存量原文被清除
- 说明：本机无 Docker/Supabase，**未真实执行**；交付脚本，需在用户 Supabase 环境 `psql "$DATABASE_URL" -f supabase/tests/rls_phase3.sql` 验证。静态断言（`packages/db/rls.test.ts`）已在本机 CI 通过。
