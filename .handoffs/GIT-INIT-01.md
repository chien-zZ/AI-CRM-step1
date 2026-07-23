# GIT-INIT-01 本地 Git 仓库初始化

- Status: completed locally; remote branch protection pending
- Owner: 项目负责人（当前会话）
- Allowed paths: `.git/`, `.gitattributes`, `.gitignore`, `docs/04-工程手册/`, `.handoffs/GIT-INIT-01.md`

## 已知事实

- 工作目录初始化前没有 Git metadata。
- 用户要求先配置本地 Git 仓库，暂时不连接远程仓库。
- 仓库已有 `.gitignore`、GitHub CI 占位配置和 CODEOWNERS 占位说明，但尚无可执行的主分支保护。
- 第一阶段实施计划要求先通过 G0，再开展多 Agent 并行写入。

## 允许的假设

- 默认集成分支使用现有 CI 配置所引用的 `main`。
- 当前文件全部保留，不清理或重写用户已有内容。
- Git 作者身份沿用当前机器已有的全局配置，不把个人身份复制为仓库配置。

## 禁止的假设

- 不假设任何远程托管平台、组织、仓库 URL 或 CODEOWNERS 账号。
- 不假设本地策略等同于服务端主分支保护。
- 不提交当前工作树，不创建 Tag，不改写历史。

## 非目标

- 不连接远程仓库。
- 不配置 GitHub/GitLab 分支保护。
- 不启动第一阶段应用或平台模块实现。
- 不创建 CRM 领域模块或业务契约。

## 决策

- 初始化 `main` 作为本地默认分支。
- 使用仓库级 `.gitattributes` 固定文本文件为 LF，并保留 Windows 批处理文件 CRLF。
- 使用 `task/<task-id>-<slug>` 分支和独立 Worktree 承载后续工作包。
- 本地配置采用 fast-forward-only pull，并关闭 Git 自动转换行尾；合并与评审规则记录在 `Git协作基线.md`。

## 验证

- Git `2.54.0.windows.1` 已在 `main` 初始化空仓库，当前没有提交。
- `git remote -v` 输出为空，未配置远程仓库。
- 仓库配置已确认：`core.autocrlf=false`、`core.safecrlf=warn`、`core.quotepath=false`、`pull.ff=only`、`fetch.prune=true`。
- `node --version` 为 `v24.15.0`，`pnpm --version` 为 `9.15.0`。
- `git check-ignore` 已确认依赖、Turbo 缓存、环境文件、运行时 Secret 和备份路径被忽略，`.env.example` 可跟踪。
- `pnpm check` 通过；Turbo 同时提示 0 个包和 0 个任务，不能将该结果解释为工程实现完成。

## 未解决问题

- 首次基线提交由项目负责人确认后创建。
- 远程仓库平台、URL、具名 CODEOWNERS、必需检查和服务端 `main` 保护待后续确认。
