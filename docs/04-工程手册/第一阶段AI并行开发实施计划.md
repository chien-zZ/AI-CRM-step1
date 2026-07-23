# 第一阶段 AI 并行开发实施计划

- 状态：已批准实施基线
- 日期：2026-07-23
- 适用范围：公共技术底座、业务中立 Walking Skeleton、第一阶段 AI 并行开发任务拆分与合并
- 关联验收：[第一阶段 Walking Skeleton 验收清单](../06-质量验收/第一阶段Walking-Skeleton验收清单.md)
- 架构依据：ADR-0001～ADR-0024，以及 `docs/01-权威与基线/`、`docs/03-模块说明/` 和根 `AGENTS.md`

## 1. 文档目的与使用方式

本文将第一阶段拆成可由多个 AI Agent 独立开发、独立测试、按依赖合并的工作包。它回答以下问题：

- 第一阶段必须真正实现什么。
- 哪些能力只建立契约、Fake 和故障测试。
- 哪些内容必须等待业务调研。
- 哪些工作可以并行，哪些必须串行。
- 每个 Agent 可以修改哪些目录，必须输出什么证据。
- 在什么合并门之后，后续工作包才能启动。

本文不替代 ADR、契约或模块说明。发生冲突时按根 `AGENTS.md` 的权威顺序处理。AI Agent 在开始任务前必须读取与自身工作包直接相关的 ADR、契约、模块说明和本计划，不得只依赖任务提示中的摘要。

## 2. 当前已知事实

- 当前范围是公共技术底座与业务中立 Walking Skeleton。
- `packages/domain-modules/` 必须保持为空，直到真实业务边界被确认。
- 仓库已经建立应用、平台模块、契约、部署和文档目录，但大多数目录只有 README，没有可运行实现。
- 当前 `pnpm check` 通过，但 Turbo 显示 0 个包级任务，不能视为工程实现完成。
- PC Web 使用 React 19、Vite、Ant Design 6 和 ProComponents。
- PC Web 的设计与交互参照[PC 工作台 Demo 参考基线](./PC工作台Demo参考基线.md)，但不继承 Demo 的 Umi Max、Mock Store、业务模型或业务规则。
- 内部移动端使用 Taro H5；外部端使用独立 Taro 应用输出 H5 与微信小程序。
- 后端使用 NestJS、PostgreSQL、Drizzle、RabbitMQ、Redis、Keycloak、Flowable 和 ClamAV。
- 生产方向为两台腾讯云 Ubuntu CVM、自托管 Docker Compose、Nginx 入口。
- 第一阶段只使用 Keycloak 标准登录，不启用企微或微信真实登录。
- 第一阶段通知只实现 PC 站内通知与轮询。
- 第三方集成与 AI 只实现业务中立运行时、契约、Fake/Stub 和故障测试，不接真实供应商。
- 当前工作目录没有 Git metadata。安排多 Agent 并行修改前，项目负责人必须先建立或连接正式版本控制仓库、分支和合并机制。

## 3. 允许的假设

- 使用合成用户、组织、权限、表单、流程、文件和通知 Fixture 验证平台能力。
- Walking Skeleton 可以使用仅存在于 `tests/` 的测试来源适配器，不创建生产 `demo-crm` 领域模块。
- 第一阶段可先锁定满足 ADR 的具体开源库版本，再通过依赖评审和契约测试固定。
- 多个 AI Agent 可以在契约冻结后并行开发不同模块。
- 本地和 CI 可以使用 Docker Compose 启动开源组件；预发布使用真实测试 COS Bucket 验证存储 Adapter。

## 4. 禁止的假设

- 不得创建 Lead、Customer、Order、Settlement、Product、Partner、Student、Dashboard 等 CRM 领域模块。
- 不得从历史讨论或常见 CRM 产品推断实体、字段、状态、角色、SLA、审批路线、归属和指标口径。
- 不得为企微、微信、短信、支付、课程平台、题库或真实模型创建伪 Adapter、DTO、Webhook、账号或 Secret。
- 不得把测试 Fixture 提升为生产业务模型。
- 不得让领域或平台模块直接依赖 Keycloak、Flowable、RabbitMQ、Redis、COS、Sentry 或模型供应商 SDK。
- 不得跨模块查询表、传递 Drizzle Schema/Transaction、深层导入或共享内部异常类型。
- 不得让 Flowable、任务中心、通知中心、Integration Runtime 或 AI Gateway 直接修改未来领域表。
- 不得在没有契约和迁移评审时由多个 Agent 同时编辑同一 Schema、OpenAPI 文件或组合根。
- 不得在第一阶段引入 Kubernetes、APISIX、Vault、Prometheus/Grafana、LiteLLM、LangChain、RAG 或向量数据库。

