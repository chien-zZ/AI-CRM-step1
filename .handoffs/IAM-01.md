# IAM-01 Keycloak、BFF 与 Auth Context

- Status: G2 approved
- Owner: 当前会话
- Allowed paths: `packages/platform-modules/auth-context`、`apps/api` 的认证适配边界、`deploy/keycloak`、认证 HTTP/错误契约、生成契约制品、根 Lockfile、本任务 handoff

## Known Facts

- G1 已通过，G2 要求模块具备已评审公共入口、契约、测试，以及授权、审计、幂等和失败语义。
- Keycloak 是唯一认证权威；项目不自建密码、认证 JWT 或 Refresh Token 体系。
- PC Web、内部 H5 和外部 H5 使用彼此隔离的 BFF HttpOnly Cookie；小程序只能持有短期不透明服务端会话句柄。
- `auth-context` 只验证可信 Keycloak 结果并输出传输无关认证主体；人员、Employment 和 Assignment 由 IAM-02 的 `organization` 解析。
- 会话时长、并发设备数、重新认证范围和强制失效传播目标仍未确认。
- Keycloak Compose 镜像已固定为 `26.3.1`，现有 Realm 文件只有 G1 占位内容。

## Allowed Assumptions

- 使用合成 Realm、Client 和主体测试认证协议，不创建真实人员、岗位、角色或业务权限。
- OIDC/JWT 验证可采用成熟 JOSE 库，并通过窄公共类型隔离第三方实现。
- 未确认的会话时长必须由类型化配置提供，不在实现中散落默认业务值。
- 本地合成 Realm 可使用回环 HTTP；非回环 Issuer/JWKS 必须使用 HTTPS。

## Forbidden Assumptions

- 不根据姓名、手机号、邮箱、`userid`、`openid` 或 `unionid` 自动关联身份。
- 不把 Keycloak Role/Claim、认证成功或会话存在解释为业务授权、人员有效或任职有效。
- 不允许客户端接收 Keycloak Token、Client Secret、授权码、Cookie 值或微信 `session_key`。
- 不实现企微/微信真实登录，不创建外部主体、邀请表、匿名业务端点或账号恢复规则。
- 不猜测未确认的 Session TTL、设备并发上限、权限码或强制失效 SLA。

## Non-goals

- 不实现 IAM-02 组织模型或 IAM-03 授权核心。
- 不修改 CRM 领域模块、业务表或业务状态。
- 不创建真实 Provider Adapter、Keycloak SPI 或生产 Secret。
- 不进入 CMP-01 的全应用 Composition Root；`apps/api` 仅容纳 IAM-01 自有 BFF 适配边界。

## Authority And References

- 根 `AGENTS.md`
- ADR-0004、ADR-0005、ADR-0017、ADR-0018
- `docs/03-模块说明/认证上下文与会话边界.md`
- `docs/04-工程手册/第一阶段AI并行开发实施计划.md`
- `docs/06-质量验收/第一阶段Walking-Skeleton验收清单.md`

## Contract Changes

- 新增按客户端受众隔离的认证 HTTP 源契约；生成 Bundle 与 API Client 只由生成器更新。
- 新增稳定、传输无关的认证主体公共类型和归一化认证失败类别。

## Migration Changes

- `auth-context` 不拥有数据库 Schema；短期会话归 Redis 适配器，不创建 PostgreSQL 迁移。

## Required Tests

- Token 签名、Issuer、Audience、过期和必要 Claim 验证。
- 主体输出不包含原始 Token、角色、Cookie 或提供商标识。
- 非法配置与 JWKS 不可用失败关闭。
- 后续 BFF 批次覆盖 State、Nonce、PKCE、CSRF、轮换、刷新并发、注销与过期。

## Authorization And Audit

- IAM-01 只建立认证会话，不裁决业务授权；所有受保护业务请求仍交由 IAM-03 服务端裁决。
- 登录、回调、刷新、注销、撤销和拒绝需要安全审计意图，但不得记录认证凭据。

## Idempotency, Retry And Failure

- Token/JWKS 验证失败关闭，不回退为匿名高权限。
- JWKS 只允许库内受控缓存和密钥轮换刷新；调用方不得盲目重试认证写操作。
- OAuth 回调、会话轮换和注销采用一次性/幂等语义；具体实现在 BFF 批次完成。

