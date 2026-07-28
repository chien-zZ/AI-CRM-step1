# ADR-0026：RabbitMQ 运行策略与延迟重试边界

- 状态：已接受
- 日期：2026-07-27
- 接受日期：2026-07-28
- 决策人：项目负责人
- 适用范围：`apps/worker` 的 RabbitMQ 组合边界、`eventing-outbox` RabbitMQ Adapter、AsyncAPI 已拥有消费者的运行策略、延迟重试、死信处置和运行观测
- 依赖决策：ADR-0010、ADR-0021、ADR-0022

## 已知事实

- ADR-0010 已接受 RabbitMQ 至少一次投递、PostgreSQL Outbox/Inbox、Publisher Confirm、Mandatory 路由检查、手动 ACK、有界重试和死信隔离。
- RabbitMQ 是传输层，不是业务事实源；Redis 不得成为耐久消息、Inbox 或一次性延迟队列。
- 第一阶段生产是两台 CVM 上的独立 Docker Compose Project，自托管 RabbitMQ，不具备仲裁型高可用，也不承诺自动故障转移、SLA、RPO 或 RTO。
- 当前部署基线示例使用 `rabbitmq:4.2.9-management`，生产仍需不可变镜像摘要、升级验证和恢复演练。
- `eventing-outbox` 已公开供应商中立的 Confirm Channel、Confirm/Return 发布、Rabbit Delivery、Inbox 幂等、Outbox 隔离/重放和积压/对账接口；公共 API 不暴露 RabbitMQ 客户端类型。
- AsyncAPI 目前只为 Task Center 投影声明一个拥有明确 Owner 的消费者及其 DLQ；它仍明确禁止激活，直到事件运行策略值和延迟机制被接受。
- Event 运行策略由组合层显式提供；Job 信封携带有界重试、退避、超时和隔离策略，但具体 `jobType`、Owner、Handler 和拓扑尚未因此自动成立。

## 允许的假设

- RabbitMQ Node 客户端可以放在应用组合/Adapter 层，并被现有供应商中立 Port 隔离。
- 第一阶段的有界退避值集合通常很小，可以为每个被评审的精确延迟值声明独立固定 TTL 延迟队列。
- 每个消费者可以按自身处理时长、事务占用、下游配额和幂等能力独立配置 `prefetch` 与 `concurrency`。
- VHost 是非 Secret 的环境隔离配置；TLS 私钥、证书、用户名/密码和管理凭据是文件 Secret。

## 禁止的假设

- 不从历史材料或现有 Schema 推断任何 CRM 消费者、Job、倒计时、SLA、重试次数、延迟值、容量、保留期或告警阈值。
- 不承诺恰好一次、全局严格顺序、跨 PostgreSQL/RabbitMQ/外部系统的分布式事务或自动故障切换。
- 不以一个隐式全局策略覆盖所有事件和 Job，不允许无限重试或立即 `requeue` 循环。
- 不把“ADR 被接受”“客户端已安装”“队列已声明”“Handler 已注册”和“生产消费已启用”视为同一件事。
- 不允许客户端连接字符串、Secret 值、消息正文、个人数据、客户内容、原始供应商载荷或任意异常文本进入日志、指标、Trace、Sentry 或健康响应。

## 决策

### 1. 客户端与版本采用兼容矩阵，不让 SDK 穿透公共边界

RabbitMQ 服务端以 ADR-0021 的固定镜像原则为准。首次实现以当前部署基线的 RabbitMQ `4.2.9` 为验证对象，生产发布同时固定镜像摘要；不得使用 `latest`、浮动大版本或未验证的小版本自动升级。安全补丁升级必须在预发布重复连接、拓扑声明、Confirm/Return、流控、消费、延迟、DLX、优雅停止和恢复测试，再逐台发布。

Node 客户端的推荐候选是 `amqplib`，原因是它能映射 AMQP 0-9-1 的 Confirm Channel、Mandatory Return、手动 ACK/NACK、QoS/prefetch、TLS 和连接阻塞信号。这里不直接批准一个包版本，也不授权安装依赖；实现任务必须：

