import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

// ============================================================================
// 静态 RLS / 数据库模型 断言（Phase 3）
//
// 本环境没有 Docker / Supabase / PostgreSQL，无法真实执行 SQL。
// 这里通过读取 supabase/migrations/013*.sql 与 API 路由源码，做“策略存在性与
// 语义”断言，作为真实 RLS 测试（supabase/tests/rls_phase3.sql）的本地静态基线。
// ============================================================================

const root = process.cwd();
const migrationsDir = join(root, "supabase", "migrations");

function readMigrationsFrom013(): string {
  const files = readdirSync(migrationsDir).filter(f => /^0(1[3-9]|[2-9][0-9])_/.test(f)).sort();
  return files.map(f => readFileSync(join(migrationsDir, f), "utf8")).join("\n");
}

function readApiRoute(relPath: string): string {
  const p = join(root, "apps", "web", "app", "api", relPath);
  if (!existsSync(p)) throw new Error(`Missing API route for privacy scan: ${p}`);
  return readFileSync(p, "utf8");
}

let sql = "";

beforeAll(() => {
  sql = readMigrationsFrom013();
});

describe("Phase 3 migration exists (new file only, 013+)", () => {
  it("contains a 013+ migration file", () => {
    expect(sql.length).toBeGreaterThan(0);
  });

  it("does NOT drop or alter inherited DoFirst tables (tasks/pools/pool_members/task_submissions)", () => {
    expect(sql).not.toMatch(/drop\s+table\s+(public\.)?(tasks|pools|pool_members|task_submissions)/i);
    expect(sql).not.toMatch(/drop\s+column/i);
    expect(sql).not.toMatch(/alter\s+table\s+public\.(pools|pool_members|task_submissions)\b/i);
  });
});

describe("New MessageTodo tables created idempotently", () => {
  const tables = ["settings", "task_sources", "reminders", "attachments"];
  for (const t of tables) {
    it(`creates public.${t} with IF NOT EXISTS`, () => {
      expect(sql).toMatch(new RegExp(`create\\s+table\\s+if\\s+not\\s+exists\\s+public\\.${t}\\b`, "i"));
    });
  }
});

describe("RLS enabled on every new table", () => {
  const tables = ["settings", "task_sources", "reminders", "attachments"];
  for (const t of tables) {
    it(`enables row level security on public.${t}`, () => {
      expect(sql).toMatch(new RegExp(`alter\\s+table\\s+public\\.${t}\\s+enable\\s+row\\s+level\\s+security`, "i"));
    });
  }
});

describe("Strict ownership RLS: auth.uid() = user_id on every new table", () => {
  const tables = ["settings", "task_sources", "reminders", "attachments"];
  for (const t of tables) {
    it(`policy on ${t} uses using( auth.uid() = user_id ) with check`, () => {
      const policyBlock = sql.match(new RegExp(`create\\s+policy\\s+${t}_owner_all[\\s\\S]*?;`, "i"))?.[0] ?? "";
      expect(policyBlock).toMatch(/using\s*\(\s*auth\.uid\(\)\s*=\s*user_id\s*\)/i);
      expect(policyBlock).toMatch(/with\s+check\s*\(\s*auth\.uid\(\)\s*=\s*user_id\s*\)/i);
    });
  }
});

describe("tasks baseline extension (soft delete + version)", () => {
  it("adds tasks.deleted_at", () => {
    expect(sql).toMatch(/add\s+column\s+if\s+not\s+exists\s+deleted_at\s+timestamptz/i);
  });
  it("adds tasks.version with default 0", () => {
    expect(sql).toMatch(/add\s+column\s+if\s+not\s+exists\s+version\s+bigint\s+not\s+null\s+default\s+0/i);
  });
});