## Observability And Health

- 仅暴露有界错误类别、结果和安全 Trace 引用；禁止 Token、Cookie、授权码、请求体和完整 OIDC 响应进入遥测。
- Keycloak/JWKS 或会话存储不可用时认证入口失败，不能伪报 Ready。

## Backward Compatibility

- 当前只有 G1 包标识，没有旧运行契约；新增导出保持包根公共入口，不提供深层导入。

## Deliverables

- 认证 HTTP 源契约与生成制品。
- `auth-context` 公共入口、OIDC 验证实现和单元测试。
- BFF 会话安全适配边界、合成 Keycloak Realm 与相关测试。
- 独立 Review Pass 和验证证据。

## Unresolved Questions

- 会话空闲/绝对 TTL、并发设备数、重新认证范围和强制失效目标仍待安全 Owner 确认。
- 内部 Keycloak 账号禁用、恢复和全部 Employment 失效后的公司级策略未确认。
- 真实回调域名、生产 Client、企微/微信 SPI、Provider 应用和测试账号未确认。

## Handoff Result

- 执行中；已建立 `codex/IAM-01-auth-context` 分支并完成第一批认证公共边界，未声明 IAM-01 或 G2 已通过。

### 2026-07-24 第一批实现

- 新增 PC BFF 登录、回调、当前会话、刷新和注销 OpenAPI 源契约，生成内部 Bundle/API Client；外部 Client 仍无认证操作。
- `auth-context` 新增基于 `jose@6.1.0` 的 RS256/PS256 验证，校验签名、Issuer、Audience、有效期、必要 Claim 和客户端绑定，输出仅含 `issuer + sub`、Client 与 Token 时间边界的传输无关主体。
- JWKS 超时/非法响应归类为依赖不可用，坏签名、错误受众/客户端和缺失 Claim 归类为坏 Token；所有错误消息均不携带原始异常或凭据。
- `apps/api` 的 IAM-01 适配边界新增 256-bit 不透明凭据、HMAC 会话索引、AES-256-GCM Token 信封、密钥 ID 轮换读取、`__Host-` Cookie 和 Origin/Referer + CSRF 双重校验。
- 未添加数据库 Schema 或迁移；未添加 Keycloak Token 到客户端、业务授权、人员/任职规则、真实 Provider 或生产 Secret。

### 验证证据

- `auth-context`：2 个测试文件、9 项测试通过；真实 RSA/JWKS 覆盖正确签名、错误 Audience、错误 Client、缺失 Subject、过期、错误签名和 JWKS 超时。
- `apps/api`：2 个测试文件、8 项测试通过；覆盖凭据随机性、不可逆索引、Token 加解密、篡改/未知版本/超大信封拒绝、CSRF/Origin/Referer 与 Cookie 属性。
- `pnpm check`：通过；28 个 Workspace 包共 140 个任务成功，包含 build、lint、typecheck、test、contracts:check、边界、契约确定性和 Compose 静态安全检查。

### 第一批 Review Pass

- Authorization：认证主体没有角色、权限或数据范围；业务授权仍明确留给 IAM-03，默认未接线。
- Idempotency：当前批次仅提供无状态 Token 验证和安全原语；OAuth 回调一次性消费、刷新合并和注销幂等仍待会话编排实现。
- Transactions：未新增数据库事务；Redis 原子消费、轮换和刷新锁仍待实现。
- Migrations：不适用，模块不拥有 PostgreSQL Schema。
- Observability：错误类别有界且不包含凭据；安全审计 Intent、指标和健康依赖接线仍待实现。
- Backward compatibility：从 G1 包标识新增根入口导出，没有旧运行契约或深层导入。
- Secrets：加密/索引密钥仅作为运行时字节输入；类型化 `*_FILE` 配置与最小挂载仍待 BFF 组合批次。
- Failure modes：Token/JWKS、加密信封、CSRF 和会话输入均失败关闭；Keycloak/Redis 集成故障和恢复测试仍待实现。
- 独立性：本次为实现者自查，不满足合并前“非原实现 Agent”的独立 Review Pass，IAM-01 不得据此进入 G2。

