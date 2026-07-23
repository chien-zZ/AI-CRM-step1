# 第一阶段 Walking Skeleton 验收清单

- 状态：已批准验收基线
- 日期：2026-07-23
- 适用范围：第一阶段公共技术底座、三个客户端壳层、业务中立端到端流程
- 实施计划：[第一阶段 AI 并行开发实施计划](../04-工程手册/第一阶段AI并行开发实施计划.md)

## 1. 验收原则

- 验收对象是可运行行为和可复现证据，不是目录、README、接口名称或演示截图。
- 正常路径、拒绝路径、重复路径、故障路径和恢复路径必须同时验证。
- 测试只使用合成数据，不创建真实 CRM 对象、角色、状态或流程。
- 测试 Fixture 只能位于 `tests/` 或明确的 dev/test 初始化资产中，不进入生产领域模块。
- 每项验收需要保存自动化测试、日志摘要、迁移版本、镜像版本或恢复报告等适当证据。

## 2. 环境前置检查

- [ ] Node 24 和固定 pnpm 版本生效。
- [ ] 所有应用/包是 Workspace Package。
- [ ] `pnpm check` 执行真实包级任务。
- [ ] PostgreSQL、Redis、RabbitMQ、Keycloak、Flowable、ClamAV、Nginx 使用固定镜像版本。
- [ ] 本地/CI Compose 可重复启动。
- [ ] 生产 Secret 未出现在仓库、Compose 字面值、镜像和日志中。
- [ ] 测试数据库、Keycloak Realm、RabbitMQ VHost 和存储与其他环境隔离。
- [ ] Sentry 测试环境和 Source Map 配置不包含生产凭据。

## 3. 工程和边界验收

- [ ] 禁止跨模块深层导入的检查可复现失败。
- [ ] 禁止模块读取其他模块表的架构测试存在。
- [ ] `packages/domain-modules/` 没有投机性业务包。
- [ ] 公共入口不导出 Drizzle Schema、Query Builder、Transaction Handle 或供应商 SDK 类型。
- [ ] Generated 契约制品不能手工编辑。
- [ ] 外部 Allowlist Client 不包含内部/管理 API。
- [ ] API 和 Worker Composition Root 不含领域规则。

## 4. 身份与会话验收

### 正常路径

- [ ] PC Web 可以使用 Keycloak 标准登录。
- [ ] 浏览器只获得 HttpOnly BFF Cookie，不获得 Keycloak Token。
- [ ] 登录回调正确校验 State、Nonce、Issuer 和 Audience。
- [ ] Session 刷新、注销和强制失效正常。
- [ ] 当前主体解析为唯一 Workforce Person、有效 Employment 和 Active Assignment。

### 拒绝与安全路径

- [ ] 无 Person 关联失败关闭。
- [ ] 多重有效关联失败关闭。
- [ ] Employment 失效后不能进入内部工作台。
- [ ] Assignment 失效撤销对应上下文。
- [ ] CSRF、Session Fixation、过期 Cookie 和伪造回调被拒绝。
- [ ] 日志、Sentry、Trace 和错误响应不含 Token、Cookie、授权码和 Secret。
- [ ] 内部 H5/外部 H5 会话命名、Cookie Scope 和受众隔离。
- [ ] 微信小程序骨架不伪造真实已登录主体。

## 5. 授权验收

- [ ] 单项 Check 与 Batch Check 结果一致。
- [ ] 未注册权限默认拒绝。
- [ ] 前端显示权限不影响后端最终裁决。
- [ ] Data Scope 是结构化约束，不是 SQL 字符串。
- [ ] 拥有数据的模块负责将 Scope 转换为本地查询。
- [ ] Redis 缓存失效后权限变化可见。
- [ ] 多任职切换不做权限并集。
- [ ] 授权拒绝有安全审计和 Trace 引用。
- [ ] 无权用户不能通过直接 API、深链或重放绕过授权。

## 6. 数据库与迁移验收

