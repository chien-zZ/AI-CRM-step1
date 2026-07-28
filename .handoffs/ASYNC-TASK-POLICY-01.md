# ASYNC-TASK-POLICY-01 Task 投影消费者首版运行策略

- Status: CONTRACTED; production activation remains fail-closed pending environment evidence
- Date: 2026-07-28
- Owner: current technical control session

## Known Facts

- ADR-0026 要求每个消费者拥有独立、密封、版本化的运行策略，且具体值不得从 CRM 材料推断。
- Task Center PostgreSQL 投影已具备事件收据、内容冲突检查和单调版本防回退语义。
- Worker Rabbit Adapter 已支持固定 TTL 延迟层、Confirm/Return、有界 Prefetch/并发、手动 ACK/NACK 和 Drain。
- 当前没有可信的生产流量、压测、值班或 SLA 证据。

## Allowed Assumptions

- 使用单并发、小预取和少量有界重试作为首版安全基线，不将它解释为容量承诺。
- 只有 Task Center/Eventing 稳定错误码白名单且明确标记 `retryable=true` 的故障可进入重试。

## Forbidden Assumptions

- 不将本策略复用到其他 Event、Job、Provider 或 CRM 流程。
- 不将异常文本、用户输入或未知异常用于重试分类。
- 不在没有真实 TLS/最小权限/恢复/告警证据时激活生产消费。

## Non-goals

- 不实现 CRM 实体、状态、SLA 或流程。
- 不创建 DLQ 自动重放、RabbitMQ 管理权限或生产 Secret。
- 不声称 G3、E2E-01 或生产容量已通过。

## Contract Result

- 新增已接受 ADR-0027。
- 策略 ID：`taskProjectionLifecyclePolicyV1`。
- Owner/Handler：`platform.task-center` / `task-center.postgres-projection-apply.v1`。
- `maxAttempts=3`，`backoffSeconds=[30,300]`，`timeoutMs=10000`，`prefetch=2`，`concurrency=1`。
- 仅 `TASK_STORAGE_UNAVAILABLE`、`eventing_storage_unavailable`、`eventing_conflict`、`eventing_handler_timeout` 且 `retryable=true` 可重试；未知错误终止隔离。
- AsyncAPI 新增 30 秒与 300 秒队列级固定 TTL 延迟层，明确无消费者，到期 DLX 回主路由。
- 生产 activation 继续为 false，阻塞原因已从“数值未审批”收敛为四类可验证的环境证据。

## Authorization And Audit

本变更不授予运维或 DLQ 重放权限。人工重放继续禁用；终止隔离和未来重放必须使用独立权限、权威状态复核和追加式审计。

## Idempotency, Transactions, And Failure

重试只在 Inbox/投影本地事务未成功时发生。本地事务提交后才 ACK；重试发布必须 Mandatory 未 Return 且 Confirm 成功后才 ACK 原 Attempt。Confirm 不确定不递增 Attempt，由 Broker 重投相同 Attempt。

## Migrations And Compatibility

无数据库迁移。AsyncAPI 版本从 `0.2.0` 提升到 `0.3.0`；消息 v1 载荷不变，新增的是传输拓扑和运行策略。变更延迟、Attempt、错误分类或并发时必须再次版本化评审。

## Observability And Secrets

- DLQ 新增 1 条、职责 Not Ready 持续 2 分钟、最旧待处理超 5 分钟且持续 5 分钟是首版告警下限，不是 SLA。
- 指标只使用受控 consumer/message type/version/result label，不包含 payload、异常文本、个人数据或 Secret。
- 本变更不生成、读取或记录任何生产 Secret。

## Verification

- `node --test contracts/asyncapi/topology.contract.test.mjs`：4/4 通过。
- Worker 密封策略与错误分类专项：2/2 通过，新增文件 100% statements/branches/functions/lines。
- Worker lint/typecheck：通过。
- `node scripts/contracts/generate.mjs --check`：通过，无生成制品漂移。
- 完整 `pnpm check`：Repository 40/40、Compose static、contract generation/check 和 Turbo 140/140 通过。
- `git diff --check`：通过。

## Review Findings And Resolution

- P1：首次契约修改引用了 `ai-crm.platform.retry.v1` 但未声明交换机本身。已新增耐久 direct exchange 和只允许 30/300 秒两个 routing key 的 Mandatory/Confirm 重试发布 Operation，契约测试锁定名称和路由。
- P1：首稿错误白名单遗漏 ACK 前的 Eventing Inbox 存储失败、可重试冲突和 Handler 超时，会把短暂基础设施故障直接送入 DLQ。已增加三个稳定 Eventing 错误码，并强制错误实例及 `retryable=true`；伪造 plain object 和未知异常仍终止。
- P1 open activation boundary：Task Center `apply()` 尚未接收并把 `AbortSignal` 传播到 PostgreSQL 执行。当前不创建虚假的“可中止 Handler”，生产 activation 继续 false。下一实现必须证明超时后底层操作真正结束，不得只超时外层 Promise。

## Remaining Activation Evidence

- RabbitMQ 4.2.9 固定摘要与 `amqplib@2.0.1` 真实 TLS/Confirm/Return/ACK/延迟/Drain 矩阵。
- Publisher/Consumer 最小权限账号、环境隔离 VHost 和文件 Secret 证据。
- Inbox/重试/DLQ/恢复排空和上述告警的验收环境证据。
- 生产 Handler/Topology/Registry 精确组合与独立 Review。
- Task Center 投影持久化的可中止执行边界，覆盖超时后事务/连接不再被迟到使用。