1. 选择仍受维护且与 Node 24、RabbitMQ 4.2 固定版本兼容的稳定版本，并以精确版本进入 Lockfile。
2. 对 TypeScript 类型包同样固定兼容版本；若运行包自带类型则不得叠加冲突类型源。
3. 用真实 RabbitMQ 集成测试证明 Confirm/Return 关联不会串消息，连接/Channel 关闭会拒绝未决发布，写缓冲背压会等待 Drain，消费者取消和优雅停止可收敛。
4. 只在 `apps/worker` 或应用组合的具体 Adapter 中导入客户端。`eventing-outbox`、领域模块、Handler、契约和 `platform-sdk` 继续只依赖供应商中立 Port。
5. 把客户端或协议重大升级视为兼容性变更：先双版本测试和发布门禁，不依赖管理 UI 的人工默认值修复代码声明。

若候选不能通过上述矩阵，应替换候选，而不是削弱 Confirm、Return、TLS、流控或优雅停止要求。

### 2. 生产连接使用 TLS、独立 VHost 和文件 Secret

- 每个环境使用显式、非空、非默认的 VHost；开发、测试、预发布和生产不得共享 VHost。VHost 名称通过类型化运行配置提供，不由请求、主机名或数据库内容推断。
- Publisher、Consumer 与只读运维诊断使用分离的最小权限账号。应用账号只获得已评审交换机/队列所需的 configure/write/read 权限，不能使用 RabbitMQ 默认管理员或管理 UI 凭据。
- 生产 AMQP 连接必须使用 TLS，并验证服务端证书链和预期主机名；不得设置跳过证书校验。是否使用双向 TLS 由证书运维评审决定，不能用自签名忽略校验替代。
- CA、客户端证书、私钥、用户名/密码分别使用环境、服务、用途特定的 Docker Compose Secret 或只读文件挂载，以类型化 `*_FILE` 引用读取。缺失、不可读、权限过宽、空值或解析失败均使 Worker 对相应职责 Not Ready，不能回退到环境变量 Secret 或默认账号。
- 连接日志和健康响应不得输出 AMQP URL、VHost、用户名、证书路径、指纹、队列名称或 Secret。轮换采用新旧凭据短暂并存、建立新连接、停止旧连接领取、排空在途消息、撤销旧凭据的受控流程；轮换不能依赖进程永久复用旧连接。

### 3. 每个拥有的消费绑定必须有独立运行策略

运行策略的稳定身份是 `consumer + messageType + messageVersion`；仅存在 Message Schema、Job 信封或 Handler 类不构成策略。策略至少包含：

| 字段 | 约束 |
|---|---|
| Owner 与 Handler | 明确拥有模块、公开处理边界和已注册 Handler；注册表与 AsyncAPI 绑定必须完全匹配 |
| `maxAttempts` | 正整数且有平台上限；Event 来自评审后的运行配置，Job 来自已验证信封并受该 `jobType` 的服务器端允许范围约束 |
| `backoffSeconds` | 长度严格等于 `maxAttempts - 1`，每个精确值都必须映射到已声明的固定延迟层 |
| `timeoutMs` | 有界；Handler 必须响应 `AbortSignal` 并在释放事务连接前真正结束 |
| 错误分类 | 稳定、版本化的 `retryable` 或 `terminal` 结果；未知错误默认不无限重试 |
| `prefetch` / `concurrency` | 两个独立正整数、有平台上限，按消费者容量证据设置 |
| 隔离与重放 | 明确 DLQ、Owner、权限、追加式审计、权威状态复核和对账入口 |
| 兼容与顺序 | 支持的消息版本、重复/延迟/乱序行为、必要的单调版本防回退规则 |

具体数值进入对应 AsyncAPI/运行配置评审，不写入通用 ADR。应用启动时使用密封 Handler Registry 原子比对拓扑、策略和 Handler；任一缺失、重复、未支持版本、未声明延迟层或无 Owner 均使该消费者保持关闭并使其职责 Not Ready。不能先开始消费再异步补注册。

### 4. 延迟重试使用固定 TTL 层，禁止共享逐消息 TTL 的队头阻塞设计

第一阶段选择 RabbitMQ 原生的固定延迟层：每个已评审的精确 `backoffSeconds` 值对应一个专用、耐久、无消费者的延迟队列。该队列使用队列级固定 `x-message-ttl`，并通过 DLX 在到期后把消息路由回原消费者主交换机/主路由。

该设计的必要约束是：