### 下一批必须完成

- 基于成熟 OIDC Client 实现 Authorization Code + PKCE、`state`、`nonce`、回调白名单和标准注销。
- 实现 Redis 会话存储 Adapter、一次性登录事务、原子会话轮换、并发刷新合并与撤销。
- 使用 `packages/config` 接入 Keycloak Client、允许来源、回调、TTL 和 `*_FILE` 密钥引用；未确认时长继续作为必填配置。
- 增加合成 Keycloak Realm/Client 配置和 Compose 集成测试，不引入真实用户、角色或 Provider。
- 接入安全审计 Intent、认证指标、Trace 和 Readiness，并完成非原实现者独立审查。

### 2026-07-24 第二批实现

- 锁定 `openid-client@6.8.4` 与官方 `redis@6.1.0`；第三方类型没有进入下游模块契约。
- 实现 Authorization Code + PKCE、State、Nonce、严格回调 URI、Client Secret Basic、Token Refresh 和标准 End Session URL；只对本地/测试回环地址允许 HTTP。
- Redis Store 使用 `GETDEL` 一次性消费登录事务，使用 Lua 原子触碰绝对/空闲 TTL、校验 Revision 后轮换 Session，并以 compare-and-delete 释放刷新租约。
- 刷新流程采用会话级短租约，获锁后二次读取，并原子撤销旧 Cookie/创建新 Cookie；租约冲突返回已评审的 `409 authentication_refresh_in_progress`，不会调用 Refresh Token。
- 使用 `@ai-crm/config` 接入全部必填 TTL、Issuer、Origin、回调、Redis 与 `*_FILE` Secret 引用；加密密钥与索引密钥必须是不同的 256-bit base64url 值。
- 当前会话与主体解析在服务端解密 Access Token 后调用 `auth-context` 验证；坏 Token/过期 Token 会撤销本地会话，JWKS 不可用保留会话但请求失败关闭。
- 新会话和新轮换只有在认证审计 Port 成功记录后才返回；审计失败会撤销刚创建的会话。
- 未修改 Keycloak Realm Client：当前尚无符合文件式 Secret 规则的 Realm Import 注入机制，拒绝在 Git、Realm JSON、Compose 环境值或命令参数中放置 Client Secret。

### 第二批验证证据

- `apps/api`：6 个测试文件、25 项测试通过（含共享 smoke）。
- 合成 OIDC 服务器覆盖 Discovery、PKCE、State、Nonce、RS256 ID Token、Client Basic、Refresh、End Session、State 拒绝、外部 Return URL 拒绝和 Token 端点故障归类。
- 会话服务覆盖回调一次性消费、并发刷新阻断、旧凭据失效、新凭据可用、审计失败撤销、幂等注销和 Access Token 验证后主体解析。
- Redis 单元测试验证 `SET NX PX`、`GETDEL`、单次 Lua Touch/Rotate 和非法持久化数据失败关闭；真实 Redis/Keycloak Compose 集成仍待执行。
- 第二批完成后再次执行 `pnpm check`：28 个 Workspace 包共 140 个 build/lint/typecheck/test/contracts 任务全部成功，仓库边界、契约确定性和 Compose 静态安全检查通过。

### 第二批 Review Pass

- Authorization：会话存在不产生角色、权限或组织上下文；服务端只输出已验证认证主体，IAM-02/IAM-03 仍必须继续解析和裁决。
- Idempotency：登录事务只消费一次；注销本地幂等；刷新租约阻止并发使用 Refresh Token，Revision + Lua 保证旧凭据只能轮换一次。
- Transactions：Redis 内部一次性消费、触碰、轮换和租约释放为单命令/单脚本原子边界；Keycloak、Redis 与未来 Audit 数据库之间不宣称分布式事务。
- Migrations：无 PostgreSQL Schema 或迁移。
- Observability：稳定失败类别、审计 Port 和 Redis Readiness 已提供；具体 Logger/Metric/Trace Composition 仍待 CMP-01。
- Backward compatibility：新增错误码为非破坏性扩展；内部 API Client 由源契约重新生成，外部 Client 仍没有认证 Operation。
- Secrets：四类 Secret 均为 `*_FILE` 引用；会话加密/索引密钥禁止复用；尚未配置不安全的 Realm Client Secret。
- Failure modes：Keycloak/JWKS/Redis/Audit 故障失败关闭；Token 端点 `429/5xx` 与无效回调/Refresh Grant 已分开归类。
- 独立性：仍是实现者自查，不能代替非原实现 Agent 的合并前独立 Review。

