import fs from "fs";
import { createClient } from "@supabase/supabase-js";

function loadEnv(p) {
  const out = {};
  const text = fs.readFileSync(p, "utf8").replace(/^\uFEFF/, "");
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 0) continue;
    out[line.slice(0, i)] = line.slice(i + 1);
  }
  return out;
}

const env = loadEnv("apps/web/.env.local");
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const service = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !service) throw new Error("missing env keys=" + Object.keys(env).join(","));

const admin = createClient(url, service, { auth: { autoRefreshToken: false, persistSession: false } });

const email = `smoke_${Date.now()}@messagetodo.local`;
const password = "SmokeTest123!";

const { data: created, error: createErr } = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true
});
if (createErr) throw createErr;
const userId = created.user.id;
console.log("user", userId);

const { data: pool, error: poolErr } = await admin
  .from("pools")
  .insert({ owner_id: userId, name: "Smoke Pool", timezone: "Asia/Shanghai" })
  .select("id")
  .single();
if (poolErr) throw poolErr;

const { error: memErr } = await admin.from("pool_members").insert({
  pool_id: pool.id,
  user_id: userId,
  role: "owner",
  can_add: true
});
if (memErr) throw memErr;

const dueAt = new Date(Date.now() + 30 * 60_000).toISOString();
const remindAt = new Date(Date.now() - 60_000).toISOString();

const { data: task, error: taskErr } = await admin
  .from("tasks")
  .insert({
    pool_id: pool.id,
    created_by: userId,
    title: "[SMOKE] create->remind loop",
    status: "open",
    visibility: "owner_only",
    due_at: dueAt
  })
  .select("id")
  .single();
if (taskErr) throw taskErr;

const { data: reminder, error: remErr } = await admin
  .from("reminders")
  .insert({
    task_id: task.id,
    user_id: userId,
    remind_at: remindAt,
    offset_minutes: 30,
    status: "scheduled",
    notification_status: "pending"
  })
  .select("id, status, notification_status, remind_at")
  .single();
if (remErr) throw remErr;

fs.writeFileSync(
  "apps/web/.smoke-state.json",
  JSON.stringify({ email, password, userId, poolId: pool.id, taskId: task.id, reminderId: reminder.id }, null, 2)
);
console.log(JSON.stringify({ ok: true, poolId: pool.id, taskId: task.id, reminderId: reminder.id, remindAt }, null, 2));
