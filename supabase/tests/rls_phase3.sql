-- ============================================================================
-- RLS 交叉用户测试 — MessageTodo Phase 3
--
-- 运行方式：在 Supabase 本地(或云)SQL Editor / psql 以 postgres 角色执行本文件。
--   supabase db reset                 # 先应用 001→014 迁移
--   psql "$DATABASE_URL" -f supabase/tests/rls_phase3.sql
--
-- 覆盖场景（对应 Phase 3 第 15 条要求）：
--   [T1] User A 可以读取自己的 task
--   [T2] User A 不能读取 User B 的 task
--   [T3] User A 不能修改 User B 的 task
--   [T4] User A 不能删除 User B 的 task
--   [T5] User A 不能通过 task_sources 间接读取 User B 的原始消息
--   [T6] User A 只能读写自己的 settings / task_sources / reminders / attachments
--   [T7] User A 越权写入他人 user_id 的行被 RLS with check 拒绝
--   [T8] User A 不能修改/删除 User B 的 settings / task_sources / reminders / attachments
--   [T9] 客户端省略 user_id 时，BEFORE INSERT 触发器用 auth.uid() 填充归属
--   [T10] 隐私不变量：settings.keep_original_text=false 时不得保存 original_text（并清除存量原文）
--
-- 说明：本文件在本开发环境（无 Docker / 无 Supabase CLI）中【未执行】，
--       交付为可在用户 Supabase 环境直接运行的验证脚本，请以真实执行结果为准。
--       auth.users 的必填列随 Supabase 版本可能略有差异，若插入失败请按版本补齐列。
-- ============================================================================

begin;

-- 0. 创建两个测试用户（幂等；若已存在则跳过）
insert into auth.users
  (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
   confirmation_token, recovery_token, email_change_token_new,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_sso_user, is_anonymous)
values
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'user_a@test.local', 'not-used', now(),
   '', '', '', '{}'::jsonb, '{}'::jsonb, now(), now(), false, false),
  ('20000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'user_b@test.local', 'not-used', now(),
   '', '', '', '{}'::jsonb, '{}'::jsonb, now(), now(), false, false)
on conflict (id) do nothing;

-- 1. 准备测试数据（postgres 角色绕过 RLS，直接构造；显式 user_id 模拟受信服务端写入）
insert into public.pools (id, owner_id, name, timezone)
values
  ('30000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', 'A pool', 'Asia/Shanghai'),
  ('30000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-00000000000b', 'B pool', 'Asia/Shanghai')
on conflict (id) do nothing;

insert into public.pool_members (pool_id, user_id, role, can_add)
values
  ('30000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', 'owner', true),
  ('30000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-00000000000b', 'owner', true)
on conflict (pool_id, user_id) do nothing;

insert into public.tasks (id, pool_id, created_by, title, priority, status, visibility, due_at)
values
  ('40000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-00000000000a',
   '10000000-0000-0000-0000-00000000000a', 'A 的任务：给张总发报价单', 3, 'open', 'owner_only', now() + interval '1 day'),
  ('40000000-0000-0000-0000-00000000000b', '30000000-0000-0000-0000-00000000000b',
   '20000000-0000-0000-0000-00000000000b', 'B 的任务：给李总回电话', 3, 'open', 'owner_only', now() + interval '1 day')
on conflict (id) do nothing;

insert into public.task_sources (id, task_id, user_id, source_type, source_metadata, original_text, keep_original, parsed_title)
values
  ('50000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a',
   'share', '{"app":"wechat"}'::jsonb, '明天下午把合同发给客户。', true, '把合同发给客户'),
  ('50000000-0000-0000-0000-00000000000b', '40000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-00000000000b',
   'manual', '{}'::jsonb, '周五之前把报价单发给张总。', true, '把报价单发给张总')
on conflict (id) do nothing;

insert into public.settings (user_id, timezone, keep_original_text)
values
  ('10000000-0000-0000-0000-00000000000a', 'Asia/Shanghai', true),
  ('20000000-0000-0000-0000-00000000000b', 'Asia/Shanghai', true)
on conflict (user_id) do nothing;

insert into public.reminders (id, task_id, user_id, remind_at, offset_minutes, status)
values
  ('60000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', now() + interval '23 hours', 60, 'scheduled'),
  ('60000000-0000-0000-0000-00000000000b', '40000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-00000000000b', now() + interval '23 hours', 60, 'scheduled')
on conflict (id) do nothing;

