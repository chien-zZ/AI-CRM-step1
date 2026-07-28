# OPS-G3-GATES 生产制品与运行配置静态门禁

## Objective

为第一阶段生产部署补齐三个无外部依赖、可重复、失败关闭的静态门禁：不可变 API/Worker 制品携带完整受审迁移目录及可校验清单；Worker 应用 drain timeout 严格小于 Compose `stop_grace_period`；生产 Compose 可选择性表达 BFF 上一版本会话加密密钥文件，并保持最小 Secret 挂载与 typed `*_FILE` 配置。

## Known Facts

- API 运行时通过 `AI_CRM_MIGRATIONS_ROOT=/app` 读取受审迁移目录，并在启动时执行只读兼容性检查，不自动执行迁移。
- 生产 API 和 Worker 镜像必须使用 sha256 digest 固定；release manifest 已记录迁移摘要证据，但当前没有证明镜像内完整迁移目录与清单一致的独立门禁。
- Worker 使用 `AI_CRM_WORKER_DRAIN_TIMEOUT_SECONDS`，生产 Compose 使用 `AI_CRM_WORKER_STOP_GRACE_PERIOD`；当前静态检查只验证 `stop_grace_period` 存在。
- BFF 运行时已支持必须成对配置的 `AI_CRM_PC_SESSION_PREVIOUS_ENCRYPTION_KEY_ID/_FILE`，当前生产 Compose 未表达该可选轮换输入。
- 工作区已有 `.handoffs/API-PROD-COMPOSITION.md` 与 `.handoffs/CMP-01.md` 修改，属于其他任务，本任务不修改或覆盖。

## Allowed Assumptions

- API 与 Worker 的不可变制品使用同一个、由仓库受审迁移源生成的确定性 manifest；发布方可从解包后的镜像文件系统或等价制品根目录运行校验。
- Compose duration 使用 Docker Compose 支持的明确 duration 单位；Worker drain 输入以正整数秒表达。
- previous key 轮换是显式 opt-in；未启用时不得声明或挂载 previous key Secret。

## Forbidden Assumptions

- 不猜测任何生产 Secret 值、Secret 根目录、主机地址、域名、GID、容量或超时值。
- 不假设 release manifest、镜像 digest、CI evidence reference 或人工批准本身证明制品内容可信；摘要必须从实际文件重新计算。
- 不假设 previous key 可单独配置、可与 current/index key 复用，或可长期保留多个历史版本。
- 不宣称两台 CVM 或任一单点状态服务具备高可用、自动故障转移、SLA、RPO 或 RTO。

## Non-goals

- 不修改 API、Worker、平台模块、领域模块、契约、数据库迁移、根 package manifest 或 Lockfile。
- 不构建、推送、签名或部署真实镜像，不执行生产变更。
- 不引入真实 Provider、CRM 领域、Kubernetes、Secret Manager 或新的消息/可观测技术栈。
- 不改变 BFF keyring 运行时语义，也不生成、轮换或读取生产 Secret 值。

## Authority And References

- 根 `AGENTS.md`。
- `docs/04-工程手册/第一阶段AI并行开发实施计划.md`。
- `docs/06-质量验收/第一阶段Walking-Skeleton验收清单.md`。
- `docs/04-工程手册/数据库与迁移基线.md`。
- `docs/04-工程手册/第一阶段生产发布Runbook.md`。
- `.handoffs/API-PROD-COMPOSITION.md` 与 `.handoffs/CMP-01.md` 仅作为已知接口事实读取，不修改。

## Allowed Paths

- `deploy/**`
- `scripts/check/**`
- `scripts/deploy/**`
- 与本门禁直接相关的部署/发布文档
- `.handoffs/OPS-G3-GATES.md`

## Forbidden Paths

- `apps/**`
- `packages/**`
- `contracts/**`
- 根 `package.json`、`pnpm-lock.yaml` 与其他根 manifest
- 现有 CMP handoff，包括 `.handoffs/CMP-01.md`
- 其他任务正在修改的 handoff 或共享生成制品

## Contract Changes

无 HTTP、事件、Job 或公共 TypeScript 契约变更。新增的迁移制品 manifest 是部署制品完整性格式，只列受审迁移相对路径、大小与 sha256；格式变更需版本化。

## Migration Changes

