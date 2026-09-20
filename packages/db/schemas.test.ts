import { describe, it, expect } from "vitest";
import {
  TaskUpdateSchema,
  TaskSourceCreateSchema,
  TaskSourceType,
  ReminderCreateSchema,
  ReminderUpdateSchema,
  ReminderStatus,
  SettingsUpsertSchema,
  AttachmentCreateSchema
} from "./schemas";

describe("TaskUpdateSchema (priority 1-10 fix)", () => {
  it("accepts priority within 1..10", () => {
    expect(TaskUpdateSchema.parse({ taskId: crypto.randomUUID(), priority: 10 }).priority).toBe(10);
    expect(TaskUpdateSchema.parse({ taskId: crypto.randomUUID(), priority: 1 }).priority).toBe(1);
  });

  it("rejects priority 11 (beyond DB range)", () => {
    const result = TaskUpdateSchema.safeParse({ taskId: crypto.randomUUID(), priority: 11 });
    expect(result.success).toBe(false);
  });

  it("rejects priority 0", () => {
    const result = TaskUpdateSchema.safeParse({ taskId: crypto.randomUUID(), priority: 0 });
    expect(result.success).toBe(false);
  });
});

describe("TaskSourceCreateSchema (task_sources)", () => {
  it("defaults sourceType to manual", () => {
    const parsed = TaskSourceCreateSchema.parse({ taskId: crypto.randomUUID() });
    expect(parsed.sourceType).toBe("manual");
    expect(parsed.keepOriginal).toBe(true);
    expect(parsed.sourceMetadata).toEqual({});
  });

  it("accepts every supported source type (incl. Phase 3 required list)", () => {
    for (const t of [
      "manual", "share", "clipboard", "email", "telegram", "slack",
      "discord", "whatsapp", "wechat", "web", "api", "other"
    ]) {
      expect(TaskSourceType.safeParse(t).success).toBe(true);
    }
  });

  it("rejects unknown source type", () => {
    const result = TaskSourceCreateSchema.safeParse({ taskId: crypto.randomUUID(), sourceType: "gmail" });
    expect(result.success).toBe(false);
  });

  it("keeps originalText optional (privacy: can be omitted)", () => {
    const withText = TaskSourceCreateSchema.parse({ taskId: crypto.randomUUID(), originalText: "周五之前把报价单发给张总。" });
    expect(withText.originalText).toBe("周五之前把报价单发给张总。");
    const without = TaskSourceCreateSchema.parse({ taskId: crypto.randomUUID() });
    expect(without.originalText).toBeUndefined();
  });
});

describe("ReminderCreateSchema (reminders)", () => {
  it("accepts absolute remindAt", () => {
    const parsed = ReminderCreateSchema.parse({
      taskId: crypto.randomUUID(),
      remindAt: "2026-09-25T10:00:00.000Z"
    });
    expect(parsed.status).toBe("scheduled");
  });

  it("accepts offsetMinutes (提前 N 分钟)", () => {
    const parsed = ReminderCreateSchema.parse({ taskId: crypto.randomUUID(), offsetMinutes: 30 });
    expect(parsed.offsetMinutes).toBe(30);
  });

  it("accepts when both remindAt and offsetMinutes provided (offset=provenance, remind_at=authoritative)", () => {
    const parsed = ReminderCreateSchema.parse({
      taskId: crypto.randomUUID(),
      remindAt: "2026-09-25T10:00:00.000Z",
      offsetMinutes: 30
    });
    expect(parsed.remindAt).toBe("2026-09-25T10:00:00.000Z");
    expect(parsed.offsetMinutes).toBe(30);
  });

  it("rejects when neither provided", () => {
    const result = ReminderCreateSchema.safeParse({ taskId: crypto.randomUUID() });
    expect(result.success).toBe(false);
  });

  it("rejects negative offset", () => {
    const result = ReminderCreateSchema.safeParse({ taskId: crypto.randomUUID(), offsetMinutes: -5 });
    expect(result.success).toBe(false);
  });
  it("rejects offset beyond DB bound (1 year = 525600)", () => {
    const result = ReminderCreateSchema.safeParse({ taskId: crypto.randomUUID(), offsetMinutes: 525601 });
    expect(result.success).toBe(false);
    const ok = ReminderCreateSchema.safeParse({ taskId: crypto.randomUUID(), offsetMinutes: 525600 });
    expect(ok.success).toBe(true);
  });

  it("accepts every reminder status", () => {
    for (const s of ["scheduled", "fired", "snoozed", "dismissed", "cancelled", "completed"]) {
      expect(ReminderStatus.safeParse(s).success).toBe(true);
    }
  });
});

describe("ReminderUpdateSchema", () => {
  it("accepts status transitions (e.g. snooze -> scheduled)", () => {
    const parsed = ReminderUpdateSchema.parse({ reminderId: crypto.randomUUID(), status: "snoozed" });
    expect(parsed.status).toBe("snoozed");
  });

  it("rejects invalid status", () => {
    const result = ReminderUpdateSchema.safeParse({ reminderId: crypto.randomUUID(), status: "paused" });
    expect(result.success).toBe(false);
  });
});

describe("SettingsUpsertSchema (settings / timezone / privacy)", () => {
  it("accepts IANA timezone and privacy switch", () => {
    const parsed = SettingsUpsertSchema.parse({
      timezone: "Asia/Shanghai",
      keepOriginalText: false,
      defaultReminderOffsetMinutes: 30,
      use24h: true
    });
    expect(parsed.timezone).toBe("Asia/Shanghai");
    expect(parsed.keepOriginalText).toBe(false);
  });

  it("validates quietHours HH:MM format", () => {
    const ok = SettingsUpsertSchema.safeParse({ quietHours: { start: "22:00", end: "07:00" } });
    expect(ok.success).toBe(true);
    const bad = SettingsUpsertSchema.safeParse({ quietHours: { start: "10pm", end: "7am" } });
    expect(bad.success).toBe(false);
  });

  it("accepts null quietHours", () => {
    const parsed = SettingsUpsertSchema.parse({ quietHours: null });
    expect(parsed.quietHours).toBeNull();
  });

  it("rejects empty timezone", () => {
    const result = SettingsUpsertSchema.safeParse({ timezone: "" });
    expect(result.success).toBe(false);
  });
});

describe("AttachmentCreateSchema (attachments)", () => {
  it("accepts a PDF attachment", () => {
    const parsed = AttachmentCreateSchema.parse({
      taskId: crypto.randomUUID(),
      storagePath: "user/uuid/contract.pdf",
      fileName: "contract.pdf",
      mimeType: "application/pdf",
      sizeBytes: 2048
    });
    expect(parsed.mimeType).toBe("application/pdf");
  });

  it("rejects missing storagePath", () => {
    const result = AttachmentCreateSchema.safeParse({ taskId: crypto.randomUUID(), fileName: "a.pdf" });
    expect(result.success).toBe(false);
  });
});
