# CMP-API-AUTH-PERSIST：API 生产授权、组织上下文与认证审计组合

- 状态：已完成，待 Integration Owner 合并复核
- 日期：2026-07-28
- Integration Owner：本任务单一 API Integration Owner
- 前置：ADR-0025 已接受；AUTH-PERSIST-01 已提供 authorization 公共 PostgreSQL 持久化入口与 migration
- 路径所有权：仅 `apps/api/**` 与本文件

## 目标

在不增加业务 HTTP 路由、不建立真实授权策略的前提下，把 API 生产 `DatabaseRuntime` 组合到：

1. PostgreSQL `AuthorizationPolicyStore` 与 `AuthorizationDecisionRecorder`，并创建生产 `AuthorizationService`；
2. PostgreSQL `OrganizationServiceApi`，只用于认证 subject 到有效 workforce context 的解析；
3. PostgreSQL `AuditService`，并把 PC BFF `AuthenticationAuditPort` 映射为追加式安全认证审计；
4. 启动与 Readiness 门禁，验证当前策略完整且 Permission、Role、Grant 均非空，并验证正式耐久认证审计 adapter 已组合且其数据库/migration 技术依赖健康。

## 已知事实

- ADR-0025 要求 PostgreSQL 是授权事实源，每次授权裁决必须由耐久 Recorder 记录，缺失、损坏或空策略必须失败关闭。
- `authorization` 已公开 `createPostgresAuthorizationPersistence` 与 `createAuthorizationService`。
- `organization` 已公开 `createPostgresOrganizationService`，但它的 PostgreSQL runtime 对写命令要求 authorizer、审计 intent 和 event intent。
- `audit` 已公开 `createPostgresAuditStore` 与 `createAuditService`；普通日志不是审计事实。
- API 已拥有一个生产 `DatabaseRuntime`、Redis BFF session store、有界关闭和数据库 migration/health 生命周期。
- 仓库没有获批的真实 Permission、Role 或 Grant；无策略时生产 API Not Ready 是预期安全结果。

## 允许的假设

- 同一 API `DatabaseRuntime` 可作为三个平台模块公开的 vendor-neutral persistence runtime；其事务上下文由数据库包维护。
- 认证审计使用 `system` actor `api.pc_bff`，因为现有 `AuthenticationAuditEvent` 不携带可验证的已认证 subject；不得从 session reference 推断人员。
- 认证逻辑事实使用有域分隔的确定性 UUID operation ID：begin 绑定 state index、complete 绑定 session ID、logout 绑定 session reference、refresh 绑定 session ID 与目标 revision。同一事实安全重试复用 ID，不同登录和 refresh revision 不碰撞。
- 每个逻辑认证操作只捕获一次安全 W3C trace ID 并随事件传递；当前缺少 HTTP trace 传播，因此它只表示本地认证操作 trace，不声称与入站 HTTP trace 关联。后续若引入请求 trace context，应改为捕获已验证的传播上下文。
- 不写合成“审计探针”事实，也不越过 audit 公共接口直查表。认证审计技术就绪仅由 migration 兼容、DatabaseRuntime 健康和正式 Audit adapter 已组合共同证明；真实追加能力在每个认证事件发生时由 AuditService 失败关闭地验证。
- 当前未配置 authorization Redis cache；权威 PostgreSQL 快照直接参与每次裁决，正确性不依赖缓存。

## 禁止的假设

- 不假设或创建任何管理员、Permission、Role、Grant、Scope、默认 allow、超级用户或基线策略。
- 不根据 Keycloak Role/Claim、姓名、联系方式、岗位或 session reference 推断 workforce、Assignment 或权限。
- 不假设组织写命令已获授权，也不伪造审计/outbox intent；所有组织写命令必须在 authorizer 处失败关闭。
- 不用 Pino、Sentry、Trace 或内存数组替代授权决策记录或认证审计。
- 不假设数据库健康等于策略完整或认证审计可写。
- 不修改平台包内部结构、合同、migration、部署、Worker、lockfile 或其他现有 handoff。

