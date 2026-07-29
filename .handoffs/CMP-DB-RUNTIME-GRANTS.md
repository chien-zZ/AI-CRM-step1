# CMP-DB-RUNTIME-GRANTS Handoff

> Status: superseded for Worker role topology by G3 production composition. This handoff records the earlier API-only baseline; current production facts are in `docs/04-工程手册/PostgreSQL运行角色权限矩阵.md` and `.handoffs/G3-WORKER-PRODUCTION-COMPOSITION.md`.

## Known Facts

- 生产初始化权威定义 `ai_crm_migration` 与单一应用登录角色 `ai_crm_runtime`；运行角色当前只有数据库 `CONNECT`。
- 两台生产 API 都读取 `api_postgres_url`，没有权威配置把 API 与 Worker 拆成不同 PostgreSQL 角色。
- 当前 API 的实际数据库路径包括迁移兼容检查、Workforce Context 读取、授权策略读取与决策追加、认证审计追加、Application Registry 查询和 Form Release 查询。
- Worker 生产 Compose 尚未挂载 PostgreSQL Secret，Task projection 消费者仍按合同失败关闭。
- 本分支创建时全仓最高迁移编号为 `0000000012`。

## Allowed Assumptions

- `ai_crm_runtime` 在生产由已接受的 PostgreSQL 初始化脚本创建；任何执行 `0013` 的完整迁移环境都必须显式预建该受限角色。
- 应用数据库名称可以因环境隔离而不同；权限迁移必须使用 PostgreSQL `current_database()`，不能硬编码生产逻辑数据库名。
- PostgreSQL 的默认对象权限保持收紧；权限迁移仍显式回收当前全部应用 Schema/表权限，防止已有环境漂移扩大访问面。
- `SELECT ... FOR UPDATE` 对 Audit 幂等收据需要 `UPDATE` 表权限，实际 UPDATE/DELETE 继续由追加式触发器拒绝。

## Forbidden Assumptions

- 不推导独立 API/Worker 角色、未来业务模块、File Provider、Task consumer 或未激活平台能力的数据库权限。
- 不因 Store 类型含写方法就授予当前生产不可达写路径；以生产组合和公开 HTTP 路径为准。
- 不授予 Schema 全表写、DDL、角色管理、数据库创建、超级用户或 Keycloak/Flowable 数据库权限。
- 不把来自 `PUBLIC` 的 `CONNECT`、`TEMPORARY` 或 `public` Schema 权限误判为运行角色没有权限；有效权限必须通过 PostgreSQL 集成测试检查。
- 不修改历史迁移，不运行自动 Schema 同步，不把测试凭据或生产 Secret 写入仓库。

## Non-Goals

- 不发布真实授权策略，不定义 Permission、Role、Grant 或业务访问规则。
- 不修改 API、Worker、生产 Compose、根依赖或 Secret 文件布局。
- 不激活 File、Task、Notification、Eventing 或业务配置运行时。
- 不声明数据库高可用、SLA、RPO 或 RTO。

## Deliverables

- `packages/database/migrations/0000000013_runtime_database_grants.sql` 与审查元数据。
- `docs/04-工程手册/PostgreSQL运行角色权限矩阵.md` 的可审查技术矩阵。
- 真实 PostgreSQL 集成测试，覆盖允许路径、跨 Schema 拒绝、未授权写拒绝和 DDL 拒绝。
- 集成测试在迁移前断言生产初始化脚本已创建 `ai_crm_runtime`，并验证 `PUBLIC` 不再间接提供 TEMP 或 `public` Schema 访问。
- 公共只读 `createPostgresRuntimeRoleCapabilityProbe`，固定核验 `ai_crm_runtime` 身份、危险角色属性、继承成员关系和关键有效权限。
- 第二个真实 PostgreSQL 隔离容器验证角色缺失时 `0013` 失败且不记账，创建受限角色后可以前滚重跑成功。
- 数据库迁移集成测试补入既有 `0000000012` 授权持久化迁移，证明空库升级和幂等执行覆盖完整目录。

## Integration Notes

- Integration Owner 合并前必须重新检查全仓最高迁移号；并行分支若已占用 `0000000013`，本迁移及测试期望必须整体重编号。
- 本变更不会让 Registry/Form readiness 自动通过；两者仍缺模块自有的运行能力探针。
- 本变更可满足 Audit capability probe 所检查的表权限，但完整 G3 仍取决于真实非空授权策略和其他未决生产能力。
- Integration Owner 必须把 `createPostgresRuntimeRoleCapabilityProbe` 接入 API 生产 Composition 的 required readiness；接入前不能声称权限矩阵对真实 API 连接已生效或 API Ready。

## Independent Review Fixes

- P2 missing-role skip: fixed. Migration `0013` now raises PostgreSQL `42704`; its transaction is not recorded. A separate PostgreSQL container without repository initialization proves the failure, then creates the reviewed role and proves the same migration can be rerun successfully.
- P2 no runtime verification boundary: fixed in the database package. The public probe is read-only, has no caller-supplied role name, checks exact identity, dangerous attributes, inherited memberships and effective database/public-Schema privileges, and fails closed without returning catalog details.
- P2 missing-role test readiness race: fixed. The uninitialized PostgreSQL container now has a bounded `pg_isready` Docker Healthcheck; the runner waits for `healthy` and then performs a second bounded `select 1` through the migration URL file before starting Vitest. Timeout and failure messages are stable and never include the URL, password, or driver error.

## Verification

- `pnpm --filter @ai-crm/database lint`: passed.
- `pnpm --filter @ai-crm/database typecheck`: passed.
- `pnpm --filter @ai-crm/database build`: passed.
- `pnpm --filter @ai-crm/database test`: 26 passed, 5 environment-gated PostgreSQL tests skipped.
- `pnpm db:test:integration`: two consecutive independent runs passed 31/31 against two isolated PostgreSQL 17.5 containers per run. Both runs completed Docker `pg_isready` health and the migration-URL `select 1` probe before Vitest started.
- The initialized container passed the full `0001` through `0013` migration, least-privilege SQL paths, effective-denial matrix, exact runtime-role probe, Owner/extra-role rejection, and inherited-membership rejection.
- The uninitialized container proved missing `ai_crm_runtime` returns `42704`, does not record `0013`, and succeeds on forward rerun after the restricted role is created.
- Full repository `pnpm check` is intentionally deferred to Integration Owner after independent re-review and API readiness composition.

## Review Pass

- Authorization: no business Permission/Role/Grant was added; database access follows current production composition and denies unlisted effective privileges, including those inherited from `PUBLIC`. The capability probe fixes the expected role internally and exposes no catalog detail.
- Idempotency and transactions: migration execution remains globally locked and transactional; repeated migration execution passed. Audit advisory locking, receipt row locking, append and mutation rejection passed against PostgreSQL.
- Migrations: only new global migration `0013` was changed; no historical migration or automatic synchronization was used. Missing prerequisite roles now abort transactionally without false migration evidence. Metadata includes lock/data impact, recovery and forward-fix guidance.
- Observability: no runtime component or telemetry path changed. Migration state remains observable through the existing migration registry.
- Backward compatibility: existing API SQL paths are allowed; uncomposed module and write paths remain denied. Revoking broad or inherited privileges may expose undocumented access, which must be treated as a stopped rollout and corrected by a reviewed forward migration.