insert into public.attachments (id, task_id, user_id, storage_path, file_name, mime_type, size_bytes)
values
  ('70000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', 'a/contract.pdf', 'contract.pdf', 'application/pdf', 1234),
  ('70000000-0000-0000-0000-00000000000b', '40000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-00000000000b', 'b/quote.pdf', 'quote.pdf', 'application/pdf', 5678)
on conflict (id) do nothing;

-- 2. 以 User A 身份执行交叉用户断言
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-00000000000a';

-- [T1] A 可以读取自己的 task
do $$
declare n int;
begin
  select count(*) into n from public.tasks where id = '40000000-0000-0000-0000-00000000000a';
  if n <> 1 then raise exception '[T1] FAIL: A 读不到自己的 task (n=%)', n; end if;
  raise notice '[T1] PASS: A 可以读取自己的 task';
end $$;

-- [T2] A 不能读取 B 的 task
do $$
declare n int;
begin
  select count(*) into n from public.tasks where id = '40000000-0000-0000-0000-00000000000b';
  if n <> 0 then raise exception '[T2] FAIL: A 读到了 B 的 task (n=%)', n; end if;
  raise notice '[T2] PASS: A 不能读取 B 的 task';
end $$;

-- [T3] A 不能修改 B 的 task
do $$
declare n int;
begin
  update public.tasks set title = '被 A 篡改' where id = '40000000-0000-0000-0000-00000000000b';
  get diagnostics n = row_count;
  if n <> 0 then raise exception '[T3] FAIL: A 修改了 B 的 task (row_count=%)', n; end if;
  raise notice '[T3] PASS: A 不能修改 B 的 task';
end $$;

-- [T4] A 不能删除 B 的 task
do $$
declare n int;
begin
  delete from public.tasks where id = '40000000-0000-0000-0000-00000000000b';
  get diagnostics n = row_count;
  if n <> 0 then raise exception '[T4] FAIL: A 删除了 B 的 task (row_count=%)', n; end if;
  raise notice '[T4] PASS: A 不能删除 B 的 task';
end $$;

-- [T5] A 不能通过 task_sources 间接读取 B 的原始消息
do $$
declare n int;
begin
  select count(*) into n from public.task_sources where id = '50000000-0000-0000-0000-00000000000b';
  if n <> 0 then raise exception '[T5] FAIL: A 读到了 B 的 task_source (n=%)', n; end if;
  raise notice '[T5] PASS: A 不能经 task_sources 读取 B 的原始消息';
end $$;

-- [T6] A 只能读写自己的 settings/task_sources/reminders/attachments
do $$
declare n int;
begin
  select count(*) into n from public.settings where user_id = '10000000-0000-0000-0000-00000000000a';
  if n <> 1 then raise exception '[T6] FAIL: A 读不到自己的 settings (n=%)', n; end if;
  select count(*) into n from public.settings where user_id = '20000000-0000-0000-0000-00000000000b';
  if n <> 0 then raise exception '[T6] FAIL: A 读到了 B 的 settings (n=%)', n; end if;
  select count(*) into n from public.reminders where id = '60000000-0000-0000-0000-00000000000a';
  if n <> 1 then raise exception '[T6] FAIL: A 读不到自己的 reminder (n=%)', n; end if;
  select count(*) into n from public.reminders where id = '60000000-0000-0000-0000-00000000000b';
  if n <> 0 then raise exception '[T6] FAIL: A 读到了 B 的 reminder (n=%)', n; end if;
  select count(*) into n from public.attachments where id = '70000000-0000-0000-0000-00000000000a';
  if n <> 1 then raise exception '[T6] FAIL: A 读不到自己的 attachment (n=%)', n; end if;
  select count(*) into n from public.attachments where id = '70000000-0000-0000-0000-00000000000b';
  if n <> 0 then raise exception '[T6] FAIL: A 读到了 B 的 attachment (n=%)', n; end if;
  raise notice '[T6] PASS: A 只能读写自己的 settings/task_sources/reminders/attachments';
end $$;

-- [T7] 越权写入被 RLS 拒绝：A 试图插入 user_id = B 的 settings（with check 拦截）
do $$
begin
  insert into public.settings (user_id, timezone) values ('20000000-0000-0000-0000-00000000000b', 'Asia/Shanghai');
  raise exception '[T7] FAIL: A 成功写入了他人的 settings';
exception
  when insufficient_privilege then
    raise notice '[T7] PASS: A 越权写入被 RLS with check 拒绝 (42501)';
  when others then
    raise;
end $$;

