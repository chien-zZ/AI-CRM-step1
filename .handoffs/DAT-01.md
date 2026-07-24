# DAT-01 PostgreSQL、Drizzle 与迁移

- Status: completed
- Owner: 当前会话（迁移序列单一 Owner）
- Security patch branch: `codex/DAT-01-drizzle-security`
- Allowed paths: `packages/database`、迁移工具、测试数据库 Fixture、相关迁移说明

## 2026-07-24 安全维护补丁

### 已知事实

- `drizzle-orm@0.44.3` 受 GHSA-gpj5-g38j-94v9 影响；该漏洞允许未正确转义的 SQL 标识符造成 SQL 注入。
- 官方修复版本为 `0.45.2`；当前 `pg@8.16.3`、`@types/pg@8.15.5` 和 `@opentelemetry/api@1.9.1` 满足其 Peer Dependency。
- 数据库公共 API 只使用 `drizzle-orm/node-postgres` 的 `drizzle` 入口，本补丁不改变 Schema、SQL 迁移或数据库合同。

### 允许的假设

- 在现有公共 API、单元测试和 PostgreSQL 集成测试全部通过的前提下，`0.45.2` 与当前数据库运行时兼容。

### 禁止的假设

- 不把依赖升级解释为数据库 Schema 或迁移格式变更，不引入新的实体、字段、权限或业务规则。

### 非目标

- 不升级 `drizzle-kit`，不修改 SQL 迁移、数据库合同或其他 G2 工作包。

### 补丁验证

- `drizzle-orm` 从精确版本 `0.44.3` 升级到精确版本 `0.45.2`，锁文件不再解析旧版本。
- 数据库包的 Build、Lint、Typecheck、Test 和 Contract Check 全部通过；单元测试为 10 通过、1 个 PostgreSQL 集成测试按默认配置跳过。
- 隔离 PostgreSQL 集成测试 11/11 通过；测试容器、网络和 Volume 已清理。
- `pnpm audit --prod` 报告 `No known vulnerabilities found`。
- 全仓 `pnpm check` 通过，Turbo 任务为 140/140。

### 补丁独立审查

- Authorization: 无授权逻辑或授权接口变化；数据库包仍不裁决业务权限。
- Idempotency: 无幂等键或处理语义变化；现有迁移重复执行与 Checksum 测试继续通过。
- Transactions: 无事务代码变化；Commit、Rollback、嵌套事务与原错误传播测试继续通过。
- Migrations: 无迁移文件、迁移登记 Schema 或自动同步行为变化；应用启动仍不执行迁移或 `drizzle-kit push`。
- Observability: 无日志、Trace、指标或健康响应变化；未新增 SQL、参数或连接信息暴露。
- Backward compatibility: 公共导出和运行时代码未变，Peer Dependency 兼容，数据库包与真实 PostgreSQL 回归门禁通过。

## 已知事实

- PostgreSQL 与 Drizzle 已由 ADR-0011 接受。
- 当前没有模块 Schema、业务表或已部署迁移。
- 应用启动不得执行迁移或 `drizzle-kit push`。

## 允许的假设

- 基础迁移只创建迁移登记 Schema/Table，不创建任何业务数据结构。
- 迁移使用全仓单调编号、Checksum 和 PostgreSQL Advisory Lock。

## 禁止的假设

- 不定义 CRM 表、通用 Base Repository、跨模块外键或跨模块查询。
- 不向公共入口导出 Drizzle Schema、Query Builder、数据库 Row 或底层事务句柄。

## 非目标

- 不建立平台模块自己的 Schema；它们由各模块后续 G2 工作包负责。

## 验证

- 数据库配置边界、健康成功/失败、嵌套事务单连接、Commit、Rollback 和原错误传播测试通过。
- 迁移文件名、完整影响/回填/恢复/前滚元数据、破坏性批准、Checksum、Advisory Lock 和失败不登记成功测试通过。
- PostgreSQL 17.5 隔离空库执行首迁移成功，第二次执行幂等，登记记录数保持 1。
- 运行时账号不是数据库 Owner；迁移账号独立持有 DDL 所有权。
- 集成测试结束后容器、网络、Volume 和一次性连接文件均删除。

## 独立审查

- Authorization: 数据库包不裁决业务权限；迁移与运行时凭据隔离，运行时账号不持有 DDL Owner 权限。
- Idempotency: 已执行版本按 Checksum 跳过；同版本内容变化失败，失败事务不写成功记录。
- Transactions: 最外层事务获取一个连接并 Commit/Rollback；嵌套调用复用 AsyncLocalStorage 上下文，远程调用不在此边界内。
- Migrations: 全局 Advisory Lock、单调文件名、Owner/兼容性/锁与数据影响/回填/恢复/前滚元数据、破坏性明确批准、独立部署命令和追加修复规则已实现；无 `drizzle-kit push`。
- Observability: 健康检查返回有限状态和延迟，不返回 SQL、参数或连接错误；更完整指标属于 INF-02。
- Backward compatibility: 迁移元数据要求应用兼容范围和恢复指导；破坏性 SQL 默认拒绝。
- Secrets: 迁移 URL 只通过 `DATABASE_MIGRATION_URL_FILE` 读取；测试连接文件位于系统临时目录并清理。
- Failure modes: 连接失败、配置错误、Checksum 漂移、迁移异常和锁释放均有明确失败/清理路径。

## 未解决问题

- 当前无破坏性迁移；未来真实破坏性迁移仍需逐项影响评估、批准和接近真实数据量的恢复演练。
