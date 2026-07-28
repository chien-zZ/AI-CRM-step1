# CMP-WORKER-GENERIC — Worker 通用生产资源组合骨架

状态：完成（2026-07-28）

## 结论

`apps/worker` 已具备业务中立的生产资源组合骨架：typed、文件引用式 PostgreSQL 配置，完整迁移兼容性只读检查，有界数据库健康缓存，以及 publisher/consumer 两个独立 TLS RabbitMQ 账户的资源生命周期。Task projection consumer 仍明确不可用；生产 bootstrap 在完成通用校验后以稳定错误 `task_projection_consumer_policy_unavailable` 失败，关闭已获取资源并返回非零，未激活任何具体消费者。

## Known facts

- ADR-0026 已接受，但 Task projection 的 `maxAttempts`、`backoffSeconds`、`timeoutMs`、`prefetch`、`concurrency`、错误分类、容量和告警阈值尚未接受。
- 生产迁移由独立发布步骤执行；应用启动只能读迁移登记并验证兼容性。
- Rabbit publisher 与 consumer 使用不同的文件式账户凭据和 AMQPS/TLS 配置。
- `task-center` 的持久化投影存在不等于 Worker 获得 consumer responsibility。

## Allowed assumptions

- Worker 可复用 `@ai-crm/database` 的 `DatabaseRuntime` 和 `checkMigrationCompatibility` 公共入口。
- 通用组合可打开一个不声明 topology、不调用 `consume` 的 consumer-control 连接/Channel，用于验证 TLS、账户和资源健康生命周期。
- PostgreSQL/Rabbit 连接、健康检查和关闭可使用业务中立的有界技术超时；这些值不是 Task 消费策略。

## Forbidden assumptions

- 不推测或设置重试次数、固定 TTL/queue、backoff、handler timeout、prefetch、concurrency、错误类别、容量或告警阈值。
- 不声明 exchange、queue、routing key、binding 或 Task event/job type。
- 不调用 consumer adapter 激活 binding，不注册 Task handler，不启动 Outbox polling。
- 不在 Worker startup 执行 migration，不把凭据放入环境值、日志、健康文件或文档。

## Non-goals

- G3、E2E-01、OPS-02、DLQ replay、真实 provider/AI adapter。
- Task projection 的事件处理、幂等 receipt、重试和容量实现。
- 修改生产 Compose、迁移或 root lockfile；Integration Owner 需串行把 Worker 的 `@ai-crm/database: workspace:*` 写入 lockfile。

## 实现摘要

- `production-config.ts`：文件式 PostgreSQL Secret、Worker schema version、完整 11 个 migration 目录、连接/健康/兼容性技术边界，并加载既有 publisher/consumer Rabbit TLS 配置。
- `production-composition.ts`：只读 migration compatibility、DB health cache、publisher 与 topology-free consumer-control 的有界 acquire/abort/partial cleanup/late cleanup/close；readiness 永久包含 false 的 Task policy 项。
- `rabbit-adapter.ts`：topology-free runtime 只建立 AMQPS connection/channel；不 assert exchange/queue，不 prefetch，不 consume；Blocked 和 connection/channel close/error fail closed。
- `bootstrap.ts`：生产路径校验通用资源后显式触发稳定 Task policy unavailable gate，关闭资源并返回 `1`；cleanup failure 也不返回成功。

## 失败与关闭行为

- 配置/DB/Rabbit 任一 acquire 失败：关闭已获取 publisher 与 DB；cleanup 同时失败时保留为 `AggregateError`。
- acquire 超时/abort 后底层 Rabbit late completion：在同一有界窗口主动关闭 late resource，避免无 Owner 连接。
- migration incompatible 或首次 DB health unavailable：不发布 DB readiness。
- DB runtime loss、Rabbit Blocked、connection/channel close：readiness fail closed；Task policy 项始终 false。
- close 先失效状态并停止 health probes，再并行关闭 consumer-control、publisher、DB；超时为 `worker_production_resource_close_timeout`，拒绝为 `worker_production_resource_close_failed`。
- bootstrap 最终稳定返回非零；即使 close 失败也不宣称 Ready/成功。