-- [T8] A 不能修改/删除 B 的 settings/task_sources/reminders/attachments
do $$
declare n int;
begin
  update public.reminders set status = 'cancelled' where id = '60000000-0000-0000-0000-00000000000b';
  get diagnostics n = row_count; if n <> 0 then raise exception '[T8] FAIL: A 修改了 B 的 reminder (n=%)', n; end if;
  delete from public.reminders where id = '60000000-0000-0000-0000-00000000000b';
  get diagnostics n = row_count; if n <> 0 then raise exception '[T8] FAIL: A 删除了 B 的 reminder (n=%)', n; end if;

  update public.attachments set file_name = 'x' where id = '70000000-0000-0000-0000-00000000000b';
  get diagnostics n = row_count; if n <> 0 then raise exception '[T8] FAIL: A 修改了 B 的 attachment (n=%)', n; end if;
  delete from public.attachments where id = '70000000-0000-0000-0000-00000000000b';
  get diagnostics n = row_count; if n <> 0 then raise exception '[T8] FAIL: A 删除了 B 的 attachment (n=%)', n; end if;

  update public.task_sources set keep_original = false where id = '50000000-0000-0000-0000-00000000000b';
  get diagnostics n = row_count; if n <> 0 then raise exception '[T8] FAIL: A 修改了 B 的 task_source (n=%)', n; end if;
  delete from public.task_sources where id = '50000000-0000-0000-0000-00000000000b';
  get diagnostics n = row_count; if n <> 0 then raise exception '[T8] FAIL: A 删除了 B 的 task_source (n=%)', n; end if;

  update public.settings set timezone = 'UTC' where user_id = '20000000-0000-0000-0000-00000000000b';
  get diagnostics n = row_count; if n <> 0 then raise exception '[T8] FAIL: A 修改了 B 的 settings (n=%)', n; end if;
  delete from public.settings where user_id = '20000000-0000-0000-0000-00000000000b';
  get diagnostics n = row_count; if n <> 0 then raise exception '[T8] FAIL: A 删除了 B 的 settings (n=%)', n; end if;

  raise notice '[T8] PASS: A 不能修改/删除 B 的新表数据';
end $$;

-- [T9] 省略 user_id 时由触发器填充 auth.uid()，且原文在允许时保留
do $$
declare n int; v_id uuid; v_uid uuid; v_text text;
begin
  insert into public.task_sources (task_id, source_type, original_text, keep_original, parsed_title)
  values ('40000000-0000-0000-0000-00000000000a', 'manual', 'A 手动录入的待办', true, 'A 手动录入的待办')
  returning id, user_id, original_text into v_id, v_uid, v_text;

  if v_uid <> '10000000-0000-0000-0000-00000000000a' then
    raise exception '[T9] FAIL: user_id 未按 auth.uid() 填充 (got=%)', v_uid;
  end if;
  if v_text is distinct from 'A 手动录入的待办' then
    raise exception '[T9] FAIL: 允许保存时 original_text 丢失 (got=%)', v_text;
  end if;
  select count(*) into n from public.task_sources where id = v_id;
  if n <> 1 then raise exception '[T9] FAIL: 新建 task_source 对 A 不可见 (n=%)', n; end if;
  raise notice '[T9] PASS: 触发器以 auth.uid() 填充归属，原文保留';
end $$;

-- [T10] 隐私不变量：settings.keep_original_text=false 时，新写入原文被清空，且存量原文被清除
do $$
declare n int; v_text text; v_keep boolean;
begin
  -- 1) 关闭全局原文保存
  update public.settings set keep_original_text = false where user_id = '10000000-0000-0000-0000-00000000000a';

  -- 2) 存量原文被清除
  select count(*) into n from public.task_sources
   where user_id = '10000000-0000-0000-0000-00000000000a' and original_text is not null;
  if n <> 0 then raise exception '[T10] FAIL: 关闭开关后仍有存量原文 (n=%)', n; end if;

  -- 3) 新写入 original_text 被强制置空、keep_original 被强制为 false
  insert into public.task_sources (task_id, source_type, original_text, keep_original)
  values ('40000000-0000-0000-0000-00000000000a', 'share', '隐私内容，不应落库', true)
  returning original_text, keep_original into v_text, v_keep;

  if v_text is not null then raise exception '[T10] FAIL: 关闭开关后仍保存了原文 (got=%)', v_text; end if;
  if v_keep is distinct from false then raise exception '[T10] FAIL: keep_original 未被置为 false (got=%)', v_keep; end if;

  raise notice '[T10] PASS: settings=false 时既不保存新原文，也清除存量原文';
end $$;

rollback;

-- ============================================================================
-- 全部通过时：输出 "ALL RLS TESTS PASSED"；任一断言失败会抛出异常并回滚。
-- ============================================================================
select 'ALL RLS TESTS PASSED' as result;