### 后续剩余项

- 设计并评审 Keycloak Realm Import 的文件式 Client Secret 安全引导机制，然后增加合成 Client 配置。
- 在允许的 Composition 阶段接入 HTTP Controller、Cookie 解析/设置、CSRF 调用、审计实现、Logger/Metric/Trace 与 Readiness。
- 对真实 Compose Keycloak/Redis 执行登录、刷新、注销、Redis 故障、Keycloak 故障和 Secret 缺失集成测试。
- IAM-02 提供唯一 Workforce Person/有效 Employment 解析后，组合内部主体失败关闭链路。
- 完成非原实现者独立 Review；此前 IAM-01 和 G2 均保持未通过。

### 2026-07-24 第三批实现与验证

- 新增框架无关的认证 HTTP 适配边界：登录/回调重定向、`__Host-` Secure HttpOnly Cookie、`no-store`/Referrer-Policy、当前会话、刷新/注销 CSRF、重复/畸形 Cookie 拒绝、稳定错误到 HTTP 状态映射及无会话注销清 Cookie。
- 刷新/注销的 CSRF 校验使用有效的服务端 Session 状态，不依赖仍未过期的 Access Token；因此 Access Token 过期后仍可执行受保护的 Refresh 流程。
- 新增显式环境门控的真实 Redis 集成测试；默认测试不依赖外部服务，设置 `TEST_AUTH_REDIS_URL` 与 `TEST_AUTH_REDIS_PASSWORD_FILE` 后覆盖真实 `GETDEL`、`SET NX PX`、Lua Touch/Rotate、绝对过期和 compare-and-delete 租约释放。

### 第三批验证证据

- `pnpm --filter @ai-crm/api typecheck`：通过。
- `pnpm --filter @ai-crm/api lint`：通过。
- 默认 API 测试：8 个测试文件，32 项通过，4 项 Redis 集成测试按设计跳过。
- 一次性 Redis 7.4.5 Alpine 容器（密码仅通过临时只读 Secret 文件挂载）：8 个测试文件，36 项通过，包含 4 项真实 Redis 集成测试；测试后容器已停止并移除。

### 第三批 Review Pass

- Authorization：HTTP 适配器只调用 IAM-01 会话服务，不推断 Workforce Person、Employment、Assignment 或业务权限；当前主体接口仍不暴露角色/数据范围。
- Idempotency：回调一次性消费、刷新租约/Revision 轮换、注销幂等和无会话清 Cookie 均由测试覆盖；重复 Cookie 与错误 CSRF 在状态变更前拒绝。
- Transactions：HTTP 层不宣称跨 Keycloak、Redis、Audit 的分布式事务；Redis 原子边界继续由单命令/Lua 脚本提供。
- Observability：HTTP 响应不回传 Token 或内部异常；审计 Port、Readiness 和安全错误类别仍等待 CMP-01 组合接线。
- Secrets：集成测试使用临时文件式 Secret；生产 Realm Client Secret 引导仍未解决，未把值放入 Realm、Compose、参数或仓库。
- Failure modes：无效/过期 Token、JWKS/Redis 不可用、CSRF/Origin/Referer 失败和刷新并发冲突均保持失败关闭；真实 Keycloak 流程尚未在 Compose 中执行。
- 独立性：本批仍为实现者自查，未满足非原实现 Agent 的独立 Review 要求，因此 IAM-01 与 G2 继续保持未通过。

### 2026-07-26 跨任务职责决策：认证 Secret Contract

