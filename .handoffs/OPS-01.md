# OPS-01 Deployment Configuration And Release Gates

- Status: `IMPLEMENTING`
- Branch: `task/OPS-01-release-gates`
- Owner: Agent D
- Independent Reviewer: Agent B

## Objective

建立开发、测试、预发布和两台生产主机的版本化部署边界，提供业务中立的双主机 Compose 结构、同站点入口、不可变发布清单、逐台发布/Worker Drain/回滚 Runbook，以及不会接触 Secret 值的自动发布门禁。

## Known Facts

- 第一阶段生产是两台腾讯云 Ubuntu CVM，每台运行独立 Docker Compose Project；不是跨主机集群。
- API 至少一台主机一个副本；PostgreSQL、Redis、RabbitMQ、Keycloak、Flowable 和 ClamAV 仍是自托管状态/支撑组件。
- 生产 Secret 使用 root-owned 受限文件、Compose Secret/只读单文件挂载和 `*_FILE` 引用。
- Pino、托管 Sentry、腾讯云云监控、外部可用性探测及 W3C Trace Context 是已批准的第一阶段可观测性方向。
- 当前没有批准的主机规格、容量、域名、镜像仓库、真实镜像摘要、告警接收人、SLA、RPO 或 RTO。

## Allowed Assumptions

- Host A 暂时承载入口和单实例状态组件，Host B 承载第二入口、第二 API 与 Worker；该放置用于形成明确的第一阶段人工恢复拓扑，后续容量/故障域评审可版本化调整。
- 两台主机通过受控私网地址互访；仅 Nginx 公开，状态端口仅绑定私网并由安全组限制。
- 非敏感发布参数由受控 release manifest/host configuration 提供；Secret 值始终只从目标主机受限文件读取。

## Forbidden Assumptions

- 不宣称自动故障转移、零停机、高可用、SLA、RPO 或 RTO。
- 不写入真实主机、域名、账号、证书、Token、密码、Sentry DSN、COS 凭据或其他 Secret。
- 不引入 Kubernetes、Swarm、Prometheus、Grafana、Loki、ELK、OpenTelemetry Collector、自托管 Sentry、Vault 或云 Secret Manager。
- 不在发布模板中使用 `latest`、浮动应用镜像、生产 `.env`、明文 Secret 或跨主机 Compose 网络幻觉。

## Non-goals

- 不实现 `apps/api`、`apps/worker` Composition Root 或应用健康端点；这些属于 CMP-01。
- 不执行真实生产发布、DNS 切换、证书签发、备份恢复或安全演练；恢复与演练属于 OPS-02。
- 不确认 CRM 容量、业务 SLA、告警阈值或任何真实 Provider 配置。

## Authority And References

- `AGENTS.md`
- `docs/01-权威与基线/第一阶段部署范围.md`
- `docs/08-架构决策/ADR-0021-第一阶段两台云服务器Docker-Compose部署.md`
- `docs/08-架构决策/ADR-0022-第一阶段轻量可观测性基线.md`
- `docs/08-架构决策/ADR-0023-文件式Secret与两台主机安全基线.md`
- `docs/04-工程手册/部署与发布基线.md`
- `docs/09-安全与数据治理/Secret与主机安全基线.md`

## Allowed Paths

- `deploy/**`
- `scripts/deploy/**`
- `scripts/check/verify-compose.mjs`
- `scripts/check/*release*.test.mjs`
- deployment/release documentation
- `.handoffs/OPS-01.md`

## Forbidden Paths

- `apps/api/**`、`apps/worker/**`
- 平台/领域模块、契约源、生成制品、根 Lockfile
- 真实 Secret、生产 `.env`、真实账号和 Provider 配置

## Authorization And Audit

- 发布清单只接受有界 operator/approver 引用，不接受自由文本身份或 Secret。
- 真实生产发布需要人工批准并在外部受控审计系统记录；仓库模板只定义必要证据字段，不伪造批准事实。

## Idempotency, Transactions And Migrations

