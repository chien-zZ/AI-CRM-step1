# 接口契约说明

存放面向开发者和业务人员的接口说明。机器可读的唯一契约位于根目录 `contracts/`。

## 工具链

- OpenAPI 源文件按模块放在 `contracts/http/modules/*.openapi.yaml`。
- 每个 Operation 必须显式声明 `x-ai-crm-audiences`；只有标记为 `external` 的 Operation 才能进入外部 Bundle 和 Client。
- JSON Schema 使用 Draft 2020-12，并通过包含 `/vN/` 的 `$id` 明确主版本。
- RabbitMQ 拓扑只放在 `contracts/asyncapi/`；领域事件和私有 Job Payload 分别属于 `contracts/events/` 与 `contracts/jobs/`。
- `pnpm contracts:generate` 确定性生成内部/外部 OpenAPI Bundle 和 Client。生成文件带标识及 SHA-256 Manifest，不得手工编辑。
- `pnpm contracts:check` 校验源契约、受众隔离和生成制品。生成文件有任何修改或缺失时检查失败。

兼容性评审以源契约为对象：删除或重命名 Operation、收紧输入、放宽既有错误语义、删除 Schema 字段或改变字段类型均按潜在破坏性变更处理。正式自动兼容基线将在首个发布契约冻结后加入；当前不得把尚无发布基线解释为可任意破坏契约。
