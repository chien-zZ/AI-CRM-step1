# CMP-01 API 与 Worker 组合根

- Status: EVIDENCE_BLOCKED（仓库侧生产组合已随 `e090dda` 合并；等待受保护环境证据）
- Owner: 当前会话（`apps/api`、`apps/worker` 组合根单一 Owner）
- Reviewer: 独立 Review 多轮完成；授权持久化、RabbitMQ Adapter 与 API 授权/审计/组织组合的复审 finding 已清零
- Allowed paths: `apps/api`、`apps/worker` 的 Composition Root、Module Wiring、启动与健康入口，以及本任务 handoff

## CMP-API-DB-READY 历史子包边界

本节保留已完成数据库 Readiness 子包当时的范围；后文至“独立 Review”为 G3 合并前的累积历史记录。当前权威结论见文末“当前状态与外部阻塞”和 `G3-PRODUCTION-COMPOSITION.md`。

### 已知事实

- API 已通过公共 `DatabaseRuntime` 组合有界 PostgreSQL Pool，且启动迁移兼容检查只读、不执行迁移。
- 当前同步 Readiness 仅缓存启动兼容结果，无法识别启动后的 PostgreSQL 失联。

### 允许的假设

- API 可在兼容检查成功后启动单一、非重叠的运行期数据库探测循环，并以有界技术配置控制间隔和超时。
- 当前绑定代际内，探测失败将缓存状态置为不可用，后续成功可恢复。

### 禁止的假设

- 不把 Pool 存在、启动检查成功或过期缓存视为当前健康。
- 探测不执行迁移、DDL、模块查询或跨模块表访问。
- 超时探测的迟到结果不得更新状态；只有底层调用真正结束后才可进入独立下一轮。Stop、Abort 或旧代探测不得更新状态或继续调度。
- 健康响应不得暴露 SQL、错误详情、依赖名称、拓扑或 Secret。

### 非目标

- 不处理授权策略、认证审计、Organization、受保护 Controller、Worker/RabbitMQ、Compose、迁移、合同或 Lockfile。
- 不声明生产高可用、自动故障转移、SLA、RPO 或 RTO。

## 已知事实

- 多线执行总表已记录全部模块通过 G2，CMP-01 为 READY，旧的 G2 阻塞结论已经失效。
- ADR-0003 和 ADR-0011 要求 API 与 Worker 使用独立 NestJS 运行入口。
- 系统 HTTP 契约只公开 `/health/live` 与 `/health/ready`，响应不得暴露依赖名称、版本、拓扑或 Secret。
- 平台模块已经通过各自包根公开服务 Facade、持久化工厂和失败语义；组合根不得深层导入。
- Eventing 公开批次发布、Inbox 消费和 Rabbit 端口，但没有高层 Worker Registry；文件、任务和通知也只公开能力 Facade。

## 允许的假设

- 应用层可以定义业务中立的 Route/Handler 生命周期注册接口，并将真实模块 Facade 通过公共入口显式注入。
- API 默认监听端口保持生产 Compose 约定的 `3000`；测试可以使用随机端口。
- Worker 默认 Drain 上限为 30 秒，最终生产值由已存在的运行配置约束注入。

## 禁止的假设

- 不在组合根创建 CRM 实体、权限、流程、状态、SLA 或领域规则。
- 不通过 Repository、Schema、Drizzle 对象或深层导入绕过模块公共入口。
- 不把未接线的 PostgreSQL、RabbitMQ、Redis、Keycloak、Flowable、ClamAV 或对象存储报告为 Ready。
- 不自动运行迁移或 Schema 同步；启动只允许版本兼容检查。

## 非目标

- 本轮不新增真实 Provider Adapter、生产 Secret、CRM HTTP 路由或业务 Fixture。
- 本轮仅追加 Task/Notification 权限映射与业务中立 RabbitMQ 拓扑合同；不改变 Event、Job 或数据库契约。

## 当前实现