## 5. 非目标

- 不交付真实 CRM 业务流程。
- 不交付企微/微信联合登录、外部邀请流程或匿名业务端点。
- 不交付外部通知渠道、支付、退款、短信或其他供应商调用。
- 不交付真实 AI 用途、Prompt、知识库、Agent 或自动决策。
- 不承诺生产高可用、SLA、RPO 或 RTO 数值。
- 不在本计划中给出日历排期或人员工时。

## 6. 第一阶段目标结果

第一阶段最终必须证明以下能力可以形成一条稳定链路：

```text
Keycloak 标准登录
  → BFF 服务端会话
  → 内部主体/人员/Employment/Assignment 解析
  → 功能权限与数据范围校验
  → PC 工作台加载应用注册、任务与通知
  → 版本化表单渲染和服务端校验
  → Flowable 测试流程与人工任务
  → 统一任务投影
  → 文件上传、扫描和稳定引用
  → Outbox/RabbitMQ/Inbox/Worker
  → 任务状态与通知更新
  → 审计、日志、Trace、健康和失败恢复证据
```

这条链路必须使用测试专用合成来源，不能创建正式业务实体。

## 7. 第一阶段实现深度分类

### 7.1 必须达到可运行、可持久化、可测试水平

- 工程构建、Lint、Typecheck、Test、Contract Check 与生成工具。
- `apps/api`、`apps/worker`、`apps/workbench-web`。
- `packages/config`、`packages/database`、`packages/observability`、`packages/platform-sdk`。
- Keycloak 标准登录、PC Web BFF、H5 会话适配骨架。
- `auth-context`、`organization`、`authorization`。
- PostgreSQL + Drizzle + 版本化迁移。
- `eventing-outbox`、RabbitMQ 消费/发布、Inbox 幂等、Redis 短期协调。
- `workflow`、Flowable Facade、BPMN 版本化。
- `task-center`、`notifications`、`audit`、`app-registry`。
- `form-schema`、`business-configuration`、`file-center`。
- Pino、Sentry、Trace Context、健康检查和 Docker 日志轮转。
- 本地/CI Compose、部署配置骨架、Secret 文件引用和备份恢复说明。

### 7.2 必须构建应用壳层，但不承载真实业务

- `apps/internal-mobile`：Taro H5、独立构建、路由、会话、错误、API Client 和最小任务/通知/表单展示。
- `apps/external-portal`：Taro H5 + 微信小程序双产物、独立网络/会话/路由 Adapter、外部 Allowlist Client 和安全错误边界。

### 7.3 只实现契约、Fake、测试工具和失败语义

- `integration-runtime`：Deadline、错误分类、Retry Budget、限流、熔断、Webhook 安全接口、Fake/Stub 和故障注入。
- `ai-gateway`：用途/策略/版本/预算/Proposal 契约、Fake Model Adapter、合成 Fixture 和人工确认阻断语义。
- 微信小程序不透明会话适配骨架：不建立真实微信主体。

### 7.4 必须等待业务调研

- 所有 CRM 领域模块。
- 首个外部业务场景、匿名/邀请/长期登录选择。
- 真实审批路线、业务状态、SLA、通知模板与收件角色。
- 企微、微信、短信、支付和其他第三方 Provider。
- 真实 AI 用途、模型、Prompt、知识库和工具。

## 8. 合并门与整体顺序

第一阶段不按日历推进，而按以下合并门推进。

### G0：版本控制和任务治理门

启动条件：项目负责人准备开始多 Agent 并行开发。

必须完成：

- 建立正式 Git 仓库或连接现有远程仓库。
- 保护主分支，禁止 AI Agent 直接无审查覆盖主分支。
- 确定分支/Worktree、Commit、Review 和合并策略。
- 为每个工作包分配唯一 Task ID、Owner 和允许修改路径。
- 建立 `.handoffs/<task-id>.md`，记录假设、决策和未解决问题。
- 明确契约、迁移、组合根和 Lockfile 的单一 Owner。

未通过 G0，不允许多个 Agent 在同一目录并行修改。

### G1：工程与契约基础门

必须完成：FND-01、FND-02、INF-01、DAT-01 的公共入口和最低测试。

通过后可以并行启动 IAM、ASY、PLT、CLI、OPS、INT 和 AIG 工作轨道。

### G2：模块公共接口门

每个模块需要：

- 已评审公共入口。
- 已评审契约。
- 单元/契约测试。
- 模块内部迁移。
- 授权、审计、幂等和失败语义说明。
- 不依赖其他模块内部实现。