- 部署脚本以 release ID、不可变镜像引用和主机项目名为稳定输入；重复验证无副作用。
- 本任务不持有业务事务或数据库事务。
- 发布门要求迁移已评审、兼容扩展、恢复点可用；应用回滚不等同于数据库回滚。

## Observability, Secrets And Failure Modes

- Compose 定义日志轮转、健康检查、优雅停止、资源参数和最小网络边界。
- Sentry/云监控/外部探测不可用不能阻断业务；生产启用前仍需真实账号、区域、保留和数据边界评审。
- Secret 缺失、权限错误、镜像非不可变、门禁证据缺失、主机目标不明确、Worker 未 Drain 或回滚材料缺失时均失败关闭。
- 发布与校验输出不得回显 Secret 值、Cookie、Token、请求正文、个人数据或 Provider Payload。

## Backward Compatibility

OPS-01 新增生产部署结构和校验，不改变现有开发/测试 Compose。CMP-01 接入应用运行配置时必须保持当前 release manifest/health/stop 约定兼容，必要变更需版本化。

## Required Tests And Evidence

- 生产 Compose 静态检查：独立项目、固定/受控镜像、健康、日志轮转、资源、停止、无 Docker Socket/特权/公网状态端口、Secret 最小只读挂载。
- Release manifest 正常、拒绝、重复验证、畸形/漂移镜像、缺门禁、Secret-like 字段和错误主机放置测试。
- `git diff --check`、`pnpm compose:check`、专项 Node tests、完整 `pnpm check`。

## Review Checklist

Owner 与 Reviewer 每轮必须明确 Authorization、Idempotency、Transactions、Migrations、Observability、Backward Compatibility、Secrets、Failure Modes；不适用项写明依据。Reviewer 只输出可复现 findings，不直接修改实现。

## Owner Self-review Round 1

- Authorization：release manifest 要求 operator/approver 有界引用且必须不同；真实权限和人工批准由外部受控发布系统执行，仓库校验不伪造授权成功。
- Idempotency：manifest 验证和变量渲染为纯、可重复、无副作用操作；两个 Compose project、release ID 和不可变镜像引用显式稳定。
- Transactions：本任务无业务/数据库事务；逐台发布和 Worker Drain 的中断点、停止条件及证据保存在 Runbook。
- Migrations：无 Schema 变更；发布门要求单一迁移身份、兼容扩展、恢复点和前滚修复，明确应用镜像回滚不回滚数据库。
- Observability：Nginx 访问日志只含时间、状态、耗时和 request ID，不含 IP、URL、Query 或正文；Docker 日志轮转、健康检查和 Sentry/云监控/外部探测启用门明确。
- Backward Compatibility：不改变开发/测试 Compose；生产模板在 CMP-01 前失败关闭，最终应用端口、健康、Worker/Secret 消费只能兼容扩展或版本化修改。
- Secrets：Compose 仅保存 `${AI_CRM_SECRET_ROOT}` 引用并逐文件挂载；长驻 Keycloak 不持有 bootstrap 管理员 Secret；Redis/RabbitMQ 文件值在进入配置前按 43 字节 base64url 格式校验且不输出。
- Failure Modes：非不可变镜像、门禁/Hash/双主机放置缺失、operator/approver 相同、Secret-like 字段、资源/主机参数缺失均失败关闭；Runbook 覆盖迁移失败、Worker Drain 超时、实例不就绪、敏感日志和状态主机故障。

自审修复包括：Nginx `combined` 日志可能记录完整 URL/Query，已改为最小安全技术格式并增加静态门；Redis/RabbitMQ 在 capability drop 后的 root/chown 假设，已改为专用非 root 入口且验证 Secret 格式；常驻 Keycloak bootstrap 管理凭据非最小挂载，已从服务定义移除并隔离为一次性受审操作；示例 TTL/超时值可能被误读为已批准生产参数，已改为显式待评审标记。

Round 1 Owner 证据：release tests 8/8；两个生产 Compose 文件经 `docker compose config --quiet` 分别解析；production shell scripts 语法检查通过；`pnpm compose:check` 通过；完整 `pnpm check` 140/140；`git diff --check` 通过。等待 Agent B 对精确 Owner candidate 独立 Review。