- `apps/api`：NestJS Composition Root；真实 `/health/live`、`/health/ready`；依赖失败关闭；启动/停止 Hook；HTTP 健康契约测试。
- `apps/worker`：NestJS Application Context；显式 Handler 注册；启动前 Readiness；Abort/Stop/在途等待；有界 Drain 超时失败；生命周期测试。
- API/Worker 运行参数通过 `@ai-crm/config` 严格解析；Worker Drain 秒数只在进程边界转换为毫秒。
- Worker 使用 `/tmp` 原子 `0600` Readiness/Heartbeat marker；Drain、Handler 失败或依赖失败时摘除；构建生成 Compose 约定的 `dist/worker-healthcheck.mjs`。
- API/Worker 的完整启动过程受 AbortSignal 和 Deadline 约束；启动代际门阻止 Stop/超时后的迟到 Nest 实例提交 Ready，并关闭迟到实例。
- Worker Handler 按启动代际跟踪；失败启动会在预算内停止并等待本代 Handler，无法清理时进入 terminal，禁止遗留消费者跨重启运行。
- Worker 正常 Drain 将 workload 与 lifecycle cleanup 分配在同一个总预算内，包含最小 `1ms` 合法边界测试。
- 两应用保持独立进程与生命周期；NestJS、Observability 依赖和 Lockfile 已版本化。
- API 已注册契约内五条 PC BFF 路由，并在 IAM Adapter 前拒绝重复、非标量、缺失或超限的 Query/Header；启动期信号与失败清理共用有界生命周期。
- API 的 principal → Workforce Context → Authorization 链只通过模块公共入口组合；开发/测试默认工厂可执行且 Readiness 失败关闭，生产真实工厂缺失时明确拒绝启动。
- Worker 已提供密封 Handler Registry、全体 Ready 后统一取活、运行期依赖失效 Fatal Drain、实际 Rabbit Binding ID/并发/Prefetch/在途 Drain Port，以及 Outbox、Inbox、文件维护、任务对账和通知 Intent Handler。
- `@ai-crm/database` 已增加只读 Pool-based 迁移兼容检查；全局迁移 `0000000011` 将 Schema 兼容范围持久化到迁移注册表，应用启动仍不运行迁移。
- API 已在兼容检查后通过公共 `DatabaseRuntime.healthCheck()` 启动有界、非重叠的 PostgreSQL 运行期探测缓存；失败摘除、后续成功恢复，Stop/Abort 会清除定时器、失效代际并拒绝迟到更新。
- ADR-0025 与 ADR-0026 已于 2026-07-28 被项目负责人接受；接受确认持久化与运行边界，不等同于策略数据或生产消费者启用。
- Authorization 已实现迁移 `0000000012`、不可变策略版本/发布、原子当前策略指针、事务发布器和耐久幂等 Decision Recorder；没有 Permission、Role 或 Grant seed。
- API 生产组合已接入 PostgreSQL Authorization Store/Recorder、Organization 只读 workforce 解析、PostgreSQL Audit 与真实认证审计 Adapter。组织写在数据库访问前失败关闭；无完整当前策略时 API 保持 Not Ready；没有 audit-owned 非写健康合同前 authentication-audit required Readiness 也保持 Not Ready。
- Audit 已新增并组合只读能力前置探针；Registry/Form 已新增 PostgreSQL 查询 Facade，并以完整 Workforce Person、活动 Assignment 集、可选选择 Assignment 和同一 Trace 执行模块级动态/精确权限复核。最小权限迁移 `0000000013`、数据库运行角色探针和 Registry/Form 模块能力探针已接入，错误或高权限连接角色、缺表/列/权限、超时和数据库失联均阻止相关 required Readiness。
- Authorization 已新增受保护策略发布命令边界，显式要求当前 Workforce 授权、稳定操作幂等、管理审计和事务发布；未创建真实发布权限、Owner、Role/Grant/策略 seed 或生产写入口，首次策略 bootstrap 仍失败关闭。
- Worker 已提供固定 `amqplib@2.0.1` 的文件式 AMQPS Adapter，覆盖 Confirm/Return、背压、ACK/NACK、固定 TTL 分层重试、DLQ、Prefetch/Concurrency、Readiness 和可中止 Drain/Close；生产 bootstrap 尚未接线，消费者保持禁用。

## G3 合并前历史未完成项（已由后续增量取代）

以下内容用于解释增量演进，不再代表 `e090dda` 合并后的当前缺口。

