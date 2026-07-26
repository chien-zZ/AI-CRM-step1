# Internal Mobile

First-stage internal mobile application built with Taro, React, TypeScript, and NutUI React. It outputs an H5 artifact for WeCom Workbench WebView and ordinary mobile browsers.

Its build, test, configuration, routing, authentication boundary, platform integration, and deployment artifact are independently owned from the PC workbench and external portal. It does not output a native application or assume WeCom federation is already implemented.

Its H5 session uses an independent BFF HTTP-only cookie and CSRF boundary. Standard Keycloak login remains the browser fallback; WeCom federation can be enabled only through the reviewed Keycloak adapter after provider configuration is approved. A verified identity must resolve to one workforce person with active employment under ADR-0018. Browser JavaScript never receives Keycloak tokens.

It serves internal workforce contexts only and consumes the reviewed internal OpenAPI client through a Taro transport plus the applicable `platform-sdk` surface. It does not own authorization or CRM business rules and never imports Ant Design or ProComponents.

The current walking-skeleton shell exposes explicit Home, Task, Notification, Form, and status routes. Only the generated Task read operations are allowlisted; Notification, Form, internal-mobile session, and BFF contracts are not fabricated. The production runtime therefore fails closed to a maintenance state. Development uses a visibly labelled synthetic Fixture selected by a build-time runtime alias, and the production bundle check rejects Fixture content, source maps, sensitive patterns, or an entrypoint above 600 KiB.

Commands:

- `pnpm --filter @ai-crm/internal-mobile build`
- `pnpm --filter @ai-crm/internal-mobile lint`
- `pnpm --filter @ai-crm/internal-mobile typecheck`
- `pnpm --filter @ai-crm/internal-mobile test`
- `pnpm --filter @ai-crm/internal-mobile bundle:check`

See [ADR-0015](../../docs/08-架构决策/ADR-0015-第一阶段多客户端应用范围与隔离.md), [ADR-0016](../../docs/08-架构决策/ADR-0016-Taro内部移动端与外部多端技术栈.md), [ADR-0017](../../docs/08-架构决策/ADR-0017-多客户端认证与服务端会话.md), [ADR-0018](../../docs/08-架构决策/ADR-0018-内部人员主体关联与失效.md), and the [Taro baseline](../../docs/04-工程手册/Taro多端工程基线.md).