通过后才允许进入 `apps/api`/`apps/worker` 组合。

### G3：应用组合门

必须完成：CMP-01，以及三个客户端的构建与 API Client 接入。

通过后启动 E2E-01。

### G4：Walking Skeleton 验收门

执行完整端到端、安全、幂等、故障和可观测验收。通过后进入 OPS-02 发布与恢复验收。

### G5：第一阶段完成门

满足本文第 18 节和质量验收文档的所有强制项，才能开始第一个正式 CRM 领域模块。

## 9. 并行工作轨道总览

| 轨道 | 工作包 | 主要产出 | 前置依赖 |
|---|---|---|---|
| 基础工程 | FND-01、FND-02 | Workspace、包脚本、契约生成、边界检查 | G0 |
| 基础设施 | INF-01、INF-02、DAT-01 | Compose、配置、Secret、观测、Drizzle | G0 |
| 身份授权 | IAM-01～IAM-03 | Keycloak/BFF、组织、授权 | G1 |
| 异步流程 | ASY-01、PRC-01～PRC-03 | Outbox、Workflow、Task、Notification | G1 |
| 通用平台 | PLT-01～PLT-03 | Audit/App Registry、Form/Config、File | G1 |
| 客户端 | CLI-01～CLI-03 | PC、内部 H5、外部 H5/weapp | G1 和相关契约 |
| 外部运行时 | INT-01 | Integration Runtime + Fake | G1 |
| AI 治理 | AIG-01 | AI Gateway + Fake Proposal | G1 |
| 应用组合 | CMP-01 | API/Worker Composition Root | 各模块 G2 |
| 质量验收 | E2E-01、OPS-01、OPS-02 | E2E、部署、恢复、安全证据 | G3/G4 |

## 10. 基础工程工作包

### FND-01：Workspace 与包执行基线

**目标**

让所有应用和包成为真实 Workspace Package，使 Turbo 能执行实际任务。

**允许修改**

- 根 `package.json`、`pnpm-workspace.yaml`、`turbo.json`。
- `packages/eslint-config`、`packages/tsconfig`、`packages/test-config`。
- 各应用/包的 `package.json`、`tsconfig.json` 和最小公共入口。
- `scripts/check/` 中仓库结构与依赖规则检查。

**产出**

- Node 24 与 pnpm 版本校验。
- 统一 `build/lint/typecheck/test/contracts:check` 脚本。
- TypeScript Project Reference 或经评审的等价方案。
- 包边界、深层导入和循环依赖检查。
- 统一测试环境和覆盖率输出。

**禁止**

- 添加业务实体或业务依赖。
- 为让构建通过而关闭严格 TypeScript、Lint 或测试失败。
- 在多个包重复定义相同配置。

**验收**

- `pnpm check` 执行真实包级任务。
- 任意非法深层导入测试会失败。
- 每个包可以独立构建并只通过公共入口导入。

### FND-02：契约工具链

**目标**

建立 HTTP、事件、Job、权限、表单、配置、通知、集成和 AI 契约的校验与生成流程。

**允许修改**

- `contracts/`、`packages/api-client`、`scripts/check/` 和生成配置。
- `docs/05-接口契约/` 中面向开发者的说明。

**产出**

- 模块拆分 OpenAPI 源文件与生成 Bundle。
- 内部 Client 和外部 Allowlist Client 独立生成。
- JSON Schema 校验和版本检查。
- AsyncAPI/RabbitMQ 拓扑描述规则。
- Generated 文件标识和禁止手工编辑检查。
- 契约兼容性与破坏性变更检查方向。

**禁止**

- 创建未经确认的业务字段。
- 把 RabbitMQ 拓扑放入领域事件 Schema。
- 把 Provider DTO、Flowable Payload 或数据库 Row 暴露为公共契约。

**验收**

- 源契约改变能稳定生成相同制品。
- 修改生成文件后检查失败。
- 外部 Client 不包含内部或管理端点。

## 11. 基础设施与数据工作包

### INF-01：本地与 CI Compose

**目标**

一条受控命令启动开发/测试所需开源组件。

**允许修改**

- `deploy/compose`、`deploy/keycloak`、`deploy/flowable`、`deploy/nginx`、相关运维脚本和说明。

**产出**

- 固定版本的 PostgreSQL、Redis、RabbitMQ、Keycloak、Flowable、ClamAV、Nginx 定义。
- 健康检查、Volume、网络、资源限制和日志轮转。
- 开发/测试初始化配置，不含生产 Secret。
- 可清理的测试数据和可重复启动说明。

**禁止**

- 使用 `latest`、默认生产密码或公开状态服务端口。
- 在 Compose 中写入生产 Secret。
- 使用 APISIX、Kubernetes 或 Swarm。

