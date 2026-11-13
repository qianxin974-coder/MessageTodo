import { NextRequest, NextResponse } from "next/server";
import { QuickAddSchema } from "@messagetodo/db/schemas";
import { createRequestClient, getAuthUser, createServerClient } from "../../../lib/supabase-server";

/**
 * POST /api/tasks.quickAdd
 * Body: { poolId, title, description?, priority?, tags?, visibility?, dueAt? }
 *
 * Minimal loop: when dueAt is provided, also insert a reminders row
 * (remind_at = dueAt - settings.default_reminder_offset_minutes, or dueAt if offset is 0).
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const parsed = QuickAddSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });
    }
    const { poolId, title, description, priority, tags, visibility, dueAt } = parsed.data;

    const authHeader = req.headers.get("authorization");
    const sessionClient = await createServerClient();
    const user = await getAuthUser(sessionClient, authHeader);
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const supabase = await createRequestClient(authHeader);

    const { data: member } = await supabase
      .from("pool_members")
      .select("user_id, can_add")
      .eq("pool_id", poolId)
      .eq("user_id", user.id)
      .single();
    if (!member || !member.can_add) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    const cleanTitle = title.trim();
    const allTags = tags || [];
    const finalPriority = priority ?? null;
    const dueAtIso = dueAt ?? null;

    const { data: task, error } = await supabase
      .from("tasks")
      .insert({
        pool_id: poolId,
        created_by: user.id,
        title: cleanTitle,
        description: description?.trim() || null,
        priority: finalPriority,
        visibility: visibility || "owner_only",
        status: "open",
        due_at: dueAtIso
      })
      .select("id")
      .single();
    if (error) {
      return NextResponse.json({ error: "db_error", details: error.message }, { status: 500 });
    }

    if (allTags.length) {
      const { data: tagRows } = await supabase
        .from("tags")
        .select("id, name")
        .in("name", allTags)
        .eq("pool_id", poolId);
      const idByName = new Map();
      tagRows?.forEach((r) => idByName.set(r.name, r.id));
      const missing = allTags.filter((t) => !idByName.has(t));
      if (missing.length) {
        const { data: created } = await supabase
          .from("tags")
          .insert(missing.map((name) => ({ pool_id: poolId, name })))
          .select();
        created?.forEach((r) => idByName.set(r.name, r.id));
      }
      const tagIds = allTags.map((n) => idByName.get(n)).filter(Boolean);
      if (tagIds.length) {
        await supabase.from("task_tags").insert(tagIds.map((tag_id) => ({ task_id: task.id, tag_id })));
      }
    }

    let reminderId = null;
    if (dueAtIso) {
      const { data: settings } = await supabase
        .from("settings")
        .select("default_reminder_offset_minutes")
        .eq("user_id", user.id)
        .maybeSingle();

      const offsetMinutes = settings?.default_reminder_offset_minutes ?? 30;
      const dueMs = new Date(dueAtIso).getTime();
      const remindAt = new Date(dueMs - Math.max(0, offsetMinutes) * 60_000).toISOString();

      const { data: reminder, error: remErr } = await supabase
        .from("reminders")
        .insert({
          task_id: task.id,
          user_id: user.id,
          remind_at: remindAt,
          offset_minutes: offsetMinutes > 0 ? offsetMinutes : null,
          status: "scheduled",
          notification_status: "pending"
        })
        .select("id")
        .single();

      if (remErr) {
        return NextResponse.json(
          { error: "reminder_create_failed", details: remErr.message, taskId: task.id },
          { status: 500 }
        );
      }
      reminderId = reminder.id;
    }

    return NextResponse.json({ taskId: task.id, reminderId }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: "server_error", details: e?.message || String(e) }, { status: 500 });
  }
}