- 不把不同延迟值放进同一 FIFO 队列并使用逐消息 TTL。RabbitMQ 只从队头移除过期消息，较长延迟会阻塞其后的较短延迟。
- 延迟层按“精确延迟值”复用，而不是按 CRM 业务创建；只有已拥有消费者策略引用的值才允许声明。队列名、绑定和 TTL 必须进入 AsyncAPI，不能由运行时任意生成。
- 延迟队列没有消费者，不允许优先级、立即重入主队列或任意用户输入 TTL。消息在延迟层过期后由 DLX 返回；延迟只是至少等待时间，不承诺准点 SLA。
- 重试发布使用 Mandatory、持久消息和 Confirm Channel。确认成功且未收到 Return 后才 ACK 原投递；发布失败或结果不确定时不 ACK 原投递，让 Broker 重投相同 Attempt。
- 若 RabbitMQ 重启、时钟/资源水位、DLX 配置或目标绑定异常，消息可能延迟或重复。PostgreSQL Inbox、权威状态检查与对账负责收敛，不能用 Redis 修正这一正确性路径。

第一阶段不启用 `rabbitmq_delayed_message_exchange` 插件。未来若固定延迟层数量或运维成本不可接受，须新 ADR 评审插件版本兼容、升级、备份恢复、监控和迁移，不能在生产临时安装插件。

### 5. Prefetch 与应用并发分别限制，先保守再用证据调整

`prefetch` 限制 Broker 可交付但尚未 ACK 的数量；`concurrency` 限制应用同时进入 Handler 的数量。两者必须按消费者独立配置，不能用一个 Worker 全局值替代，也不能以大量 Prefetch 伪装吞吐能力。

- `concurrency` 不得超过数据库事务连接、下游并发配额、CPU/内存和 Handler 幂等能力的安全预算。
- `prefetch` 必须不小于有效并发且设置有界上限；具体倍数和数值通过压测确定。缺少容量证据时保持消费者关闭，而不是在 ADR 中猜测数字。
- 长任务不得占用无限事务。超时会发出 Abort，Handler 必须结束后才释放事务；忽略 Abort 的 Handler 触发 Watchdog/Not Ready，并停止新领取，不能提前释放仍被使用的连接。
- RabbitMQ `connection.blocked`、内存/磁盘水位、数据库不可用或应用正在停止时，Publisher 停止新领取 Outbox，Consumer 停止新投递/取消订阅并有界等待在途处理。不能通过增加并发绕过背压。

### 6. Delivery Attempt、Publisher Confirm 与 ACK 使用固定顺序

初次 Outbox 发布设置 `x-ai-crm-delivery-attempt = 1`。`x-ai-crm-publish-attempt` 只表示 Outbox 到 RabbitMQ 的发布尝试，不能计入消费重试预算。

消费 Attempt `N` 的状态机如下：

1. 校验消息大小、信封、类型/版本、必需 Header、Attempt 和策略；无 Handler、策略不匹配或载荷冲突进入终止隔离，不执行副作用。
2. 在本地事务中以稳定 `message_id + consumer` 串行检查 Inbox，重新检查权威状态，执行本地副作用并写 Inbox。事务提交成功后才允许 ACK；重复投递返回 duplicate 后同样可 ACK。
3. 对可重试错误且 `N < maxAttempts`，按 `backoffSeconds[N - 1]` 向对应固定延迟层发布 Attempt `N + 1`。只有 Mandatory 未 Return 且 Publisher Confirm 成功后，才 ACK Attempt `N`。
4. 重试发布失败、Channel/连接关闭或 Confirm 结果不确定时，不 ACK Attempt `N`。Broker 可以重投同一 `N`；不得提前递增、同时发布多个重试或立即 requeue。
5. 对终止错误、策略拒绝或 `N >= maxAttempts`，使用 `reject/nack(requeue=false)` 进入已声明 DLX/DLQ；不自动重放。若进程在隔离动作完成前崩溃，原消息仍可重投。

ACK 丢失、Confirm 成功后进程崩溃、RabbitMQ 已接收但 Outbox 尚未标记 published 都会产生重复，这是至少一次语义的正常结果。Inbox 与外部副作用幂等/对账必须承受重复；任何日志或 Trace 都不能用来推导“恰好一次”。

### 7. DLQ 是隔离区，人工重放默认拒绝并与 Outbox 重放分权

