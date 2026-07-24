# FND-02 契约工具链

- Status: completed
- Owner: 当前会话（契约源与生成制品单一 Owner）
- Allowed paths: `contracts/`、`packages/api-client`、`scripts/check/`、`docs/05-接口契约/`

## 已知事实

- 当前契约目录只有说明文件，没有机器可读源契约或生成制品。
- 当前阶段不得创建未经确认的业务字段或外部业务端点。

## 允许的假设

- 可以用业务中立的技术健康端点建立最小 OpenAPI 生成链路。
- 外部 Allowlist 在没有获批外部端点时生成空 `paths` 契约。

## 禁止的假设

- 不暴露 Provider DTO、Flowable Payload、数据库 Row 或内部端点到外部 Client。
- 不把 RabbitMQ 拓扑写入领域事件 Schema。

## 非目标

- 不定义 CRM HTTP、事件、Job、权限、表单、配置、通知、集成或 AI 业务契约。

## 验证

- `pnpm contracts:generate` 生成内部/外部 OpenAPI Bundle、两个 Client 入口和 SHA-256 Manifest。
- `pnpm contracts:check` 通过 OpenAPI 3.1、JSON Schema 2020-12、版本化 `$id`、AsyncAPI 3.0 和受众声明校验。
- 两次渲染结果一致；自动化测试把生成制品复制到系统临时目录后实施篡改，检查明确失败且不修改真实工作树。
- 外部 Bundle 的 `paths` 为空，外部 Client 操作列表为空，不包含两个内部健康端点。

## 独立审查

- Authorization: 每个 Operation 强制声明受众，外部制品仅允许显式 `external` 操作。
- Idempotency/Transactions/Migrations: 当前只有只读技术健康契约，不适用。
- Observability: 生成过程不记录契约请求正文或运行数据。
- Backward compatibility: 开发文档明确破坏性变更方向；首个发布基线冻结前不虚构历史兼容基线。
- Secrets: 契约和生成制品不含 Secret。
- Failure modes: 重复 Path、无受众、无版本 `$id`、无效规范、缺失或被修改的生成制品均失败关闭。

## 未解决问题

- 无获批外部端点，因此外部 Client 仅保留生成边界，不含操作。
