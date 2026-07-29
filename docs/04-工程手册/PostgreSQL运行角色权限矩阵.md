# PostgreSQL 运行角色权限矩阵

- 状态：CMP-DB-RUNTIME-GRANTS 待合并评审
- 适用范围：当前生产 `apps/api` 与已审 Task 投影 Worker 组合使用的应用数据库角色
- 架构依据：ADR-0011、ADR-0021、ADR-0023

## 角色边界

当前权威部署定义两个相互隔离的应用数据库登录角色：API 使用 `ai_crm_runtime`，Worker 使用 `ai_crm_worker_runtime`。两者读取各自用途的文件式连接 Secret；生产 `worker_postgres_url` 必须解析为后者，Worker 的固定身份能力探针会在连接角色不匹配时阻止 Ready。仓库只验证 Secret 引用和运行时失败关闭，不能证明未提供的生产 Secret 内容。

两个运行角色都只有当前应用数据库的 `CONNECT`、各自表格中列出的 Schema `USAGE` 和表权限。迁移通过 `current_database()` 安全引用实际数据库名，适用于名称隔离的测试和预发布数据库。两者都没有 `TEMPORARY`、`public` Schema 使用、DDL、角色管理、数据库创建、跨数据库或 Keycloak/Flowable 数据库权限；Worker 的 Task/Eventing 权限只开放首个投影消费者和 Outbox Publisher 的当前可达 SQL 路径。

## 最小权限

| 角色 | Schema | Relation | 权限 | 当前生产 SQL 依据 |
|---|---|---|---|---|
| API | `ai_crm_migrations` | `applied_migrations` | `SELECT` | 启动迁移兼容性检查 |
| API | `organization` | `subject_associations`、`employments`、`assignments`、`organization_units`、`organization_unit_placements`、`positions` | `SELECT` | BFF 主体解析后的 Workforce Context、活动任职与组织路径解析 |
| API | `authorization_core` | `current_policy`、`policy_versions`、`policy_publications` | `SELECT` | 当前已发布策略加载与完整性验证 |
| API | `authorization_core` | `decision_records` | `SELECT, INSERT` | 授权决策追加与幂等冲突读取 |
| API | `audit` | `records` | `SELECT, INSERT` | 认证事件审计追加及 Store 读取路径 |
| API | `audit` | `operation_receipts` | `SELECT, INSERT, UPDATE` | 幂等收据读取/追加；`SELECT ... FOR UPDATE` 要求 `UPDATE` 权限，表触发器仍禁止实际修改和删除 |
| API | `pg_catalog` | `hashtextextended(text,bigint)`、`pg_advisory_xact_lock(bigint)` | `EXECUTE`（PostgreSQL 内置默认能力） | Audit 幂等追加事务锁；集成测试验证有效权限和真实调用 |
| API | `app_registry` | `applications`、`routes`、`navigation` | `SELECT` | 注册应用、路由、导航与 Deep Link 查询 |
| API | `form_schema` | `releases`、`release_status` | `SELECT` | 精确发布版本读取与提交校验 |
| API | `file_center` | `files`、`content_versions`、`upload_sessions`、`operation_receipts`、`resource_links`、`outbox_events` | 精确 `SELECT/INSERT/UPDATE` | File Center 当前读写、幂等收据和 Outbox 追加路径；各表权限见 migration 0014 |
| API | `platform_notifications` | `in_app_notifications` | `SELECT` | 当前人员站内通知查询 |
| API | `platform_task_center` | `task_projections` | `SELECT` | Task 投影查询 |
| Worker | `ai_crm_migrations` | `applied_migrations` | `SELECT` | 启动迁移兼容性检查 |
| Worker | `platform_eventing` | `inbox_receipts` | `SELECT, INSERT` | Task 投影 Inbox 去重与事务提交 |
| Worker | `platform_eventing` | `isolations` | `INSERT` | 合同、版本和终止错误的技术隔离事实 |
| Worker | `platform_eventing` | `outbox_messages` | `SELECT, UPDATE` | 已拥有 Task route 的 Outbox claim、Confirm 后完成与失败保留；Worker 当前不追加 Outbox 事实 |
| Worker | `platform_task_center` | `task_projections` | `SELECT, INSERT, UPDATE` | 幂等、乱序防回退的 Task PostgreSQL 投影写入 |
| Worker | `platform_task_center` | `projection_events` | `SELECT, INSERT` | 投影事件收据读取与追加；当前没有更新路径 |

未列出的 Schema、表和操作全部拒绝。尤其不授权 `organization.workforce_people` 和各模块写入/操作收据表，因为当前生产 API 的可达路径不需要它们；Organization 写命令在应用层也保持失败关闭。

## 迁移与回收

API 基线权限由全局追加迁移 `0000000013_runtime_database_grants.sql` 管理；Task 投影 Worker 的增量精确权限由 `0000000014_task_projection_worker_grants.sql` 管理。前者要求 `ai_crm_runtime` 已由受控初始化创建，后者同时要求 `ai_crm_runtime` 与 `ai_crm_worker_runtime` 存在，因为它还包含同一发布所需的 API File/Notification/Task 查询权限。角色缺失时迁移以 `42704` 中止且不会写入迁移账本。迁移从 `PUBLIC` 回收当前应用数据库的 `CONNECT/TEMPORARY` 和 `public` Schema 权限，再分别回收角色在受管 Schema/表上的既有权限，只返还 `CONNECT` 和上述精确集合。迁移不修改数据或历史迁移。隔离测试必须显式预建两个受限角色，不能通过跳过权限语句制造成功结果。

生产不执行机械 Down Migration。若权限过宽，追加迁移立即 `REVOKE` 并验证受影响能力；若合法路径缺少权限，停止该能力发布，基于实际 SQL 追加最小 `GRANT`。不得临时授予 Schema 全表写权限或使用迁移凭据运行应用。

Integration Owner 合并前必须重新扫描全仓迁移编号；若 `0013` 已占用，应同时重编号 SQL、元数据与测试期望，保持全仓版本唯一。

## 运行能力探针

`@ai-crm/database` 分别公开 API 的 `createPostgresRuntimeRoleCapabilityProbe` 与 Worker 的 `createPostgresWorkerRuntimeRoleCapabilityProbe` 只读探针。它们固定要求 `current_user` 精确为 `ai_crm_runtime` 或 `ai_crm_worker_runtime`，不能由配置替换 expected role；同时要求角色可登录、不是 Superuser、没有 `CREATEDB/CREATEROLE/REPLICATION/BYPASSRLS`，没有任何继承角色成员关系，并且没有数据库 `CREATE/TEMPORARY` 或 `public` Schema `CREATE/USAGE`。

探针查询失败、结果缺失、字段增加/缺失、任一禁止能力存在、Owner/额外角色连接或继承角色关系存在时统一返回 `unavailable`，不返回角色详情。API 与 Worker 生产 Composition 已分别使用各自 DatabaseRuntime 接入固定身份探针，并将失败结果纳入 required readiness；仓库集成测试只证明受控测试连接上的权限矩阵，实际生产连接仍必须由受信发布证据验证。