- 生产 API Binding Factory 已闭合 PostgreSQL、Redis Session、OIDC、迁移检查、运行角色最小权限验证、资源生命周期、Organization 只读解析、持久化 Authorization Policy/Decision、认证 Audit，以及 Registry/Form 查询与模块能力 Readiness。File internal-only HTTP 合同和受保护 Controller/Adapter 已组合，但 storage/scanner Provider 尚未组合并保持 required Readiness 失败关闭。
- Task/Notification 的 9 个 HTTP operation 已映射到 8 个业务中立平台权限；Registry/Form/File 新增 7 个 HTTP operation 与 6 个业务中立权限。未创建角色、Grant 或策略 seed。
- AsyncAPI 与 ADR-0026 已确认固定 TTL 分层重试机制，具体 Adapter 已实现；Task projection 的 `maxAttempts`、`backoffSeconds`、`timeoutMs`、`prefetch`、`concurrency`、错误分类、容量和告警值仍未接受，因此生产消费显式禁用，Worker 生产组合继续失败关闭。
- API 已组合文件式 PostgreSQL/Redis/OIDC/会话配置、只读迁移兼容检查、运行期数据库 Readiness 探测、授权/组织/认证审计与有界资源生命周期；没有当前完整策略时按设计保持 Not Ready，不以 seed 绕过。
- API 受保护平台 HTTP 使用一次入站 W3C Trace 贯穿授权耐久记录、模块调用和响应关联；Form 原始 JSON 体在授权前执行 262144 字节/深度 32/节点 10000 限额；File mutation 在服务调用前执行幂等键、BFF Origin/CSRF 与当前授权。未确认 Assignment 选择传输，Controller 不发明 Header 或会话约定。
- Worker 已组合文件式 PostgreSQL 配置、完整迁移目录双向门、只读兼容检查、DB 健康缓存和双账户 Rabbit TLS 资源生命周期；Task policy 不可用时仍稳定失败关闭，未声明 topology 或激活 consumer。接入真实 Error Reporter/Trace、生产 Secret 挂载与真实 RabbitMQ 4.2.9 TLS 联合测试仍待完成。Worker Drain `< stop_grace_period` 静态门和 BFF previous-key 生产 overlay 已完成，但不构成 G3 通过。

## 验证

- API：最终普通门 170 tests passed、5 integration tests skipped；Composition Factory 专项 21/21，三条平台 HTTP Adapter 64/64，Controller 真实 HTTP 路由、120 KiB 合法体与超 262144 字节拒绝均有回归；lint/typecheck/build/contracts 通过。
- Worker：RabbitMQ Adapter 最新专项 20/20；NACK 后同 message ID 重试不会消费旧 Confirm 状态。生产消费者仍禁用。
- Authorization：受保护策略发布边界 48 tests passed、6 gated skipped；隔离 PostgreSQL 17.5 集成 5/5；未知合同版本、denied-decision policy authority 与发布审计重试复核问题已关闭。
- Database：全局迁移 `0000000013` 已验证；隔离 PostgreSQL 17.5 数据库集成 31/31 通过，覆盖缺失运行角色恢复、精确权限矩阵和运行角色漂移失败关闭。
- Platform HTTP contracts：权限/HTTP 专项 3/3、contracts 28/28、Repository 40/40；独立复审关闭 3 项 P2，无新增 finding。
- Worker：89/89；通用生产组合聚焦 32/32；独立复审关闭 1 项 P1 与 2 项 P2，无新增 finding。
- Lockfile 由单一 Integration Owner 更新 `amqplib@2.0.1` 与 Worker/authorization 的 `@ai-crm/database workspace:*` importer；`pnpm install --frozen-lockfile` 通过。最新串行完整 `pnpm check` 通过：Repository 40/40、Compose static、contracts generation/check，Turbo 140/140。
- 本批次最终 `pnpm check` 再次通过：Repository 40/40、Compose static、contracts generation/check 与 Turbo 140/140；API 170 passed/5 skipped、Worker 90/90。首次完整运行遇到 Worker coverage 临时文件 `ENOENT`，Worker 独立复跑及随后完整复跑均通过。

## 独立 Review

