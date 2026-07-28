# ASYNC-RUNTIME-DECISION RabbitMQ 运行策略与延迟重试边界

- 状态：ADR-0026 已于 2026-07-28 被项目负责人接受；任何生产消费者仍保持关闭
- 决策人：项目负责人
- 接受日期：2026-07-28

## 任务目标

在不启用任何生产消费者、不修改契约或代码的前提下，基于已接受的 ADR-0010、已完成的 ASY-01、CMP-01-ASYNCAPI 和现有 `eventing-outbox` 公共 API，形成 RabbitMQ 运行决策。决策覆盖客户端与版本选择原则、生产连接安全、逐事件运行策略、无队头阻塞的延迟重试、消费流控、死信与人工重放、Attempt/Confirm/ACK 顺序、兼容性、故障和可观测性。

## 已知事实

- ADR-0010 已接受 RabbitMQ 至少一次投递、PostgreSQL Outbox/Inbox 耐久事实、Publisher Confirm、手动 ACK、有界重试和死信隔离；RabbitMQ 不是业务事实源。
- ADR-0021 已接受两台腾讯云 Ubuntu CVM、每台独立 Docker Compose Project、自托管状态组件且不承诺 RabbitMQ 高可用；当前发布清单示例固定 `rabbitmq:4.2.9-management`。
- ADR-0022 已接受 Pino、托管 Sentry、腾讯云云监控和 W3C/OpenTelemetry 传播的轻量观测基线，并禁止在技术遥测中记录消息载荷、个人数据、凭据和非受控文本。
- ASY-01 已提供供应商中立的 Confirm Channel、Mandatory Return、Rabbit Delivery、Outbox Publisher、Inbox 幂等、隔离、授权审计 Outbox 重放和积压/对账公共边界；尚未选择具体 Node RabbitMQ 客户端。
- CMP-01-ASYNCAPI 只声明 Task Center 投影拥有的主队列与死信队列。该消费者仍被 `reviewed-event-runtime-policy-values` 和 `reviewed-rabbitmq-delay-mechanism` 阻止启用。
- `x-ai-crm-delivery-attempt` 初始值为 `1`；重试发布使用 `N + 1`，且必须 Confirm 后才 ACK 原投递。Outbox 发布尝试与消费投递尝试是两个不同事实。
- 现有 Job 信封携带有界 `maxAttempts`、`backoffSeconds`、`timeoutMs` 和 `failureDisposition: isolate`；现有 Event 由组合层显式提供运行策略。

## 允许的假设

- 决策可以规定供应商中立的客户端准入条件和推荐实现，但具体包版本只有通过 Node 24、RabbitMQ 固定版本、TLS、Confirm/Return、流控和故障集成测试后才能进入锁文件。
- 第一阶段可以采用“每个已评审延迟值一个固定 TTL 延迟队列 + DLX 返回主交换机”的延迟机制；延迟队列没有消费者，也不使用共享队列的逐消息 TTL。
- `prefetch` 与应用 `concurrency` 可以作为每个已拥有消费者的独立、正整数、有上限运行参数；未获得容量证据前不发明生产数值。
- VHost 名称本身是非 Secret 的环境配置，证书、私钥、用户名/密码等凭据通过每服务、每环境、每用途的文件 Secret 注入。

## 禁止的假设

- 不创建或推断任何 CRM 事件、Job、倒计时、SLA、路由、消费者、队列、重试次数、延迟值、容量、保留期、告警阈值或值班人。
- 不因 JSON Schema、Message Component 或 Handler 类型存在就创建队列或启用消费者。
- 不承诺恰好一次、全局顺序、RabbitMQ/数据库分布式事务、自动故障转移、SLA、RPO 或 RTO。
- 不把 DLQ、RabbitMQ 投递状态、日志、Trace 或指标作为业务事实、任务完成证明或审计事实。
- 不允许无限立即重新入队、共享可变逐消息 TTL 重试队列、自动 DLQ 重放、绕过授权的批量重放，或在重放时跳过权威状态复核。
- 不把 RabbitMQ Channel、客户端 SDK 类型、连接字符串、密码、证书私钥或管理凭据暴露给领域模块或前端。

## 非目标

- 不安装 RabbitMQ 客户端、不修改包清单/Lockfile、不实现连接 Adapter、消费者、重试发布器、Worker Composition、Compose、Secret、Runbook、UI 或运营 API。
- 不修改 AsyncAPI、事件/Job Schema、生成 Bundle、数据库迁移、现有 ADR 索引、代码或既有 handoff。
- 本任务不实现具体运行策略数值、客户端包版本、镜像摘要、证书方案或消费启用；这些仍由对应 Owner/项目负责人独立确认和验收。

## 权威依据

