# 第一阶段 AI 能力范围

- 状态：已批准
- 日期：2026-07-23
- 适用阶段：公共技术底座与业务无关 walking skeleton
- 架构依据：ADR-0010、ADR-0020、ADR-0022、ADR-0023、ADR-0024

## 第一阶段建立

- 业务中立 `ai-gateway` 模块和供应商中立 `contracts/ai` 目录。
- AI 用途注册、输入/输出 JSON Schema、数据政策、Prompt/模型版本和预算语义。
- Fake Model Adapter 与合成 Fixture。
- 调用元数据、Token/成本、错误分类、数据策略结果和安全 Trace 方向。
- 非权威 `AiProposal` 和服务端人工确认边界。
- Outbox/RabbitMQ/Worker 默认异步链路及同步调用限制。

## 自研、开源与托管边界

- 自研：AI 网关治理、用途/版本/预算/调用记录、人工确认和平台 SDK 边界。
- 开源：JSON Schema 2020-12、Ajv、OpenTelemetry 和现有 `integration-runtime` 技术依赖。
- 托管：未来批准的模型推理服务，经独立 Provider Adapter 接入。
- 不采用：第一阶段 LiteLLM、LangChain/LangGraph、Agent/RAG 平台、向量数据库或自建模型推理。

## 第一阶段不交付

- 真实模型账号、Secret、Provider Adapter 和生产 AI 调用。
- 客资评级、跟进摘要、员工绩效、销售分配、职业规划等业务用途或 Prompt。
- 向量库、知识库、联网搜索、多模态、工具调用、MCP、SQL、代码或文件执行。
- 自动修改领域状态、自动审批、自动授权或无人确认的高风险建议执行。
- 上传真实客户/员工数据、完整 Prompt/响应或供应商调试载荷到日志/Sentry。

## 启用门禁

- 确认用途 Owner、输入/输出、数据分类、模型地域、合同、保留、预算、验收集和人工确认责任。
- 契约先于实现，使用合成数据完成质量、安全、成本、延迟和失败测试。
- Provider Adapter 通过官方协议、Secret、超时、重试、用量和退出方案评审。
- 生产输出只能形成非权威 Proposal，正式业务影响由拥有模块重新授权和确认。

## 非目标

- 本基线不把“全 AI 开发”扩展为运行时 AI 的生产数据访问权限。
- 本基线不定义任何 CRM 实体、字段、评分或业务决策。
