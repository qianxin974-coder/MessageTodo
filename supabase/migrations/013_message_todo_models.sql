-- ============================================================================
-- 013_message_todo_models.sql
-- MessageTodo Phase 3 — MessageTodo 专属数据模型 + 严格 RLS
--
-- 原则（与 Phase 3 约束一致）：
--   1) 不改动 001–012（DoFirst MIT 基线）任何历史迁移；
--   2) 全部使用幂等写法，可在“全新库(001→013)”或“已存在 DoFirst 基线库”上继续执行；
--   3) 新增 MessageTodo 模型：settings / task_sources / reminders / attachments；
--   4) tasks 追加 deleted_at（软删除墓碑，供离线同步）与 version（乐观锁/冲突处理）；
--   5) 补齐 tasks 的 DELETE 策略（基线只有 read/insert/update，导致现有 delete API 在 RLS 下静默失效）；
--   6) 新增表一律 auth.uid() = user_id 严格归属：禁止通过伪造 user_id/task_id 访问他人数据。
--
-- 身份来源约定：user_id 一律由服务端从 Supabase Auth session(auth.uid()) 取得，
-- 客户端提交的 user_id 不可信；RLS with check 与 BEFORE INSERT 触发器双重兜底。
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. 枚举类型（DO 块实现幂等；PostgreSQL 的 CREATE TYPE 不支持 IF NOT EXISTS）
-- ----------------------------------------------------------------------------
do $$
begin
  create type public.task_source_type as enum (
    'manual','share','clipboard','email','telegram','slack',
    'discord','whatsapp','wechat','web','api','other'
  );
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.reminder_status as enum (
    'scheduled','fired','snoozed','dismissed','cancelled','completed'
  );
exception when duplicate_object then null;
end $$;

-- ----------------------------------------------------------------------------
-- 1. settings — 用户设置（时区 / 原文保存隐私开关 / 默认提醒提前量）
--    关系：user 1 ── 1 settings
-- ----------------------------------------------------------------------------
create table if not exists public.settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  timezone text not null default 'Asia/Shanghai',        -- IANA 时区名；禁止假设统一时区
  locale text not null default 'zh-CN',
  use_24h boolean not null default true,
  default_reminder_offset_minutes int not null default 30, -- 默认提前提醒分钟数（如提前 30 分钟）
  keep_original_text boolean not null default true,        -- 隐私开关：是否保存原始消息全文
  quiet_hours jsonb,                                       -- {start:"HH:MM", end:"HH:MM"} 免打扰
  preferences jsonb not null default '{}'::jsonb,          -- 其它偏好（保留扩展位）
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.settings is 'MessageTodo 用户设置：时区 / 原文保存隐私开关 / 默认提醒提前量 / 免打扰';
comment on column public.settings.timezone is 'IANA 时区（如 Asia/Shanghai、America/New_York）';
comment on column public.settings.keep_original_text is '隐私开关：false 时不保存原始消息全文';
comment on column public.settings.default_reminder_offset_minutes is '新建任务时的默认提前提醒分钟数';
comment on column public.settings.quiet_hours is '免打扰时间段 {start,end}（与 nagging_preferences 兼容格式）';

-- ----------------------------------------------------------------------------
-- 2. task_sources — 任务来源 / 原始消息
--    关系：user → task → task_source → original message
--    隐私：original_text 可为 NULL（关闭原文保存时不落库）；keep_original 记录该条是否保留原文。
--    parsed_title / parsed_description 保留“AI 解析后的必要信息”，即使原文不保存也在。
-- ----------------------------------------------------------------------------
create table if not exists public.task_sources (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  source_type public.task_source_type not null default 'manual',
  source_metadata jsonb not null default '{}'::jsonb,   -- app_name / device / conversation_id / share 平台等
  original_text text,                                   -- NULL = 未保存原文（隐私开关关闭）
  keep_original boolean not null default true,          -- 该条是否保留原文
  parsed_title text,                                    -- AI/解析后的标题（即使不保存原文也保留）
  parsed_description text,                              -- AI/解析后的描述
  created_at timestamptz not null default now()
);

comment on table public.task_sources is 'MessageTodo 任务来源：原始消息 + 来源 + 原文保存隐私开关（区别于 DoFirst task_submissions）';
comment on column public.task_sources.original_text is '原始消息全文；隐私开关关闭时为 NULL';
comment on column public.task_sources.keep_original is '该条是否保留原文（受 settings.keep_original_text 全局开关影响）';
comment on column public.task_sources.source_metadata is '来源元数据：app_name / device / conversation_id / share 平台等';

-- ----------------------------------------------------------------------------
-- 3. reminders — 提醒（独立模型）
--    关系：task 1 ── N reminders
--    支持：提前 N 分钟(offset_minutes)、绝对时间(remind_at)、snooze(改 remind_at 回 scheduled)、
--          周期提醒(recurrence 预留)、通知投递状态(notification_status)、完成后停止(completed/cancelled)。
-- ----------------------------------------------------------------------------
create table if not exists public.reminders (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  remind_at timestamptz not null,
  offset_minutes int,                       -- 相对 due_at 的提前量；NULL = remind_at 为绝对时间
  status public.reminder_status not null default 'scheduled',
  recurrence jsonb,                         -- 周期提醒规则（与 tasks.recurrence 结构一致，预留）
  notification_status text,                 -- pending / delivered / failed / cancelled
  last_notified_at timestamptz,             -- 最近一次通知投递时间
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.reminders is 'MessageTodo 提醒模型：独立于 tasks.remind_at，支持多条/提前量/snooze/周期/投递状态';
comment on column public.reminders.offset_minutes is '提前 N 分钟（如 5/30）；NULL 表示 remind_at 为绝对时间';
comment on column public.reminders.status is 'reminder 生命周期：scheduled/fired/snoozed/dismissed/cancelled/completed';
comment on column public.reminders.notification_status is '通知投递状态（pending/delivered/failed/cancelled），Phase 4 投递链路使用';
comment on column public.reminders.recurrence is '周期提醒规则（预留，如 {freq:weekly}）';

-- ----------------------------------------------------------------------------
-- 4. attachments — 附件（图片 / PDF / 文件）
--    关系：task 1 ── N attachments；权限与 user_id 绑定。
-- ----------------------------------------------------------------------------
create table if not exists public.attachments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  storage_path text not null,               -- Supabase Storage 对象路径
  file_name text not null,
  mime_type text,
  size_bytes int,
  created_at timestamptz not null default now()
);