- [ ] 空数据库可以升级到最新版本。
- [ ] 已部署迁移不可修改，修复通过追加迁移。
- [ ] 应用、Keycloak 和 Flowable 数据库隔离。
- [ ] 模块数据位于模块自有 Schema/Repository。
- [ ] 自动 Schema Sync 和 `drizzle-kit push` 不用于共享环境。
- [ ] 迁移失败不会被标记为成功。
- [ ] 破坏性迁移有备份/恢复点、锁影响和前滚方案。
- [ ] 慢查询和事务能够关联安全 Trace。

## 7. Outbox、RabbitMQ 与 Inbox 验收

- [ ] 本地事务回滚时没有可见消息。
- [ ] 数据库提交后 RabbitMQ 不可用时 Outbox 保留。
- [ ] Publisher Confirm 丢失导致重复发布时消费者无重复副作用。
- [ ] 消费完成但 ACK 丢失时 Inbox 安全去重。
- [ ] 重复、乱序和未知版本消息被正确处理或隔离。
- [ ] 重试耗尽进入死信，不无限循环。
- [ ] 人工重放需要授权、理由和审计。
- [ ] Redis 不可用不丢失 Outbox/Inbox 事实。
- [ ] Worker Job 执行前重新检查权威状态。
- [ ] Message/Correlation/Causation/Trace Context 正确传播。

## 8. Workflow 验收

- [ ] BPMN 测试资产版本化。
- [ ] 可以部署、启动、查询和取消测试流程。
- [ ] 人工任务可以查询、认领/操作和完成。
- [ ] Flowable 类型、表和异常没有泄漏到调用模块。
- [ ] 重复完成同一任务不会产生重复领域副作用。
- [ ] 已取消、已完成、过期和未知任务失败语义明确。
- [ ] Flowable 完成只请求来源命令，不直接写来源表。
- [ ] Flowable 不可用时 API/Worker 按定义失败或恢复。

## 9. Task Center 验收

- [ ] Workflow Task 可形成统一投影。
- [ ] 创建、更新、完成、取消处理幂等。
- [ ] 乱序事件不会回退到旧状态。
- [ ] Task Center 与来源状态不一致时可对账修复。
- [ ] 完成命令路由回来源，不由投影自行完成。
- [ ] 深链使用 App/Route ID，不存任意 URL。
- [ ] 访问任务详情时重新授权。
- [ ] 通知已读不改变任务状态。

## 10. Notification 验收

- [ ] Notification Intent 幂等。
- [ ] 实际收件人快照可追溯。
- [ ] 站内列表、详情、未读数、已读和归档正常。
- [ ] Mustache 模板变量使用 JSON Schema 校验。
- [ ] 历史通知不随模板新版本改变。
- [ ] PC Web 使用 TanStack Query 轮询。
- [ ] RabbitMQ 重试/死信不会删除站内事实。
- [ ] 没有企微、微信、短信、邮件、WebSocket 或 SSE Adapter。
- [ ] Provider 送达不被解释为用户已读或工作完成。

## 11. Audit 与 Application Registry 验收

- [ ] 关键写操作、权限变化、人工重放和敏感访问产生审计。
- [ ] 审计包含 Actor、有效上下文、Action、Resource、Result、Reason 和 Trace。
- [ ] 审计记录追加式保存，普通业务操作不能修改或删除。
- [ ] 审计不由日志关键词推断。
- [ ] 应用、导航和路由使用稳定 ID。
- [ ] 禁用应用不会通过旧深链绕过。
- [ ] 外部端不会加载内部注册项。
- [ ] 路由目标每次重新授权。

## 12. Form 与 Configuration 验收

- [ ] JSON Schema 2020-12 使用 Ajv 严格校验。
- [ ] 远程 `$ref`、未知关键字、超深/超大 Schema 被拒绝。
- [ ] UI Schema 只能使用白名单组件和布局。
- [ ] 客户端校验不能替代服务端校验。
- [ ] 草稿可修改，发布版本不可修改。
- [ ] 历史记录按绑定版本解释。
- [ ] Dictionary Code 稳定，停用不破坏历史。
- [ ] Parameter 类型、范围、版本和缺失失败策略明确。
- [ ] Redis 不可用时 PostgreSQL 仍是事实源。
- [ ] Secret、权限、状态机和 SQL 不能进入业务配置。
- [ ] Fixture 不包含真实 CRM 字段和 SLA。

## 13. File Center 验收

