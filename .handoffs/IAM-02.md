# IAM-02 Organization Effective-Dated Core

- Status: independent review complete; G2 accepted
- Owner: 当前会话
- Allowed paths: `packages/platform-modules/organization`、其模块迁移、`contracts/models`、根 Lockfile、本任务 handoff

## Known Facts

- IAM-01 已通过 G2 并合并；认证公共边界只提供经验证的 Keycloak `issuer + sub`。
- `organization` 拥有 Workforce Person、Employment、Organization Unit、Position、Assignment 及认证主体到人员的有效关联。
- 内部访问必须解析到唯一人员和至少一个有效 Employment；并行 Assignment 合法，不能隐式选择第一条。
- 关闭事实保留历史；关闭单个 Assignment 不等于离职，Employment 关闭也不自动禁用 Keycloak 用户。
- 模块数据位于自有 PostgreSQL Schema，使用 reviewed/versioned Drizzle SQL migration；公共入口不得暴露数据库类型或事务句柄。

## Allowed Assumptions

- 第一阶段只固化稳定 UUID、必要外键和半开有效区间 `[effectiveFrom, effectiveTo)`。
- 缺少已确认业务字段时，Workforce Person、Organization Unit 和 Position 可以仅以稳定 ID 表达。
- 服务时间统一使用带时区 ISO-8601 字符串，持久层使用 PostgreSQL `timestamptz`。
- 合成 Fixture 使用随机 UUID 和 `example.test` Issuer，不代表真实公司结构。

## Forbidden Assumptions

- 不新增姓名、手机号、邮箱、员工号、人员状态、组织类型、岗位名称或真实层级。
- 不根据任何模糊属性自动关联主体与人员。
- 不把 Keycloak Claim、Role、Group 或登录成功解释为 Employment、Assignment 或授权。
- 不物理删除或覆盖有效期历史，不把并行 Assignment 当作数据错误。

## Non-goals

- 不实现真实 HRM/企微目录同步、负责人规则、公司账号禁用策略或管理 UI。
- 不实现 IAM-03 权限、CMP-01 应用组合或 CRM 领域模块。
- 不创建跨模块外键、跨模块查询或通用 Repository。

## Contract And Behavior

- 新增 transport-neutral Workforce Context JSON Schema。
- 公共服务提供受控创建/关闭命令、按认证主体解析和显式 Assignment 选择。
- 所有写命令要求 `operationId`、Actor、Reason 和 Trace 引用；Store 必须将状态、幂等 Receipt、审计 Intent 与 Outbox Intent 原子提交。
- 重复 `operationId` + 相同指纹返回原结果；不同指纹失败关闭。

## Migration Guidance

- 模块迁移只创建 `organization` Schema 及自有表、约束和索引。
- 迁移为追加、非破坏性；空库和当前基线均可升级。
- 应用回滚保留新增结构；若需修复，追加前滚迁移，不机械删除历史事实。

## Unresolved Questions

- 人员展示字段、Employment 业务分类/状态、组织节点类型、岗位目录和负责人规则未确认。
- 多 Assignment 的客户端选择交互和默认策略未确认；服务端因此只接受显式选择或返回全集。
- 管理命令的正式权限码与审批规则留给 IAM-03/后续业务规则确认。

## 2026-07-26 Implementation Result

- 新增 Workforce Context V1 模型合同和 Organization Change V1 transport-neutral 事件合同；两者只包含稳定引用、解析时间/生效时间，不含显示属性、目录标识、Keycloak Claim、角色或权限。
- `OrganizationService` 提供人员、Employment、组织单元、有效期 Placement、Position、Assignment、主体关联的受控创建/关闭和主体上下文解析。
- 多个有效 Assignment 原样返回；调用方可以显式选择一个 Assignment，服务端不会选择隐式第一条。
- 写命令必须提供 UUID `operationId`、Actor、Reason、Trace，并先通过必填 `OrganizationCommandAuthorizer`；该端口不硬编码角色或权限码。
- `OrganizationStore.commit` 把状态、幂等 Receipt、包含目标的审计 Intent 和 transport-neutral 事件 Intent 作为一个原子提交边界。
- 内存 Store 覆盖核心不变量；PostgreSQL Store 使用参数化 SQL；包根只暴露模块专用的 ambient-transaction Persistence Runtime，不导出 Store 写入口、Drizzle Table、数据库行、Query Builder 或事务句柄。
- 私有 Drizzle Schema 与 `0000000002_organization_effective_dated_core` 迁移创建模块自有 `organization` Schema；复合外键锁定 Assignment 的 Person/Employment 和 Position/Unit 一致性。
- PostgreSQL Trigger 使用确定顺序的事务级 Advisory Lock 拒绝并发重叠主体关联，并拒绝同一组织单元的重叠 Placement。
- 模块迁移命令只读取 `DATABASE_MIGRATION_URL_FILE`，复用专用迁移凭据、Checksum 和全局迁移锁；应用启动不自动迁移。

## Verification Evidence

- 默认组织测试：14 项通过，4 项环境门控 PostgreSQL 测试按设计跳过。
- 真实 PostgreSQL 17.5 集成：4 项通过，覆盖空库基础/模块迁移、上下文持久化、审计/事件/Receipt 同事务、事件目标与生效时间、故障回滚、并发主体关联冲突，以及未来时点层级循环的数据库拒绝与稳定错误映射。
- 一次性执行器使用随机临时文件式 Secret、回环随机端口和固定镜像；验证后容器与临时 Secret 目录已清理。
- 合同生成与 `pnpm contracts:check`：通过，28/28 包成功。
- `pnpm check`：通过；28 个 Workspace 包共 140 个 build、lint、typecheck、test、contracts:check 任务全部成功，仓库边界、合同确定性和 Compose 静态安全检查通过。

