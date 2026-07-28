# AUTH-POLICY-DECISION 授权策略持久化与发布边界

- 状态：ADR-0025 已于 2026-07-28 被项目负责人接受；后续实现与生产启用仍待独立交付和验收
- 决策人：项目负责人
- 接受日期：2026-07-28
- Owner：当前并行任务
- 允许路径：`docs/08-架构决策/ADR-0025-授权策略持久化与发布边界.md`、`docs/08-架构决策/README.md`、`.handoffs/AUTH-POLICY-DECISION.md`
- 依赖：ADR-0007、IAM-03、`authorization` 公共接口与权限契约

## Known Facts

- ADR-0007 已接受自研、传输无关的轻量授权核心；Keycloak 负责认证，`authorization` 负责权限声明、角色权限集合、有效 Grant 和授权裁决。
- `authorization` 已公开 `AuthorizationPolicyStore.currentVersion()`、`load(version)`、必需的 `AuthorizationDecisionRecorder.record(...)` 以及按策略版本失效的可选 Redis 缓存端口。
- 当前授权策略快照契约把 Permission、Role 和 Grant 聚合为带版本的快照；Role 是权限集合，不是岗位名称或 Keycloak Role。
- Grant 只允许显式指向 Workforce Person 受控例外或 Assignment；Assignment Grant 只在调用者明确选择该有效 Assignment 时适用。
- 当前实现对未知权限、缺失 Grant、无效上下文、策略不可用或损坏失败关闭；决策记录失败时结果不得逃逸。
- Redis 只是可选性能适配器，不是授权事实源；现有缓存键包含策略版本，缓存异常不能扩大权限。
- PostgreSQL 数据必须由模块自有 schema 与 repository 隔离；生产变更使用经审核、版本化的 Drizzle SQL migration，不允许自动 schema 同步或 `drizzle-kit push`。
- 审计记录、业务事实与技术遥测具有不同所有者和真值语义；日志、指标、Trace 与 Sentry 不得携带人员、客户内容、凭据或无界输入。

## Allowed Assumptions

- `authorization` 可以拥有独立 PostgreSQL schema，持久化自身的 Permission、Role、Grant、不可变发布版本与授权决策审计事实；具体表名和列级实现由后续 migration/implementation 任务评审。
- 一个已发布策略版本是不可变、可校验并可按版本完整加载的快照；发布动作以单一数据库事务原子地写入版本内容并切换当前版本指针。
- Permission 声明、Role 定义与 Grant 都是有时间边界的发布输入；在既有合同允许范围内，缺失结束时间表示开放结束，而不是永久不可撤销。
- Redis 失效采用“版本隔离保证正确性、发布后失效旧版本用于清理”的模式；失效投递失败不允许回退到旧策略或阻止新请求读取权威当前版本。
- 授权决策审计需要耐久记录最小裁决事实，并以现有 `decisionId`、策略版本和安全 Trace 引用关联；保留期限和低风险允许决策的最终分级仍需负责人/数据安全规则确认。
- 恢复可以重新指定一个已验证、仍保留的不可变历史版本作为新的当前发布选择；不得就地修改历史版本。

## Forbidden Assumptions

- 不定义或植入任何真实 Permission、Role、Grant、数据范围值、管理员、审批路线或组织结构。
- 不把 Keycloak Role、Position 文本、人员名称、部门标签、前端可见性、通知送达或邀请能力解释为授权事实。
- 不允许空策略、缺失当前版本、部分发布、损坏快照、无法记录审计或无法确认权威版本时放行。
- 不把 Redis、日志、Sentry、Trace、前端缓存或生成的 OpenAPI 文档作为策略或审计事实源。
- 不允许修改已发布版本、复用同一版本标识覆盖内容、直接更新生效 Grant，或以自动 schema 同步代替 migration。
- 不让 `authorization` 查询 `organization`、领域模块或 Keycloak 的表；不允许其他模块直接查询授权 schema。
- 不引入 Casbin、OpenFGA、OPA、Cerbos、关系图、通用表达式语言或第二套身份系统。

## Non-goals

