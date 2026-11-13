import { NextRequest, NextResponse } from "next/server";
import { ReminderCreateSchema } from "@messagetodo/db/schemas";
import { createServerClient, getAuthUser } from "../../../lib/supabase-server";

/**
 * POST /api/reminders.create
 * Body: { taskId, remindAt?, offsetMinutes?, status?, recurrence?, notificationStatus? }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = ReminderCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });
    }

    const { taskId, remindAt, offsetMinutes, status, recurrence, notificationStatus } = parsed.data;
    const supabase = await createServerClient();
    const user = await getAuthUser(supabase, req.headers.get("authorization"));
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const { data: task, error: taskError } = await supabase
      .from("tasks")
      .select("id, pool_id, due_at")
      .eq("id", taskId)
      .single();

    if (taskError || !task) {
      return NextResponse.json({ error: "task_not_found" }, { status: 404 });
    }

    const { data: member } = await supabase
      .from("pool_members")
      .select("user_id")
      .eq("pool_id", task.pool_id)
      .eq("user_id", user.id)
      .single();

    if (!member) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    let finalRemindAt = remindAt;
    if (!finalRemindAt) {
      if (!task.due_at) {
        return NextResponse.json(
          { error: "missing_remind_at", message: "offsetMinutes requires task.due_at or remindAt" },
          { status: 400 }
        );
      }
      const dueMs = new Date(task.due_at).getTime();
      finalRemindAt = new Date(dueMs - offsetMinutes * 60_000).toISOString();
    }

    const { data: reminder, error } = await supabase
      .from("reminders")
      .insert({
        task_id: taskId,
        user_id: user.id,
        remind_at: finalRemindAt,
        offset_minutes: offsetMinutes ?? null,
        status: status ?? "scheduled",
        recurrence: recurrence ?? null,
        notification_status: notificationStatus ?? "pending"
      })
      .select("id, remind_at, status, notification_status")
      .single();

    if (error) {
      return NextResponse.json({ error: "db_error", details: error.message }, { status: 500 });
    }

    return NextResponse.json({ reminder }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: "server_error", details: e?.message || String(e) }, { status: 500 });
  }
}