## Implementer Review Pass

- Authorization：所有写命令在持久化前调用必填服务端 Authorizer；无默认允许、无角色名或权限码；正式策略留给 IAM-03。
- Idempotency：同一 `operationId` 和指纹返回原结果，不同指纹失败关闭；PostgreSQL Receipt 与状态同事务，并发由唯一主键串行化。
- Transactions：状态、Receipt、审计 Intent、事件 Intent 同一环境事务；故障注入证明事件记录失败时其他三类写入全部回滚。不宣称跨 Keycloak/Redis 的分布式事务。
- Migrations：迁移追加、非破坏、模块隔离；提供锁影响、数据影响、恢复和前滚修复说明。应用回滚保留组织历史。
- Observability：使用稳定错误码、受限操作名和 Trace 引用；不记录认证凭据、请求体、人员显示属性、SQL 参数或外部 Provider Payload。具体 Logger/Metric/Health 由 CMP-01 组合。
- Backward Compatibility：从空公共入口新增 V1 合同和根导出，没有旧运行接口或数据需要兼容；数据库变化纯新增。
- Secrets：生产/测试数据库连接只接受文件引用；集成随机 Secret 不进入参数、环境值或日志并在结束后清理。
- Failure Modes：无关联、关联冲突、无有效 Employment、无效/缺失 Assignment、层级循环/损坏、非法区间、授权拒绝、幂等冲突和数据库事务失败均失败关闭。
- Independent Review：本节是实现者自查，不能替代质量清单要求的非原实现者 Review；IAM-02 尚未声明通过 G2。

## 2026-07-26 Self-Review And Repair Loop

### Loop 1：Authorization、Idempotency、Public Boundary

- 修复 Authorizer 缺少目标实体：现在每次写授权都包含稳定 Action、Actor、Entity Type、Entity ID 和 Operation ID，支持对象级服务端裁决。
- 授权前移到任何实体读取之前；未授权命令不能通过 `not found` 或关系校验结果探测组织事实。
- 幂等指纹加入 Actor 与 Reason，同时保留 Trace 可变化；跨主体或改变语义复用 Operation ID 失败关闭。
- 包根不再导出 Store、Write 或可直接提交状态的工厂；只导出授权内置的 Service Factory/API 和模块专用 Persistence Runtime。
- 显式 Assignment 选择先过滤再校验路径；一个损坏或关闭的无关 Assignment 不会撤销其他仍有效上下文。

### Loop 2：Effective Time、Hierarchy、Migration

- 新增父子有效区间包含校验；Position、Placement 和 Assignment 不能延伸超过其 Unit、Parent、Employment 或 Position 的有效区间。
- 上下文解析现在验证完整组织路径的唯一 Placement、节点有效性和循环，路径损坏失败关闭。
- 循环检查覆盖新 Placement 区间内所有已排定 Placement 起点，不只检查创建瞬间。
- PostgreSQL Trigger 使用全局层级 Advisory Lock 串行化层级写入，并在全部相关未来边界递归检查循环；数据库 `P1001` 映射为稳定 `organization_hierarchy_cycle`。
- Drizzle Schema 补齐 SQL 迁移中的 Check、复合唯一约束、复合外键和 Receipt 长度约束，消除 Schema/迁移漂移。

### Loop 3：Audit、Composition、Documentation

- 成功审计 Intent 显式记录 `result=succeeded`；拒绝决策由 Authorizer/IAM-03 的授权审计边界拥有。
- PostgreSQL Factory 的公共参数收敛为模块专用 ambient-transaction Persistence Runtime，不暴露事务句柄或数据库模型。
- 文档明确上下文解析只接受服务端已验证主体；Memory Service 只用于测试/合成 Fixture，禁止作为生产事实存储。
- 第三轮修复后的再次复审未发现新的 Authorization、Idempotency、Transactions、Migrations、Observability、Backward Compatibility、Secrets 或 Failure Modes 问题。

## 2026-07-26 Independent Review Result

- 独立 Review 已完成并由项目负责人确认通过。
- Review 覆盖 Authorization、Idempotency、Transactions、Migrations、Observability、Backward Compatibility、Secrets 与 Failure Modes；修复已包含在 `IAM-02: harden organization review findings`。
- IAM-02 公共入口、合同、迁移和测试证据已接受，工作包通过 G2，可进入后续 IAM-03 工作包。

## 2026-07-30 Temporary Migration Compatibility Notice

- Git history proves `0000000003_eventing_outbox_inbox_core` was introduced by `acc1675` before `444af9c` introduced `0000000003_recheck_placement_parent_updates`; commit `57a6d30` contains both paths through the merged history.
- The migration loader present in `444af9c` rejects globally duplicated versions, and the Organization metadata in that commit also marked SQL containing `DROP TRIGGER` as non-destructive even though the loader rejects that combination. Therefore the complete repository migration catalog containing the Organization `0000000003` could not pass the reviewed global loader from the moment that file was introduced.
- This repository evidence does not prove whether an operator bypassed the global catalog. The historical single-module integration path loaded the database and Organization directories separately, so only disposable module-test databases could legitimately have recorded the Organization `0000000003` outside the complete catalog. Such test databases must be destroyed and rebuilt from the corrected global catalog; they must not be upgraded by editing `ai_crm_migrations.applied_migrations`.
- If any staging, production, shared development, backup, or other non-disposable database shows the Organization `0000000003` as applied, rollout is blocked. Preserve the database and migration evidence, identify the exact SQL checksum and execution path, and require a human migration audit and reviewed forward repair. No runner or migration tooling may automatically rename, delete, insert, or rewrite an applied-registry row.
