import fs from "fs";
import { createClient } from "@supabase/supabase-js";
import os from "os";
import path from "path";
import { chromium } from "playwright";

function loadEnv(p) {
  const text = fs.readFileSync(p, "utf8").replace(/^\uFEFF/, "");
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 0) continue;
    out[line.slice(0, i)] = line.slice(i + 1);
  }
  return out;
}

const env = loadEnv("apps/web/.env.local");
const state = JSON.parse(fs.readFileSync("apps/web/.smoke-state.json", "utf8"));
const base = env.APP_BASE_URL || "http://127.0.0.1:3000";
const vapid = env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
if (!vapid) throw new Error("missing VAPID public key");

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: signed, error: signErr } = await anon.auth.signInWithPassword({
  email: state.email,
  password: state.password,
});
if (signErr) throw signErr;
const token = signed.session.access_token;
const refresh = signed.session.refresh_token;

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mt-webpush-"));
const context = await chromium.launchPersistentContext(userDataDir, {
  channel: "chrome",
  headless: false,
  permissions: ["notifications"],
  serviceWorkers: "allow",
  baseURL: base,
});
await context.grantPermissions(["notifications"], { origin: base });
const page = context.pages()[0] || await context.newPage();
page.on("console", (msg) => console.log("[browser]", msg.type(), msg.text()));

await page.goto(base + "/settings", { waitUntil: "domcontentloaded" });

// Inject supabase session into browser cookies via client
await page.evaluate(async ({ url, anonKey, access_token, refresh_token }) => {
  const { createBrowserClient } = await import("https://esm.sh/@supabase/ssr@0.7.0");
  // Prefer in-app client if available after soft nav
}, { url: env.NEXT_PUBLIC_SUPABASE_URL, anonKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, access_token: token, refresh_token: refresh });

// Use local app bundle: open home, set session with window supabase if exposed.
// Fallback: set auth storage keys used by @supabase/ssr cookie bridge via fetch + document.
await page.goto(base + "/", { waitUntil: "networkidle" });
const sessionOk = await page.evaluate(async ({ access_token, refresh_token }) => {
  // Dynamic import of app's own module path won't work; use global supabase from CDN
  const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.0/+esm");
  const url = window.__NEXT_DATA__ ? null : null;
  return { access_token: !!access_token, refresh_token: !!refresh_token };
}, { access_token: token, refresh_token: refresh });

// Robust path: subscribe purely in page with PushManager, then POST with Bearer
const subResult = await page.evaluate(async ({ vapidPublicKey, bearer }) => {
  function urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const rawData = atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
    return outputArray;
  }

  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    return { ok: false, error: "no_push_support" };
  }

  const registration = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return { ok: false, error: "permission_" + permission };

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
  });
  const json = subscription.toJSON();
  const res = await fetch("/api/webpush/subscribe", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer " + bearer,
    },
    body: JSON.stringify(json),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body, endpoint: json.endpoint?.slice(0, 48) };
}, { vapidPublicKey: vapid, bearer: token });

console.log("subscribe", JSON.stringify(subResult));
if (!subResult.ok) {
  await context.close();
  process.exit(1);
}

const { count: subCount } = await admin
  .from("web_push_subscriptions")
  .select("id", { count: "exact", head: true })
  .eq("user_id", state.userId);
console.log("db_subscriptions", subCount);

const dueAt = new Date(Date.now() + 10 * 60_000).toISOString();
const addRes = await fetch(base + "/api/tasks.quickAdd", {
  method: "POST",
  headers: { "content-type": "application/json", authorization: "Bearer " + token },
  body: JSON.stringify({ poolId: state.poolId, title: "[SMOKE] real webpush", dueAt }),
});
const addBody = await addRes.json();
console.log("quickAdd", addRes.status, addBody);
if (!addRes.ok) {
  await context.close();
  process.exit(1);
}

// Wait briefly for possible SW install
await page.waitForTimeout(1000);

const cronRes = await fetch(base + "/api/cron/reminders");
const cronBody = await cronRes.json();
console.log("cron", cronRes.status, cronBody);

// Give the service worker time to receive and display the push
let shown = [];
try {
  if (!page.isClosed()) {
    await page.waitForTimeout(5000);
    shown = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready;
      const list = await reg.getNotifications();
      return list.map((n) => ({ title: n.title, body: n.body, tag: n.tag }));
    });
  } else {
    console.log("shown_notifications_skipped", "page_closed");
  }
} catch (e) {
  console.log("shown_notifications_error", e?.message || String(e));
}
console.log("shown_notifications", JSON.stringify(shown));

const { data: rem } = await admin
  .from("reminders")
  .select("id,status,notification_status")
  .eq("id", addBody.reminderId)
  .single();
console.log("reminder", rem);

const pass =
  rem?.status === "fired" &&
  cronBody?.skippedNoPush === 0 &&
  (cronBody?.delivered ?? 0) >= 1;

await context.close();
console.log(pass ? "WEBPUSH_LOOP_PASS" : "WEBPUSH_LOOP_FAIL");
process.exit(pass ? 0 : 2);