不新增、不编辑、不执行迁移。门禁只枚举仓库中完整受审的 `packages/database/migrations` 与 `packages/platform-modules/*/migrations` 文件集，并验证制品中的同一文件集、大小和摘要；不得自动同步 Schema。

## Dependencies

- Node.js 24 标准库。
- 现有 `yaml` 解析依赖与生产 Compose 文件。
- 现有受审迁移目录；不新增第三方依赖。

## Required Tests

- 迁移 manifest 生成确定、覆盖完整目录，并拒绝缺失、额外、修改、路径逃逸、畸形摘要或错误 manifest 版本。
- Duration 解析覆盖 Compose 支持的复合单位和毫秒精度；拒绝空值、变量占位、无单位、负数、未知单位及 drain 大于等于 stop grace。
- previous key 未启用时不误挂；启用时 ID 与 typed `*_FILE` 成对、两个 API 均只挂载对应命名 Secret；缺文件声明、额外挂载、非 `*_FILE` 或非失败关闭变量均被拒绝。
- `node --test` 专项测试、`pnpm compose:check`、相关脚本 lint/仓库检查与 `git diff --check`。

## Authorization And Audit

静态门禁不授予部署权限，也不替代独立 operator/approver、人工批准或审计系统。校验输出只包含安全的相对路径、摘要差异类别和配置字段名，不输出 Secret 内容。

## Idempotency, Retry And Failure

生成与验证均为只读或显式输出到调用方指定位置的确定性操作，可重复执行。无网络重试。缺失、额外、修改、畸形、无法读取或关系不满足均以非零状态失败关闭；不进行部分部署或自动修复生产配置。

## Observability And Health

门禁输出有界成功摘要或逐项错误，不记录 Secret、环境变量值、绝对生产路径、主机信息或业务数据。它不替代运行时 health、指标、Trace、Sentry 或告警。

## Backward Compatibility

现有 current/index BFF Secret 保持必需。previous key 为显式 opt-in 的 Compose overlay，未启用时基础生产 Compose 不声明、不挂载、不引用该文件。现有 release manifest v1 保持兼容；迁移制品 manifest 使用独立版本字段。

## Deliverables

- 迁移制品 manifest 生成/验证脚本及专项测试。
- Worker drain 与 Compose stop grace 数值比较静态门禁及专项测试。
- BFF previous key 可选 Compose overlay、验证门禁、示例/Runbook 文档及专项测试。
- 专项测试、Compose 校验、必要 lint 和八维自审记录。

## Unresolved Questions

- 最终镜像构建流水线与 Dockerfile 所在边界不在本任务授权路径内；本任务提供可由镜像构建/发布流水线调用的确定性生成和制品根校验入口，接线由 Integration Owner 在受控窗口完成。
- 真实 drain/stop grace 数值仍须基于 staging 证据审批；本任务仅强制可解析及严格大小关系。

## Handoff Result

完成，未提交 Git commit。

### Implemented

- 新增确定性迁移制品 manifest：递归覆盖仓库 `packages/database/migrations` 与 `packages/platform-modules/*/migrations` 的全部普通文件，记录安全相对路径、字节数和 SHA-256；拒绝无迁移、路径逃逸、畸形/重复/未排序条目、未知版本、符号链接及覆盖已有输出。
- 新增 API+Worker 联合制品门禁：两份解包制品都必须在固定根位置包含 `ai-crm-migrations.manifest.json` 和完整 `packages/**/migrations`；同一外部批准摘要绑定两份规范化 manifest，并拒绝任一制品缺目录、缺/多文件或内容变化。单制品命令仅保留作诊断。
- 新增 Worker 已渲染 Compose 数值门禁：解析复合 `us/ms/s/m/h` duration，要求应用 drain 为正整数秒且严格小于 stop grace；变量表达式、无单位、零/负数、未知单位、相等或超过均失败关闭。支持受限文件或 stdin。
- 新增 Host A/Host B previous-key rotation overlay。普通基础 Compose 完全不声明或挂载 previous key；显式追加 overlay 时只向 API 添加 previous ID、typed `*_FILE` 与单一命名 Secret 文件，缺 ID/Secret root/文件时失败关闭。
- 更新生产 Compose 指南、部署脚本说明、发布 Runbook 和检查脚本说明；不包含生产 Secret、主机、域名或超时值。

