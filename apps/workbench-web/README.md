# Workbench Web

PC workbench based on React 19, Vite, TypeScript, Ant Design 6, Ant Design Pro Components, React Router, and TanStack Query.

The application shell provides a login entry, explicit routing, application navigation, assignment context, unified tasks, notifications, forms, and files. Authentication, authorization, and platform capabilities will be consumed through reviewed generated clients once those contracts pass G2. Until an adapter is composed, production fails closed with a maintenance state; development and tests use visibly labelled synthetic fixtures behind `WorkbenchPort`.

PC Web uses a same-site BFF session. Browser JavaScript must never receive or persist Keycloak access, refresh, or ID tokens; it only consumes the minimal current-user view and sends CSRF-protected requests with the HTTP-only session cookie. See [ADR-0005](../../docs/08-架构决策/ADR-0005-PC-Web采用BFF登录会话.md).

The first foundation stage enables standard Keycloak login. Internal workforce association is defined by ADR-0018, but WeCom/WeChat provider login remains disabled until provider configuration is approved and the external account lifecycle is defined. See [第一阶段认证范围](../../docs/01-权威与基线/第一阶段认证范围.md), [ADR-0017](../../docs/08-架构决策/ADR-0017-多客户端认证与服务端会话.md), and [ADR-0018](../../docs/08-架构决策/ADR-0018-内部人员主体关联与失效.md).

The first notification stage uses TanStack Query polling for the in-app notification list and unread count. WebSocket/SSE and external channels remain out of scope. Notification deep links resolve through the application registry and recheck authorization at the target. See [第一阶段通知范围](../../docs/01-权威与基线/第一阶段通知范围.md).

Domain-specific pages are added only after their business contracts are confirmed.

See [ADR-0001](../../docs/08-架构决策/ADR-0001-PC-Web采用Vite与Ant-Design技术栈.md) for the accepted frontend baseline and boundaries.

The existing pure-frontend workbench Demo is a design and interaction reference, not an implementation or business source. New pages should preserve its proven information density, navigation hierarchy, master-detail patterns, URL-restorable work context, and explicit operation feedback while being reimplemented on the accepted Vite architecture and formal contracts. See [PC 工作台 Demo 参考基线](../../docs/04-工程手册/PC工作台Demo参考基线.md).
