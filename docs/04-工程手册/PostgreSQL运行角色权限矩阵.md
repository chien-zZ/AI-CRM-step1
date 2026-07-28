# PostgreSQL 运行角色权限矩阵

- 状态：CMP-DB-RUNTIME-GRANTS 待合并评审
- 适用范围：当前生产 `apps/api` 组合使用的应用数据库角色
- 架构依据：ADR-0011、ADR-0021、ADR-0023

## 角色边界

当前权威部署只定义 `ai_crm_runtime` 一个应用数据库登录角色，两台 API 使用同一类文件式连接 Secret。Worker 虽有数据库配置代码，但生产 Compose 尚未挂载 Worker PostgreSQL Secret，消费者也未激活；因此本矩阵不猜测或创建独立 API/Worker 角色。

`ai_crm_runtime` 只有当前应用数据库的 `CONNECT`、下表列出的 Schema `USAGE` 和表权限。迁移通过 `current_database()` 安全引用实际数据库名，适用于名称隔离的测试和预发布数据库。它没有 `TEMPORARY`、`public` Schema 使用、DDL、角色管理、数据库创建、跨数据库、Keycloak、Flowable、File、Task、Notification、Eventing 或业务配置数据权限。

## 最小权限

| Schema | Relation | 权限 | 当前生产 SQL 依据 |
|---|---|---|---|
| `ai_crm_migrations` | `applied_migrations` | `SELECT` | API 启动迁移兼容性检查 |
| `organization` | `subject_associations`、`employments`、`assignments`、`organization_units`、`organization_unit_placements`、`positions` | `SELECT` | BFF 主体解析后的 Workforce Context、活动任职与组织路径解析 |
| `authorization_core` | `current_policy`、`policy_versions`、`policy_publications` | `SELECT` | 当前已发布策略加载与完整性验证 |
| `authorization_core` | `decision_records` | `SELECT, INSERT` | 授权决策追加与幂等冲突读取 |
| `audit` | `records` | `SELECT, INSERT` | 认证事件审计追加及 Store 读取路径 |
| `audit` | `operation_receipts` | `SELECT, INSERT, UPDATE` | 幂等收据读取/追加；`SELECT ... FOR UPDATE` 要求 `UPDATE` 权限，表触发器仍禁止实际修改和删除 |
| `pg_catalog` | `hashtextextended(text,bigint)`、`pg_advisory_xact_lock(bigint)` | `EXECUTE`（PostgreSQL 内置默认能力） | Audit 幂等追加事务锁；集成测试验证有效权限和真实调用 |
| `app_registry` | `applications`、`routes`、`navigation` | `SELECT` | 注册应用、路由、导航与 Deep Link 查询 |
| `form_schema` | `releases`、`release_status` | `SELECT` | 精确发布版本读取与提交校验 |

未列出的 Schema、表和操作全部拒绝。尤其不授权 `organization.workforce_people` 和各模块写入/操作收据表，因为当前生产 API 的可达路径不需要它们；Organization 写命令在应用层也保持失败关闭。

## 迁移与回收

权限由全局追加迁移 `0000000013_runtime_database_grants.sql` 管理。它先要求 `ai_crm_runtime` 已由受控初始化创建；角色缺失时迁移以 `42704` 中止且不会写入迁移账本。随后从 `PUBLIC` 回收当前应用数据库的 `CONNECT/TEMPORARY` 和 `public` Schema 权限，再回收 `ai_crm_runtime` 在当前应用 Schema/表上的既有权限，只向运行角色返还 `CONNECT` 和上述精确集合。迁移不修改数据或历史迁移。隔离测试必须显式预建受限角色，不能通过跳过权限语句制造成功结果。

生产不执行机械 Down Migration。若权限过宽，追加迁移立即 `REVOKE` 并验证受影响能力；若合法路径缺少权限，停止该能力发布，基于实际 SQL 追加最小 `GRANT`。不得临时授予 Schema 全表写权限或使用迁移凭据运行应用。

Integration Owner 合并前必须重新扫描全仓迁移编号；若 `0013` 已占用，应同时重编号 SQL、元数据与测试期望，保持全仓版本唯一。

## 运行能力探针

`@ai-crm/database` 公开 `createPostgresRuntimeRoleCapabilityProbe` 只读探针。它固定要求 `current_user` 精确为 `ai_crm_runtime`，不能由配置替换 expected role；同时要求角色可登录、不是 Superuser、没有 `CREATEDB/CREATEROLE/REPLICATION/BYPASSRLS`，没有任何继承角色成员关系，并且没有数据库 `CREATE/TEMPORARY` 或 `public` Schema `CREATE/USAGE`。

探针查询失败、结果缺失、字段增加/缺失、任一禁止能力存在、Owner/额外角色连接或继承角色关系存在时统一返回 `unavailable`，不返回角色详情。Integration Owner 必须在 API 生产 Composition 中使用真实 API DatabaseRuntime 接入该探针，并将失败结果纳入 required readiness。在该接入完成并验证前，不得声称本矩阵已在生产连接上生效或 API Ready。