### Verification Evidence

- `node --test scripts/check/migration-artifact.test.mjs scripts/check/production-deployment-gates.test.mjs`：11/11 通过。
- 对当前受审仓库运行真实 manifest 生成：22 个迁移文件，规范化摘要 `sha256:de75224d9d59cde2fe54195e4b72b0f92f4df480102434b4a2afb09e44faa1bd`；临时 manifest 已安全删除。该摘要只是本工作区检查证据，不是生产批准值。
- Docker Compose v5.3.0 使用纯合成非 Secret 输入：Host A/Host B 基础配置及各自 previous-key overlay 的 `config --quiet` 均通过；Host B 实际渲染输出经 stdin 数值门禁通过（合成 29 秒 drain、30 秒 stop grace，不编码进仓库）。
- `pnpm compose:check`：通过。
- 相关新增/修改脚本 ESLint `--max-warnings 0`：通过。
- `pnpm repo:check`：38/38 Node checks 通过。
- `pnpm check`：通过，Turbo 140/140 tasks successful；契约生成 drift、build、lint、typecheck、test 与 contracts checks 全部通过。
- `git diff --check`：通过。

### Eight-area Review

- Authorization：门禁不授权发布、不自证 approval；operator/approver 与受信 evidence 仍由现有发布边界负责。无权限模型或业务授权变更。
- Idempotency：manifest 构建与全部验证是确定性、可重复的只读计算；生成命令使用 `wx` 拒绝覆盖，避免静默替换既有批准清单。
- Transactions：不访问数据库、不写业务状态、不启动部署，无本地/跨模块事务或 ACK 顺序问题。
- Migrations：未编辑、执行或自动同步迁移；完整性门禁只读取全部受审目录，外部批准摘要防止镜像内 manifest 自证。迁移发布/恢复继续服从既有 Runbook。
- Observability：成功/错误输出有界，只含安全相对迁移路径、计数、摘要或配置字段名；不输出 SQL 内容、Secret、主机、域名、请求/响应或业务数据。运行时 health/Trace 不被静态门禁替代。
- Backward Compatibility：release manifest v1 与 `artifacts.migrationHead` 字段保持不变并明确其语义；基础 Compose current/index key 行为不变。previous key 仅显式 overlay opt-in，移除 overlay 恢复原配置。
- Secrets：基础文件不误挂 previous key；overlay 只挂单一命名文件并使用 typed `*_FILE`，ID/Secret root 强制失败关闭。未生成、读取、记录或猜测任何 Secret 值。
- Failure Modes：缺失/额外/修改/畸形/符号链接/摘要不符/任一 API 或 Worker 制品缺失、未渲染 duration、相等/越界 timeout、incomplete overlay 都非零失败；无重试、部分部署或自动修复副作用。

### Remaining Integration Boundary

最终 API/Worker Dockerfile 与镜像构建流水线不在授权路径内。Integration Owner 必须在受控构建窗口把同一完整迁移目录及固定 manifest 复制进两份不可变镜像，并在 release gate 对两份解包制品调用 `verify-application-migration-artifacts.mjs`；未完成该接线前不能把本静态实现描述为已验证的生产镜像。

### Independent Review And Fix

- 独立复核发现 1 项 P1 制品边界问题：原扫描拒绝迁移目录内部的符号链接，但可能跟随 `packages`、模块目录等祖先路径的符号链接，且嵌入 manifest 本身也可为符号链接。这会允许错误或恶意解包制品读取制品根外内容并把它纳入完整性计算。
- 已修复：扫描前逐级要求制品根、`packages`、数据库/平台模块及 migration 根为真实目录；平台模块条目遇到符号链接直接拒绝；固定位置 manifest 必须是非符号链接的普通文件。
- 回归证据：新增祖先目录 junction/symlink 与 manifest symlink 场景；专项测试更新为 12/12，通过 Windows junction 和非 Windows symlink 两条平台路径。相关 ESLint、`pnpm compose:check` 与 `git diff --check` 再次通过。
- 八维复核结论不变：修复只收紧制品信任边界，不改变授权、事务、迁移内容、运行配置、Secret、公共契约或 release manifest v1；当前无开放 P0/P1/P2/P3 finding。