- 已确认采用职责分离：IAM-01 定义认证 Secret Contract 和集成验收场景；INF/CMP 负责 Compose 与 Bootstrap 实现。
- IAM-01 的运行时 Secret 输入保持为 `AI_CRM_PC_OIDC_CLIENT_SECRET_FILE`、`AI_CRM_REDIS_PASSWORD_FILE`、`AI_CRM_PC_SESSION_ENCRYPTION_KEY_FILE` 和 `AI_CRM_PC_SESSION_INDEX_KEY_FILE`；认证代码不读取 Compose、Docker 或主机路径细节。
- INF/CMP 必须为本地开发、本地测试、测试服务器和生产服务器提供等价的文件式 Secret 注入；环境差异只体现在 Secret 来源、权限、轮换和生命周期，不改变认证契约。
- Keycloak Realm 模板不得包含真实 Client Secret。启动时必须从受限 Secret 文件读取 Client Secret，并生成权限受限的临时 Import 文件；Secret 不得进入 Git、Compose YAML 字面量、环境变量、命令参数、镜像层、日志或备份明文。
- 本地开发/测试可以自动生成合成 Secret；测试服务器和生产服务器必须使用预置、可轮换、最小权限的 Secret 文件。临时 Import 文件在启动后应清理或留在容器私有临时目录中，不得作为持久配置提交。

### INF/CMP 交付给 IAM-01 的集成验收场景

- 四个环境均能启动 Keycloak 和 Redis，且 API 只通过上述 `*_FILE` 配置引用认证 Secret。
- Keycloak Client Secret 缺失、不可读或 Realm Import 注入失败时，服务启动/就绪检查失败关闭，不回退到无 Secret 或明文配置。
- 使用合成 Realm/Client 完成 Authorization Code + PKCE、State、Nonce、回调、Session 创建、Refresh、Rotation 和 Logout。
- Redis 不可用、Keycloak/JWKS 不可用、Secret 文件被撤回或权限错误时，认证入口返回有界失败，不能伪报 Ready，也不能泄露凭据。
- 验收日志、Compose 配置、容器环境和镜像检查均不出现 Secret 值、Token、Cookie 或原始 OIDC 响应。

### 当前执行边界

- IAM-01 继续只修改认证契约、认证代码、认证测试和本 handoff；不直接修改 `deploy/compose` 或 `scripts/bootstrap`。
- INF/CMP 获得上述契约后负责部署侧实现；在其变更和测试完成前，真实 Keycloak Compose 集成与 IAM-01/G2 验收保持阻塞。

### 2026-07-26 INF-01 本地部署侧交付结果

- INF-01 已按 Contract 为本地开发/本地测试提供独立 `pc_oidc_client_secret`、Compose 文件挂载、合成 confidential PC BFF Client 模板和运行时临时 Realm Import。
- Keycloak 26.3.1 与 PostgreSQL 17.5 的隔离 Compose 启动达到 Healthy，Realm OIDC Discovery 返回 HTTP 200；缺少 Client Secret 时入口以退出码 1 失败关闭。
- IAM-01 可以继续进行真实 Keycloak 协议集成验收；但测试服务器/生产服务器 Secret 生命周期、完整 BFF Composition、IAM-02/IAM-03 和独立 Review 仍未完成，因此 IAM-01/G2 保持进行中。

### 2026-07-26 真实 Keycloak/Redis 协议集成验收

- 新增环境门控的 Keycloak 集成测试和一次性执行器 `pnpm auth:test:integration`；普通 API 测试仍不依赖外部服务。
- 执行器使用隔离 Compose Project 和临时文件式 Secret 启动 PostgreSQL 17.5、Redis 7.4.5、Keycloak 26.3.1，并在成功/失败路径统一清理容器、Volume、网络和临时目录。
- 测试通过 Keycloak Admin REST 在运行时创建随机合成用户，凭据只存在于测试进程内存；测试结束删除用户，不在 Realm、仓库、环境变量、命令参数或日志中保存密码。
- 真实浏览器协议模拟解析 Keycloak 登录表单，完成 Authorization Code + PKCE、State、Nonce、Callback Code Exchange 和 Client Secret Basic。
- Session Service 使用真实 Redis 保存一次性登录事务和加密 Token；`auth-context` 通过真实 Keycloak JWKS 验证 Access Token，并只返回 `issuer + sub` 与客户端/时间边界。
- Refresh 使用真实 Refresh Token，完成 Redis Revision 轮换；旧不透明凭据立即失效，新凭据可解析相同认证主体；Logout 撤销本地 Session、生成 End Session URL，重复注销保持幂等。
- Realm Client 新增仅面向 `ai-crm-pc-bff` 的 Access Token Audience Mapper，使服务端 Audience 验证显式成立；未增加角色、权限、人员、任职或业务 Claim。

