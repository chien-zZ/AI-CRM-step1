# ASY-01 Eventing、Outbox 与 Inbox

- Status: G2 accepted
- Branch: `codex/ASY-01-eventing-outbox-inbox`
- Owner: current serial implementation pass

## 已知事实

- G1 已完成；ASY-01 的计划前置依赖已满足。
- ADR-0010 规定至少一次投递，PostgreSQL Outbox/Inbox 是耐久事实，RabbitMQ 是传输，Redis 只能保存可重建协调状态。
- 当前持久化权威基线是 ADR-0011 的 PostgreSQL + Drizzle SQL migration，不是历史分支中的 Prisma/ADR-0025。
- 领域事件、RabbitMQ 拓扑和 Worker 私有 Job 分属 `contracts/events`、`contracts/asyncapi` 和 `contracts/jobs`。

## 允许的假设

- 业务中立 v1 信封可以携带稳定消息 ID、来源、类型/版本、发生时间、关联/因果 ID、W3C Trace Context 和受限 JSON 数据。
- Outbox Publisher 可以使用 PostgreSQL 行锁、`SKIP LOCKED`、有界租约和有界退避领取已提交记录。
- 真实事件/Job 拓扑未确认前，只提供显式拓扑 Port 和合成测试路由，不向 AsyncAPI 发明生产队列。

## 禁止的假设

- 不创建 CRM 事件、队列、路由、倒计时、SLA、提醒、审批路线或业务 Job。
- 不承诺恰好一次、全局有序、分布式事务、自动故障切换、SLA、RPO 或 RTO。
- 不把 Redis 用作 Outbox、Inbox、Job 或唯一幂等事实源。
- 不公开 Drizzle Schema、查询器、事务句柄、RabbitMQ Channel 或供应商 SDK 类型。
- 不在 Confirm 前标记已发布，不在 Inbox 本地事务完成前 ACK。

## 非目标

- 本批不实现真实生产消费者拓扑、具体 RabbitMQ 客户端连接、Worker Composition Root、运营 HTTP/UI、生产容量/保留策略或告警阈值。
- `apps/worker` 的最终发布器/消费者注册和 Readiness 由 CMP-01 在模块 G2 后统一组合审查。

## 实现证据

- 新增传输中立 Event v1 与私有 Job v1 JSON Schema；Job 自带有界重试、退避、超时、失败隔离和幂等键。
- 追加迁移 `0000000003_eventing_outbox_inbox_core` 创建模块自有 `platform_eventing` Schema，以及 Outbox、Inbox、Job、隔离事实表；迁移有锁、数据、恢复和前滚元数据。
- 公共 API 提供事务性 Outbox/Inbox Core、正式 `DatabaseRuntime` 事务参与、PostgreSQL 持久化 Port、Publisher、Rabbit Confirm/Return 边界、重试/死信交付包装、授权审计重放、积压快照与只读漂移对账。
- Publisher Confirm 后才推进状态；Confirm 成功但状态更新丢失时允许稳定 ID 重发。Mandatory publish 的 `Basic.Return` 被视为可重试失败。
- 消费者副作用与 Inbox receipt 在同一事务提交；ACK 仅在 `consume` 返回后发生。重复 ACK 丢失只提交一次副作用。
- Redis 未进入任何正确性路径；Job 原子进入 `processing`、执行前强制重新检查权威状态并执行合同超时，取消仅能更新 `queued`，完成/隔离仅能更新 `processing`。

## 验证

- 单元/故障测试：20 项 ASY 行为 + 1 项 Workspace smoke 通过。
- 隔离 PostgreSQL 集成：3/3 通过；正式 Runtime、根迁移入口、事务回滚、Outbox claim、Inbox/副作用原子性、去重和取消/执行并发已验证；测试 Project、容器、网络和 Volume 已清理。
- `pnpm check`：28 个 Workspace 包共 140 个 build/lint/typecheck/test/contracts 任务通过。
- `git diff --check`：通过。

## 实现者复核

