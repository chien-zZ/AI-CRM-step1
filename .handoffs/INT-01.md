# INT-01 Integration Runtime

- Status: SELF_REVIEW complete; awaiting independent Review
- Branch: `task/INT-01-integration-runtime`
- Owner: Agent D
- Reviewer: Agent B

## Objective

建立供应商中立的 Deadline、错误分类、Retry Budget、退避/抖动、并发/限流、熔断、Webhook 验签/防重接口和 Fake 故障工具，不创建真实 Provider 或第二套消息传输。

## Known Facts

- ADR-0020 已确认“拥有模块 Port + integration-runtime + 组合根 Adapter”边界。
- 第一阶段没有已批准的真实供应商、账号、凭据、Webhook 协议或验收 Owner。
- RabbitMQ/Outbox/Inbox 是异步传输；本模块不得建立第二套队列。
- 首个真实集成尚未确认持久化字段和保留策略，因此本任务只定义耐久防重 Port，不创建数据库 Schema。

## Allowed Assumptions

- Adapter 能接收并遵守 AbortSignal。
- 拥有模块为每个操作提供稳定、受限的 operation ID、安全类别和显式重试策略。
- Webhook Adapter 在业务解析前向运行时提供原始字节、签名、时间戳、Nonce、事件 ID 和协议版本。

## Forbidden Assumptions

- 不创建支付、短信、企微、微信、课程、题库或真实 AI Adapter/DTO/端点。
- 不提供任意 URL Executor、业务编排、字段映射、供应商业务状态或第二套消息总线。
- 不从 HTTP 状态机械推断业务成功；只有 Adapter 映射后的稳定错误分类进入运行时策略。
- 不把内存 ReplayStore 用于生产正确性。

## Non-goals

- 不实现 Provider HTTP Client、Secret 解析、Webhook HTTP Route、PostgreSQL/Redis Adapter、人工重放 UI 或生产告警阈值。
- 不拥有通知投递、支付、人员、AI Proposal 或其他业务事实。

## Authority And References

- 根 `AGENTS.md`。
- ADR-0020、ADR-0010、ADR-0022、ADR-0024。
- `docs/03-模块说明/第三方集成运行时.md`。
- 第一阶段实施计划 INT-01 与验收清单第 15、21 节。

## Allowed Paths

- `packages/platform-modules/integration-runtime`。
- `contracts/integrations`。
- `.handoffs/INT-01.md`。

## Forbidden Paths

- `apps/api`、`apps/worker`、其他平台/领域模块、根 Lockfile、生成 OpenAPI/API Client、部署和真实 Provider 配置。

## Contract Changes

- 新增 provider-neutral operation policy v1 JSON Schema。
- 新增 verified Webhook receipt v1 JSON Schema。
- 公共入口新增 Deadline、Retry、Limiter、Circuit Breaker、Executor 和 Webhook 接口；测试工具仅从 `./testing` 子入口导出。

## Migration Changes

无。首个真实集成前不发明技术调用/Webhook 存储字段、保留策略或迁移。

## Dependencies

只使用 Node 标准能力和现有 Workspace 工具，没有新增第三方运行时依赖或 Lockfile 修改。

## Required Tests

- connect/response/total Deadline 与取消分类。
- Retry allowlist、预算、退避和确定性抖动。
- 并发上限、固定窗口限流、熔断/半开恢复。
- 非幂等写禁止自动重试。
- Webhook 原始报文先验签后防重、旧时间戳、坏签名、重复事件。
- Fake 超时、429/临时错误和内存重复 Fixture。

## Authorization And Audit

本模块不提供业务命令、人工重放或运维写入口，因此没有可授权业务资源。未来 Webhook 路由、人工重放、映射修复和对账必须由组合任务与拥有模块分别授权和审计；运行时不能用技术日志替代审计。

## Idempotency, Retry And Failure

- 非幂等写强制单次尝试；其他操作只重试显式 allowlist 内且标记 retryable 的稳定错误。
- Retry Budget 最大 10 次，退避数组必须逐次完整定义，抖动限制在 0～1；单一总 Deadline 覆盖限流等待、全部尝试与退避，不因重试重新计时。
- Webhook 在验签后通过独立 SHA-256 Event ID/Nonce 键调用原子耐久 ReplayStore；任一重复均失败关闭。
- ReplayStore 不可用映射为可重试 `upstream_unavailable`，验签异常映射为不可重试 `signature_invalid`。
- Adapter 必须响应 AbortSignal 并结束；运行时等待 Adapter settle，不让仍运行 Promise 越过调用边界。

## Observability And Health