## Independent Review Round 1 And Fixes

- P1 Edge 无法在 read-only/non-root/template 布局启动：Reviewer 使用 `nginx:1.28.0-alpine` 复现 `/etc/nginx/conf.d` 不可写及 cache 临时目录 permission denied。Host A/B 现分别要求独立 Edge UID/GID，并对 `/etc/nginx/conf.d`、`/var/cache/nginx`、`/var/run`、`/tmp` 声明精确 `uid/gid/mode=0750` tmpfs；静态门验证四个目录。新增真实容器检查生成一次性合成证书，按相同 read-only/non-root/tmpfs/template 布局启动 Nginx 并从容器内验证 `/health/live`，临时证书和容器最终清理。
- P1 release gates 可由调用方用布尔 `true` 伪造：每个 gate 现必须包含有界 `evidence://` 引用和 SHA-256 内容摘要；布尔值、HTTP 任意引用、畸形/缺失摘要失败关闭。发布权威仍必须从批准证据库解析引用、重算摘要并校验 CI/审批身份；CLI 输出改为只声明结构和 evidence binding 有效，不宣称底层证据已满足门禁。

Round 1 修复后专项证据：release tests 10/10；`pnpm compose:check` 通过；部署/检查脚本 ESLint 通过；两个 Compose 仍可由 Docker 解析；真实 Production Edge read-only/non-root 启动、模板渲染与 liveness 通过。等待原 Reviewer Round 2 复查。

## Independent Review Round 2 And Fix

- P1 Edge 在 root-owned `0400` TLS 文件下仍不可读：确认 standalone Compose 的 file-backed Secret 不为非 root 消费者重映射权限，且同类问题影响所有非 root Secret 消费者。生产基线现统一要求挂载文件 `root:<专用 Secret-reader GID>`、`0440`；只有声明 Secret 的服务通过 `group_add` 获得该 supplementary GID，Secret 根目录不挂载、普通主机账号不作为常驻成员。Edge 容器检查改用 Docker Volume 由 root 创建 `0:<synthetic gid> 0440` 证书/私钥，断言 ownership/mode 后以 UID/GID 101 + supplementary group + 两个只读 volume-subpath 启动，覆盖真实非 root 读取语义。

Round 2 修复需重新通过 Edge 容器、Compose 静态/解析、release tests、ESLint、完整 `pnpm check`，再交原 Reviewer Round 3。

## Independent Review Round 3 Acceptance

- Reviewer 对精确 candidate `fe1c6e19b30525269293d90ba28572936849ba3b` 复查，P0-P3 可执行 finding 为零，未决架构或契约问题为零。
- Round 1 的 Edge writable tmpfs 与 evidence binding 两项 P1、Round 2 的 non-root Secret 可读性 P1 均关闭；同源检查确认只有 Secret 消费服务获得 supplementary reader GID，Secret 根目录未挂载。
- Reviewer 复跑 release 10/10、`pnpm compose:check`、真实 Production Edge Docker health；Owner 的两个 `docker compose config --quiet`、部署脚本 ESLint、shell syntax、`git diff --check` 和完整 `pnpm check` 140/140 证据有效。
- Authorization、Idempotency、Transactions、Migrations、Observability、Backward Compatibility、Secrets、Failure Modes 八项无新增 finding；本任务无业务事务或 Schema migration 的不适用依据保持成立。

G2 决策：`G2_ACCEPTED`。真实生产发布仍受 CMP-01、E2E-01、OPS-02、容量/安全/数据边界和人工批准阻塞；本结论不证明真实证据源或生产可用性。

## Unresolved Questions

- 最终主机规格、域名/IP、镜像仓库与摘要、证书、资源限制、状态盘、真实 Owner、告警阈值、Sentry 区域、RPO/RTO 和保留期仍待上线前评审。
- CMP-01 将确认 API/Worker 的最终端口、健康端点、运行配置和 Secret 消费清单。
