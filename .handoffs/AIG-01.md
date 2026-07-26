# AIG-01 AI Gateway Fake

- Status: `SELF_REVIEW`
- Branch: `task/AIG-01-ai-gateway-fake`
- Owner: Agent D
- Independent Reviewer: Agent B

## Objective

建立业务中立的 AI 用途注册、合成数据输入/输出 Schema 校验、预算和授权 Port、确定性 Fake Adapter、非权威 Proposal 与人工确认阻断语义，不连接真实模型或执行领域命令。

## Known Facts

- ADR-0024 要求拥有模块拥有用途语义和正式命令，AI Gateway 只提供治理、调用和安全证据边界。
- 第一阶段只允许合成 Fixture；尚无获批的真实用途、Provider、模型、Prompt、凭据、地域、预算或保留策略。
- 模型输出是不可信、非权威 Proposal；结构校验和人工点击都不等于领域状态已改变。
- Provider 调用未来复用 `integration-runtime`，具体 Adapter 只在 `apps/api` 或 `apps/worker` 组合。

## Allowed Assumptions

- 拥有模块提供已授权的稳定资源引用、UUID operation ID 和受限结构化输入。
- 注册用途提供 JSON Schema 2020-12、不可变策略/Schema 版本引用以及硬 Token、成本、字节和 Proposal TTL 上限。
- 第一阶段 Authorizer、Budget Port 和 Fake Adapter 是进程内组合的测试实现。

## Forbidden Assumptions

- 不创建 CRM 用途、客户/员工数据、评分、摘要、Prompt 文本、真实模型或 Provider DTO。
- 不提供通用 `generate(prompt)`、任意 URL、工具/MCP、代码/SQL/文件执行、RAG、向量库、LiteLLM、LangChain 或 LangGraph。
- 不把完整输入、输出、Prompt、响应、思维链、Token、Cookie、Secret 或 Provider Payload 放入安全调用记录。
- 不允许 AI Gateway 直接调用正式领域命令或将确认事实视为业务动作成功。

## Non-goals

- 不实现 HTTP/Worker 组合、Provider Retry/Deadline、持久化、管理 UI、Prompt 发布、真实预算结算、生产指标或告警。
- 不声明内存幂等可提供跨进程/重启正确性，不创建未经确认的数据库字段和迁移。

## Allowed Paths

- `packages/platform-modules/ai-gateway/**`
- `contracts/ai/**`
- `.handoffs/AIG-01.md`

## Forbidden Paths

- `apps/api`、`apps/worker`、其他模块、根 Lockfile、生成 OpenAPI/API Client、部署配置和真实 Provider 文件。

## Contracts And Public API

- Use Case Policy V1：用途 Owner、启用状态、输入/输出 JSON Schema、版本引用及硬上限。
- AI Proposal V1：结构化输出、摘要、过期时间和不可执行语义。
- AI Call Record V1：安全版本引用、摘要、Token/成本、Proposal 和 Trace 引用，不含完整内容。
- AI Proposal Confirmation V1：实际认证主体、资源/操作/Trace 引用、决定和 `domainCommandExecuted: false`。
- 公共 TypeScript API 提供注册、调用、确认、稳定错误和 Port；Fake 只从 `./testing` 子入口导出。

## Migration And Transactions

无迁移。首个真实用途及保留/权限/加密策略未确认，故不发明调用、Proposal 或确认表。模块不持有数据库事务；未来异步调用遵循拥有模块本地事务、Outbox、RabbitMQ、Worker 路径。

## Idempotency, Retry And Failure

- 同一 operation ID 的相同语义调用共享执行并重放；语义变化返回 `ai_operation_conflict`，Trace 不参与业务语义指纹。
- 同一确认 operation ID 共享在途授权和结果；返回对象均隔离复制，调用方修改不会污染重放。
- 本任务不自动重试 Adapter，避免在结果未知时重复费用；Provider 重试留给已批准策略与 `integration-runtime`。
- 未注册/停用、无权、预算拒绝、数据策略拒绝、畸形外部 Port 结果、输出超限/Schema 错误、Proposal 不存在/过期和操作冲突均失败关闭。

## Authorization And Audit

- 调用和确认分别重新授权同一用途与资源引用；Authorizer 返回值精确校验并要求 UUID decision ID。
- 人工确认只允许 `authenticated_subject`，确认事实记录实际主体和安全上下文引用。
- AI 调用记录不替代领域审计；本任务无管理员发布/重放入口。正式命令必须由拥有模块再次读取状态、授权并审计。

## Observability And Secrets

- Call Record 只包含摘要、版本、受限引用、Token/成本和 Trace；错误只暴露固定代码与 retryable 标志。
- 模块不读取、保存或记录 Secret；禁止字段扫描覆盖 Prompt、Token、Cookie、Session、Credential、Request/Response 等键。
- 生产日志、指标、Sentry 和 Trace Adapter 留给组合任务，且不得接收完整输入/输出。

## Backward Compatibility

包此前只有 `packageId`，本次均为新增 API 和 V1 Schema；没有既有消费者、数据表或迁移。契约和实现字段采用精确运行时校验，后续变更必须版本化。

## Required Tests And Evidence

- 未注册/运行时非法用途；Schema 和禁止字段；授权/预算拒绝。
- 合成调用、非权威 Proposal、安全 Call Record、输出/用量异常。
- 调用与确认幂等、并发共享、语义冲突、调用方修改隔离。
- Proposal 过期、确认重新授权、系统主体拒绝、正式命令阻断。
- 包 lint/typecheck/test、仓库 contracts check 和完整 `pnpm check`。

## Owner Self-review

- Authorization：调用/确认分离授权，确认仅认证主体；不创建伪权限代码。
- Idempotency：规范化 JSON 指纹与在途 Promise 去重；结果隔离复制；无跨进程持久化声明。
- Transactions：无数据库或领域事务；不泄露事务句柄，不绕过 Outbox 路径。
- Migrations：存储模型未确认，明确无迁移和后续前置条件。
- Observability：只返回有界安全元数据；无内容、凭据、原始载荷或任意字符串日志。
- Backward Compatibility：纯新增 V1 契约/API，无已有消费者破坏。
- Secrets：不接收 Provider Secret；禁止敏感键和值进入 Fixture/记录。
- Failure Modes：拒绝、冲突、过期、预算、畸形端口、超限和结构失败均有稳定错误并失败关闭。

自审修复包括：规范化对象中的 `undefined` 指纹缺陷、JSON 纯对象/访问器边界、Authorizer/Budget/Adapter 精确返回校验、Call Record 契约字段缺失、并发确认重复授权、系统主体可确认、确认事实缺少实际主体/上下文、重放对象可被调用方修改，以及确认/用途契约覆盖不足。

## Unresolved Questions

- 首个真实用途、Owner、数据边界、Provider 地域/合同、模型/Prompt、预算、保留、授权和验收集尚未批准。
- 持久化 Schema、跨进程幂等、调用状态查询、取消/迟到结果、费用对账和失败记录保留等待首个真实用途设计。
- 本任务完成独立 Review 前不得标记 `G2_ACCEPTED`。