**验收**

- 全新环境可重复启动和停止。
- 健康检查能区分启动中、就绪和失败。
- 删除测试环境不会影响任何生产或共享数据。

### INF-02：配置、Secret 与可观测

**目标**

建立类型化配置、文件式 Secret、Pino、Sentry Adapter、Trace Context 和健康约定。

**允许修改**

- `packages/config`、`packages/observability`、`deploy/secrets`、`deploy/observability`。

**产出**

- 非 Secret 环境变量 Schema。
- `*_FILE` Secret 读取、格式校验和失败关闭。
- Pino 单行 JSON、稳定字段和递归脱敏。
- W3C Trace Context 提取、生成和传播。
- Sentry 薄 Adapter、Release/Environment 和数据清洗。
- Liveness/Readiness/Deep Diagnostic 公共约定。

**禁止**

- 提交真实 Secret、DSN、Token 或生产路径文件。
- 让领域模块导入 Pino、Sentry 或云厂商 SDK。
- 记录请求正文、Cookie、Token、客户内容或供应商载荷。

**验收**

- Secret 缺失、空值、权限错误和格式错误测试通过。
- 脱敏测试覆盖嵌套对象、数组、Cause 和循环引用。
- Sentry 不可用不阻断请求。

### DAT-01：PostgreSQL、Drizzle 与迁移

**目标**

建立按模块拥有 Schema/Repository 的数据访问与事务基础。

**允许修改**

- `packages/database`、迁移工具、测试数据库 Fixture。
- 不同平台模块自己的 `src/infrastructure` 与迁移目录，但需由相应模块 Owner 配合。

**产出**

- Drizzle Client 和连接池。
- 模块 Schema 命名、迁移编号和执行顺序规则。
- Repository/Transaction 公共技术接口，但不把 Transaction Handle 暴露跨模块。
- 迁移 Check、空库升级、已部署版本追加迁移测试。
- 测试数据库隔离和清理工具。

**禁止**

- `drizzle-kit push` 用于共享环境。
- 跨模块外键或查询其他模块表。
- 修改已经执行的迁移。
- 创建 CRM 业务表。

**验收**

- 空库能升级到最新版本。
- 模块迁移失败不会留下伪成功状态。
- 破坏性迁移检查和恢复说明存在。

## 12. 身份与授权工作包

### IAM-01：Keycloak、BFF 与 Auth Context

**目标**

完成 Keycloak 标准登录与 PC Web BFF 主链路，并建立其他客户端会话适配骨架。

**允许修改**

- `packages/platform-modules/auth-context`。
- `apps/api` 中认证组合与 BFF Adapter。
- `deploy/keycloak`、相关 HTTP/错误契约。

**产出**

- Keycloak Realm/Client 配置即代码。
- 登录、回调、刷新、注销和强制失效。
- HttpOnly/Secure/SameSite Cookie、CSRF 和 Session Fixation 防护。
- Keycloak Token 服务端存储与加密引用。
- Transport-neutral Principal Context。
- H5 隔离会话 Adapter 和小程序不透明句柄接口骨架。

**禁止**

- 自建密码、JWT 或 Refresh Token 体系。
- 客户端接收 Keycloak Token。
- 企微/微信真实登录和伪提供商映射。

**验收**

- 登录、刷新、注销、过期、撤销、CSRF 和错误回调测试通过。
- 日志/Sentry 不出现 Token、Cookie 或授权码。

### IAM-02：Organization

**目标**

实现人员、Employment、组织、岗位、Assignment 和内部主体关联的最小有效期模型。

**允许修改**

- `packages/platform-modules/organization`、其契约和模块迁移。

**产出**

- Workforce Person、Employment、Organization Unit、Position、Assignment。
- Keycloak `issuer + sub` 到 Person 的有效关联。
- 有效区间与历史不可覆盖规则。
- 当前人员/任职解析公共接口。
- 合成组织 Fixture。

**禁止**

- 真实公司部门、岗位、人数或层级。
- 根据姓名、手机号、邮箱、企微 userid 自动模糊关联。
- 在组织模块保存客户归属或绩效规则。

**验收**

- 无关联、多重关联、Employment 失效和 Assignment 失效场景失败语义正确。
- 转岗和并行任职保留历史。

### IAM-03：Authorization

**目标**

实现轻量、显式、供应商中立的功能权限和结构化数据范围核心。

**允许修改**

- `packages/platform-modules/authorization`、`contracts/permissions`、`platform-sdk` 对应入口。

**产出**

