# zsjcrm 历史材料确认台账

## 状态

已完成。历史材料中的公共技术底座结论已逐项确认并提升到正式 ADR、基线、契约目录、模块说明或工程手册。本文件只保留任务交接记录，不承载永久业务规则。

## 已知事实

- 临时历史材料目录已由项目负责人于 2026-07-23 删除，正式仓库不得再依赖其路径或内容。
- 当前建设范围是公共技术底座和业务无关的 walking skeleton。
- CRM 领域实体、字段、状态、权限、SLA 和审批路线尚未确认。
- PC Web 已确认采用 Vite、React 19、Ant Design 6 与 ProComponents 的显式架构，不采用 Umi Max，见 `docs/08-架构决策/ADR-0001-PC-Web采用Vite与Ant-Design技术栈.md`。
- 项目运行时已确认统一采用 Node 24，见 `docs/08-架构决策/ADR-0002-Node-24运行时基线.md`。
- Monorepo 已确认保留当前 `apps + platform-modules + domain-modules + platform-sdk + contracts` 结构，并废弃历史 `apps/server + shared-core` 方案，见 `docs/08-架构决策/ADR-0003-Monorepo应用与模块边界.md`。
- 身份认证已确认采用 Keycloak，不在业务系统内自建密码、JWT 签发和 Refresh Token 系统；业务授权保持独立，见 `docs/08-架构决策/ADR-0004-Keycloak统一身份认证中心.md`。
- PC Web 登录已确认采用 BFF 服务端会话，浏览器不接触 Keycloak Token，见 `docs/08-架构决策/ADR-0005-PC-Web采用BFF登录会话.md`。
- 第三方身份已确认统一通过 Keycloak 联合接入，不在 CRM 内建立平行认证体系，见 `docs/08-架构决策/ADR-0006-第三方身份通过Keycloak联合接入.md`。
- 第一阶段真实登录范围已确认为 Keycloak 标准登录；企微与微信联合登录等待提供商配置、Keycloak 扩展兼容性和账号生命周期确认，见 `docs/01-权威与基线/第一阶段认证范围.md`。
- 业务授权已确认第一阶段自研轻量核心，分离功能权限与结构化数据范围，并保留策略引擎适配层，见 `docs/08-架构决策/ADR-0007-自研轻量业务授权核心.md`。
- 人员与组织已确认自研有效期模型，分离认证主体、内部人员、Employment、组织单元、岗位和 Assignment，见 `docs/08-架构决策/ADR-0008-自研有效期化人员与组织模型.md`。
- 审批引擎已确认采用 Flowable，并与领域状态、统一任务投影、提醒和后台 Job 分离，见 `docs/08-架构决策/ADR-0009-Flowable审批引擎与职责分离.md`。
- 异步执行已确认采用 RabbitMQ + Redis，并自研 Transactional Outbox/Inbox；RabbitMQ 负责传输、路由、死信和一次性延迟触发，Redis 仅负责缓存与短期协调，见 `docs/08-架构决策/ADR-0010-RabbitMQ与Redis异步执行及Outbox-Inbox.md`。
- 数据持久化已确认采用 PostgreSQL + Drizzle ORM；项目自研薄数据访问与事务边界，按模块划分 Schema 和 Repository，并使用版本化 SQL 迁移，见 `docs/08-架构决策/ADR-0011-PostgreSQL与Drizzle数据持久化基线.md`。
- 文件能力已确认自研文件中心控制面，生产二进制使用腾讯云 COS、本地使用文件系统适配器，并通过开源 ClamAV 扫描，见 `docs/08-架构决策/ADR-0012-自研文件中心与腾讯云COS对象存储.md`。
- 表单与业务配置已确认采用 JSON Schema 2020-12 + Ajv，自研轻量表单渲染和版本化字典/参数中心；技术配置、业务配置、表单定义与领域提交数据保持分离，见 `docs/08-架构决策/ADR-0013-版本化表单与业务配置中心.md`。
- 通知已确认自研控制面，第一阶段只实现 PostgreSQL 站内通知与 TanStack Query 轮询，模板使用受限 Mustache，外部渠道仅保留适配边界，见 `docs/08-架构决策/ADR-0014-自研通知中心与站内通知优先.md`。
- 第一阶段客户端范围已确认必须同时创建 PC Web、内部移动端和外部端，并保持独立构建、身份/API 与安全边界；具体端形态、技术栈和会话传输已分别由 ADR-0016、ADR-0017 确认，见 `docs/08-架构决策/ADR-0015-第一阶段多客户端应用范围与隔离.md`。
- 多端技术已确认内部移动端使用 Taro H5，外部端使用独立 Taro 应用输出 H5 + 微信小程序，均采用 React + TypeScript + NutUI React，不创建原生 App，见 `docs/08-架构决策/ADR-0016-Taro内部移动端与外部多端技术栈.md`。
- 多客户端认证传输已确认：H5 使用隔离的 BFF HttpOnly Cookie，微信小程序只持有短期不透明服务端会话句柄，Keycloak 仍为唯一认证中心；外部访问按 ADR-0019 分级，只有长期登录场景才继续确认账号关联和恢复，见 `docs/08-架构决策/ADR-0017-多客户端认证与服务端会话.md`。
- 内部人员主体关联已确认：企微联合身份归 Keycloak，Keycloak 主体到 Workforce Person 的一对一有效关联归组织模块；Employment 失效关闭内部访问，单个 Assignment 失效只撤销对应上下文，见 `docs/08-架构决策/ADR-0018-内部人员主体关联与失效.md`。
- 外部访问模式已确认分为匿名、用途受限邀请和 Keycloak 长期登录；邀请凭据不证明身份，不与登录权限合并，在首个业务场景确认前不创建邀请模块、表或端点，见 `docs/08-架构决策/ADR-0019-外部端分级访问与邀请授权.md`。
- 第三方系统集成已确认采用“拥有模块 Port + 轻量 `integration-runtime` + 独立 Provider Adapter”；默认异步链路复用 Outbox/RabbitMQ/Worker，不建设巨型集成网关，第一阶段不创建真实供应商 Adapter，见 `docs/08-架构决策/ADR-0020-第三方集成运行时与供应商适配器.md`。
- 第一阶段部署已确认沿用两台腾讯云 Ubuntu CVM + 自托管 Docker Compose 原方案；PostgreSQL、Redis、RabbitMQ、Keycloak、Flowable、Nginx 和 ClamAV 不采用生产托管版，明确接受非自动高可用和人工恢复边界，见 `docs/08-架构决策/ADR-0021-第一阶段两台云服务器Docker-Compose部署.md`。
- 可观测性已确认沿用轻量原方案：Pino JSON 结构化日志、托管 Sentry 错误与采样 Trace、腾讯云云监控和外部可用性探测；保留 OpenTelemetry/W3C 标准传播，不部署 Collector、Prometheus、Grafana、Loki、ELK 或自托管 Sentry，见 `docs/08-架构决策/ADR-0022-第一阶段轻量可观测性基线.md`。
- Secret 与两台主机安全已确认采用调整后的原方案：不使用 Vault 或腾讯云 Secrets Manager，生产 Secret 使用 root 受限文件、Compose Secret/只读单文件挂载和 `*_FILE` 读取；异地应急包用离线公钥加密，明确接受无逐次读取审计与人工双机轮换限制，见 `docs/08-架构决策/ADR-0023-文件式Secret与两台主机安全基线.md`。
- AI 网关已确认采用调整后的原方案：自研业务中立 `ai-gateway` 管用途、数据/Prompt/模型策略、预算、调用记录、结构化 Proposal 和人工确认；模型协议经独立 Adapter，外部调用复用 `integration-runtime`。第一阶段不使用真实模型、LiteLLM、LangChain/RAG/工具或 CRM Prompt，见 `docs/08-架构决策/ADR-0024-AI网关与AI治理边界.md`。

