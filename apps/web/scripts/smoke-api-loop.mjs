import fs from "fs";
import { createClient } from "@supabase/supabase-js";

const text = fs.readFileSync("apps/web/.env.local","utf8").replace(/^\uFEFF/,"");
const env = Object.fromEntries(text.split(/\r?\n/).filter(Boolean).map(l=>{const i=l.indexOf("=");return [l.slice(0,i),l.slice(i+1)];}));
const state = JSON.parse(fs.readFileSync("apps/web/.smoke-state.json","utf8"));

const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {auth:{persistSession:false,autoRefreshToken:false}});
const { data: signed, error: signErr } = await anon.auth.signInWithPassword({ email: state.email, password: state.password });
if (signErr) throw signErr;
const token = signed.session.access_token;

const dueAt = new Date(Date.now() + 10 * 60_000).toISOString(); // +10m with default offset 30 => remind already due
const addRes = await fetch("http://127.0.0.1:3000/api/tasks.quickAdd", {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
  body: JSON.stringify({ poolId: state.poolId, title: "[SMOKE] quickAdd dueAt", dueAt })
});
const addBody = await addRes.json();
console.log("quickAdd", addRes.status, addBody);
if (!addRes.ok) process.exit(1);

const cronRes = await fetch("http://127.0.0.1:3000/api/cron/reminders");
const cronBody = await cronRes.json();
console.log("cron", cronRes.status, cronBody);

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {auth:{persistSession:false,autoRefreshToken:false}});
const { data: rem } = await admin.from("reminders").select("id,status,notification_status,remind_at").eq("id", addBody.reminderId).single();
console.log("reminder", rem);
if (rem?.status !== "fired") {
  console.error("FAIL: expected fired");
  process.exit(2);
}
console.log("LOOP_PASS");