- Authorization：人工重放默认拒绝；必须先获得允许决策并成功记录理由/审计，再改变 Outbox 状态。
- Idempotency：稳定 Message ID、消费者复合键、Job 幂等键、载荷指纹和隔离唯一键均受约束。
- Transactions：本地状态 + Outbox、消费者副作用 + Inbox 使用调用方提供的同一嵌套事务运行时；Rabbit ACK 位于事务返回之后。
- Migrations：仅追加模块自有 Schema，无跨模块外键、自动同步、`drizzle-kit push` 或破坏性 SQL。
- Observability：公开积压、发布中、隔离、Inbox、Job 计数和最老待发布时间；Trace/Correlation/Causation 传播不记录载荷。运行时日志、指标适配和 Readiness 留给 CMP-01/INF 组合。
- Backward Compatibility：公共入口、v1 合同和新表均为新增；未修改现有事件、Job、数据或客户端契约。
- Secrets：源码、Fixture、合同和输出不含 Secret；集成测试只接受 `*_FILE`，临时 Secret 与隔离资源已清理。
- Failure Modes：数据库回滚、Rabbit 不可用、Confirm/状态更新窗口、重复 ACK、取消、权威状态拒绝、重试耗尽、死信和授权重放均有明确行为。

## 2026-07-26 独立 Review 修复

- P1 Transactions：正式 `DatabaseRuntime` 新增参数化 `execute`，Eventing Persistence Runtime 明确取其 `execute + withTransaction`；集成测试不再使用自制事务 Runtime。
- P1 Migrations：Eventing 新增 `migrate`，根迁移入口发现数据库/模块目录并按全局版本排序；隔离测试执行根入口后再做幂等迁移验证。
- P1 Timeout：Job `timeoutMs` 产生 `AbortSignal`，超时抛出可重试错误并回滚 `processing`、Inbox 和本地 SQL 副作用。
- P1 Cancel race：新增条件状态转换与真实 PostgreSQL 并发测试；处理开始后取消会等待事务并返回最终 `completed`，不会虚假返回 `cancelled`。
- P2 Contracts/Retry：Schema 对齐幂等键、Subject、TraceState 和退避数组长度；Rabbit Job 重试直接取已验证信封策略。
- P2 Observability/Reconciliation：隔离计数包含 Outbox 隔离；新增无载荷 Observer 与缺失 Inbox/Outbox、隔离 Outbox 的只读对账报告。

## 2026-07-26 第二轮独立 Review 修复

- P1 Timeout settlement：不再用 `Promise.race` 提前释放事务；Event 与 Job 到期后发出 `AbortSignal`，等待 Handler 真正结束，再以可重试超时回滚。Event 运行策略也必须显式提供有界 `timeoutMs`；忽略 Abort 的有限 Handler 测试证明其结束前事务保持占用。
- P1 Concurrent Inbox：同一 `messageId + consumer` 在 Inbox 检查前获取 PostgreSQL 事务级 advisory lock；真实并发集成测试证明第二次投递等待首次提交后返回 `duplicate`，不会被误判为冲突或产生第二次副作用。
- P2 Retry budget：Rabbit 适配边界在调用消费者前校验当前 Attempt，超过 Event/Job 策略预算直接死信；Event 策略的重试、退避和超时均显式传入消费边界。

## 未决事项

- RabbitMQ Node 客户端库、TLS/凭据/VHost、真实交换机/队列/路由、容量、保留/归档、告警阈值和运营权限仍未确认，不能在本包发明。
- 真实 RabbitMQ 连接集成测试须在客户端库与合成测试拓扑被评审后补充；当前已验证 Confirm、Mandatory Return、ACK、重试 Confirm 和死信的供应商中立 Port 顺序。
- 非原实现 Agent 已完成三轮独立审查；前两轮 findings 均已修复，最终复核无 P0/P1/P2，建议 `G2 accepted`。
- 忽略 Abort 且永不结束的 Handler 会按明确契约持续占用事务/连接；组合层必须提供 watchdog/readiness，Handler 实现评审必须验证 Abort 后可结束。模块不会通过提前释放事务让仍运行的 Promise 越过事务边界。
