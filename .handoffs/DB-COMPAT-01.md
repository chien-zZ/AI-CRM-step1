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
- 当前历史 `">=0.0.0"` 及仓库已有三条 additive 声明的评审结论均为从 `0.0.0` 起无上界；迁移 `0000000011` 仅在版本与 SQL Checksum 精确匹配时把该结论回填为数据库证据，运行时不信任可变 metadata。
- 运行时使用仅有迁移注册表 `SELECT` 权限、且由调用方配置连接/查询/语句/整体启动 Deadline 与取消的 Pool；查询异常由 Composition Root 转换为失败关闭的启动/Readiness 状态。

## 禁止的假设

- 不把未知迁移猜测为可兼容，不从迁移编号推断语义，也不解析任意自然语言兼容说明。
- 不把 `AI_CRM_RELEASE_ID`、`AI_CRM_RELEASE` 或其他发布/镜像/构建标识当成 `applicationSchemaVersion`。
- 不认为应用镜像回滚可以回滚数据库，不运行 Down Migration，不修改任何已部署 SQL 内容。
- 不认为兼容检查成功等于业务模块健康、授权正确、数据完整或数据库高可用。
- 不记录或返回连接字符串、SQL 参数、业务数据、凭据或 Provider 数据。
- 不把 `.meta.json` 当作已应用兼容范围的持久证据；当前注册表 Checksum 不覆盖 metadata，修改 metadata 不能改变运行时结论。

## 非目标

- 不接线 `apps/api`、`apps/worker`、Readiness、日志、Sentry 或部署 Compose。
- 应用兼容检查不执行、写入、同步、修复或回滚迁移；本工作包只通过专用部署迁移 `0000000011` 为技术迁移注册表追加兼容证据列，不新增业务表、业务字段或索引。
- 不修改其他平台模块的迁移元数据；其历史格式由数据库包的显式兼容适配器读取，后续新迁移必须使用规范对象。
- 不引入完整 SemVer 库、Prerelease/Build 规则或根 Lockfile 变更。
- 不新增运行时环境变量；`applicationSchemaVersion` 的构建时受控来源与注入由 CMP-01 在其路径内完成。

## 实现摘要

- 新增唯一公共 Pool-only `checkMigrationCompatibility`。已移除自建 connection-string/Pool 入口，Deadline、取消和 Pool 清理由调用方拥有。检查只发出一条固定 `SELECT`，不加迁移锁、不开始事务、不执行 SQL 文件、不写注册表。
- 兼容报告包含当前应用 Schema 版本、最高已应用迁移版本及稳定的分类问题：缺失迁移、未知已应用迁移、Checksum 漂移、注册表身份漂移、兼容证据缺失、应用 Schema 版本不受支持。
- 检查失败关闭：当前发布已知迁移必须全部应用；数据库中存在当前发布目录不能解释的未来迁移也判定不兼容。
- 新元数据规范为 `{ "minimumInclusive": "x.y.z", "maximumExclusive"?: "x.y.z" }`。Loader 通过新增 `applicationCompatibilityRange` 输出该机器可读结构，验证字段白名单、严格版本格式及非空范围；原有 string 类型 `applicationCompatibility` 保留并标记 deprecated，避免公共类型直接破坏。
- 历史 `0000000001` metadata 与 SQL 均保持原文不变，避免已评审 metadata 漂移。规范对象由新测试 Fixture 证明；其他包的已存在格式也通过四类逐字 legacy 值兼容，新自由文本一律拒绝。
- 追加全局迁移 `0000000011` 为注册表增加规范 min/max 兼容范围；`0000000001` 至 `0000000010` 仅在持久 SQL Checksum 精确匹配评审值时回填，任何不匹配都会回滚。Runner 为 `0000000011` 及后续迁移写入规范范围；运行时对比数据库证据与发布 metadata，缺失或不一致均失败关闭。
- SemVer 数字段使用 BigInt 比较，不存在 JavaScript Number 安全整数溢出或精度合并。

## 失败、超时与重试语义