- [ ] 创建上传会话并返回安全上传信息。
- [ ] 本地 Adapter 与 COS Adapter 满足同一契约。
- [ ] 未确认上传不能直接变为可用文件。
- [ ] ClamAV 扫描通过后才允许使用。
- [ ] 恶意文件被隔离并审计。
- [ ] 扫描不可用时失败关闭或保持待处理。
- [ ] 重复确认、断点、超时和清理幂等。
- [ ] 业务只保存 `FileReference`。
- [ ] 客户端看不到 Bucket、Object Key、COS Secret 和永久 URL。
- [ ] 预发布真实测试 Bucket 契约测试通过。

## 14. 客户端验收

### PC Web

- [ ] React 19 + Vite + Ant Design 6 + ProComponents。
- [ ] 显式 Router、TanStack Query 和生成 API Client。
- [ ] ProLayout、应用导航、任务、通知、表单和文件页面可用。
- [ ] URL 筛选/分页/选项卡状态可恢复。
- [ ] 403、404、500、离线、Session 过期和维护状态明确。
- [ ] 不使用 Umi Max 或 HeroUI。
- [ ] 已按 [PC 工作台 Demo 参考基线](../04-工程手册/PC工作台Demo参考基线.md) 检查导航层级、信息密度、列表/详情模式、操作反馈和桌面宽度。
- [ ] 与 Demo 参考基线的明显差异已在任务交接中说明并通过评审。
- [ ] 未复制 Demo 的角色、路由、业务字段、状态、SLA、审批路线、Mock Store、Action Engine、AI 助手或多主题实验。

### Internal Mobile

- [ ] 独立 Taro H5 构建。
- [ ] 独立 BFF Cookie、网络和错误 Adapter。
- [ ] 任务、通知和测试表单最小展示可用。
- [ ] 弱网、返回、刷新和 Session 过期行为明确。
- [ ] 不导入 Ant Design/ProComponents，不实现企微 OAuth。

### External Portal

- [ ] 同一独立应用输出 H5 和 weapp。
- [ ] 外部 Allowlist Client 不含内部接口。
- [ ] H5 Session 与小程序句柄 Adapter 隔离。
- [ ] 不包含 Keycloak Token、微信 `session_key` 或 Provider Secret。
- [ ] 没有匿名业务端点、邀请表、外部用户模型和真实微信登录。

## 15. Integration Runtime 验收

- [ ] Deadline 同时限制连接、响应和总耗时。
- [ ] Retry Budget、退避和抖动可测试。
- [ ] 非幂等写操作默认不盲目重试。
- [ ] 限流、并发和熔断状态可观测。
- [ ] Webhook 在业务解析前执行原始报文验签接口。
- [ ] 时间戳、Nonce、事件 ID 和耐久防重语义明确。
- [ ] Fake/Stub 支持超时、429、5xx、重复和乱序。
- [ ] 不存在任意 URL Executor、真实 Provider DTO 或第二套消息总线。

## 16. AI Gateway Fake 验收

- [ ] 未注册 Use Case 被拒绝。
- [ ] 输入/输出使用 JSON Schema。
- [ ] Fake Adapter 只处理合成数据。
- [ ] Proposal 明确为非权威结果。
- [ ] 未经人工确认不能执行正式测试命令。
- [ ] 确认时重新授权并检查 Proposal 过期。
- [ ] Token/成本/错误记录不含完整 Prompt/Response。
- [ ] 没有真实模型、CRM Prompt、RAG、工具、MCP、LiteLLM 或 LangChain。

## 17. 主 Walking Skeleton E2E

- [ ] 合成用户通过 Keycloak/BFF 登录。
- [ ] 解析有效 Person、Employment、Assignment 和 Permission。
- [ ] Workbench 加载合成注册应用。
- [ ] 合成表单与 BPMN 发布成功。
- [ ] 测试流程创建 Flowable Task。
- [ ] Task Center 收到投影。
- [ ] Notification Center 生成站内通知。
- [ ] PC Web 轮询看到任务和通知。
- [ ] 表单渲染、服务端校验和文件上传/扫描完成。
- [ ] 用户完成任务。
- [ ] Workflow 请求测试来源正式命令。
- [ ] 测试来源重新授权并接受命令。
- [ ] Task 投影关闭并生成结果通知。
- [ ] 重复事件不产生重复副作用。
- [ ] 无权限用户被拒绝。
- [ ] Trace 从浏览器/BFF/API/Outbox/RabbitMQ/Worker 连通。
- [ ] Audit 可追溯，日志/Sentry 无敏感内容。