## 测试证据

- Reviewer-fix focused：production config/composition/Rabbit adapter/bootstrap `32/32`。
- Worker full：`89/89`。
- Worker lint、typecheck、build：通过。
- Worker contracts check：通过。
- PostgreSQL 17.5 empty-database integration：database `24/24`（含 migration integration `1/1`），Compose 资源已清理。

覆盖：文件式 DB Secret、双 Rabbit 账户、完整迁移目录、incompatible migration、DB loss、Rabbit Blocked/channel-close、acquire abort、partial cleanup、late completion cleanup、close timeout/failure、bootstrap 稳定非零与失败关闭。

## 独立复审修复

- P1：Rabbit adapter acquisition 现接收 composition-owned `AbortSignal`。timeout/abort 会进入 connector、model、Channel acquisition 内部；若 model 已取得但 `createChannel`/`createConfirmChannel` 永不完成，会立即发起 Channel/model 强制关闭并让 acquisition 返回稳定取消。connector 自身 late completion 也会关闭 late model。新增 pending normal/confirm Channel 回归测试。
- P2：生产资源 `close()` 现使用共享 close operation；并发调用和 timeout 后重入等待同一底层关闭，不重复发起。若 close 已明确拒绝，只保留失败 target 供下一次 `close()` 重试，已成功 target 不重复关闭。bootstrap 不再静默吞 cleanup failure，会记录无敏感数据的 `worker_production_cleanup_failed` 并保持非零。
- P2：approved migration roots 增加 repo 双向 gate。配置加载时扫描 database migration root 和所有 `platform-modules/*/migrations`，与单一 Worker manifest 精确比较；新增或删除 root 都以 `worker_migration_root_manifest_mismatch` fail closed。当前真实仓库和增删 synthetic root 均有测试。

## Turbo 并发稳定性回归

- 最终全仓 Turbo 并发负载曾使 3 个 signal child case 在固定 3 秒启动 marker 窗口内超时；相同 Worker suite 独立运行持续通过，且真实 child 冷启动已接近 2–3 秒。
- marker 等待预算调整为有界 10 秒，仍严格小于每 case 的 30 秒总 timeout；子进程若在 marker 前退出会立即以 `child_exited_before_condition` 失败，不会等待满窗口或掩盖启动崩溃。
- SIGTERM/SIGINT 后的 exit code、readiness marker 删除、startup cancel 和 stuck drain 非零断言均未放宽。修复后 child `7/7`、Worker full `89/89` 通过。
- 一次与其他 agent 同时执行的 root check 在 Vitest 写 Worker `coverage/.tmp` 时发生共享目录清理竞争；该次无 child lifecycle failure，未作为通过证据。最终 root gate 应由 Integration Owner 串行执行。

## 八维复审

1. 授权/最小权限：publisher/consumer 账户分离；consumer-control 不拥有或激活 topology/handler。通过。
2. 幂等/重试：本切片不处理消息、不产生副作用；未编码任何未接受 retry policy。通过（非适用边界明确）。
3. 事务：startup 仅执行只读 compatibility/health；不启动业务事务、不写 DB、不跑 migration。通过。
4. 迁移：检查完整 11 目录的版本、checksum、record、compatibility evidence、unknown/missing migration；不自动同步。通过。
5. 可观测性/隐私：readiness 仅稳定依赖名与布尔健康；错误稳定且无 Secret/URL/payload/SQL 参数。通过。
6. Secret/供应商边界：PostgreSQL 与 Rabbit 凭据仅从文件读取；AMQPS 校验复用既有边界；无 provider SDK/业务数据。通过。
7. 生命周期/故障：acquire、abort、partial cleanup、late completion、probe generation、Blocked/channel-close、close timeout/failure 均 fail closed 且有测试。通过。
8. 向后兼容：开发/测试默认 composition 不变；新增公共导出为 additive；生产仍非零，不把骨架误报为 G3/Ready。通过。

## 后续阻塞

必须先接受 Task projection 精确运行策略和容量/告警责任，之后才能另行提交 topology、consumer adapter binding、handler 与生产启用证据。当前不得宣称 G3 通过。