comment on table public.attachments is 'MessageTodo 附件：图片/PDF/文件，storage_path 指向 Supabase Storage，权限绑定 user_id';

-- ----------------------------------------------------------------------------
-- 5. tasks 追加字段（幂等；不改既有列语义）
-- ----------------------------------------------------------------------------
alter table public.tasks add column if not exists deleted_at timestamptz;
alter table public.tasks add column if not exists version bigint not null default 0;

comment on column public.tasks.deleted_at is '软删除墓碑（离线同步 / 服务端删除同步用，Phase 8）';
comment on column public.tasks.version is '乐观锁版本号（冲突处理用，Phase 8）';

-- ----------------------------------------------------------------------------
-- 6. 索引
-- ----------------------------------------------------------------------------
create index if not exists idx_task_sources_task on public.task_sources(task_id);
create index if not exists idx_task_sources_user on public.task_sources(user_id);
create index if not exists idx_reminders_task on public.reminders(task_id);
create index if not exists idx_reminders_user_at on public.reminders(user_id, remind_at) where status = 'scheduled';
create index if not exists idx_attachments_task on public.attachments(task_id);
create index if not exists idx_attachments_user on public.attachments(user_id);
create index if not exists idx_tasks_created_by_deleted_at on public.tasks(created_by, deleted_at);

-- ----------------------------------------------------------------------------
-- 7. 启用 RLS
-- ----------------------------------------------------------------------------
alter table public.settings enable row level security;
alter table public.task_sources enable row level security;
alter table public.reminders enable row level security;
alter table public.attachments enable row level security;

-- ----------------------------------------------------------------------------
-- 8. 身份兜底触发器：user_id 为空时自动填 auth.uid()（来自 session，不可伪造）
--    仅当 user_id 为 NULL 时填充：普通客户端省略 user_id 也能写入正确归属；
--    同时服务角色（cron 等）仍可显式指定 user_id（受信路径）。
-- ----------------------------------------------------------------------------
create or replace function public.set_owner_user_id()
returns trigger language plpgsql as $$
begin
  if new.user_id is null then
    new.user_id := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_settings_owner on public.settings;
create trigger trg_settings_owner before insert on public.settings
  for each row execute function public.set_owner_user_id();

drop trigger if exists trg_task_sources_owner on public.task_sources;
create trigger trg_task_sources_owner before insert on public.task_sources
  for each row execute function public.set_owner_user_id();

drop trigger if exists trg_reminders_owner on public.reminders;
create trigger trg_reminders_owner before insert on public.reminders
  for each row execute function public.set_owner_user_id();

drop trigger if exists trg_attachments_owner on public.attachments;
create trigger trg_attachments_owner before insert on public.attachments
  for each row execute function public.set_owner_user_id();

-- ----------------------------------------------------------------------------
-- 9. RLS 策略
--    新增表一律 auth.uid() = user_id：
--      - User A 只能读写自己的 settings/task_sources/reminders/attachments；
--      - 无法通过伪造 user_id 写入他人行（with check）；
--      - 无法通过 task_id 间接读取他人原始消息（user_id 不匹配 → 0 行）。
--    同时补齐 tasks 的 DELETE 策略（基线缺失，导致现有 delete API 静默失效）。
-- ----------------------------------------------------------------------------
drop policy if exists settings_owner_all on public.settings;
create policy settings_owner_all on public.settings
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists task_sources_owner_all on public.task_sources;
create policy task_sources_owner_all on public.task_sources
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists reminders_owner_all on public.reminders;
create policy reminders_owner_all on public.reminders
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists attachments_owner_all on public.attachments;
create policy attachments_owner_all on public.attachments
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- tasks 删除：任务创建者或 pool owner 可删（与现有 tasks_update 语义一致）
drop policy if exists tasks_delete on public.tasks;
create policy tasks_delete on public.tasks
  for delete using (
    auth.uid() in (select owner_id from public.pools where id = pool_id)
    or created_by = auth.uid()
  );

-- ----------------------------------------------------------------------------
-- 10. 工具函数：get_user_settings（get-or-create）
--     与 DoFirst get_nagging_preferences 模式一致，但加了 auth.uid() 校验，
--     防止“传他人 user_id 创建/读取他人设置”的攻击路径。
-- ----------------------------------------------------------------------------
create or replace function public.get_user_settings(p_user_id uuid)
returns table (
  user_id uuid,
  timezone text,
  locale text,
  use_24h boolean,
  default_reminder_offset_minutes int,
  keep_original_text boolean,
  quiet_hours jsonb,
  preferences jsonb
)
language plpgsql security definer as $$
begin
  -- 只允许读取/初始化自己的设置
  if p_user_id <> auth.uid() then
    return;
  end if;

  insert into public.settings (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  return query
    select s.user_id, s.timezone, s.locale, s.use_24h,
           s.default_reminder_offset_minutes, s.keep_original_text,
           s.quiet_hours, s.preferences
    from public.settings s
    where s.user_id = p_user_id;
end;
$$;