- 每个拥有的主队列必须有明确终止 DLQ，但 DLQ 不设置自动消费者、自动 TTL 回流或周期性批量重放。
- `outbox_replay` 只授权 PostgreSQL Outbox 隔离记录重新进入发布，不能授权 RabbitMQ DLQ 重放。DLQ 重放需要独立稳定操作名、最小权限、资源范围、单条/批量边界和审计契约；在该契约接受前功能保持 disabled。
- 人工重放顺序是：只读检查消息技术标识与当前隔离原因；向拥有模块请求当前权威状态复核；获得允许的授权决定；先写成功的追加式审计意图（操作者主体、授权决定引用、消息/消费者引用、受控原因、原 Attempt、目标策略版本和 Trace 引用）；再以稳定消息 ID 和明确的新重放关联发布；Confirm/Return 成功后才完成原 DLQ 处置记录。
- 审计失败、授权服务不可用、消息版本不再受支持、权威状态拒绝、原始载荷校验失败或目标绑定不匹配时失败关闭。不得在 RabbitMQ 管理 UI 中绕过应用授权直接移动生产消息。
- 重放不会删除业务历史、重置 Inbox 或证明处理成功。若 Inbox 已完成则重放应成为 duplicate；若需要业务补偿，必须调用拥有模块的正式命令而不是篡改 Inbox/DLQ。

### 8. 兼容、发布与故障行为

- 事件 v1 采用向后兼容扩展；破坏性变更发布新版本并在迁移期并行声明路由、Handler 与运行策略。旧 Handler 停用前必须证明旧队列、延迟层和 DLQ 已排空或有批准的迁移处置。
- 拓扑声明必须幂等且与 AsyncAPI 一致；不允许应用启动时删除/重建不匹配的耐久实体。参数不兼容时失败关闭并由版本化迁移/Runbook 处置。
- RabbitMQ 不可用时，本地业务事务仍可提交 Outbox；Publisher 停止领取或保留待发布记录。Consumer 连接断开会停止新处理；未 ACK 消息由 Broker 恢复后重投。
- PostgreSQL 不可用时 Consumer 不得执行无法与 Inbox 同事务提交的本地副作用；暂停消费并 Not Ready。外部副作用不能加入本地事务，必须先保存可恢复状态、传稳定幂等键并提供对账。
- Telemetry、Sentry 或指标后端故障不得改变 ACK、Confirm、事务、重试和隔离结果。RabbitMQ 管理插件不可用不等于 AMQP 数据面失败，也不能作为唯一健康依据。
- 优雅停止顺序为：标记 Not Ready、停止 Outbox 新领取与 Consumer 新投递、等待有界在途处理、对未完成投递不 ACK、关闭 Channel/连接。超过停止预算时允许 Broker 重投，不伪造完成。

### 9. 可观测性和健康只报告有界技术事实

运行观测至少覆盖：

- 连接/Channel 状态、Blocked/Unblocked、重连次数与持续时间、Confirm 延迟/失败、Mandatory Return、Outbox 最老待发布时长和积压。
- 按受控 `consumer`、消息类型/版本和结果类别聚合的未 ACK 数、消费延迟、Handler 时长、超时、Retry、DLQ、Inbox duplicate；指标 Label 不含 `message_id`、用户输入或异常文本。
- 日志/Trace 可关联受校验的 `message_id`、`correlation_id`、`causation_id`、`trace_id`、消费者、消息类型/版本、Attempt、策略版本和稳定错误码，但不得记录消息正文、Header 全量、URL、个人数据、Secret、SQL 参数或原始异常/供应商响应。
- Liveness 只表示进程可运行；Readiness 按职责检查 TLS 连接、所需 Channel、拓扑/Registry/策略精确匹配、数据库事务能力和是否被 Blocked。健康响应只给受控状态码，不泄露 VHost、队列、主机、证书或账号。

阈值、告警窗口、容量和 Owner 必须由压测与值班安排确认；本 ADR 不发明数值。消息载荷检查只能在受控、授权、审计的运维工具中按最小必要原则进行，不能借日志或 Sentry 实现。

## 消费启用门禁

接受本 ADR 仍不启用任何消费者。每个消费者只有同时满足以下条件才能由单独实施变更启用：

1. AsyncAPI 已声明 Owner、主/延迟/DLQ 拓扑、路由和支持版本，并通过契约兼容检查。
2. 逐事件或具体 `jobType` 运行策略数值、错误分类、Handler、权威状态复核和重放 Owner 已评审。
3. Node 客户端精确版本和 RabbitMQ 镜像摘要通过真实 TLS/Confirm/Return/ACK/故障集成矩阵。
4. VHost、最小权限和文件 Secret 已配置并完成轮换/撤销演练。
5. Inbox 原子性、重复、乱序、超时、Retry Confirm 失败、DLQ、优雅停止、恢复排空和对账测试通过。
6. 观测、告警 Owner、Runbook、容量上限和回滚/前滚方案已就绪。
7. 应用 Composition Root 的密封 Handler Registry 与声明绑定精确匹配，并经独立授权、幂等、事务、兼容和 Secret 复核。