- 权限注册、角色权限包和有效授权。
- Check、Batch Check 和 Data Scope Resolution。
- 服务端 Guard/Facade 和拒绝错误。
- Redis 缓存和版本化失效。
- 授权决策审计引用。

**禁止**

- 硬编码角色名称。
- SQL 片段式 Data Scope。
- 前端显隐替代后端授权。
- 创建真实销售、财务或管理角色。

**验收**

- 允许、拒绝、缓存失效、多任职切换和未知权限默认拒绝测试通过。

## 13. 异步与流程工作包

### ASY-01：Eventing、Outbox 与 Inbox

**目标**

实现数据库事务到 RabbitMQ，再到幂等消费者的可靠链路。

**允许修改**

- `packages/platform-modules/eventing-outbox`、`contracts/events`、`contracts/jobs`、`contracts/asyncapi`。
- `apps/worker` 中发布器和消费者组合入口，需在 CMP-01 合并门统一审查。

**产出**

- 传输中立事件信封校验。
- Outbox 事务写入与 Publisher Confirm。
- Inbox 去重与消费者本地事务包装。
- 重试、死信、隔离、重放和对账接口。
- Worker Job 幂等、取消和执行前状态重检约定。

**重点故障测试**

- DB 成功、RabbitMQ 失败。
- RabbitMQ 成功、发布状态未更新。
- 消费成功、ACK 丢失。
- 重复、乱序、未知版本和死信。
- Redis 不可用。

### PRC-01：Workflow Facade

**目标**

通过稳定契约隔离 Flowable。

**允许修改**

- `packages/platform-modules/workflow`、`deploy/flowable`、BPMN 测试资产和工作流契约。

**产出**

- 流程定义部署/版本、实例启动/查询、人工任务操作。
- Flowable 错误映射、变量白名单和超时。
- 测试专用 BPMN，不包含真实审批路线。
- 完成事件/命令边界，不直接写其他模块表。

**验收**

- 重复启动、重复完成、已取消任务、未知版本和 Flowable 不可用测试通过。

### PRC-02：Task Center

**目标**

形成可重放、可对账的统一任务投影。

**允许修改**

- `packages/platform-modules/task-center`、任务 HTTP/事件契约和模块迁移。

**产出**

- Task Projection 创建、更新、完成、取消和查询。
- 来源版本、幂等、乱序保护和对账。
- 命令路由回来源模块。
- 应用注册深链引用。

**禁止**

- 直接完成 Flowable Task。
- 将通知已读视为任务完成。
- 存任意 URL。

### PRC-03：Notifications

**目标**

完成 PostgreSQL 站内通知与 PC 轮询链路。

**允许修改**

- `packages/platform-modules/notifications`、`contracts/notifications`、相关 HTTP/事件契约和迁移。

**产出**

- Notification Intent、收件人快照、站内通知、已读/归档。
- Mustache 模板、变量 Schema 和不可变版本。
- 幂等、偏好、调度、重试、死信和对账。
- PC Web 列表、详情和未读数接口。

**禁止**

- 企微、微信、短信、邮件、WebSocket、SSE。
- 真实 CRM 通知类型和模板。

## 14. 通用平台工作包

### PLT-01：Audit 与 Application Registry

**目标**

建立追加式安全审计和工作台应用/路由注册。

**允许修改**

- `packages/platform-modules/audit`、`packages/platform-modules/app-registry`、对应契约和迁移。

**产出**

- Actor/Action/Resource/Result/Reason/Trace 审计模型。
- 受控 Before/After 差异和敏感访问审计入口。
- 应用、导航、Route ID、启用状态和权限引用。
- Task/Notification 深链解析和目标重新授权。

**禁止**

- 从 Pino/Sentry 自动猜测审计事实。
- 任意 URL、内部管理路由泄漏给外部端。

### PLT-02：Form Schema 与 Business Configuration

**目标**

实现版本化表单、字典和参数的业务中立控制面。

**允许修改**

- `packages/platform-modules/form-schema`、`business-configuration`。
- `contracts/forms`、`contracts/configuration` 和模块迁移。

**产出**

- JSON Schema 2020-12、Ajv 严格校验和受控 UI Schema。
- 草稿、不可变发布版本、内容摘要和历史解析。
- Dictionary/Parameter 定义、版本、生效区间和解析结果版本。
- Redis 缓存、Outbox 失效和审计。
- 合成 Schema/字典/参数 Fixture。

**禁止**

- 真实 CRM 字段、字典、SLA 或状态。
- 远程 `$ref`、脚本、SQL、任意表达式和完整低代码平台。
- Secret 进入业务配置。

### PLT-03：File Center

**目标**

实现文件控制面、本地/COS Adapter、ClamAV 扫描和稳定引用。