### 真实集成验证证据

- `pnpm auth:test:integration`：9 个测试文件、37 项测试全部通过，其中 4 项真实 Redis 集成和 1 项真实 Keycloak/Session 集成执行成功。
- 测试过程中 PostgreSQL、Redis、Keycloak 均达到 Healthy；测试结束确认隔离容器、Volume 和网络全部移除。
- 首次失败运行暴露合成用户缺少 Keycloak 26 必填资料，补齐纯合成 First/Last Name 与 `example.test` 邮箱后通过；没有把该要求编码为 CRM 人员字段或业务规则。
- 本验收仍由实现者执行，不能替代非原实现 Agent 的独立 Review；测试服务器/生产部署和 IAM-02/IAM-03 Composition 也仍未完成，因此 IAM-01/G2 保持进行中。

### 2026-07-26 实现者 Review 修复

- Client binding：`auth-context` 现在要求 Access Token 的 `azp` 必须存在且等于配置 Client；新增缺失 `azp` 的失败关闭测试。
- Logout：现有 Session 注销会撤销本地 Session、清除 BFF Cookie，并由 HTTP Adapter `302` 到不包含 `id_token_hint` 的 Keycloak End Session URL；真实集成测试现在通过 HTTP Adapter 验证该链路，不再绕过传输层。
- HTTP Contract：源 OpenAPI 补齐 Login/Session/Logout 错误响应、Callback/Refresh/Logout 的 `Set-Cookie`、现有 Session Logout 的 `302 Location`，并重新生成内部/外部 Bundle 与内部 Client。
- Secret：API 配置和 Keycloak 入口均要求 PC OIDC Client Secret 为 43 字符规范 base64url（32 字节随机值）；弱 Secret 启动失败关闭，静态 Compose 守卫与配置测试覆盖该约束。
- Integration cleanup：执行器聚合主测试、Compose 清理和 Secret 清理错误；Compose 清理失败时返回失败并保留受限 Secret 目录供恢复，不再误报成功或删除仍被容器使用的文件。
- 修复后定向 API 测试默认 34 项通过、5 项环境门控测试跳过；真实 Keycloak/Redis 集成 39/39 项通过，容器、Volume、网络和临时 Secret 正常清理。
- 本节仍是实现者修复与复查记录，不能满足“非原实现者独立 Review”的合并门槛。

### 2026-07-26 第二轮 Review 修复

- Logout/Refresh race：Redis 为稳定 Session ID 维护带 TTL 的会话族当前索引；创建、触碰、轮换、过期清理和撤销使用 Lua 原子维护该指针。即使 Refresh 先把旧 Cookie 轮换到新索引，Logout 仍通过稳定 Session Reference 撤销新索引。
- Logout audit failure：HTTP Adapter 在 CSRF 校验时取得不返回浏览器的稳定 Session Reference；Session Service 先持久记录可重试的 `session_logout_requested`，成功后才原子撤销。审计不可用返回 `503` 时本地会话未改变，浏览器可以安全重试，不再形成“已删除但未清 Cookie/未调用 Provider Logout”的部分状态。
- Client Secret rotation：Realm Import 明确只负责首次 Bootstrap；新增 `pnpm auth:rotate-client-secret`，通过文件式管理凭据更新并验证现有 Keycloak Client，再原子替换受限 Secret 文件，文件替换失败则回滚 Keycloak。该命令仅适用于本地/测试，生产仍由 OPS 使用独立管理员和受控维护窗口。
- CSRF Contract：Refresh/Logout 的源 OpenAPI 同时声明可选 `Origin` 与 `Referer`，并明确至少一个必须解析为 Allowlist Origin；实现继续优先使用 Origin、缺失时使用 Referer。
- 回归测试新增 Refresh 先完成后的 Logout 撤销、Logout 审计失败可重试，以及真实 Redis 会话族轮换后按旧索引撤销当前 Session。
- 真实集成在 Realm 已导入后先在线轮换 Client Secret，再使用新 Secret 完成 Authorization Code、Refresh、Rotation 和 Logout；41/41 项通过，容器、Volume、网络和临时 Secret 均已清理。