- Round 1 发现容器监听地址、全流程 Drain 上限、动态 Readiness、重启竞态、信号监听器泄漏和运行故障不可观测等问题。
- 已修复：API 默认监听 `0.0.0.0`；HTTP/直接 Readiness 感知运行状态和动态依赖；Worker Stop Hook、在途任务、应用 Hook 与 Nest Context Close 共用一个 Deadline；超时进入 terminal 状态；信号监听器按启动/停止注册清理；生命周期与 Handler 失败通过 `ApplicationLogger` 记录稳定错误类别。
- 后续复核修复：健康 `ok` 发布失败完整 Teardown；启动/停止串行化；Handler Ready 握手；依赖检查异常失败关闭；两阶段 Drain；完整启动 Deadline；迟到 Nest 实例关闭与代际隔离；失败启动 Handler 有界清理；最小 Drain 预算边界。
- 最终窄复核确认：失败启动按代际等待 Handler；abort rejection 只视为已结束；卡住或资源清理失败进入 terminal；正常 Stop 不混入旧代；本轮范围无开放 P1/P2。
- API 复审关闭清理 Terminal、HTTP 标量边界、启动期信号和无界数据库 Helper；确认生产 Binding Factory及受保护路由因 Secret/权限合同缺失合法阻塞 G3。
- Worker 复审要求并已修复可伪造 Binding Count、Ready 前取活、运行期依赖失效继续领取、Idle 忙循环及 Rabbit Binding/Drain 端口；生产具体 Rabbit 组合仍因空 AsyncAPI 合法阻塞 G3。
- DB-COMPAT-01 独立复审关闭元数据证据信任根、无界 Pool 和 SemVer 精度问题；治理登记与 handoff 口径已由 Integration Owner 修正。
- 权限/HTTP 与 AsyncAPI 独立审查关闭文档相对引用、Retry Queue 队头阻塞、Attempt 语义、VHost、生成器基址和门禁覆盖问题；生产消费在策略与延迟机制确认前保持禁用。
- API 生产组合独立审查关闭 Factory 获取早于信号/Deadline、部分初始化清理无界且吞错、Factory 失败缺少结构化日志三项问题；回归覆盖获取期 SIGTERM、关闭拒绝和永不结束。
- Authorization persistence 独立审查关闭 locale 相关摘要、裁决一致性/已发布策略校验、原始数据库错误泄漏、非法日历时间、并发同 ID 冲突和历史策略恢复问题。
- RabbitMQ Adapter 独立审查关闭 `0440` Secret 权限、逐发布 Return 关联、重试 Channel 故障、Drain/Close 错误传播、元数据边界、拓扑防御复制和消息类型长度问题；最终复审无残留 finding。
- API 授权/审计/组织组合独立审查关闭认证操作 ID、单逻辑操作 Trace、相同命令不确定提交重试及慢策略加载生命周期竞态；最终窄复核无残留 finding。
- 平台 HTTP 独立 Review 发现生产查询未组合却可能 Ready、File 授权拒绝误报 503、Nest 默认 100 KiB Parser、Form GET Content-Type 误拒绝和入站 Trace 分裂；全部修复并由原 Reviewer 复审清零。Assignment 选择来源仍待契约评审，本批次未发明 Header。
- Audit/Registry/Form 查询组合独立 Review Round 1 发现关闭后可能启动策略 SQL、卡死依赖冻结数据库探测、嵌套 accessor 仍可执行三项 P2；均已按复现路径修复并补回归，同一 Reviewer 复审关闭全部 finding，未发现新增问题。
- 数据库最小权限、Registry/Form 模块探针和受保护策略发布边界均完成独立 Review 与原 Reviewer 复审。API 最终接线 Review 关闭启动取消状态残留、guard lint/type 和卡死探针恢复证明问题，无开放 P0-P3。

## 当前状态与外部阻塞

- 2026-07-29，仓库侧 Authorization 管理权限/基线、API Task/Notification/File/COS、独立 API/Worker 数据库角色、Task Outbox/Inbox/投影 Worker、AMQPS 固定重试/DLQ、告警/恢复声明和 API/Worker 镜像迁移制品门已随 `e090dda` 合并；汇总见 `G3-PRODUCTION-COMPOSITION.md`。
- CMP-01 当前唯一口径为 `EVIDENCE_BLOCKED`，尚未达到 `PASSED`。真实首发策略、COS test Bucket、不可变镜像摘要、RabbitMQ TLS/CAM、告警部署、Inbox/重试/DLQ/Drain 恢复演练及消费者显式启用必须由受保护环境闭合。
- 在上述证据完成前不得解锁 E2E-01，不得把合成集成测试当作生产证据。
- Notification、Workflow、File Job 缺少已审的队列/Job 合同，因此未创建消费者；这属于合同边界，不是遗漏实现。Workflow 还需要耐久 Ledger 和有类型的应用/Provider 组合合同。