## 允许的假设

- 在项目负责人明确变更前，`AGENTS.md` 和当前正式分层目录继续作为项目基线。
- 后续决策只使用当前用户请求、正式 ADR、契约、模块说明和经确认的业务规则，不恢复或引用已删除的临时材料。

## 禁止的假设

- 不从历史材料推断 CRM 实体、字段、状态、角色、数据范围、SLA、佣金、审批路线或指标口径已经确认。
- 不把历史材料中的自建 JWT、Prisma、自研审批表或旧目录结构视为当前技术决策；RabbitMQ 和 PostgreSQL 仅因本轮负责人明确确认而成为正式决策。
- 不为未来业务预建空领域模块、数据库表或占位字段。

## 非目标

- 当前确认过程不实现 CRM 业务模块。
- 不重新创建、恢复或复制已删除的临时历史材料目录到正式 `docs/`。
- 未经独立实施任务，不生成前端工程或安装前端依赖。

## 已确认事项

1. PC Web：Vite + React 19 + Ant Design 6 + ProComponents；不采用 Umi Max。已提升为 ADR-0001。
2. 运行时：整个 monorepo 统一采用 Node 24。已提升为 ADR-0002。
3. 仓库结构：保留当前应用组合入口、平台模块、领域模块、平台 SDK 和契约分层。已提升为 ADR-0003。
4. 身份认证：Keycloak 作为统一身份提供商，认证与业务授权分离。已提升为 ADR-0004。
5. PC Web 会话：使用 BFF 和安全 Cookie，不在浏览器保存 Keycloak Token。已提升为 ADR-0005。
6. 第三方身份：统一通过 Keycloak 联合身份接入，CRM 不自建绑定登录体系。已提升为 ADR-0006。
7. 第一阶段登录范围：只交付 Keycloak 标准登录，企微和微信联合登录暂缓。已提升到权威与基线。
8. 业务授权：第一阶段自研轻量授权核心，不引入独立策略引擎，保留适配层。已提升为 ADR-0007。
9. 人员与组织：自研有效期化组织核心，外部目录只经适配器同步。已提升为 ADR-0008 和组织模块说明。
10. 审批与流程：采用 Flowable，经 Workflow Facade 隔离，并与业务状态、任务投影和提醒分离。已提升为 ADR-0009 和模块说明。
11. 异步执行：采用 RabbitMQ + Redis，自研 Transactional Outbox/Inbox；不采用 BullMQ。已提升为 ADR-0010 和事件与可靠消息模块说明。
12. 数据持久化：采用 PostgreSQL + Drizzle ORM，自研薄数据访问边界、事务协调与迁移治理；应用数据按模块 Schema 所有，Keycloak 与 Flowable 使用独立逻辑数据库。已提升为 ADR-0011 和工程基线。
13. 文件中心：自研文件控制面；生产使用腾讯云 COS，本地使用文件系统适配器，恶意文件扫描使用 ClamAV。已提升为 ADR-0012 和文件中心模块说明。
14. 表单与业务配置：使用 JSON Schema 2020-12 + Ajv，自研轻量 Ant Design 渲染器和版本化字典/参数中心，不引入完整低代码平台。已提升为 ADR-0013、两个模块说明和契约目录。
15. 通知：自研通知中心；第一阶段仅站内通知与轮询，使用受限 Mustache 模板，不实现企微/微信/短信/邮件/JPush/WebSocket/SSE。已提升为 ADR-0014、第一阶段范围、模块说明和契约目录。
16. 客户端范围：第一阶段同时创建 `workbench-web`、`internal-mobile` 和 `external-portal`，内部与外部发布物及安全边界独立。已提升为 ADR-0015、第一阶段客户端范围和两个应用目录骨架。
17. 多端技术栈：内部端 Taro H5；外部端独立 Taro 应用输出 H5 + 微信小程序；使用 React + TypeScript + NutUI React，不做原生 App。已提升为 ADR-0016 和 Taro 工程基线。
18. 多客户端认证与会话：PC/内部 H5/外部 H5 均采用隔离 BFF HttpOnly Cookie；微信小程序使用短期、可轮换、可撤销的不透明服务端会话句柄；企微/微信通过自研薄 Keycloak 适配边界接入，不在客户端暴露 Keycloak Token。已提升为 ADR-0017、认证基线和认证模块说明。
19. 内部人员主体关联：Keycloak 管企微联合身份，组织模块管有效期化主体到人员关联；禁止模糊属性自动匹配，支持受控预配或已登录重新认证后绑定；解绑不删除人员历史，Employment 失效关闭访问。已提升为 ADR-0018、认证基线和组织模块说明。
20. 外部端访问模式：按匿名、用途受限邀请、Keycloak 长期登录分级；邀请使用服务端状态和随机不透明 Token，不证明身份，不创建通用外部用户模型。已提升为 ADR-0019、客户端/认证基线和外部访问能力边界说明。
21. 第三方系统集成：自研轻量 `integration-runtime`，由拥有模块定义供应商中立 Port，具体 Provider Adapter 在 `apps/api` 或 `apps/worker` 组合；默认复用 Outbox/RabbitMQ/Worker 异步链路，不建立巨型集成网关，不把供应商成功视为业务事实。已提升为 ADR-0020、第一阶段范围、模块说明和集成契约目录。
22. 部署形态：第一阶段生产使用两台腾讯云 Ubuntu CVM，每台运行独立 Docker Compose Project；状态组件和 Keycloak/Flowable/Nginx/ClamAV 均自托管，不采用 Kubernetes 或生产托管 PostgreSQL/Redis/RabbitMQ。已提升为 ADR-0021、第一阶段部署范围和部署发布基线。
23. 可观测性：使用 Pino JSON 结构化日志、托管 Sentry 错误/采样 Trace、腾讯云云监控和外部可用性探测；使用 OpenTelemetry/W3C 传播但不部署 Collector、Prometheus、Grafana、Loki、ELK 或自托管 Sentry。审计、业务事实与技术观测分离。已提升为 ADR-0022、第一阶段范围和工程手册。
24. Secret 与主机安全：不使用 Vault 或云 Secret 产品；生产凭据保存在两台主机各自 root 受限文件中，经 Compose Secret/只读挂载和 `*_FILE` 读取。使用最小权限、独立凭据、人工轮换、SSH/sudo/文件变更审计和离线公钥加密应急包补偿文件式方案限制。已提升为 ADR-0023、第一阶段范围、安全基线和部署目录说明。
25. AI 网关与治理：自研轻量 `ai-gateway`，拥有模块定义用途和确认后的正式动作，网关管理数据/Prompt/模型策略、预算、调用元数据和非权威 Proposal；模型 Adapter 复用 `integration-runtime`。第一阶段不接真实模型、不创建 CRM Prompt、不引入 LiteLLM/LangChain/RAG/工具执行。已提升为 ADR-0024、第一阶段范围、模块说明和 AI 契约目录。

## 后续业务调研

历史材料确认任务已结束。首个外部业务场景及其主体、访问模式和数据边界仍未确认，应在未来独立业务调研任务中处理，不能从本台账或已删除材料推断。