**允许修改**

- `packages/platform-modules/file-center`、文件契约、模块迁移、Worker 文件任务。

**产出**

- File Metadata、Upload Session、Content Version、Resource Link。
- 本地文件 Adapter 与 COS Adapter 公共契约。
- 预签名上传、状态确认、授权下载。
- ClamAV 扫描、隔离、清理和对账。
- Stable `FileReference`。

**禁止**

- 向业务或客户端暴露 Bucket、Object Key、COS Secret 或永久 URL。
- 将二进制存入 PostgreSQL。

**验收**

- 正常、重复、恶意、超大、中断上传和扫描服务不可用测试通过。
- 预发布使用真实测试 Bucket 完成 Adapter 契约测试。

## 15. 客户端工作包

### CLI-01：PC Workbench Web

**目标**

建立可操作的内部 PC 工作台壳层。

实施前必须阅读[PC 工作台 Demo 参考基线](./PC工作台Demo参考基线.md)。Demo 用于保持既有工作台的信息密度、导航层级、页面模式和交互连续性，不改变 ADR-0001 的正式技术栈。

**允许修改**

- `apps/workbench-web`，以及经证明确需复用的 `packages/shared-ui`。

**产出**

- React 19、Vite、Ant Design 6、ProComponents、React Router、TanStack Query。
- ProLayout、应用导航、登录入口和 Session 恢复。
- 当前人员/任职上下文。
- 权限路由和按钮显示；后端仍最终授权。
- 任务、通知、表单和文件的业务中立页面。
- 403/404/500/离线/维护状态和 URL 状态恢复。
- OpenAPI 生成 Client，禁止手写重复 DTO。
- 延续 Demo 的紧凑工作区、清晰两级信息架构、任务/通知主从视图和具体操作反馈；明显差异记录在任务交接中。
- Demo 机制到 React Router、TanStack Query、Assignment Context、Application Registry 和服务端 Command 的显式映射及测试。

**禁止**

- Umi Max、HeroUI、客户端保存 Keycloak Token。
- CRM 菜单、页面和字段。
- 复制 Demo 的 `/dept3/*` 路由、角色常量、Mock、Action Engine、`localStorage` 业务状态、AI 助手或多主题实验。

### CLI-02：Internal Mobile

**目标**

建立 Taro H5 内部移动壳层并验证独立会话与 Client。

**允许修改**

- `apps/internal-mobile`，只通过公开契约共享代码。

**产出**

- Taro、React、TypeScript、NutUI React。
- H5 构建、路由、网络、会话、错误、弱网和文件 Adapter。
- Keycloak 标准登录回退和 BFF Cookie。
- 最小任务、通知、表单展示。

**禁止**

- 企微 OAuth、原生 App、Ant Design/ProComponents。
- 导入 `external-portal/src` 或 PC Web 私有代码。

### CLI-03：External Portal

**目标**

建立外部 H5/weapp 独立产物和最小暴露面。

**允许修改**

- `apps/external-portal`、外部 Allowlist Client 生成配置。

**产出**

- H5 与微信小程序构建。
- 目标特定 Session、Network、Navigation、File Adapter。
- 外部错误最小披露、隐私和环境配置骨架。
- H5 BFF 与小程序不透明句柄适配接口。

**禁止**

- 匿名业务端点、邀请表、外部用户模型、微信真实登录。
- 内部 API、菜单和管理功能。

## 16. Integration Runtime 与 AI 工作包

### INT-01：Integration Runtime

**目标**

建立供应商中立的技术韧性和 Webhook 安全原语。

**允许修改**

- `packages/platform-modules/integration-runtime`、`contracts/integrations` 和测试工具。

**产出**

- Deadline、错误分类、Retry Budget、退避、限流、熔断。
- Redaction、Trace、Fake/Stub 和故障注入。
- Webhook 原始报文、验签、时间戳/Nonce、防重放接口。

**禁止**

- 真实 Provider、任意 URL Executor、供应商 DTO 或 Webhook 端点。
- 第二套消息队列或业务编排器。

### AIG-01：AI Gateway Fake

**目标**

验证 AI 用途治理、结构化输出和人工确认阻断，不调用真实模型。

**允许修改**

- `packages/platform-modules/ai-gateway`、`contracts/ai` 和合成测试 Fixture。

**产出**

- Use Case、数据/Prompt/模型策略版本引用。
- 输入/输出 JSON Schema。
- Fake Model Adapter。
- Token/成本/错误元数据。
- 非权威 Proposal、过期和人工确认要求。
- 未确认 Proposal 不能执行正式命令的服务端测试。

**禁止**

