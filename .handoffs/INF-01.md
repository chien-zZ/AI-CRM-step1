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

## 2026-07-26 IAM-01 Secret Contract 扩展

- 根据已确认的跨任务职责，INF-01/CMP 部署侧为本地开发与本地测试实现 PC BFF Keycloak Client Secret 文件注入；IAM-01 继续拥有认证语义和集成验收。
- `compose-secrets.mjs` 新增独立的 `pc_oidc_client_secret`，Compose 仅以 Secret 文件挂载给 Keycloak。
- `realm-dev.json` 只保存合成 confidential PC BFF Client 和 Secret 标记，不包含真实 Secret、用户、角色或业务权限。
- Keycloak 入口在容器启动时从 `/run/secrets/pc_oidc_client_secret` 读取合成 Secret，仅在 Shell 内存中替换标记，并以 `umask 077` 生成容器私有临时 Realm Import；Secret 不进入环境变量或命令参数。
- Secret/模板缺失、Secret 格式非法或模板标记缺失时启动失败关闭；不回退到 Public Client、Direct Grant 或无 Secret 配置。
- 静态 Compose 检查新增回归守卫：必须挂载 Client Secret、模板不得直接挂到 Import 目录、Realm Client 安全开关必须保持、入口不得导出 Client Secret、Bootstrap 必须生成对应文件。

### 验证证据

- `pnpm compose:check` 通过。
- 使用一次性 Secret 目录和隔离 Compose Project 启动 PostgreSQL 17.5 与 Keycloak 26.3.1，两者均达到 Healthy。
- `ai-crm-dev` Realm 的 OIDC Discovery 返回 HTTP 200；生成的 Import 包含 `ai-crm-pc-bff` 且不再含 Secret 标记。
- 省略 `pc_oidc_client_secret` 的独立容器以退出码 1 失败，并只输出有界缺失错误。
- 验证后的容器、网络、Volume 和临时 Secret 目录已清理。

### 保留边界

- 当前只完成本地开发/本地测试机制。测试服务器和生产服务器的受限主机文件、轮换、撤销、备份与恢复仍由后续 OPS 工作包实现和验收。
- 本扩展不解除 CMP-01 的模块 G2 前置阻塞，也不代表 IAM-01 或 G2 已完成。

### 2026-07-26 Client Secret 轮换补充

- Keycloak `--import-realm` 只作为不存在 Realm 的首次 Bootstrap，不再将重启时生成 Import 文件描述为 Secret 轮换机制。
- 新增仅限本地/测试的 `pnpm auth:rotate-client-secret`：管理密码和当前 Client Secret 均从受限文件读取；新值只存在于进程内存和同目录 `0600` 临时文件，不进入环境值、命令参数或日志。
- 脚本获取完整 Client Representation 后更新并读取 Keycloak Client Secret 端点确认，再原子替换文件；替换失败时恢复 Keycloak 旧值并删除临时文件。
- 认证真实集成执行器在已有 Realm 上执行一次轮换，再运行完整 IAM 测试，证明后续 OIDC Client 使用轮换后的文件值；生产 Owner、双人复核、两主机顺序、维护窗口和事故动作仍由 OPS 定义。

### 2026-07-26 轮换失败边界补充

- 本地/测试 Client Secret 轮换新增 1～60 秒必填管理请求超时；Token、查询、更新、验证和回滚分别获得新的 AbortSignal。
- 新 Secret 临时文件在 Keycloak 更新前完成 `0600` 权限、写入和关闭；原子 Rename 是最终提交操作。Rename 前失败会尝试恢复 Keycloak 旧值并清理临时文件，不再存在“文件已换新但 Keycloak 回滚旧值”的 `chmod` 后置窗口。
- Session 加密 Keyring 的上一版本文件属于 API 消费者挂载，不属于 Keycloak；INF/CMP 组合时最多挂载当前、上一版本和独立索引密钥。上一版本在全体消费者切换后保留不超过绝对 Session TTL，再从配置与挂载中一起移除。

### 2026-07-26 认证集成执行器补充

- 新增 `compose.auth-test.yml`，仅为一次性 IAM 集成测试在可配置回环端口发布 Keycloak/Redis；PostgreSQL 继续只在项目私有网络内可见。
- 新增 `pnpm auth:test:integration` 执行器，自动创建隔离项目和临时 Secret、运行真实 Keycloak/Redis 测试，并在 `finally` 清理容器、Volume、网络与 Secret 目录。
- Compose 静态检查确认认证测试端口只能绑定 `127.0.0.1`，Realm Audience Mapper 和文件式 Client Secret 约束保持成立。

### 2026-07-26 认证边界闭环补充

- Client Secret 更新请求一旦发起即视为远端状态不确定；响应超时或断开时也尝试恢复旧值。故障注入覆盖 Keycloak 已应用新值但客户端未收到成功响应的路径。
- Realm Audience Mapper 现在只向 Access Token 添加独立 API Resource Audience `ai-crm-api`；OAuth Client ID 继续为 `ai-crm-pc-bff`。Compose 静态检查固定这两个边界，避免 ID Token 因复用 Client Audience 被认证 API 接受。
- API 组合必须显式提供非 Secret 配置 `AI_CRM_OIDC_API_AUDIENCE=ai-crm-api`；测试服务器/生产服务器可以使用环境特定的已评审 Audience，但不得将 OAuth Client ID 与 API Resource Audience 合并。
- 真实 Keycloak/Redis 集成 52/52 通过，包含同一登录签发的 ID Token 替换拒绝；容器、Volume、网络与临时 Secret 全部清理。
