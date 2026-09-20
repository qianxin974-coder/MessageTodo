import { z } from "zod";

// ============================================================================
// MessageTodo — 请求校验 schema（服务端 API 与客户端共用）
// 约定：user_id 一律不在此处读取/信任；身份必须来自 Supabase Auth session。
// 与 supabase/migrations/* 保持字段名/枚举一致。
// ============================================================================

// ---------------------------------------------------------------- 既有基线 ---
export const QuickAddSchema = z.object({
  poolId: z.string().uuid(),
  title: z.string().min(1).max(300),
  description: z.string().max(5000).optional(),
  visibility: z.enum(["owner_only","household","work","public"]).optional(),
  priority: z.number().int().min(1).max(10).nullable().optional(),
  tags: z.array(z.string().min(1).max(40)).optional()
});

export type QuickAddInput = z.infer<typeof QuickAddSchema>;

export const TodayProposeSchema = z.object({
  poolId: z.string().uuid(),
  taskId: z.string().uuid(),
  date: z.string() // YYYY-MM-DD
});

export const TodayRespondSchema = z.object({
  proposalId: z.string().uuid(),
  action: z.enum(["accept","decline","move"]),
  newDate: z.string().optional()
});

export const MemberInviteSchema = z.object({
  poolId: z.string().uuid(),
  email: z.string().email(),
  role: z.enum(["spouse","colleague","guest"])
});

export const EmailAliasCreateSchema = z.object({
  poolId: z.string().uuid()
});

export const TaskUpdateSchema = z.object({
  taskId: z.string().uuid(),
  title: z.string().min(1).max(300).optional(),
  description: z.string().max(5000).optional(),
  // 数据库 priority 范围为 1-10（迁移 006 已扩展）；修复 Phase 2 遗留的 1-5 校验不一致 bug。
  priority: z.number().int().min(1).max(10).optional(),
  visibility: z.enum(["owner_only","household","work","public"]).optional(),
  status: z.enum(["open","in_progress","done","archived"]).optional(),
  dueAt: z.string().optional() // ISO timestamp for due date/time
});

export const TaskDeleteSchema = z.object({
  taskId: z.string().uuid()
});

export const PoolCreateSchema = z.object({
  name: z.string().min(1).max(100),
  timezone: z.string().optional()
});

export const TodayLimitUpdateSchema = z.object({
  poolId: z.string().uuid(),
  delegateId: z.string().uuid(),
  todayLimit: z.number().int().min(0).nullable() // null = unlimited, 0 = none, 1+ = specific limit
});

export const PriorityLabelUpdateSchema = z.object({
  poolId: z.string().uuid(),
  priorityNumber: z.number().int().min(1),
  label: z.string().min(1).max(50)
});

// ======================================================================
// MessageTodo Phase 3 — 新增模型（对应 013_message_todo_models.sql）
// ======================================================================

// ---- task_sources.source_type（与 DB 枚举一致）----
export const TaskSourceType = z.enum([
  "manual", "share", "clipboard", "email", "telegram", "slack",
  "discord", "whatsapp", "wechat", "web", "api", "other"
]);
export type TaskSourceTypeValue = z.infer<typeof TaskSourceType>;

// ---- reminders.status / notification_status ----
export const ReminderStatus = z.enum([
  "scheduled", "fired", "snoozed", "dismissed", "cancelled", "completed"
]);
export type ReminderStatusValue = z.infer<typeof ReminderStatus>;

export const NotificationStatus = z.enum(["pending", "delivered", "failed", "cancelled"]);

const SourceMetadataSchema = z.record(z.string(), z.unknown()).default({});
const RecurrenceRuleSchema = z.record(z.string(), z.unknown()).nullable().optional();

// ---- task_sources 创建 ----
export const TaskSourceCreateSchema = z.object({
  taskId: z.string().uuid(),
  sourceType: TaskSourceType.default("manual"),
  sourceMetadata: SourceMetadataSchema,
  // 隐私：关闭原文保存时，客户端不应提交 originalText（服务端也会按 settings 决定是否落库）
  originalText: z.string().max(10000).optional(),
  keepOriginal: z.boolean().default(true),
  parsedTitle: z.string().max(300).optional(),
  parsedDescription: z.string().max(5000).optional()
});
export type TaskSourceCreateInput = z.infer<typeof TaskSourceCreateSchema>;

// ---- reminders 创建：remindAt(绝对) 与 offsetMinutes(相对 due_at) 二选一 ----
export const ReminderCreateSchema = z.object({
  taskId: z.string().uuid(),
  remindAt: z.string().datetime().optional(),
  offsetMinutes: z.number().int().min(1).max(10080).optional(), // 1 分钟 ~ 1 周
  status: ReminderStatus.default("scheduled"),
  recurrence: RecurrenceRuleSchema,
  notificationStatus: NotificationStatus.optional()
}).refine(d => !(d.remindAt && d.offsetMinutes), {
  message: "remindAt 与 offsetMinutes 只能二选一"
}).refine(d => Boolean(d.remindAt || d.offsetMinutes), {
  message: "必须提供 remindAt 或 offsetMinutes"
});
export type ReminderCreateInput = z.infer<typeof ReminderCreateSchema>;

export const ReminderUpdateSchema = z.object({
  reminderId: z.string().uuid(),
  remindAt: z.string().datetime().optional(),
  offsetMinutes: z.number().int().min(1).max(10080).optional(),
  status: ReminderStatus.optional(),
  notificationStatus: NotificationStatus.optional()
});
export type ReminderUpdateInput = z.infer<typeof ReminderUpdateSchema>;

// ---- settings（user_id 不在此处，由服务端从 session 取得）----
export const SettingsUpsertSchema = z.object({
  timezone: z.string().min(1).max(64).optional(),        // IANA 时区名，如 Asia/Shanghai
  locale: z.string().min(2).max(10).optional(),
  use24h: z.boolean().optional(),
  defaultReminderOffsetMinutes: z.number().int().min(0).max(10080).optional(),
  keepOriginalText: z.boolean().optional(),             // 原文保存隐私开关
  quietHours: z.object({
    start: z.string().regex(/^\d{2}:\d{2}$/),
    end: z.string().regex(/^\d{2}:\d{2}$/)
  }).nullable().optional()
});
export type SettingsUpsertInput = z.infer<typeof SettingsUpsertSchema>;

// ---- attachments 创建 ----
export const AttachmentCreateSchema = z.object({
  taskId: z.string().uuid(),
  storagePath: z.string().min(1).max(1000),
  fileName: z.string().min(1).max(255),
  mimeType: z.string().max(200).optional(),
  sizeBytes: z.number().int().min(0).optional()
});
export type AttachmentCreateInput = z.infer<typeof AttachmentCreateSchema>;
