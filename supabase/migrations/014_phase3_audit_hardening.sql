-- ============================================================================
-- 014_phase3_audit_hardening.sql
-- Phase 3 最终验收审计后的最小加固（不改 001–013，仅追加 014）
--
-- 1) 原始消息隐私优先级 —— 数据库层强制不变量（不依赖未来 API）：
--      不变量：task_sources.original_text 非空
--              ⟹ settings.keep_original_text = true
--                AND task_sources.keep_original = true
--    规则：
--      - settings.keep_original_text = false  → 无论单条如何设置，不得保存 original_text
--      - settings.keep_original_text = true 且 keep_original = true  → 可保存
--      - settings.keep_original_text = true 且 keep_original = false → 不保存
--    实现：task_sources BEFORE INSERT/UPDATE 触发器 + settings 关闭/开启为 false 时的存量清除触发器。
--
-- 2) reminders 数据约束：
--      - offset_minutes：相对 due_at 的“提前量意图”（provenance），必须为正且 ≤ 1 年(525600 分钟)；
--        remind_at 是权威触发时间；offset 与 remind_at 可共存（snooze 只改 remind_at）。
--      - notification_status：约束为已知投递状态；Phase 4 如需新增状态走一次 ALTER 迁移。
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. 隐私不变量：task_sources 写入时按 settings + keep_original 强制清理 original_text
-- ----------------------------------------------------------------------------
create or replace function public.enforce_task_source_privacy()
returns trigger language plpgsql as $$
declare
  v_keep boolean;
  v_owner uuid := coalesce(new.user_id, auth.uid());
begin
  select s.keep_original_text into v_keep
  from public.settings s
  where s.user_id = v_owner;

  -- 未初始化 settings 时按默认 true 处理（与 settings 表默认一致）
  if v_keep is null then
    v_keep := true;
  end if;

  -- 不变量：非空 original_text 仅当 settings.keep_original_text AND keep_original 同时为 true
  if not (v_keep and new.keep_original) then
    new.original_text := null;
    new.keep_original := false;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_task_sources_privacy on public.task_sources;
create trigger trg_task_sources_privacy
  before insert or update of original_text, keep_original, user_id on public.task_sources
  for each row execute function public.enforce_task_source_privacy();

-- ----------------------------------------------------------------------------
-- 2. 隐私不变量：用户把全局开关改为 false（或新建即 false）时，立即清除其已存原文
-- ----------------------------------------------------------------------------
create or replace function public.scrub_task_source_originals()
returns trigger language plpgsql as $$
declare
  v_owner uuid := coalesce(new.user_id, auth.uid());
begin
  if not new.keep_original_text then
    update public.task_sources
       set original_text = null,
           keep_original = false
     where user_id = v_owner
       and (original_text is not null or keep_original);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_settings_privacy_scrub on public.settings;
create trigger trg_settings_privacy_scrub
  before insert or update of keep_original_text on public.settings
  for each row execute function public.scrub_task_source_originals();

-- ----------------------------------------------------------------------------
-- 3. reminders 约束
-- ----------------------------------------------------------------------------
alter table public.reminders
  drop constraint if exists reminders_offset_minutes_check;
alter table public.reminders
  add constraint reminders_offset_minutes_check
  check (offset_minutes is null or (offset_minutes > 0 and offset_minutes <= 525600));

alter table public.reminders
  drop constraint if exists reminders_notification_status_check;
alter table public.reminders
  add constraint reminders_notification_status_check
  check (notification_status is null or notification_status in ('pending','delivered','failed','cancelled'));

-- 更新语义说明（覆盖 013 注释；不修改 013 文件）
comment on column public.reminders.offset_minutes is
  '相对 due_at 的提前量意图（provenance），必须为正且 ≤ 1 年；remind_at 是权威触发时间，offset 与 remind_at 可共存（snooze 只改 remind_at）。';
comment on column public.reminders.notification_status is
  '通知投递状态：pending/delivered/failed/cancelled；Phase 4 如需新增状态走一次 ALTER 迁移。';
comment on table public.task_sources is
  'MessageTodo 任务来源：原始消息 + 来源 + 原文保存隐私开关。不变量：original_text 非空 ⟺ settings.keep_original_text=true 且 keep_original=true（由触发器强制）。';
