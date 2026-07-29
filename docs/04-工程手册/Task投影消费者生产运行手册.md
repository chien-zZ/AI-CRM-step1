# Task 投影消费者生产运行手册

- 状态：G3 生产组合 v1
- Owner：`platform.task-center`
- 消费者：`platform.task-center.projection.v1`
- 依据：ADR-0010、ADR-0026、ADR-0027 与 `contracts/asyncapi/topology.asyncapi.yaml`

## 已知事实

- 当前只有 Task 投影消费者拥有已审 Owner、Handler、运行策略及主队列/固定 TTL 重试层/DLQ；Organization、Workflow、Notification 与 File Job 没有可据此推导的消费绑定。
- Worker 使用自身的 `ai_crm_worker_runtime` PostgreSQL 登录角色，并让 Eventing Inbox Store 与 Task Center PostgreSQL Store 共享同一个 Worker DatabaseRuntime。Inbox 锁、投影写入和 Inbox receipt 通过 Runtime 的嵌套事务上下文在同一本地事务中提交，提交后才 ACK；这不表示 API 与 Worker 共享登录角色。
- `node scripts/check/run-rabbitmq-integration.mjs` 使用临时合成证书与账号验证 `amqplib@2.0.1`/RabbitMQ `4.2.9` 的协议兼容矩阵；它不等同于生产 CA、镜像摘要、VHost/账号、轮换、恢复或告警证据。
- 生产 Compose 只开放 AMQPS 5671，关闭明文 listener，以独立 Publisher/Consumer 文件 Secret、环境隔离 VHost 和受限正则权限创建账号；Worker 只挂载自己需要的 PostgreSQL、CA 和两组 RabbitMQ 凭据文件。

## 允许的假设

- `platform.task-center` 是本消费者、三类首版告警和本 Runbook 的责任角色；具体当班人员由发布系统的值班表解析，不写入仓库。
- ADR-0027 的 1 并发、2 prefetch、30/300 秒退避及 10 秒超时是安全首版值，不代表容量或 SLA。

## 禁止的假设

- 不从 Message Schema、模块存在或通用 Worker Factory 推导 Notification、Workflow、File、Organization 或私有 Job 队列。
- 不自动重放 DLQ，不使用管理 UI 绕过授权/审计，不承诺恰好一次、自动故障转移、RPO、RTO 或 SLA。
- 不记录消息正文、完整 Header、SQL 参数、VHost、账号、证书路径、Secret、个人数据或异常自由文本。

## 非目标

- DLQ 人工重放权限和 UI、未确认后台 Job 调度、RabbitMQ 高可用、容量扩容及其他消费者。
- 应用启动迁移、自动 Schema 同步、CRM 业务状态或供应商 Adapter。

## 发布门

1. 固定 RabbitMQ 镜像摘要和 Worker 镜像摘要；执行本地兼容矩阵后，还必须从受信生产/预发证据系统提供真实 CA/主机名、镜像、账号权限与轮换结果的 `evidence://` 引用和摘要。本地合成测试不得作为替代。
2. 核对 Host A/Host B 的 VHost 相同且环境隔离；逐个 Secret 为 `root:<service-reader-gid>`、`0440`，普通账号不属于该组。不得输出文件内容。
3. 以 Worker 运行角色执行迁移兼容检查，确认 `platform_eventing` 与 `platform_task_center` 所需最小权限；应用不运行迁移。
4. 渲染 Compose 并执行 `pnpm compose:check` 与 Worker drain/stop-grace 数值门。Outbox batch/lease/attempt/backoff/interval 必须来自发布配置评审。只有 AsyncAPI 外部门禁的受信证据均已关闭且 release manifest 绑定其摘要后，才可显式设置 `AI_CRM_WORKER_TASK_PROJECTION_CONSUMER_ENABLED=true`。
5. 导入并验证 `deploy/monitoring/task-projection-alerts.v1.yaml` 的三条规则：DLQ 新增 1 条立即告警、Not Ready 持续 120 秒告警、最旧消息超过 300 秒并持续 300 秒告警。Owner 与升级目标必须解析成功。
6. 先以合成事件完成正常、重复、乱序、固定 30/300 秒重试、耗尽入 DLQ、数据库中断恢复、RabbitMQ 中断红elivery 与排空演练，再开放真实生产发布。

## 故障与恢复

- 数据库不可用：Worker Readiness 失败并停止新领取；不 ACK 无法完成 Inbox/投影事务的消息。数据库恢复且能力检查通过后重启 Worker，验证未 ACK 消息重投、Inbox duplicate 无重复副作用、投影版本不回退。
- RabbitMQ Blocked/断连：立即 Not Ready，取消消费并有界排空；未 ACK 消息保留给 Broker 恢复后重投。Outbox 事实保留在 PostgreSQL，不以日志替代。
- Retry Confirm 不确定：不 ACK 原 Attempt，不手工增加 Attempt；恢复后允许同 Attempt 重投。
- DLQ 新增：告警立即进入 `platform.task-center`。只读核对稳定技术 ID、策略版本和当前权威状态；在独立 DLQ 重放授权/审计合同接受前保持隔离，不重放、不删除。
- 停止：先写 unavailable 健康文件、取消订阅、等待在途 Handler 真正结束，再关闭 Rabbit Channel/Connection 与数据库。超出预算返回非零并允许 Broker 重投。

恢复证据只保存环境、Release、镜像摘要、稳定测试场景、开始/结束时间、结果、队列计数和 Inbox/投影对账摘要；不得保存载荷或 Secret。告警触发与恢复通知均需截图/事件引用，并由 `platform.task-center` Owner 签认。