describe("tasks DELETE policy added (baseline gap)", () => {
  it("defines tasks_delete for the creator or pool owner", () => {
    const m = sql.match(/create\s+policy\s+tasks_delete\s+on\s+public\.tasks[\s\S]*?;/i)?.[0] ?? "";
    expect(m).toMatch(/for\s+delete/i);
    expect(m).toMatch(/created_by\s*=\s*auth\.uid\(\)/i);
    expect(m).toMatch(/owner_id\s*from\s+public\.pools/i);
  });
});

describe("source types (Phase 3 required list reserved in DB model)", () => {
  const required = ["manual","share","clipboard","email","telegram","slack","discord","other"];
  it("enum task_source_type includes all required values", () => {
    for (const v of required) {
      expect(sql).toMatch(new RegExp(`'${v}'`, "i"));
    }
  });
  it("defaults task_sources.source_type to manual", () => {
    expect(sql).toMatch(/source_type\s+public\.task_source_type\s+not\s+null\s+default\s+'manual'/i);
  });
});

describe("reminder model forward-compat (提前量/snooze/周期/投递状态)", () => {
  it("has remind_at, offset_minutes, status, recurrence, notification_status, last_notified_at", () => {
    for (const col of ["remind_at","offset_minutes","status","recurrence","notification_status","last_notified_at"]) {
      expect(sql).toMatch(new RegExp(`\\b${col}\\b`, "i"));
    }
  });
  it("defines reminder_status enum incl. scheduled/fired/snoozed/dismissed/cancelled/completed", () => {
    for (const s of ["scheduled","fired","snoozed","dismissed","cancelled","completed"]) {
      expect(sql).toMatch(new RegExp(`'${s}'`, "i"));
    }
  });
});

describe("privacy: original message is optional + per-user switch", () => {
  it("settings has keep_original_text", () => {
    expect(sql).toMatch(/keep_original_text\s+boolean\s+not\s+null\s+default\s+true/i);
  });
  it("task_sources.original_text is nullable and keep_original default true", () => {
    expect(sql).toMatch(/original_text\s+text/i);
    expect(sql).toMatch(/keep_original\s+boolean\s+not\s+null\s+default\s+true/i);
  });
  it("deleting a task cascades to its source (original message removed together)", () => {
    expect(sql).toMatch(/task_sources\s*\([\s\S]{0,200}?on\s+delete\s+cascade/i);
  });
});

describe("identity from session, never from client", () => {
  it("BEFORE INSERT triggers fill user_id from auth.uid()", () => {
    expect(sql).toMatch(/new\.user_id\s*:=\s*auth\.uid\(\)/i);
    expect((sql.match(/execute\s+function\s+public\.set_owner_user_id\(\)/gi) ?? []).length).toBeGreaterThanOrEqual(4);
  });
  it("get_user_settings rejects a foreign p_user_id", () => {
    expect(sql).toMatch(/p_user_id\s*<>\s*auth\.uid\(\)/i);
  });
});

describe("API privacy regression: no raw message / body in logs", () => {
  it("tasks.quickAdd does not log request body or originalTitle", () => {
    const src = readApiRoute(join("tasks.quickAdd", "route.ts"));
    expect(src).not.toMatch(/console\.log\([^)]*Body/);
    expect(src).not.toMatch(/originalTitle/);
  });
  it("tasks.remindMe does not log request body", () => {
    const src = readApiRoute(join("tasks.remindMe", "route.ts"));
    expect(src).not.toMatch(/console\.log\([^)]*Body/);
  });
  it("tasks.unsnooze does not log request body", () => {
    const src = readApiRoute(join("tasks.unsnooze", "route.ts"));
    expect(src).not.toMatch(/console\.log\([^)]*Body/);
  });
  it("tasks.delete does not log task title", () => {
    const src = readApiRoute(join("tasks.delete", "route.ts"));
    expect(src).not.toMatch(/console\.log\([^)]*task\.title/);
  });
  it("cron/nag does not log task title", () => {
    const src = readApiRoute(join("cron", "nag", "route.ts"));
    expect(src).not.toMatch(/Sending notification for task \$\{task\.id\}:\s*\$\{task\.title\}/);
  });
});
