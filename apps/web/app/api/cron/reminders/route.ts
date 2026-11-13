import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";

const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!;
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY!;
const pushProxy = process.env.WEB_PUSH_PROXY || process.env.HTTPS_PROXY || process.env.https_proxy;
const pushOptions = pushProxy ? { proxy: pushProxy } : undefined;

if (vapidPublicKey && vapidPrivateKey) {
  webpush.setVapidDetails(
    "mailto:hello@messagetodo.app",
    vapidPublicKey,
    vapidPrivateKey
  );
}

/**
 * GET /api/cron/reminders
 * Minimal Phase 4 delivery loop over public.reminders.
 */
export async function GET(_req: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceKey) {
      return NextResponse.json({ error: "service_key_not_configured" }, { status: 500 });
    }

    const supabase = createClient(supabaseUrl, serviceKey);
    const now = new Date();

    const { data: due, error } = await supabase
      .from("reminders")
      .select("id, task_id, user_id, remind_at, status")
      .eq("status", "scheduled")
      .lte("remind_at", now.toISOString())
      .order("remind_at", { ascending: true })
      .limit(100);

    if (error) {
      return NextResponse.json({ error: "database_error", message: error.message }, { status: 500 });
    }

    if (!due?.length) {
      return NextResponse.json({ ok: true, processed: 0, delivered: 0, failed: 0, skippedNoPush: 0 });
    }

    let delivered = 0;
    let failed = 0;
    let skippedNoPush = 0;

    for (const rem of due) {
      const { data: task } = await supabase
        .from("tasks")
        .select("id, title, due_at, status")
        .eq("id", rem.task_id)
        .maybeSingle();

      if (!task || task.status !== "open") {
        await supabase
          .from("reminders")
          .update({
            status: "cancelled",
            notification_status: "cancelled",
            updated_at: now.toISOString()
          })
          .eq("id", rem.id);
        continue;
      }

      const { data: subscriptions } = await supabase
        .from("web_push_subscriptions")
        .select("id, endpoint, p256dh, auth")
        .eq("user_id", rem.user_id);

      let pushOk = false;
      let pushAttempted = false;

      if (vapidPublicKey && vapidPrivateKey && subscriptions?.length) {
        pushAttempted = true;
        const payload = JSON.stringify({
          title: task.title,
          body: task.due_at ? "Due " + new Date(task.due_at).toLocaleString() : "Task reminder",
          taskId: task.id,
          reminderId: rem.id
        });

        for (const sub of subscriptions) {
          try {
            await webpush.sendNotification(
              {
                endpoint: sub.endpoint,
                keys: { p256dh: sub.p256dh, auth: sub.auth }
              },
              payload,
              pushOptions
            );
            pushOk = true;
          } catch (pushError) {
            console.error("[cron/reminders] webpush failed", {
              statusCode: pushError?.statusCode || null,
              code: pushError?.code || null,
              message: String(pushError?.message || pushError || "").slice(0, 200)
            });
            if (pushError?.statusCode === 410 || pushError?.statusCode === 404) {
              await supabase.from("web_push_subscriptions").delete().eq("id", sub.id);
            }
          }
        }
      } else {
        skippedNoPush++;
      }

      const notificationStatus = pushAttempted ? (pushOk ? "delivered" : "failed") : "delivered";
      const { error: updErr } = await supabase
        .from("reminders")
        .update({
          status: "fired",
          notification_status: notificationStatus,
          last_notified_at: now.toISOString(),
          updated_at: now.toISOString()
        })
        .eq("id", rem.id)
        .eq("status", "scheduled");

      if (updErr) failed++;
      else if (pushAttempted && !pushOk) failed++;
      else delivered++;
    }

    return NextResponse.json({
      ok: true,
      processed: due.length,
      delivered,
      failed,
      skippedNoPush
    });
  } catch (e) {
    return NextResponse.json({ error: "internal_error", message: e?.message || String(e) }, { status: 500 });
  }
}