Observer 只接收受限 operation ID、固定错误类别、attempt、duration、outcome 和 retrying，不接收 URL、请求/响应、Webhook Body、签名或 Provider Payload。Limiter/Circuit Snapshot 只包含有界技术计数和状态。具体 Logger/Metric/Health Adapter 留给组合任务。

## Backward Compatibility

现有包只有 `packageId`。所有接口、Schema 和 `./testing` 导出均为新增，无现存消费者或数据迁移。

## Deliverables

- 供应商中立运行时公共 API 与开发者说明。
- 两份 v1 JSON Schema。
- 25 项模块/Workspace 测试和故障 Fixture。
- Owner 自审与后续独立 Review 记录。

## Unresolved Questions

- 第一个真实 Provider、协议、凭据、Endpoint、错误映射和验收 Owner 未确认。
- Webhook ReplayStore 的 PostgreSQL Schema、保留期、加密和运维权限等待真实协议确认。
- 分布式速率限制、租户维度和生产阈值等待容量与 Provider 合同确认。

## Owner Self-review

- Authorization：没有业务/运维写入口；未来人工操作明确留给拥有模块授权与审计。
- Idempotency：非幂等写无自动重试；Webhook 使用调用方耐久原子 reserve Port。
- Transactions：不拥有业务事务或持久化；未引入跨模块事务句柄。
- Migrations：无未确认存储模型或迁移。
- Observability：Observer 和 Snapshot 不含载荷、签名、URL、凭据或用户内容。
- Backward Compatibility：纯新增公共 API/Schema；无消费者破坏。
- Secrets：不读取、保存或记录 Secret；签名只进入 Verifier Port。
- Failure Modes：Deadline、取消、限流、并发、熔断、临时错误、验签失败、重复和 ReplayStore 不可用均有稳定失败语义。

自审修复：在初版检查后补充策略前置校验、非幂等写约束、并发取消竞态保护、已取消 Signal 继承、半开计数清理/失败分类、Webhook 输入上限、Event ID 与 Nonce 独立原子防重、ReplayStore 稳定错误映射及测试工具覆盖。第二轮将总 Deadline 从“每次尝试”提升为覆盖排队、全部尝试和退避的单一执行预算，限制所有计时器输入为最多一小时，并隔离 Observer 异常，新增总预算与观测失败回归测试。

## Independent Review Round 1 And Owner Fixes

Agent B 对 `c7429c8` 完成只读独立 Review，提出五项可执行问题：P1 Webhook 验签字节可在异步边界被修改、P1 异步 Observer rejection 未被隔离、P2 ReplayStore 异常与返回值未归一、P2 抖动后退避可突破一小时、P2 默认熔断将调用方取消计为 Provider 故障。Authorization、Migrations、Backward Compatibility 和 Secrets 无 finding；Transactions/Idempotency、Observability 与 Failure Modes 的问题由上述 finding 覆盖。

Owner 在 `f2f85e8` 全部修复并补回归：进入异步验签前验证并复制原始字节、预计算摘要且拒绝 Verifier 修改；无效字节不会调用 ReplayStore；Store 所有异常统一映射为可重试 `upstream_unavailable` 并精确校验返回结构；同步和异步 Observer 故障都被吸收；有效抖动后退避上限固定为一小时；默认熔断只统计稳定 Provider/传输故障类别。专项证据为 25/25 tests、lint、typecheck 与 28/28 contracts checks 通过。等待同一 Agent B 复审，当前不得标记 G2。

## Independent Re-review Acceptance

Agent B 对 `f2f85e8` 和 handoff `7ecec28` 完成同一 Reviewer 复查，逐项重放五个 finding，确认全部关闭且没有新增 P0/P1/P2/P3。复查确认调用方与 Verifier 字节修改均不会污染已验证摘要或提前占用防重键；同步/异步 Observer 失败不改变结果且无未处理 rejection；ReplayStore 抛错和畸形返回失败关闭；最大有效抖动为 3,600,000 ms；默认熔断在调用方取消后保持关闭。

最终证据：25/25 模块测试、包 lint/typecheck/contracts、仓库 contracts 28/28、完整 `pnpm check` 140/140 通过；只修改 integration-runtime、integration contracts 和任务 handoff，根 Lockfile、生成制品、`apps/api`、`apps/worker` 均无差异。Authorization/Migrations 不适用且已有依据；Idempotency、Transactions、Observability、Backward Compatibility、Secrets 和 Failure Modes 均无未关闭问题。状态为 `G2_ACCEPTED`，等待 Integration Owner 串行合并。

## Handoff Result

独立 Review 与同一 Reviewer 复查均已完成，可执行 finding 为零；`G2_ACCEPTED`，等待 Integration Owner 串行合并。