- 真实 Provider、CRM Prompt、RAG、工具、MCP、LiteLLM 或 LangChain。
- 完整 Prompt/响应进入日志或数据库。

## 17. 组合、E2E 与运维工作包

### CMP-01：API 与 Worker 组合根

**目标**

只在模块公共接口稳定后组合运行应用。

**允许修改**

- `apps/api`、`apps/worker` 的 Composition Root、Module Wiring、启动和健康入口。

**产出**

- 平台模块依赖注入。
- HTTP、BFF、Workflow、通知、文件和测试 Fixture 入口。
- Outbox Dispatcher、RabbitMQ Consumer、文件 Worker 和对账 Job。
- 优雅启动/停止、Readiness 和迁移版本检查。

**禁止**

- 在组合根写领域规则。
- 绕过模块公共入口访问 Repository/Schema。
- 为解决循环依赖创建全局 Service Locator。

### E2E-01：业务中立 Walking Skeleton

**目标**

完成第 6 节端到端链路及质量验收文档中的全部场景。

**允许修改**

- `tests/e2e`、测试 Fixture、必要的测试环境初始化。
- 客户端测试页面只能为 dev/test 明确启用，不能成为生产业务菜单。

**产出**

- 合成 Keycloak 用户、人员、Employment、Assignment、权限、表单和 BPMN Fixture。
- 测试来源适配器，接受 Workflow 完成后的正式测试命令。
- Playwright/API/Worker/数据库/消息联合测试。
- 重复消息、无权限、过期状态和依赖故障场景。

**禁止**

- 新建 `demo-crm` 生产模块。
- 把测试表、路由和权限作为未来业务模板。

### OPS-01：部署配置与发布门禁

**目标**

形成开发、测试、预发布和两台生产主机的版本化部署结构。

**允许修改**

- `deploy/`、部署/发布文档、健康和运维检查脚本。

**产出**

- 两台主机独立 Compose Project 和服务放置清单。
- Nginx 同站点 BFF/API 路由。
- Secret 文件引用、只读挂载和权限检查。
- 不可变镜像、逐台发布、Worker Drain 和回滚流程。
- Sentry/云监控/外部探测配置说明，不含真实账号。

### OPS-02：备份、恢复与安全演练

**目标**

证明两台服务器方案可以在明确限制下恢复。

**产出**

- PostgreSQL 基础备份、WAL 归档和受限 COS 保存。
- Keycloak、Flowable、应用数据库分别恢复。
- RabbitMQ 拓扑和 Outbox/Inbox 对账恢复。
- Secret 离线加密应急包演练。
- 从空主机或等价隔离环境恢复的证据。
- 主机失陷、凭据泄露和离职权限回收演练。

## 18. Walking Skeleton 测试流程

主 E2E 使用仅位于 `tests/` 的合成流程：

1. 初始化合成 Keycloak 用户。
2. 初始化合成 Person、Employment、Organization、Position 和 Assignment。
3. 建立合成权限与授权。
4. PC Web 通过 BFF 完成标准登录。
5. API 解析 Principal、Person、Employment 和 Active Assignment。
6. Workbench 加载应用注册、任务、通知和当前上下文。
7. 测试 Fixture 发布合成 JSON Schema 表单和 BPMN 流程。
8. 测试来源适配器启动 Workflow。
9. Flowable 创建人工任务。
10. Outbox/RabbitMQ 消费者更新 Task Center 投影。
11. Notification Center 创建站内通知。
12. PC Web 轮询并显示任务和通知。
13. 用户打开任务，渲染表单并上传无害测试文件。
14. File Center 确认上传、ClamAV 扫描并产生 `FileReference`。
15. 用户提交表单和 Workflow Task。
16. Workflow 完成后向测试来源适配器发送正式测试命令。
17. 测试来源适配器重新授权、检查状态并接受命令。
18. Task Center 投影关闭，Notification Center 生成结果通知。
19. Audit 保存关键动作，Pino/Sentry/Trace 只保存安全技术信息。
20. 重复投递同一事件，验证 Inbox 和业务幂等无重复副作用。
21. 使用无权限用户重复操作，验证服务端拒绝和审计。
22. 模拟 RabbitMQ/Redis/Flowable/ClamAV 暂时不可用并验证恢复。

附加两条独立验证链：

- Integration Runtime Fake：超时、429、5xx、熔断、重复/乱序 Webhook。
- AI Gateway Fake：合成输入、Schema 输出、Proposal 过期、无人工确认禁止执行。

## 19. AI Agent 任务卡模板

每个并行任务必须在开始前形成以下任务卡，并写入 `.handoffs/<task-id>.md`：

