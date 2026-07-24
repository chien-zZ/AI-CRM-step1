# DAT-01 PostgreSQL、Drizzle 与迁移

- Status: completed
- Owner: 当前会话（迁移序列单一 Owner）
- Allowed paths: `packages/database`、迁移工具、测试数据库 Fixture、相关迁移说明

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
