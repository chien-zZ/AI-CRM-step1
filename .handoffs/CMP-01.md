# CMP-01 API 与 Worker 组合根

- Status: blocked by module G2 prerequisites; G1 completed
- Owner: 当前会话（`apps/api`、`apps/worker` 组合根单一 Owner）
- Allowed paths: `apps/api`、`apps/worker` 的 Composition Root、Module Wiring、启动与健康入口，以及本任务 handoff

## 已知事实

- 第一阶段实施计划规定 CMP-01 只能在各模块通过 G2 后开始组合。
- G2 要求每个模块具备已评审公共入口、已评审契约、单元/契约测试、模块内部迁移，以及授权、审计、幂等和失败语义说明。
- G1 已让 `apps/api`、`apps/worker` 和平台目录成为真实 Workspace Package，但应用入口仍仅是技术包标识，不是 Composition Root。
- 平台模块当前只有 G1 最小公共入口，尚无达到 G2 的可注入服务、授权/审计/幂等/失败语义或模块迁移。
- 契约工具链和内部健康契约已建立，但 BFF、Workflow、通知、文件、事件和 Job 契约尚待对应模块 G2 工作包提供。
- `pnpm check` 已对 28 个 Workspace Project 执行真实任务，G1 前置门完成。
- 工作树已有与本任务无关的未跟踪目录 `deploy/compose/.runtime/`；本任务不修改或清理它。

## 允许的假设

- CMP-01 将在 G1 及所需模块的 G2 证据合并后，从其公共入口进行静态、显式依赖注入。
- API 与 Worker 保持独立进程、独立生命周期和独立健康状态。
- 迁移只做版本兼容性检查；应用启动不得自动同步或修改 Schema。

## 禁止的假设

- 不猜测尚未评审的模块导出名、构造参数、HTTP 路由、消息拓扑、Job Payload、数据库 Schema 或迁移版本格式。
- 不用组合根内部的临时 Repository、Schema、领域服务或全局 Service Locator 代替缺失的模块公共入口。
- 不把 README 描述当作可执行契约，也不创建 CRM 实体、字段、状态、权限、SLA 或审批路径。
- 不为通过健康检查而把尚未接线的 PostgreSQL、RabbitMQ、Redis、Keycloak、Flowable、ClamAV 或对象存储报告为 Ready。

## 非目标

- 不实现任何平台模块或 CRM 领域模块。
- 不新增或修改 HTTP、事件、AsyncAPI、Job、Workflow、通知或文件契约。
- 不新增数据库迁移、供应商适配器、生产 Secret 或部署拓扑。
- 不在缺少依赖公共接口时提交占位 Composition Root。

## 阻塞结论

CMP-01 当前仍不能进入实现。直接创建 NestJS Composition Root 将迫使本任务发明尚未达到 G2 的模块 API 和契约，违反模块公共入口边界以及“HTTP 和事件契约先于实现”的规则。

解除阻塞至少需要：

1. CMP-01 所需的平台模块逐一提供并评审公共入口、契约、测试、迁移和失败语义，达到 G2。
2. 明确 API/Worker 所需模块清单、各公共导出和 Composition Root 注入契约。
3. 明确 Liveness、Readiness、Startup/Shutdown 的统一技术契约。
4. 明确 Outbox Dispatcher、RabbitMQ Consumer、文件 Worker 和对账 Job 的公共 Worker 注册接口。

## 独立审查

- Authorization: 不适用；没有可组合的 Guard/Facade 公共入口，禁止在组合根自行实现授权。
- Idempotency: 阻塞；消费者、Job 和 Inbox 公共语义尚未实现或评审。
- Transactions: 阻塞；数据库和模块事务边界尚无公共入口。
- Migrations: 阻塞；没有迁移制品或版本检查接口，且禁止应用启动自动同步 Schema。
- Observability: 阻塞；只有边界说明，没有可供应用使用的公共 Logger、Trace 和 Health 接口。
- Backward compatibility: 无可比较的运行契约；后续只能依赖已评审公共入口组合。
- Secrets: 未新增 Secret；后续必须通过 typed `*_FILE` 引用并按服务最小挂载。
- Failure modes: 已拒绝把未接线依赖报告为 Ready；具体失败和恢复语义待各模块 G2 契约提供。

## 验证

- G1 验证见 `FND-01.md`、`FND-02.md`、`INF-01.md` 和 `DAT-01.md`；`pnpm check` 已执行 28 个包。
- 当前平台模块源码除 G1 包标识外没有可供组合的服务实现；因此 G2 和 CMP-01 仍未完成。

## 未解决问题

- 各前置工作包的 Owner、分支、评审结果和合并顺序尚未记录。
- CMP-01 所需模块何时达到 G2 尚未确定。
- 远程仓库与主分支保护仍未配置，G0 的服务端保护尚未闭环。