- 查询失败（包括注册表不存在、权限不足、网络中断、超时）原样抛出，调用方不得将其解释为兼容。
- 发现不兼容返回 `compatible: false` 和不含敏感数据的稳定问题分类；检查不自动重试。调用方必须在传入 Pool 上设置有限连接、Query/Statement Timeout，并以应用启动 Deadline 控制取消与 Pool 清理。
- 检查无副作用，可安全重复；在部署迁移并发窗口内可能先后观察到不同完整提交状态，部署编排应在迁移步骤完成后启动应用。

## 测试与证据

- `pnpm --filter @ai-crm/database lint`：通过。
- `pnpm --filter @ai-crm/database typecheck`：通过。
- `pnpm --filter @ai-crm/database build`：通过。
- `pnpm --filter @ai-crm/database contracts:check`：通过。
- `pnpm --filter @ai-crm/database test`：23 passed，1 PostgreSQL test 因无 URL 正常 skip。
- `pnpm db:test:integration`：隔离 PostgreSQL 真实执行，24/24 passed；验证全仓 11 条迁移空库升级、幂等迁移、1–10 证据回填、真实注册表兼容读取、调用方受控 Timeout Pool，并已清理容器、网络和 Volume。
- 全仓现有迁移目录加载及真实升级证据：11/11 迁移元数据成功规范化，隔离 PostgreSQL 专项 24/24 通过。
- `git diff --check`：通过。

## 八维 Review

| 维度 | 结论 |
| --- | --- |
| Authorization | API 不授予业务权限；生产连接应仅获注册表 `SELECT`，固定查询不接受外部 SQL。 |
| Idempotency | 纯读取且无锁/写入，可重复调用；相同数据库快照与发布目录得到相同报告。 |
| Transactions | 不开启事务、不参与模块事务；仅观察已提交注册表事实，不制造部分成功。 |
| Migrations | 未修改已部署 SQL/metadata；追加 `0000000011` 持久化证据并提供恢复/前滚指导，历史回填绑定 SQL Checksum，缺失/不一致均失败关闭。 |
| Observability | 返回有界版本号与稳定分类，可安全用于健康状态；不包含 SQL、连接、参数或业务内容。具体 Logger/Metric 接线留给 CMP-01。 |
| Backward Compatibility | 原 string 类型属性保留并 deprecated，新增规范范围属性；精确 legacy allowlist 保持十条现有元数据可读。未知迁移/无证据范围失败关闭。 |
| Secrets | API 仅接收调用方拥有的 Pool，不接收 connection string，不读取、记录或返回 Secret；未新增 Secret、环境变量或 Fixture 凭据。 |
| Failure Modes | 格式/目录错误在连接前失败；查询异常抛出且释放连接；无持久兼容证据明确失败；自动重试、Deadline、取消和 Pool 生命周期由 CMP-01 负责。 |

## 未决事项与后续合并要求

- CMP-01 需要从发布制品构造完整迁移目录清单，并由构建时受控应用 Schema 版本来源为 API/Worker 提供同一 `applicationSchemaVersion`；不得传入模块子集，也不得直接传 `AI_CRM_RELEASE_ID`/`AI_CRM_RELEASE`。
- CMP-01 需要把 `compatible: false` 与查询异常都映射为失败关闭的启动/Readiness，并接入安全日志/指标；不得输出连接字符串或任意异常载荷。
- CMP-01 必须传入自己拥有的只读 Pool，配置有限 `connectionTimeoutMillis`、Query/Statement Timeout 及整体启动 Deadline/取消，并在失败或停止时清理；数据库包不再创建隐含无界 Pool。
- 后续迁移 Owner 应逐步把各自 `.meta.json` 转成规范对象；是否修改已评审/已部署 metadata 由迁移 Owner 决定，本工作包不越权修改。
- 若未来需要允许旧应用跨未知新迁移回滚，必须先通过新 ADR/迁移注册表扩展建立可由旧发布验证的持久兼容声明；当前安全策略保持失败关闭。
- 后续迁移必须由 Runner 同时持久化规范兼容范围；仅修改 `.meta.json` 会与数据库证据不一致并失败关闭。若未来扩大证据字段或改用完整 metadata digest，必须追加新迁移与兼容读取策略。
