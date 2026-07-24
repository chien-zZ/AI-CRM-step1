# INF-01 本地与 CI Compose

- Status: completed
- Owner: 当前会话
- Allowed paths: `deploy/compose`、`deploy/keycloak`、`deploy/flowable`、`deploy/nginx`、相关运维脚本与说明

## 已知事实

- 第一阶段本地/测试需要 PostgreSQL、Redis、RabbitMQ、Keycloak、Flowable、ClamAV 和 Nginx。
- 生产两主机放置、容量和 Secret 属于后续 OPS-01，当前尚未确认。
- `deploy/compose/.runtime/` 已有用户未跟踪内容，本任务不读取、覆盖或清理它。

## 允许的假设

- 开发端口只绑定 `127.0.0.1`；测试环境不发布状态服务端口。
- 开发/测试 Secret 由初始化脚本在被忽略的运行时目录生成。

## 禁止的假设

- 不使用 `latest`、生产默认密码、公开状态端口、Kubernetes、Swarm 或 APISIX。
- 不声明生产高可用、SLA、RPO 或 RTO。

## 非目标

- 不生成生产 Compose、生产 Secret、备份策略或两主机服务放置。

## 验证

- `pnpm compose:check` 与 Docker Compose 合并配置检查通过。
- 七组件隔离测试中 PostgreSQL、Redis、RabbitMQ、Keycloak、Flowable REST、ClamAV 和 Nginx 全部达到 Healthy；ClamAV 固定为已复验的 `1.4.5-debian` 补丁版本。
- 测试结束后 7 个容器、4 个 Volume、2 个项目网络和系统临时 Secret 目录全部删除。
- Compose 与 PostgreSQL 集成脚本为每次执行生成唯一 `ai-crm-test-g1-*-<run-id>` 项目名，并发运行不会相互清理资源。
- 开发端口只绑定 `127.0.0.1`；测试 overlay 不发布端口。
- 所有服务都有固定镜像、健康检查、资源上限、日志轮转和停止宽限期。

## 独立审查

- Authorization: Keycloak 仅导入空开发 Realm，不创建业务角色、用户或 Client。
- Idempotency: Secret 初始化保留既有文件；重复 Compose 启停由独立 project/Volume 隔离。
- Transactions/Migrations: PostgreSQL 初始化只创建隔离数据库和技术账号；应用迁移由独立 DAT-01 步骤执行。
- Observability: JSON 文件日志轮转和容器健康状态已定义；应用 Pino/Sentry/Trace 属于 INF-02。
- Backward compatibility: 镜像均固定版本；升级需要重新运行完整健康测试。
- Secrets: 随机值只存在于忽略或系统临时文件；不进入 Compose 字面值和命令参数。RabbitMQ/Redis 使用容器内临时配置后降权启动。
- Failure modes: 依赖启动顺序基于健康条件；完整栈失败时输出受限末尾日志并仍清理隔离资源。

## 未解决问题

- 生产两主机放置和生产 Secret 挂载仍属于 OPS-01，不由 INF-01 推断。
