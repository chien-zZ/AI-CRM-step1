# ADR-0027：Task 投影消费者首版运行策略

- 状态：已接受
- 日期：2026-07-28
- 决策权限：项目负责人授权技术负责人把控当前阶段推进
- 适用范围：`platform.task-center.projection.v1` 消费者
- 依赖决策：ADR-0010、ADR-0026

## 已知事实

- Task Center 投影以 `sourceType + sourceTaskId + sourceVersion` 防止乱序回退，以事件 ID 和内容摘要处理重复与冲突。
- RabbitMQ 传输是至少一次，消费成功必须在本地 Inbox/投影事务提交后才 ACK。
- 当前只有这一个获得 Owner 的消费绑定；不存在可从 CRM 材料推导的吞吐量、SLA 或容量数据。
- Worker 已实现固定 TTL 延迟层、Confirm/Return、手动 ACK/NACK、Prefetch/并发和有界 Drain，但生产消费尚未激活。

## 允许的假设

- 首版以正确性和故障可观察为优先，使用单并发与小预取，不将其解释为生产容量承诺。
- Task 投影是数据库内幂等且可对账的技术投影，可使用少量有界重试吸收短暂数据库故障。

## 禁止的假设

- 不将这些数值推广到其他 Event、Job、CRM 流程或外部 Provider。
- 不声称 30/300 秒退避、10 秒 Handler 上限或单并发满足 SLA、容量或准时处理。
- 不将未知异常、校验错误、版本不支持或权威状态拒绝视为可无限重试。
- 不因本 ADR 已接受就跳过真实 RabbitMQ TLS、最小权限、PostgreSQL、恢复排空和告警验收。

## 决策

`platform.task-center.projection.v1 + task-center.projection-lifecycle.v1 + v1` 使用以下密封策略：

| 项目 | 首版值 |
|---|---|
| Owner | `platform.task-center` |
| Handler | Task Center PostgreSQL projection apply |
| `maxAttempts` | `3`（包含首次） |
| `backoffSeconds` | `[30, 300]` |
| `timeoutMs` | `10000` |
| `prefetch` | `2` |
| `concurrency` | `1` |
| 可重试错误 | `TASK_STORAGE_UNAVAILABLE`、`eventing_storage_unavailable`、`eventing_conflict`、`eventing_handler_timeout`，且明确 `retryable=true` |
| 终止错误 | 合同/版本/输入/冲突/权威状态拒绝，以及所有未知异常 |
| 终止去向 | 受审 DLQ，不自动重放 |

两个固定延迟队列分别使用队列级 `30000ms` 和 `300000ms` TTL，到期后通过 DLX 回到主交换机和原路由。不使用逐消息 TTL，不安装 delayed-message 插件。

告警的首版安全下限为：DLQ 新增任意 1 条立即产生可行动告警；消费职责 Not Ready 持续 2 分钟产生告警；最旧待处理消息超过 5 分钟并持续 5 分钟产生积压告警。这些是发现故障的保守门槛，不是 SLA。

## 启用门

契约与代码可以根据本决策实现，但生产 `activation.enabled` 只能在以下证据齐全后改为 `true`：

1. RabbitMQ 4.2.9 固定摘要与 `amqplib@2.0.1` 真实 TLS/Confirm/Return/ACK/延迟/Drain 联合测试通过。
2. Publisher/Consumer 最小权限账号、隔离 VHost 和文件 Secret 已在验收环境配置。
3. PostgreSQL Inbox/投影事务在重复、乱序、超时、Confirm 不确定、DLQ 和恢复排空场景通过。
4. 上述三类告警、Owner 和处置 Runbook 已配置并触发验证。
5. 独立 Review 确认授权、幂等、事务、迁移、可观测、兼容、Secret 和故障路径无开放问题。

## 影响与替换条件

- 最多同时处理 1 条，Broker 最多预取 2 条；首版优先限制数据库压力和收敛故障。
- 一条消息在不考虑 Broker/调度额外延迟时，最多进入 3 次 Handler，退避总和为 330 秒。
- 只有预发压测证明积压且 PostgreSQL 连接、CPU、内存、处理时长和重复率仍在安全边界内，才能版本化提高并发或预取。
- 任何数值、错误分类或延迟层变更都是运行合同变更，需要兼容检查、故障测试和独立 Review。

## 实现前复核修正

实现对照发现首稿只列出 Task Store 错误，遗漏了在同一 ACK 前事务边界内的 Inbox 存储失败、可重试并发冲突和 Handler 超时。这些故障可能在未 ACK 时恢复，直接终止会错误地把基础设施短暂故障送入 DLQ。因此增加上述三个 Eventing 稳定错误码，并同样强制 `retryable=true`；未知异常仍为终止。
