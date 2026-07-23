# ADR-0005：PC Web 采用 BFF 登录会话

- 状态：已接受
- 日期：2026-07-22
- 决策人：项目负责人
- 适用范围：`apps/workbench-web` 与 `apps/api` 的浏览器认证入口
- 依赖决策：ADR-0004 Keycloak 统一身份认证中心

## 背景

PC 工作台将处理客户、员工、流程以及未来可能出现的财务和经营数据。Vite 单页应用可以直接执行 OIDC Authorization Code + PKCE 并持有 Token，但这会把 Access Token、刷新、多标签页同步和注销等安全生命周期带入浏览器 JavaScript。

项目由 AI 长期维护，更适合把登录协议、Token 保管和会话失败行为集中在一个可测试的服务端边界，而不是让各前端页面或状态容器接触认证凭证。

## 决策

1. PC Web 采用 Backend for Frontend（BFF）会话模式，由 `apps/api` 提供浏览器登录入口和会话中介能力。
2. BFF 使用标准 OIDC Authorization Code 流程连接 Keycloak，并启用 PKCE、`state` 和 `nonce` 校验。
3. Keycloak 的 Access Token、Refresh Token、ID Token 和授权码只在服务端安全边界内处理，不暴露给浏览器 JavaScript。
4. 浏览器只持有随机、不可解释、可轮换的会话标识 Cookie。Cookie 不得包含 Keycloak Token、内部权限集合或业务数据。
5. 生产 Cookie 使用 `HttpOnly`、`Secure`、适当的 `SameSite`、`Path=/`，且不设置宽泛的 `Domain`。优先使用 `__Host-` 前缀。
6. 会话数据保存在服务端会话存储适配器之后；ADR-0017 后续确认使用 Redis 保存有 TTL 的短期会话。领域模块不得读取会话存储。
7. BFF 不签发自有认证 JWT，也不建立与 Keycloak 竞争的 Refresh Token 体系。Keycloak 仍是认证与 Token 的权威来源。
8. `apps/api` 从经过验证的 BFF 会话构造内部主体上下文，再交给统一授权模块裁决业务访问。
9. PC Web 与 API 在生产环境通过同站点网关访问。携带凭据的 CORS 不允许使用通配来源。
10. 所有修改状态的 Cookie 请求必须有 CSRF 防护，至少包含 `Origin`/`Referer` 校验和不可预测的 CSRF Token；不能只依赖 `SameSite`。
11. 登录成功和权限上下文变化时轮换会话标识，防止会话固定。并发刷新必须合并或加锁，避免 Refresh Token 竞争和重复轮换。
12. 注销同时终止本地会话并调用 Keycloak 标准注销能力。会话到期、刷新失败、主体失效或会话存储不可用时失败关闭，不回退为匿名高权限或跳过认证。

## 浏览器与服务端边界

| 数据或能力 | 浏览器 | BFF / 服务端 |
|---|---|---|
| 不透明会话 Cookie | 仅由浏览器自动携带，JavaScript 不可读 | 创建、轮换、撤销 |
| Keycloak Token | 禁止接触或持久化 | 安全保管、刷新、注销 |
| CSRF Token | 按协议读取并随修改请求提交 | 生成并校验 |
| 内部主体上下文 | 只接收必要的当前用户视图 | 从可信会话构造 |
| 业务授权 | 仅控制界面展示 | 服务端最终裁决 |

前端不得把 Access Token、Refresh Token、ID Token 或会话秘密写入 `localStorage`、`sessionStorage`、IndexedDB、URL、日志或前端状态持久化插件。

## 安全与可观测性

- 登录、回调、刷新和注销端点需要超时、限流、结构化错误和关联追踪。
- 日志可以记录结果、错误类别、内部主体标识和 Trace ID，但不得记录 Cookie 值、Token、授权码、Client Secret 或完整 OIDC 响应。
- 会话必须有空闲超时和绝对有效期，并与 Keycloak 会话策略协调；具体时长在安全基线中另行确认。
- Keycloak Client Secret、会话加密密钥和 Cookie 签名密钥只使用秘密引用，并支持轮换。
- 账号禁用、任职失效和强制注销的传播时效需要集成测试覆盖。

## 测试要求

- 集成测试覆盖登录跳转、回调校验、会话创建、轮换、刷新、注销、过期和失败关闭。
- 安全测试覆盖伪造 `state`、错误 `nonce`、CSRF、会话固定、Cookie 属性、刷新并发和回调地址白名单。
- Playwright 覆盖未登录跳转、登录后返回原页面、刷新页面保持会话、注销后受保护页面不可访问。
- 测试和 Mock 不得使用绕过认证的生产可达开关。

## 已考虑的方案

### SPA 直接持有 OIDC Token

部署较简单，也符合公共客户端的标准模式。但浏览器需要承担 Token 生命周期，XSS 影响面更大，多标签页和刷新竞争也更复杂。对于企业工作台不作为默认方案。

### BFF 服务端会话

增加会话存储、CSRF 和同站点网关配置，但浏览器不接触 Keycloak Token，认证逻辑集中、显式且容易统一验证，因此采用。

## 影响

- `apps/api` 增加浏览器认证中介职责，但认证协议实现仍限制在适配边界，不能进入领域模块。
- 前端和 API 的部署需要统一站点、Cookie 和反向代理策略。
- 水平扩展 API 时需要共享或可分布式访问的会话存储。
- 未来移动端、CLI 和服务间调用可以采用适合自身的 OIDC 流程，不复用浏览器 Cookie。

## 非目标

- 本 ADR 当时未选择服务端会话存储产品；该事项后来由 ADR-0017 确认为 Redis。
- 本 ADR 不定义会话和 Token 的具体有效时长。
- 本 ADR 不决定企微、微信等第三方身份如何接入 Keycloak。
- 本 ADR 不定义业务权限和数据范围。
