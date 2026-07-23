# Git 协作基线

## 1. 适用范围

本基线适用于第一阶段公共技术底座和业务中立 Walking Skeleton。它补充版本控制协作规则，不替代 `AGENTS.md`、ADR、契约、模块说明或第一阶段实施计划。

## 2. 分支与 Worktree

- `main` 是唯一集成主分支。AI Agent 不直接在 `main` 上提交、重写历史或合并未经评审的变更。
- 每个工作包使用唯一 Task ID，并从最新 `main` 创建 `task/<task-id>-<slug>` 分支。
- 并行工作使用独立 Git Worktree；一个工作包只拥有一个活动分支和 Worktree。
- `.handoffs/<task-id>.md` 必须记录 Owner、允许修改路径、已知事实、允许/禁止假设、非目标、决策、验证结果和未解决问题。
- 合同源文件、数据库迁移、`apps/api`/`apps/worker` 组合根和 `pnpm-lock.yaml` 在同一时段分别只有一个明确 Owner。跨越所有权边界前先更新 handoff 并取得评审结论。

建议命令：

```bash
git worktree add ../ai-crm-<task-id> -b task/<task-id>-<slug> main
```

## 3. 提交

- 提交信息使用 `<task-id>: <imperative summary>`，例如 `FND-01: add workspace lint baseline`。
- 一个提交只表达一个可评审目的；生成制品与其源契约在同一工作包内保持可追溯。
- 不提交 Secret、运行时数据、依赖目录、构建产物、测试报告或本地工具缓存。
- 不使用 `git add .` 绕过范围检查；提交前检查 `git status --short` 和暂存区差异。
- 不对共享分支执行强制推送，不重写已经进入评审或被其他工作包依赖的提交。

## 4. 评审与合并

- 提交评审前运行 `pnpm check` 以及工作包要求的专项测试，并把结果写入 handoff。
- 独立 Review Pass 必须检查授权、幂等、事务、迁移、可观测性、向后兼容、Secret 和失败模式；不适用项也要说明理由。
- 发现需要修改其他 Owner 的契约、迁移、组合根或 Lockfile 时暂停当前实现，由对应 Owner 先处理共享变更。
- 由项目负责人确认评审结论后合并到 `main`。在远程仓库启用前，本地策略依赖流程约束；连接远程后必须配置主分支保护和必需检查。
- 合并后删除已完成的工作分支和 Worktree，但保留权威文档、提交历史及必要验收证据。

## 5. 当前限制

本地 Git 不能提供服务端主分支保护、必需评审或 CI 合并门。未连接远程仓库前，`main` 只由项目负责人执行集成操作，并禁止多 Agent 在同一工作目录并行写入；因此 G0 的技术性主分支保护仍待远程仓库配置后闭环。