- `AGENTS.md`
- `docs/08-架构决策/ADR-0010-RabbitMQ与Redis异步执行及Outbox-Inbox.md`
- `docs/08-架构决策/ADR-0021-第一阶段两台云服务器Docker-Compose部署.md`
- `docs/08-架构决策/ADR-0022-第一阶段轻量可观测性基线.md`
- `.handoffs/ASY-01.md`
- `.handoffs/CMP-01-ASYNCAPI.md`
- `contracts/asyncapi/topology.asyncapi.yaml`
- `contracts/asyncapi/README.md`
- `packages/platform-modules/eventing-outbox/src/index.ts`
- `packages/platform-modules/eventing-outbox/src/types.ts`
- `packages/platform-modules/eventing-outbox/src/rabbit.ts`
- `packages/platform-modules/eventing-outbox/src/publisher.ts`
- `packages/platform-modules/eventing-outbox/src/operations.ts`

## 允许修改路径

- `docs/08-架构决策/ADR-0026-RabbitMQ运行策略与延迟重试边界.md`（新增）
- `docs/08-架构决策/README.md`（接受后补充索引）
- `.handoffs/ASYNC-RUNTIME-DECISION.md`（新增）

## 禁止修改路径

- `contracts/**`
- `apps/**`、`packages/**`、`deploy/**`、`scripts/**`
- 所有包清单、Lockfile、迁移和既有 handoff

## 交付物

- 一份已由项目负责人接受的 ADR-0026；接受只确认运行边界与门禁，不表示生产消费者已启用。
- 本任务卡、决策摘要、未决事项、自检结果和后续实施门禁。

## 必需自检

- 检查只新增两个允许文件，且不覆盖工作区中其他开发线的既有改动。
- 检查 ADR 明确客户端/版本选择原则、TLS/VHost/file Secret、逐事件策略、无队头阻塞延迟、prefetch/concurrency、DLQ/授权审计重放、Attempt/Confirm/ACK、兼容/故障/观测。
- 检查没有创建未拥有消费者、CRM Job、具体业务运行数值或生产启用声明。
- 运行 `git diff --check -- <两个允许文件>`。

## 独立复核清单

- Authorization：DLQ 重放与 Outbox 重放是不同操作；默认拒绝，授权决定与追加式审计先于任何状态改变。
- Idempotency：Inbox 仍是耐久去重依据；重试、连接恢复和 ACK 丢失都允许重复。
- Transactions：本地副作用与 Inbox 同事务；远程副作用使用持久状态、稳定幂等键与对账；不伪造跨 RabbitMQ 事务。
- Migrations：本任务没有数据库变化。
- Observability：只允许有界技术标识和结果类别，不记录载荷、个人数据、凭据、原始异常或供应商响应。
- Backward Compatibility：本决策不能改变已发布 Event/Job 信封；破坏性拓扑或运行策略变化需版本化迁移。
- Secrets：只定义文件引用和轮换行为，不包含任何 Secret 值。
- Failure Modes：连接、Confirm/Return、ACK 丢失、进程崩溃、延迟队列、DLQ、数据库和遥测故障均需失败关闭或可恢复。

## 当前结果

ADR-0026 已于 2026-07-28 被项目负责人接受。接受记录和 ADR README 索引已更新；契约、代码、包清单、Lockfile 与部署文件未因此改变，任何生产消费者仍未启用。

文档自检结果：

- Client/Version：以当前 RabbitMQ 4.2.9 基线做首轮兼容验证、生产固定镜像摘要；`amqplib` 是首选候选，精确版本必须通过 Node 24/RabbitMQ/TLS/Confirm/Return/流控/故障矩阵后才能安装。
- Security：生产 TLS、显式环境隔离 VHost、分离最小权限账号、类型化 `*_FILE`、缺失失败关闭与轮换撤销边界均已明确。
- Policy/Delay：运行策略按 `consumer + messageType + messageVersion` 独立评审；选择固定队列级 TTL 延迟层 + DLX，明确拒绝共享逐消息 TTL 队列造成的队头阻塞。
- Flow control/Reliability：`prefetch` 与 `concurrency` 分开受限；Attempt、Mandatory Return、Publisher Confirm、事务提交、ACK、DLQ 顺序与不确定结果恢复均已明确。
- Authorization/Audit：DLQ 重放默认禁用，并与现有 `outbox_replay` 分权；授权、权威状态复核和追加式审计先于任何重放状态改变。
- Compatibility/Failure/Observability：版本迁移、拓扑不匹配失败关闭、RabbitMQ/PostgreSQL/Telemetry 故障、优雅停止、无敏感数据遥测和分职责健康均已覆盖。
- Scope：没有创建未拥有消费者、CRM Job、业务路由或具体运行策略数值；Task Center 投影继续保持关闭，Organization/Workflow/Job Message Component 不产生队列。
- Workspace：`git status --short` 显示其他开发线正在修改/新增不属于本任务的文件；本线未触碰它们。2026-07-28 接受记录更新后，`pnpm repo:check` 通过（39/39），`git diff --check` 及未跟踪文档的 `git diff --no-index --check` 通过。

## 后续门禁

- 项目负责人已接受 ADR-0026；该接受只确认运行边界与门禁，不构成生产消费启用授权。
- 对 Task Center 投影另行确认运行策略数值、延迟层契约、Handler/Owner、客户端精确版本、镜像摘要、TLS/Secret 和容量/告警 Runbook。
- 之后才能在独立实现任务中修改 AsyncAPI、代码、依赖和部署，并完成真实 RabbitMQ 集成与故障测试；本任务未执行这些动作。
