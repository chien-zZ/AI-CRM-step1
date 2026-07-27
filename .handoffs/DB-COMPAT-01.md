# DB-COMPAT-01：只读迁移兼容性检查

- 状态：IMPLEMENTED，等待独立 Review / 合并 Owner 验收
- 日期：2026-07-27
- Owner 路径：`packages/database/**`
- 组合消费者：CMP-01 API / Worker 启动与 Readiness

## 已知事实

- ADR-0011 禁止 API/Worker 启动自动运行迁移或 Schema 同步；迁移只能由专用部署步骤和凭据执行。
- `ai_crm_migrations.applied_migrations` 已记录十位全局版本、文件名、模块 Owner、SQL Checksum 和应用时间，现有已部署 SQL 不包含应用兼容元数据列。
- 当前仓库十条迁移的 `applicationCompatibility` 同时存在 `">=0.0.0"` 和三种 additive 自由文本；SQL Checksum 只覆盖 `.sql`，不覆盖 `.meta.json`。
- CMP-01 明确需要公共只读迁移兼容检查，且不得调用 `runMigrations` 冒充启动检查。
- 当前生产发布标识示例 `AI_CRM_RELEASE_ID=2026.07.26.1` 是四段构建/发布身份，不是应用 Schema 兼容版本，不能传入本 API。

## 允许的假设

- Composition Root 会提供当前发布完整迁移目录清单和由构建时受控来源提供的独立严格 SemVer `applicationSchemaVersion`。
- 当前历史 `">=0.0.0"` 及仓库已有三条 additive 声明均表示从 `0.0.0` 起无上界；这一解释只由逐字 legacy allowlist 提供，不扩展到其他文本。
- 运行时可使用仅有迁移注册表 `SELECT` 权限的连接；查询异常由 Composition Root 转换为失败关闭的启动/Readiness 状态。

## 禁止的假设

- 不把未知迁移猜测为可兼容，不从迁移编号推断语义，也不解析任意自然语言兼容说明。
- 不把 `AI_CRM_RELEASE_ID`、`AI_CRM_RELEASE` 或其他发布/镜像/构建标识当成 `applicationSchemaVersion`。
- 不认为应用镜像回滚可以回滚数据库，不运行 Down Migration，不修改任何已部署 SQL 内容。
- 不认为兼容检查成功等于业务模块健康、授权正确、数据完整或数据库高可用。
- 不记录或返回连接字符串、SQL 参数、业务数据、凭据或 Provider 数据。

## 非目标

- 不接线 `apps/api`、`apps/worker`、Readiness、日志、Sentry 或部署 Compose。
- 不执行、写入、同步、修复或回滚迁移，不新增迁移表/列/索引。
- 不修改其他平台模块的迁移元数据；其历史格式由数据库包的显式兼容适配器读取，后续新迁移必须使用规范对象。
- 不引入完整 SemVer 库、Prerelease/Build 规则或根 Lockfile 变更。
- 不新增运行时环境变量；`applicationSchemaVersion` 的构建时受控来源与注入由 CMP-01 在其路径内完成。

## 实现摘要

- 新增公共 `checkMigrationCompatibility` / `checkMigrationCompatibilityWithPool`。检查只发出一条固定 `SELECT`，不加迁移锁、不开始事务、不执行 SQL 文件、不写注册表。
- 兼容报告包含当前应用版本、最高已应用迁移版本及稳定的分类问题：缺失迁移、未知已应用迁移、Checksum 漂移、注册表身份漂移、应用版本不受支持。
- 检查失败关闭：当前发布已知迁移必须全部应用；数据库中存在当前发布目录不能解释的未来迁移也判定不兼容。
- 新元数据规范为 `{ "minimumInclusive": "x.y.z", "maximumExclusive"?: "x.y.z" }`。Loader 统一输出该机器可读结构，验证字段白名单、严格版本格式及非空范围。
- 历史 `0000000001` metadata 与 SQL 均保持原文不变，避免已评审 metadata 漂移。规范对象由新测试 Fixture 证明；其他包的已存在格式也通过四类逐字 legacy 值兼容，新自由文本一律拒绝。

## 失败、超时与重试语义

- 查询失败（包括注册表不存在、权限不足、网络中断、超时）原样抛出，调用方不得将其解释为兼容。
- 发现不兼容返回 `compatible: false` 和不含敏感数据的稳定问题分类；检查不自动重试，重试/超时预算由应用生命周期 Owner 统一配置。
- 检查无副作用，可安全重复；在部署迁移并发窗口内可能先后观察到不同完整提交状态，部署编排应在迁移步骤完成后启动应用。

## 测试与证据

- `pnpm --filter @ai-crm/database lint`：通过。
- `pnpm --filter @ai-crm/database typecheck`：通过。
- `pnpm --filter @ai-crm/database build`：通过。
- `pnpm --filter @ai-crm/database contracts:check`：通过。
- `pnpm --filter @ai-crm/database test`：19 passed，1 PostgreSQL test 因无 URL 正常 skip。
- `pnpm db:test:integration`：隔离 PostgreSQL 真实执行，20/20 passed；验证空库迁移、幂等迁移、真实注册表兼容读取，并已清理容器、网络和 Volume。
- 全仓现有迁移目录加载探针：10/10 迁移元数据成功规范化。
- `git diff --check`：通过。

## 八维 Review

| 维度 | 结论 |
| --- | --- |
| Authorization | API 不授予业务权限；生产连接应仅获注册表 `SELECT`，固定查询不接受外部 SQL。 |
| Idempotency | 纯读取且无锁/写入，可重复调用；相同数据库快照与发布目录得到相同报告。 |
| Transactions | 不开启事务、不参与模块事务；仅观察已提交注册表事实，不制造部分成功。 |
| Migrations | 未修改已部署 SQL、未新增 DDL；Checksum/身份漂移和缺失/未知版本均失败关闭。 |
| Observability | 返回有界版本号与稳定分类，可安全用于健康状态；不包含 SQL、连接、参数或业务内容。具体 Logger/Metric 接线留给 CMP-01。 |
| Backward Compatibility | 精确 legacy allowlist 保持仓库十条现有元数据可读；新格式统一。旧应用遇到未知未来迁移失败关闭，不猜测回滚安全。 |
| Secrets | API 仅接收调用方提供的连接/Pool，不读取、记录或返回 Secret；未新增 Secret、环境变量或 Fixture 凭据。 |
| Failure Modes | 格式/目录错误在连接前失败；查询异常抛出且释放连接；不兼容以分类报告返回；自动重试、超时和生命周期决策由 CMP-01 负责。 |

## 未决事项与后续合并要求

- CMP-01 需要从发布制品构造完整迁移目录清单，并由构建时受控应用 Schema 版本来源为 API/Worker 提供同一 `applicationSchemaVersion`；不得传入模块子集，也不得直接传 `AI_CRM_RELEASE_ID`/`AI_CRM_RELEASE`。
- CMP-01 需要把 `compatible: false` 与查询异常都映射为失败关闭的启动/Readiness，并接入安全日志/指标；不得输出连接字符串或任意异常载荷。
- 后续迁移 Owner 应逐步把各自 `.meta.json` 转成规范对象；是否修改已评审/已部署 metadata 由迁移 Owner 决定，本工作包不越权修改。
- 若未来需要允许旧应用跨未知新迁移回滚，必须先通过新 ADR/迁移注册表扩展建立可由旧发布验证的持久兼容声明；当前安全策略保持失败关闭。