## 实施范围

- 调整 API 生产 binding factory，创建并暴露真实 authorization、organization、audit binding。
- 增加最小应用层 adapter：数据库 runtime 适配、组织写路径失败关闭、认证事件到 AuditService 的安全映射。
- 在 migration compatibility 通过后执行策略启动门禁，并把策略结果及正式认证审计 adapter 的技术依赖纳入 Readiness；后续探测不得把旧成功结果掩盖为当前数据库健康。
- 保持资源 acquisition、取消、探测与有界 close 语义。
- 为组合、失败关闭、门禁与安全审计映射补单元测试。
- 把 authorization migration 目录加入 API migration compatibility 输入。

## 非目标

- 不创建 Registry、Form、File 或任何 CRM controller/route。
- 不实现策略发布 API/UI、真实策略 seed、Redis 授权缓存或缓存失效消费者。
- 不开放 organization 写接口，不实现 organization 审计/outbox composition。
- 不定义审计保留期、归档、外部 Provider 或新的可观测性栈。
- 不修改 API 外部 HTTP 合同。

## 验收标准

1. 生产 binding 的 authorization 使用 PostgreSQL policy store/decision recorder；记录失败时授权服务失败关闭。
2. organization 的 `resolveWorkforceContext` 使用 PostgreSQL store；所有写方法在访问数据库前由 authorizer 拒绝。
3. authentication audit 通过 PostgreSQL AuditService 追加安全记录；失败时现有 session service 失败关闭。
4. migration 兼容后，只有当前策略可完整加载且 Permission/Role/Grant 均非空、正式认证审计 adapter 已组合、数据库与 session store 健康时才 Ready。
5. 无当前策略、空/损坏策略或审计写失败时启动失败或保持 Not Ready，且不注入任何策略数据。
6. acquisition 失败清理、重复 close、探测取消与 shutdown timeout 行为保持有界。
7. `apps/api` lint、typecheck、test 通过，并完成授权、幂等、事务、migration、可观测性、向后兼容、Secret 与生命周期八维复核。

## 失败、重试与事务语义

- 策略加载、Decision Recorder 或 AuditService 的数据库失败向上转换为现有稳定不可用语义，不允许放行。
- 认证审计每次 port 调用是一个追加事实；AuditService 的 operation receipt 保护相同 operation ID 的幂等重放。adapter 对提交结果不确定使用同一个 command/operation ID 有界重试一次，绝不换 ID 制造第二个事实。
- organization 写命令在 authorizer 阶段失败，不进入 repository 事务，因此不会产生部分业务事实、假审计或假事件。
- 授权决策记录与业务命令不是分布式原子事务；本任务不声称二者原子。
- 启动失败沿用现有资源清理；关闭同时处理 Redis 与 PostgreSQL，并受既有 timeout 约束。

## 交付结果

- API 生产 DatabaseRuntime 已通过模块公共入口组合 PostgreSQL policy store、decision recorder 与 AuthorizationService。
- PostgreSQL OrganizationService 已组合供 subject → workforce context 权威解析；全部 organization 写命令由应用层 authorizer 在 repository/事务前拒绝，audit/event intent 端口也保持失败关闭。
- PostgreSQL AuditService 已组合；PC BFF 的四类真实成功认证事件通过 AuthenticationAuditPort 追加安全审计。审计追加失败保持现有 503/回滚或可重试语义。
- migration compatibility 输入已包含 authorization migration 目录。
- 授权 Readiness 在数据库健康探测完成后通过公共 policy store 重读当前快照，要求 Permission、Role、Grant 均非空；每次后续健康探测完成后重新验证，数据库恢复不会复用旧策略结论。
- authentication-audit Readiness 保持失败关闭：migration compatibility、通用 DatabaseRuntime 健康与正式 adapter 已组合仍不能证明 Audit repository 当前可写；未写合成审计探针，未直查 audit 表。
- 独立 Review 修复：策略 load 完成后再次检查 close、AbortSignal、controller 与 probe generation，再提交 Readiness；旧 generation 或 close 期间的慢结果不能回写状态。
- 独立 Review 修复：认证审计 operation ID 改由 session service 按逻辑事实确定性派生，trace 在逻辑操作内捕获一次，adapter 对不确定提交以原 command 有界重试一次。
- 仓库仍未 seed 任何策略；无当前完整策略时 API 继续 Not Ready，授权服务默认拒绝/不可用。

