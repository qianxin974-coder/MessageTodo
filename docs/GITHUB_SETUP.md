# GitHub 仓库创建指引

本地 Git 仓库已初始化并完成首个提交（分支 `main`）。
要在 GitHub 上建立远端仓库并推送，任选一种方式：

## 方式 A：GitHub CLI（推荐）

```bash
# 安装（Windows）
winget install GitHub.cli

# 登录（浏览器授权一次）
gh auth login

# 在项目根目录创建私有仓库并推送
gh repo create messagetodo --private --source=. --remote=origin --push
```

## 方式 B：GitHub 网页

1. 打开 https://github.com/new ，仓库名 `messagetodo`（Private）。
2. 不要勾选初始化 README/.gitignore（本仓库已有）。
3. 回到项目根目录执行：

```bash
git remote add origin https://github.com/<你的用户名>/messagetodo.git
git push -u origin main
```

## 说明

- 当前分支名：`main`（已用 `git init -b main` 初始化）。
- 首个提交：`35a3319 chore(phase1-2): scaffold MessageTodo monorepo ...`
- 密钥/环境变量均未进入版本库（`apps/web/.env.local` 已被 `.gitignore` 排除）。
