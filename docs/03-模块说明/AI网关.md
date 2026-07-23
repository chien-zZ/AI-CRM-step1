# AI 网关

- 模块位置：`packages/platform-modules/ai-gateway`
- 运行入口：`apps/api`、`apps/worker`
- 类型：业务中立平台模块
- 状态：边界与第一阶段范围已确认，公开契约、存储和实现待评审
- 架构依据：ADR-0003、ADR-0010、ADR-0020、ADR-0024

## 自研与开源边界

- 项目自研用途注册、Prompt/模型版本、数据策略、预算、调用记录、输出校验和人工确认语义。
- 输入/输出使用 JSON Schema 2020-12 和 Ajv。
- 外部调用复用 `integration-runtime`；模型协议使用未来供应商官方 SDK/REST Adapter。
- 第一阶段不使用 LiteLLM、LangChain/LangGraph、向量数据库或真实模型服务。

## 职责

- 注册并验证业务中立 AI 用途治理元数据。
- 解析批准的 Prompt、模型和数据策略版本。
- 校验最小输入、禁止字段、大小、预算和调用授权。
- 路由到 Fake 或未来批准的 Provider Adapter。
- 校验模型输出并产生非权威 Proposal。
- 记录安全调用元数据、用量、成本、失败和人工处理结果引用。
- 为测试提供确定性 Fixture 和故障注入。

## 非职责

- 不拥有客户、订单、人员、任务、审批或其他领域事实。
- 不决定 AI 用途的业务含义、评分标准或确认后的领域动作。
- 不执行任意 Prompt、URL、SQL、脚本、文件、MCP 或领域命令。
- 不默认保存完整输入、Prompt、输出或供应商调试载荷。
- 不把结构校验通过、模型置信文本或人工点击当成业务状态已改变。

## 公开能力方向

- 提交已注册用途的同步或异步请求，必须携带幂等键和安全资源引用。
- 查询调用与非权威 Proposal 的安全状态。
- 解析用途允许的输出 Schema 和人工确认要求。
- 由授权管理员注册/发布 Prompt、模型策略、预算和数据政策版本。
- 由拥有模块提交人工处理结果引用；正式领域命令不由本模块执行。

具体接口先在 `contracts/ai/` 评审。不得提供通用 `generate(prompt)` 或让客户端选择任意模型、System Prompt 和 Provider 参数。

## 数据所有权

- AI 用途治理注册和技术策略版本。
- Prompt 发布制品或其受控引用、模型路由策略和数据政策版本。
- 调用元数据、用量、技术成本、错误、安全摘要和 Proposal 技术状态。
- 人工确认/拒绝/修改的引用，不拥有确认后产生的领域事实。

具体表结构和内容保留等待首个用途验证。完整输入/输出默认不持久化。

## 依赖方向

- 拥有模块通过 `platform-sdk` 和正式 AI 契约调用。
- `ai-gateway` 可以依赖 `integration-runtime`、配置、数据库、事件、审计和可观测公共入口。
- Provider Adapter 由 `apps/api` 或 `apps/worker` 注入。
- 领域模块不得依赖 AI Provider SDK、Adapter、AI 网关表或 Prompt 存储。

## 失败模式

- 用途未注册/停用、无权调用、数据政策拒绝、预算或并发超限。
- Prompt/模型/Schema 版本不存在或不兼容。
- Provider 超时、429、5xx、内容拒绝、结构错误、迟到结果或用量异常。
- Proposal 已过期、资源状态变化、确认人无权或正式领域命令拒绝。

所有失败保留稳定类别，默认失败关闭。Provider 或 Sentry 不可用不能导致敏感内容写入替代日志。

## 第一阶段范围

- 模块与契约骨架、Fake Adapter 约定、合成 Fixture 和治理测试方向。
- 业务中立 Proposal/人工确认 walking skeleton。
- 不含真实模型、Prompt、CRM 用途、RAG、工具或生产数据。

## 待确认

- 公开接口、状态、存储、权限和迁移。
- 首个真实用途及验收集。
- Provider、模型、地域、预算和内容安全方案。
