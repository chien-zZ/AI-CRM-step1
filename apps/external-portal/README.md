# External Portal

First-stage external client built with Taro, React, TypeScript, and NutUI React. The same application source produces separate H5 and WeChat Mini Program (`weapp`) artifacts.

It is independently built and deployed from internal applications and uses a separately approved identity, session, API exposure, rate-limit, privacy, and error-disclosure boundary. Target-specific network, session, navigation, and file behavior stays behind tested adapters.

Future owning domains must explicitly select and contract anonymous, restricted-invitation, or long-term-login access per operation. None of those business access modes is enabled by this shell. Anonymous access can never be an authentication fallback, and no invitation or external account model exists here.

When long-term login is required, the H5 artifact uses an independent BFF HTTP-only cookie and the WeChat Mini Program can hold only a short-lived, revocable opaque server-session handle. It never receives Keycloak tokens, provider secrets, or the WeChat `session_key`. Provider login remains disabled until a concrete external subject and account lifecycle are approved.

It consumes only the allowlisted external OpenAPI client through a Taro transport. Hiding internal routes or menu items is never an acceptable security boundary, and no internal navigation, administrator API, Ant Design component, or Keycloak token is bundled into this application.

See [ADR-0015](../../docs/08-架构决策/ADR-0015-第一阶段多客户端应用范围与隔离.md), [ADR-0016](../../docs/08-架构决策/ADR-0016-Taro内部移动端与外部多端技术栈.md), [ADR-0017](../../docs/08-架构决策/ADR-0017-多客户端认证与服务端会话.md), [ADR-0019](../../docs/08-架构决策/ADR-0019-外部端分级访问与邀请授权.md), and the [Taro baseline](../../docs/04-工程手册/Taro多端工程基线.md).