### 2026-07-26 第三轮 Review 修复

- Client Secret commit boundary：临时文件的创建、写入、关闭、权限设置和删除进入统一 `try/finally`；权限在更新 Keycloak 前验证，原子 Rename 是最后提交点，提交后不再执行可触发旧值回滚的文件操作。
- Rotation timeout：所有 Keycloak Token/Admin/验证/回滚请求使用必填、范围为 1～60 秒的 `AI_CRM_KEYCLOAK_ADMIN_TIMEOUT_SECONDS` 和独立 `AbortSignal`，依赖停滞不会无限阻塞维护与 CI 清理。
- Rotation failure tests：新增正常提交顺序、权限失败不更新 Keycloak、Rename 失败恢复旧 Secret 并删除临时文件三条 Node 测试；测试只使用合成值和内存适配器。
- Session Keyring Contract：当前密钥继续通过 `AI_CRM_PC_SESSION_ENCRYPTION_KEY_ID/_FILE` 写入；可选且必须成对出现的 `AI_CRM_PC_SESSION_PREVIOUS_ENCRYPTION_KEY_ID/_FILE` 只用于读取。最多保留一个上一版本，重复 ID/值、与索引密钥复用或不完整配置均失败关闭。
- Keyring acceptance：测试证明旧密钥加密的现存 Redis Session 在轮换窗口内仍可读取，并在 Refresh 后使用当前 Key ID 重新加密；上一版本只保留至所有消费者切换后的最大绝对 Session TTL，随后撤销。

### 2026-07-26 闭环 Review 修复

- Secret rotation ambiguity：更新 Keycloak 的 PUT 一旦发起即视为远端状态不确定；即使服务端已应用新值但响应超时，也会尝试恢复旧值并清理临时文件。故障注入测试覆盖“服务端已写入后超时”。
- Session Keyring composition：Session Service 构造阶段独立验证一至两个解密密钥、当前写密钥可读、ID/材料唯一、长度合法以及索引密钥不复用，错误组合在创建不可读 Session 前失败关闭。
- Key material ownership：构造完成时复制加密、解密和索引密钥材料及 Keyring 列表；调用方后续修改原始 `Uint8Array` 或数组不会改变正在运行的 Session Service。
- Issued-token commit boundary：登录回调和刷新得到的新 Access Token 必须先通过签名、Issuer、独立 API Audience、`azp`、时间边界验证，之后才允许创建或轮换 Redis Session。回调失败不落库；刷新失败不提交新的本地会话状态。
- Token time semantics：验证器拒绝 `iat > exp` 以及超出配置时钟容差的未来 `iat`。
- ID Token substitution：OAuth Client ID 保持 `ai-crm-pc-bff`，API Resource Audience 独立为 `ai-crm-api`。Keycloak Audience Mapper 只向 Access Token 写入 API Audience，验证器同时要求 API Audience 与 `azp=ai-crm-pc-bff`；真实登录签发的 ID Token 因 Audience 不匹配被拒绝。
- Configuration contract：新增必填非 Secret 配置 `AI_CRM_OIDC_API_AUDIENCE`，不得用 OAuth Client ID 代替 API Resource Audience。
- Verification：轮换故障测试 4/4、真实 Keycloak/Redis/API 集成 52/52 通过；集成结束后容器、Volume、网络和临时 Secret 全部清理。实现者闭环复审仍不替代 G2 要求的非原实现者正式 Review。

### 2026-07-26 G2 Review 结论

- 项目 Owner 已确认 IAM-01 的独立 Review 通过，并授权合并。
- IAM-01 公共入口、认证契约、单元/契约/真实 Keycloak 与 Redis 集成测试，以及授权、审计、幂等、事务、Secret、可观测和失败语义已满足本工作包 G2 门禁。
- 测试服务器/生产部署、IAM-02/IAM-03 主体组合和全应用 Composition Root 仍分别属于后续 OPS/CMP 工作包，不作为 IAM-01 模块公共接口门的阻塞项。
- 下一工作包按身份授权轨道推进 IAM-02；在 IAM-02/IAM-03 通过各自 G2 前，不进入完整身份链路的 CMP-01 组合。
