"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Button, Card, Spinner, spacing, useToast } from "@messagetodo/design-system";
import { QuickAddSheet } from "../../components/QuickAddSheet";
import { getSupabaseClient } from "../../../lib/supabase-client";

interface PoolTask {
  id: string;
  pool_id: string;
  title: string;
  description: string | null;
  status: string;
  created_at: string;
}

export default function PoolPage() {
  const [tasks, setTasks] = useState<PoolTask[]>([]);
  const [poolIds, setPoolIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<PoolTask | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const { showToast } = useToast();

  const loadTasks = useCallback(async () => {
    setLoading(true);
    setError(null);
    const supabase = getSupabaseClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) {
      setPoolIds([]);
      setTasks([]);
      setLoading(false);
      return;
    }

    const { data: memberships, error: membershipError } = await supabase
      .from("pool_members")
      .select("pool_id")
      .eq("user_id", session.user.id);
    if (membershipError) {
      setError("Unable to load your task pools.");
      setLoading(false);
      return;
    }

    const ids = (memberships || []).map((membership) => membership.pool_id);
    setPoolIds(ids);
    if (ids.length === 0) {
      setTasks([]);
      setLoading(false);
      return;
    }

    const { data, error: taskError } = await supabase
      .from("tasks")
      .select("id, pool_id, title, description, status, created_at")
      .in("pool_id", ids)
      .order("created_at", { ascending: false });
    if (taskError) {
      setError("Unable to load tasks in your pools.");
    } else {
      setTasks((data || []) as PoolTask[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void loadTasks(); }, [loadTasks]);

  function beginEdit(task: PoolTask) {
    setEditingTask(task);
    setTitle(task.title);
    setDescription(task.description || "");
  }

  async function saveEdit(event: React.FormEvent) {
    event.preventDefault();
    if (!editingTask || !title.trim()) return;
    setSaving(true);
    try {
      const response = await fetch("/api/tasks.update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: editingTask.id, title: title.trim(), description: description.trim() }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || result.error || "Unable to update task.");
      setEditingTask(null);
      showToast({ variant: "success", message: "Task updated." });
      await loadTasks();
    } catch (err) {
      showToast({ variant: "error", message: err instanceof Error ? err.message : "Unable to update task." });
    } finally {
      setSaving(false);
    }
  }

  async function deleteTask(task: PoolTask) {
    if (!window.confirm(`Delete “${task.title}”?`)) return;
    try {
      const response = await fetch("/api/tasks.delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: task.id }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || result.error || "Unable to delete task.");
      setTasks((current) => current.filter((item) => item.id !== task.id));
      showToast({ variant: "success", message: "Task deleted." });
    } catch (err) {
      showToast({ variant: "error", message: err instanceof Error ? err.message : "Unable to delete task." });
    }
  }

  return (
    <main style={{ maxWidth: 1200, margin: "0 auto", padding: "48px 48px 64px" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: spacing.md, marginBottom: spacing.xl }}>
        <div>
          <h1 style={{ fontSize: 32, fontWeight: 600, margin: 0 }}>Pool</h1>
          <p style={{ opacity: 0.65, marginBottom: 0 }}>Tasks in pools you belong to</p>
        </div>
        <Button onClick={() => setQuickAddOpen(true)}>+ Add task</Button>
      </header>

      {loading ? <div style={{ display: "flex", justifyContent: "center", padding: spacing.xl }}><Spinner size="lg" /></div> : null}
      {!loading && error ? <Card><p role="alert" style={{ padding: spacing.lg }}>{error}</p></Card> : null}
      {!loading && !error && tasks.length === 0 ? (
        <Card><div style={{ padding: spacing.xl, textAlign: "center" }}>
          <p>No tasks in your pools yet.</p>
          <Button onClick={() => setQuickAddOpen(true)}>Create your first task</Button>
        </div></Card>
      ) : null}
      {!loading && !error && tasks.length > 0 ? (
        <section aria-label="Pool tasks" style={{ display: "grid", gap: spacing.md }}>
          {tasks.map((task) => (
            <Card key={task.id}>
              {editingTask?.id === task.id ? (
                <form onSubmit={saveEdit} style={{ display: "grid", gap: spacing.md }}>
                  <label>Task title<input aria-label="Task title" required maxLength={300} value={title} onChange={(event) => setTitle(event.target.value)} style={{ display: "block", width: "100%", marginTop: 6, padding: 10 }} /></label>
                  <label>Description<textarea aria-label="Description" maxLength={5000} value={description} onChange={(event) => setDescription(event.target.value)} style={{ display: "block", width: "100%", marginTop: 6, padding: 10 }} /></label>
                  <div style={{ display: "flex", gap: spacing.sm }}>
                    <Button type="submit" disabled={saving || !title.trim()}>{saving ? "Saving…" : "Save changes"}</Button>
                    <Button type="button" variant="secondary" onClick={() => setEditingTask(null)}>Cancel</Button>
                  </div>
                </form>
              ) : (
                <article aria-label={`Task: ${task.title}`}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: spacing.md, alignItems: "flex-start" }}>
                    <div>
                      <h2 style={{ fontSize: 18, margin: 0 }}>{task.title}</h2>
                      {task.description ? <p>{task.description}</p> : null}
                      <small>Status: {task.status}</small>
                    </div>
                    <div style={{ display: "flex", gap: spacing.sm, flexShrink: 0 }}>
                      <Button variant="secondary" onClick={() => beginEdit(task)}>Edit</Button>
                      <Button variant="secondary" onClick={() => void deleteTask(task)}>Delete</Button>
                    </div>
                  </div>
                </article>
              )}
            </Card>
          ))}
        </section>
      ) : null}

      <QuickAddSheet open={quickAddOpen} poolId={poolIds[0]} onClose={() => { setQuickAddOpen(false); void loadTasks(); }} />
    </main>
  );
}