## 验证证据

- `pnpm --filter @ai-crm/api typecheck`：通过。
- `pnpm --filter @ai-crm/api lint`：通过，0 warning。
- `pnpm --filter @ai-crm/api test`：13 个文件通过、2 个 integration 文件按环境跳过；99 passed、5 skipped。
- 新增覆盖：空策略 Not Ready、完整权威策略使授权依赖 Ready 但 authentication-audit 仍失败关闭、真实授权 decision record 写入、organization 写命令零数据库访问、真实认证审计追加不含 OIDC URL、审计失败返回 503 并清理 login transaction、commit 后 reject 的 receipt 重放不重复、重复 logout 同 ID、refresh revision 不碰撞、close/旧 generation 的慢 policy load 不回写。
- `git diff --check -- apps/api .handoffs/CMP-API-AUTH-PERSIST.md`：通过。
- 路径复核：本任务仅修改 `apps/api/**` 和新增本 handoff；未修改 Worker、packages、contracts、deploy、lockfile 或既有 CMP handoff。

## 独立八维自审

1. 授权：授权运行期只读权威 PostgreSQL 策略并耐久记录每次裁决；无策略不放行。Organization 写命令在数据库前统一拒绝；Audit sensitive read 因缺少可安全建立的 workforce/assignment context 继续失败关闭。
2. 幂等：authorization recorder 与 AuditService 使用模块既有 receipt/digest 语义；认证 operation ID 绑定逻辑事实，adapter 的单次重试复用完全相同 command。Readiness 仅幂等读取策略。
3. 事务：复用 DatabaseRuntime AsyncLocalStorage 事务边界；authorization decision record、认证 audit 与其他未来业务命令未被错误声明为分布式原子。Organization 写路径未进入事务。
4. Migration：仅把已评审 authorization migration 目录纳入只读 compatibility catalog；启动不执行 migration、同步或 push。
5. 可观测性/审计：没有用日志替代审计，也未新增 audit probe。审计只保存受控 action/system actor/安全 resource reference/确定性 UUID operation/每逻辑操作一次的 W3C trace，不保存 Token、Cookie、Credential、Claim、OIDC URL 或请求体。当前本地 trace 不冒充尚未传播的 HTTP trace。
6. 向后兼容：ApiPlatformBindings 公共形状和 HTTP 合同未变；仅把原生产 unavailable binding 换为正式模块实现。开发/测试 synthetic composition 保持不可用。
7. Secret/隐私：未新增配置或 Secret；现有 file-backed Secret 流程不变。策略 Readiness 与健康响应只暴露布尔状态，不暴露策略、schema、SQL 或错误内容。
8. 生命周期/失败行为：acquisition cleanup、重复 close、shutdown timeout、取消和非重叠 DB probe 保持；close/abort 清除 policy readiness，晚到结果不能恢复。数据库/策略/audit 故障均失败关闭。

## 未解决事项与非签门声明

- 真实 Permission、Role、Grant、策略发布 Owner 与审批/紧急规则仍未确认；首次生产 Ready 需要通过后续受审流程发布非空策略，本任务不提供 seed 或发布接口。
- audit 模块目前没有独立公共 health port。独立 Review 证明共享数据库健康不能证明 Audit repository 可写，因此 authentication-audit required Readiness 已改为保守 Not Ready。后续必须先设计不会伪造事实的 audit-owned capability/permission health contract，不能以合成审计记录或跨边界查表绕过。
- Audit sensitive read 的授权映射仍保持不可用；在正式 Permission 与可验证 actor workforce context 输入合同出现前不推断放行。
- 本任务未运行全仓 `pnpm check`，由最终单一 Integration Owner 在所有并行修改收敛后执行。
