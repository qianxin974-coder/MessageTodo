# MessageTodo

**把任何消息快速变成待办，到点提醒。**

看到一条消息 → 分享/粘贴给 MessageTodo → 自动识别任务和时间 → 一键确认 → 到点提醒。手机、电脑通用。

> 状态：开发中。当前完成 **Phase 1 + Phase 2 + Phase 3**（项目搭建 / Web 跑通 / 数据库模型与 RLS）。
> 技术底座：DoFirst（MIT）。详见 `THIRD_PARTY_NOTICES.md`、`docs/CODE-ORIGIN.md`、`docs/PHASE3_DB_NOTES.md`。

## 功能规划（路线图）

| Phase | 内容 | 状态 |
|---|---|---|
| 1 | 建立 MessageTodo 项目（monorepo + Git） | ✅ |
| 2 | Web/电脑端先运行起来（Next.js + Supabase 基线） | ✅ |
| 3 | 数据库与权限：MessageTodo 数据模型 + 严格 RLS | ✅ |
| 4 | 迁移并测试提醒/周期任务逻辑 | ⏳ |
| 5 | 实时同步（Supabase Realtime） | ⏳ |
| 6 | 中文 AI Intent Parser | ⏳ |
| 7 | Android App（Expo） | ⏳ |
| 8 | iOS App | ⏳ |
| 9 | Share / Attachment / TaskSource | ⏳ |
| 10 | 全面测试、打包、发布 | ⏳ |

## 技术栈

- **Web:** Next.js 15 (App Router) + React 18 + TypeScript + Zod
- **数据库:** Supabase (PostgreSQL + Auth + RLS) — 本地 `supabase start`
- **通知:** Web Push (VAPID + Service Worker) + 渐进提醒（nagging）算法
- **Monorepo:** pnpm workspaces
- **测试:** Vitest；**Lint:** ESLint 9 (flat config)

## 目录结构

```
MessageTodo/
├── apps/
│   └── web/                # Next.js Web 应用
├── packages/
│   ├── db/                 # 共享校验与类型（zod）+ Phase 3 模型 schema 与测试
│   ├── design-system/      # Web 组件库 + 设计令牌 + hooks
│   ├── logging/            # 结构化日志 + 敏感字段脱敏
│   ├── nagging/            # 提醒调度算法（到点→5m→10m×3→15m 循环、安静时段）
│   ├── notifications/      # 通知平台抽象（Phase 2 仅 Web）
│   ├── rate-limit/         # 令牌桶限流
│   └── recurrence/         # 周期任务算法
├── supabase/
│   ├── migrations/         # 数据库迁移（001–012 基线来自 DoFirst；013 MessageTodo 数据模型）
│   ├── tests/              # 真实 RLS 交叉用户测试（需 Supabase/Postgres 环境）
│   ├── config.toml         # Supabase CLI 本地配置
│   └── seed_test_tasks.sql # 测试数据
├── docs/
│   ├── CODE-ORIGIN.md      # 代码来源记录
│   ├── GITHUB_SETUP.md     # GitHub 仓库初始化说明
│   └── PHASE3_DB_NOTES.md  # Phase 3 数据库改造说明（含与 Phase 1 方案差异）
├── THIRD_PARTY_NOTICES.md  # 第三方代码来源与许可证
└── LICENSE                 # MIT（含 DoFirst 版权声明）
```

## 快速开始（本地开发）

前置：Node 18+、pnpm 9+、Docker、[Supabase CLI](https://supabase.com/docs/guides/cli)。

```bash
# 1. 安装依赖
pnpm install

# 2. 启动本地 Supabase（首次会自动建库并应用 migrations 001→013）
supabase start
supabase db reset          # 可选：重置并重新应用迁移（会顺带跑 supabase/tests 之外的 seed）

# 3. 配置环境变量
cp apps/web/.env.example apps/web/.env.local
# 填入 supabase start 输出的 URL / anon key / service role key，
# 并生成 VAPID 密钥：npx web-push generate-vapid-keys

# 4. 启动 Web
pnpm dev                   # http://localhost:3000

# 5.（可选）在 Supabase SQL Editor / psql 以 postgres 角色运行 RLS 测试
#    psql "$DATABASE_URL" -f supabase/tests/rls_phase3.sql
```

## 常用脚本

```bash
pnpm dev        # 启动 Web 开发服务器
pnpm build      # 构建 Web 生产包
pnpm test       # 运行单元测试（Vitest）
pnpm lint       # ESLint 检查
pnpm typecheck  # TypeScript 类型检查（pnpm -r typecheck）
```

## 产品规则（重要）

1. **时间不猜测**：用户只说"明天"时，只解析日期，不默认时间；需要时间则询问用户。
2. **AI 不直接写库**：AI 只输出结构化 Intent，业务层负责 Validation → Confirmation → Database。
3. **统一数据模型**：Web/Android/iOS 共用同一套 Task/Reminder/Recurrence/TaskSource/Attachment/UserSetting/Notification。
4. **RLS 隐私**：用户只能访问自己的数据；新增表一律 `auth.uid() = user_id`；任何查询都必须尊重 Supabase RLS。
5. **原文保存可开关**：`settings.keep_original_text` + `task_sources.keep_original`；关闭时不落库、不打印、不返回。
6. **身份不信任客户端**：user_id 一律从 Supabase Auth session 取得，客户端提交的 user_id 不可信。

## License

MIT，含 DoFirst 版权声明。详见 `LICENSE` 与 `THIRD_PARTY_NOTICES.md`。