## 18. 可观测与健康验收

- [ ] Pino 输出有效单行 JSON。
- [ ] 日志轮转和磁盘上限生效。
- [ ] Trace/Request/Message/Correlation ID 可以关联。
- [ ] Sentry Release/Environment 正确。
- [ ] Source Map Token 不进入前端制品。
- [ ] Liveness 不因普通下游故障重启健康进程。
- [ ] Readiness 在实例无法安全承接职责时失败。
- [ ] 健康响应不暴露内部拓扑和 Secret。
- [ ] Sentry/云监控不可用不阻断业务。
- [ ] 日志/Sentry 抽样无 Token、Cookie、个人数据、表单正文和文件内容。

## 19. Secret 与主机安全验收

- [ ] 生产 Secret 使用受限文件和只读单文件挂载。
- [ ] 每个容器只获得自身需要的 Secret。
- [ ] Secret 缺失或格式错误时启动失败关闭。
- [ ] Compose、Dockerfile、镜像层、命令参数和 `.env` 无生产 Secret。
- [ ] SSH 禁止密码登录和远程 root 直登。
- [ ] 状态服务和管理端口不开放公网。
- [ ] Docker Socket 不进入业务容器。
- [ ] Secret 轮换、撤销、离职回收和泄露响应演练通过。
- [ ] 加密应急包私钥不在生产主机或 COS。

## 20. 部署、备份与恢复验收

- [ ] 两台主机分别使用独立 Compose Project。
- [ ] API 副本分布明确，状态组件单点风险记录明确。
- [ ] Nginx 同站点 BFF/API 路由和安全头正确。
- [ ] 应用和第三方镜像固定版本/摘要。
- [ ] 逐台发布、健康检查和回滚流程经过预发布验证。
- [ ] Worker 停止接收、在途任务和幂等处理经过验证。
- [ ] PostgreSQL 基础备份和 WAL 离开两台服务器故障域。
- [ ] Keycloak、Flowable 和应用数据库分别恢复。
- [ ] RabbitMQ 拓扑可重建，Outbox/Inbox 可对账。
- [ ] 从空主机或等价隔离环境完成恢复演练。
- [ ] 报告记录实际恢复点、耗时和数据差异，但不虚构 SLA/RPO/RTO。

## 21. 独立 Review Pass

每个关键工作包合并前，由非原实现 Agent 检查：

- [ ] Authorization：是否存在对象级越权、默认允许或前端代替后端授权。
- [ ] Idempotency：HTTP、事件、Job、Workflow 和 Provider 重复是否安全。
- [ ] Transactions：本地状态、Outbox、Inbox 和 ACK 顺序是否正确。
- [ ] Migrations：迁移是否追加、可部署、可恢复且不跨模块。
- [ ] Observability：日志、Trace、健康和告警是否安全且可行动。
- [ ] Backward Compatibility：旧 HTTP、事件、Job、数据和客户端是否兼容。
- [ ] Secrets：是否在代码、快照、Fixture、命令、日志和制品中泄露。
- [ ] Failure Modes：超时、重试耗尽、依赖不可用和部分成功是否定义。

Review 结果必须形成问题清单和处理结论，不能只写“LGTM”。

## 22. 第一阶段签收证据

最终签收至少需要：

- `pnpm check` 完整输出。
- 应用和镜像版本清单。
- 合同 Bundle/生成 Client 校验结果。
- 数据库迁移清单。
- Walking Skeleton E2E 报告。
- 授权拒绝和幂等故障测试报告。
- 日志/Sentry 敏感数据抽样报告。
- 预发布部署与回滚报告。
- PostgreSQL/WAL、Keycloak、Flowable 和 Secret 恢复演练报告。
- 已知限制和待业务确认清单。

所有强制项通过后，第一阶段才可标记完成。