```md
# <Task ID> <Task Name>

## Objective

## Known Facts

## Allowed Assumptions

## Forbidden Assumptions

## Non-goals

## Authority And References

## Allowed Paths

## Forbidden Paths

## Contract Changes

## Migration Changes

## Dependencies

## Required Tests

## Authorization And Audit

## Idempotency, Retry And Failure

## Observability And Health

## Backward Compatibility

## Deliverables

## Unresolved Questions

## Handoff Result
```

Agent 不得在任务过程中默默扩展允许路径或编码未解决假设。需要修改其他模块契约时，先停止实现，提交契约变更请求，由契约 Owner 合并后再继续。

## 20. 多 Agent 文件所有权规则

- 同一时间每个源契约只能有一个 Agent Owner。
- 同一时间每个迁移序列只能有一个 Agent Owner。
- `apps/api`、`apps/worker` 和根 Lockfile 在组合阶段由单一 Integration Owner 修改。
- 生成文件由生成命令更新，不由各模块 Agent 手工修改。
- 模块 Agent 只修改自己的包、契约源和测试；不得顺手重构其他模块。
- 客户端 Agent 只消费生成 Client，不自行复制后端 DTO。
- Review Agent 不直接复写实现；先输出问题清单，再由原 Owner 或明确 Fix Agent 修改。
- 如果多个 Agent 共享同一文件系统，必须分配互不重叠路径，并在合并边界前停止其他写入。
- 优先使用独立 Git Worktree/Branch；没有版本控制时禁止高并发写入。

## 21. 每个工作包的 Definition of Done

工作包只有同时满足以下适用项才可进入 G2：

- 契约、Schema 或错误模型先于实现完成评审。
- 只通过公共入口导入，无跨模块深层依赖。
- 单元、契约和适用的集成测试通过。
- 写操作授权和拒绝行为明确。
- 关键动作审计明确。
- 幂等键、重复请求和重复消息行为明确。
- 超时、重试、死信、取消和失败关闭明确。
- 数据库变更使用追加式 Drizzle SQL 迁移并有恢复说明。
- 日志、指标、Trace、健康和告警方向明确。
- Secret 仅使用引用，不进入源码、配置字面值和测试快照。
- 兼容旧契约、旧事件、旧 Job 或明确标记破坏性变更。
- 用户/运维文档更新。
- `pnpm check` 通过且执行了该包真实任务。
- 独立 Review Pass 检查授权、幂等、事务、迁移、可观测和兼容性。

## 22. 业务调研与技术开发并行接口

公共底座开发期间，业务调研继续进行，但业务内容只能在满足以下条件后进入 `packages/domain-modules/`：

- 明确领域 Owner。
- 明确对象定义和唯一身份。
- 明确状态及允许迁移。
- 明确当前归属、转移和冲突规则。
- 明确各部门输入、补充内容、输出和责任。
- 明确功能权限和数据范围。
- 明确异常、撤销、退回、重开和历史保留。
- 明确审批触发条件和人工责任。
- 明确通知、任务和事件语义。
- 明确文件、证据、隐私、审计和保留要求。
- 规则已经进入 `docs/02-业务规则/`，标注 Owner、版本和生效时间。
- HTTP/Event 契约完成评审。

不要求全公司所有业务一次性梳理完成。可以在第一阶段底座通过后选择一条已确认的最小纵向流程，建立第一个正式领域模块。

## 23. 第一阶段总体完成标准

- 五个应用都成为真实 Workspace Package，构建、测试并产生独立制品。
- Keycloak 标准登录、PC BFF 和内部主体解析链路通过。
- Organization 和 Authorization 的允许/拒绝/失效场景通过。
- PostgreSQL/Drizzle 迁移、事务和模块所有权检查通过。
- Outbox/RabbitMQ/Inbox、重试、死信和重复投递通过。
- Flowable、Task Center 和站内 Notification 完整贯通。
- Form、Business Configuration、File Center 和 App Registry 通过。
- PC Web 可操作；内部 H5 与外部 H5/weapp 壳层可独立构建。
- Integration Runtime 和 AI Gateway Fake 验证通过。
- 审计、Pino、Sentry、Trace 和健康信号通过。
- 本地、CI、预发布和两台生产服务器部署定义完成。
- PostgreSQL/WAL、配置和 Secret 应急恢复演练通过。
- Walking Skeleton 主 E2E、无权限、重复、乱序和依赖故障测试通过。
- `pnpm check` 执行所有适用包任务并通过。
- `packages/domain-modules/` 仍未包含未确认业务。

通过以上标准后，项目进入“第一个已确认 CRM 纵向流程”实施阶段，而不是继续扩张公共底座。