当前 Task Center 投影消费者仍保持关闭；组织、Workflow 和私有 Job Message Component 不产生消费者或队列。

## 已考虑的方案

### 共享重试队列 + 逐消息 TTL

实体少，但较长 TTL 位于队头时会阻塞其后的短 TTL，无法满足有界退避的时间隔离，因此不采用。

### RabbitMQ Delayed Message Exchange 插件

路由简洁并支持任意延迟，但增加插件版本、升级、恢复和监控边界；第一阶段固定延迟集合尚不足以证明该复杂度，因此暂不采用。

### 应用进程内定时器或 Redis 延迟队列

进程重启会丢失定时状态，Redis 也不是 ADR-0010 允许的一次性延迟耐久事实源，因此不采用。

### 固定 TTL 延迟层 + DLX

仅使用 RabbitMQ 原生能力，延迟值与已评审策略一一对应，并避免不同 TTL 的队头阻塞，因此作为第一阶段选择。

## 影响与风险

- 固定延迟值越多，队列实体越多；需通过策略复用、AsyncAPI 生成和拓扑对账控制，不允许任意值爆炸。
- RabbitMQ 单实例仍是传输单点；Outbox 保留未发布承诺和 Inbox 保留已完成事实，但服务中断期间异步处理会停顿。
- Confirm/ACK 窗口必然产生重复；实现和验收成本转移到幂等、权威状态复核和对账。
- DLQ 人工处置在授权契约接受前不可用，故障消息只能隔离和只读诊断；这优先于无审计重放带来的越权和重复副作用风险。
- 客户端与服务端版本被固定后，需要持续跟踪安全公告并维护升级矩阵。

## 测试与验收要求

- 契约测试：AsyncAPI 绑定、每策略延迟值、Attempt Header、主/延迟/DLQ 路由、无 Owner 无队列、Registry 精确匹配。
- 客户端集成：TLS 校验失败、Secret 缺失、VHost/权限拒绝、Confirm/Return 竞态、Drain、Blocked、连接/Channel 关闭、消费者取消和优雅停止。
- 可靠性：事务回滚不 ACK、ACK 丢失重复、Confirm 成功后崩溃、重试 Confirm 失败不 ACK、Attempt 不提前递增、耗尽进入 DLQ、RabbitMQ/数据库分别不可用及恢复排空。
- 延迟：不同固定 TTL 层的短延迟不被长延迟阻塞；同层 FIFO、重启后至少等待语义、无消费者、DLX 目标缺失时告警和可恢复。
- 幂等与兼容：重复/乱序/新旧版本、Inbox 并发、权威状态拒绝、旧 Handler 排空和外部副作用幂等/对账。
- 安全与观测：最小权限、证书轮换、日志/Sentry/Trace/指标/健康响应的敏感数据扫描，以及 Telemetry 故障不影响正确性。
- 重放：默认拒绝、授权失败、审计失败、状态变化、版本不支持、Confirm 失败、重复重放和操作主体撤权。

## 接受记录与后续确认

项目负责人于 2026-07-28 接受本 ADR。该接受只确认本文的运行边界与门禁，不确认下列具体参数，也不启用任何生产消费者：

- `amqplib` 作为首选候选通过兼容矩阵后的精确运行包/类型包版本。
- 是否把当前 RabbitMQ `4.2.9` 基线提升为生产固定版本与镜像摘要；安全支持期和升级 Owner。
- 生产 CA/证书签发、是否启用双向 TLS、VHost/账号命名、Secret Owner 与轮换周期。
- Task Center 投影的实际 `maxAttempts`、`backoffSeconds`、`timeoutMs`、`prefetch`、`concurrency`、错误分类、容量与告警阈值。
- DLQ 重放的正式权限、审计事件、运营入口、批量上限和 Runbook Owner。
- 当固定延迟层数量达到何种经验证的运维阈值时重新评审延迟插件。

## 非目标

- 本 ADR 不创建或启用任何生产消费者、CRM Job、业务倒计时、SLA、提醒、审批、路由或队列。
- 本 ADR 不安装依赖、修改 Lockfile、实现 Adapter、修改 AsyncAPI、配置生产 Secret 或创建运营 UI/API。
- 本 ADR 不把消息成功投递、进入 DLQ、产生通知或记录 Trace 解释为业务工作完成。
- 本 ADR 不承诺 RabbitMQ 高可用、自动故障转移、准点延迟、恰好一次、SLA、RPO 或 RTO。
