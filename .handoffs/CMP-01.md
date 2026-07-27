# CMP-01 API 与 Worker 组合根

- Status: IMPLEMENTING
- Owner: 当前会话（`apps/api`、`apps/worker` 组合根单一 Owner）
- Reviewer: 独立 Review 多轮完成，本轮生命周期与健康检查范围无开放 P1/P2
- Allowed paths: `apps/api`、`apps/worker` 的 Composition Root、Module Wiring、启动与健康入口，以及本任务 handoff

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
- 本轮不改变 HTTP、Event、AsyncAPI、Job 或数据库契约。

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

## 尚未完成

- 实现生产 API Binding Factory：受控 PostgreSQL Pool、Redis/IAM、Organization/Authorization/Audit 及查询 Facade 的文件式 Secret 配置、超时、关闭和 Readiness 尚未闭合。
- Task/Notification HTTP 合同尚未定义 IAM-03 `PermissionRequest` 映射；Registry/Form/File 尚无 HTTP 模块合同。在合同先行前禁止注册受保护能力 Controller，因此授权链和访问审计仍没有真实 HTTP 证据。
- AsyncAPI 当前没有 Channel/Operation；RabbitMQ 客户端、Topology、Consumer Binding 与连接配置尚未获评审。Worker 生产组合明确失败关闭，不能用合成 Binding 冒充。
- 接入真实 Error Reporter/Trace、生产 Compose Secret/超时配置、Worker Drain 与 `stop_grace_period` 静态关系，并补真实进程/依赖联合测试。

## 验证

- API：普通门 74 tests passed、5 integration tests skipped；真实 Redis/Keycloak 认证集成 79/79 通过；专项 lint/typecheck/build/contracts 通过。
- Worker：45/45 tests passed；专项 lint/typecheck/build/contracts 通过；7 个真实 Node 子进程场景覆盖 Handler Fatal Exit、SIGINT/SIGTERM、启动取消、Drain Timeout、生产空组合失败和 Readiness 清理。
- Database：普通门 23 tests passed、1 integration test skipped；隔离 PostgreSQL 运行全仓 11 条迁移及兼容检查 24/24 通过。
- Lockfile 由单一 Owner 离线更新；完整 `pnpm check` 140/140、`pnpm compose:test:integration`、`pnpm db:test:integration`、`pnpm auth:test:integration` 全部通过，临时容器、网络和 Volume 已清理。

## 独立 Review

- Round 1 发现容器监听地址、全流程 Drain 上限、动态 Readiness、重启竞态、信号监听器泄漏和运行故障不可观测等问题。
- 已修复：API 默认监听 `0.0.0.0`；HTTP/直接 Readiness 感知运行状态和动态依赖；Worker Stop Hook、在途任务、应用 Hook 与 Nest Context Close 共用一个 Deadline；超时进入 terminal 状态；信号监听器按启动/停止注册清理；生命周期与 Handler 失败通过 `ApplicationLogger` 记录稳定错误类别。
- 后续复核修复：健康 `ok` 发布失败完整 Teardown；启动/停止串行化；Handler Ready 握手；依赖检查异常失败关闭；两阶段 Drain；完整启动 Deadline；迟到 Nest 实例关闭与代际隔离；失败启动 Handler 有界清理；最小 Drain 预算边界。
- 最终窄复核确认：失败启动按代际等待 Handler；abort rejection 只视为已结束；卡住或资源清理失败进入 terminal；正常 Stop 不混入旧代；本轮范围无开放 P1/P2。
- API 复审关闭清理 Terminal、HTTP 标量边界、启动期信号和无界数据库 Helper；确认生产 Binding Factory及受保护路由因 Secret/权限合同缺失合法阻塞 G3。
- Worker 复审要求并已修复可伪造 Binding Count、Ready 前取活、运行期依赖失效继续领取、Idle 忙循环及 Rabbit Binding/Drain 端口；生产具体 Rabbit 组合仍因空 AsyncAPI 合法阻塞 G3。
- DB-COMPAT-01 独立复审关闭元数据证据信任根、无界 Pool 和 SemVer 精度问题；治理登记与 handoff 口径已由 Integration Owner 修正。

## 未解决问题

- RabbitMQ concrete adapter、连接配置和 topology composition 尚无已实现应用端口。
- Production Compose 的 API/Worker 依赖配置与当前模块运行所需配置尚未闭合。
- Production Compose 尚未向 API/Worker 挂载应用运行时 PostgreSQL Secret；Worker 也没有 RabbitMQ/Redis 等所需连接 Secret，禁止猜测变量名或绕过文件式 Secret。
- Worker Drain deadline 与 Compose `stop_grace_period` 尚无静态关系校验，不能证明容器会给应用留下完整排空预算。
- BFF previous encryption key 轮换对已由代码支持，但当前生产 Compose 尚不能表达该可选轮换配置。
- 生产 API/Worker 必须向公共只读迁移兼容检查提供受控只读 Pool、完整迁移目录和独立应用 Schema SemVer；不得传四段 Release ID 或调用 `runMigrations` 代替检查。
- CMP-01 仍处于 IMPLEMENTING，不满足 G3 或 Definition of Done，不得解锁 E2E-01。