- 不实现数据库 schema、Drizzle migration、repository、发布 API、管理 UI、缓存消息消费者或生产组合。
- 不修改 contracts、公共 TypeScript 接口、代码、测试、ADR 索引或现有 handoff。
- 不确定真实权限目录、角色矩阵、Grant 审批者、审批流、紧急访问流程、数据范围维度或业务模块查询转换。
- 不决定审计法定保留期限、归档介质、生产 Redis TTL/容量、SLA、RPO 或 RTO。
- 不宣称两台 CVM、PostgreSQL、Redis 或授权存储具有高可用或自动故障转移。

## Deliverables

- 新增并接受 ADR-0025，明确 schema owner、不可变 policy version/publication、Permission/Role/Grant 有效期、decision audit、Redis cache invalidation、空策略失败关闭、迁移/兼容/恢复边界。
- 在 ADR 中明确接受本决策不等于已实现生产 schema、migration、角色、Grant 或生产授权链路。
- 记录未决问题、独立 Review 清单、自检与 `git diff --check` 证据。

## Acceptance Checks

- ADR 与 ADR-0007、IAM-03、现有 `authorization` 公共接口和权限契约没有冲突。
- 每项决定都区分权威持久化事实、运行期缓存、技术遥测和审计事实。
- 发布、并发、失败、空策略、回退及缓存失效行为明确且默认拒绝。
- 迁移是显式、可审查、可恢复的；不出现自动同步、破坏性覆盖或未声明兼容假设。
- 文档未包含真实角色、Permission 或 Grant；改动严格限制为两个新文件。
- `git diff --check` 通过。

## Separate Review Pass

- Authorization：已检查。空策略、无当前版本、快照损坏、权威存储不可用和 Recorder 失败均失败关闭；Assignment/Workforce Person Grant 边界沿用 IAM-03，未定义真实授权事实。
- Idempotency：已检查。同版本不同内容拒绝，同发布意图重试保持同一结果；缓存失效和同一 `decisionId` Recorder 重试为幂等清理/追加行为，不能扩大权限。
- Transactions：已检查。版本内容、发布历史和当前指针在单一 PostgreSQL 事务内提交，并发发布要求形成单一明确顺序，读取者不得看到部分快照。
- Migrations：已检查。本任务未创建 schema 或 migration；ADR 只要求后续使用审核过的版本化 Drizzle SQL migration、expand–migrate–contract 和恢复验证。
- Observability / Audit：已检查。授权决策记录与业务审计、技术遥测分离；Recorder 未耐久提交时不返回结果，最小字段排除 Token、正文、原始 Claim/Provider payload 等敏感内容。
- Backward Compatibility：已检查。现有 `AuthorizationPolicyStore`、`AuthorizationDecisionRecorder`、缓存失效端口、v1 策略契约与 SDK 表面保持不变；新字段或契约版本必须合同先行。

## Unresolved Questions

- 谁可以提交、复核和发布策略，以及是否需要双人复核或紧急撤销，尚未确认。
- Permission 与 Role 的业务治理所有者、真实目录和生命周期管理方式尚未确认。
- 授权决策审计的精确保留期限、归档/清除规则及低风险 allow 是否允许分级记录，尚未确认。
- 生产 Redis TTL、容量、失效通知机制和运维告警阈值尚未确认。
- 首次生产基线版本的内容和切换窗口尚未确认；在其确认并安全发布前，生产授权必须保持失败关闭。

## Evidence

- 2026-07-27：逐项对照 ADR-0007、IAM-03、`authorization` README、公共 TypeScript 接口和 v1 权限契约完成文档自检。
- 2026-07-27：确认改动范围仅为本 handoff 与新的 ADR-0025 草案；未修改 ADR README、contracts、代码、migration 或现有 handoff。
- 2026-07-27：`git diff --check -- <scoped paths>` 通过；由于两个文件尚未跟踪，另以 `git diff --no-index --check` 分别与空文件比较，均无 whitespace error。未运行 `pnpm check`，因为本任务只有 Markdown 草案且不改变行为、合同或构建输入。
- 2026-07-28：项目负责人明确接受 ADR-0025；状态、决策人、接受记录和 ADR 索引已同步更新。该接受未被解释为实现完成或生产授权链路启用，Unresolved Questions 继续有效。
- 2026-07-28：接受记录更新后 `pnpm repo:check` 通过（39/39），`git diff --check` 及未跟踪文档的 `git diff --no-index --check` 通过。
