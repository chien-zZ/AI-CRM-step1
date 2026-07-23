# Notifications

Owns explicit notification intents, actual recipient snapshots, in-app notifications, immutable Mustache template releases, preferences, channels, deduplication, scheduling, delivery attempts, and receipts. Business modules decide why a notification is requested and provide stable resource references; notifications never replace tasks or domain facts.

Provider delivery addresses such as a WeCom user identifier are channel data, not the authentication source of truth. This module must obtain them through reviewed interfaces and must never query Keycloak tables directly. See [ADR-0006](../../../docs/08-架构决策/ADR-0006-第三方身份通过Keycloak联合接入.md).

The first stage implements only PostgreSQL-backed in-app notifications queried by PC Web polling. No WeCom, WeChat, SMS, email, JPush, WebSocket, or SSE adapter is implemented until its client and channel scope are approved.

For a future approved external channel, this module owns the vendor-neutral `ChannelAdapter` port and delivery facts; the concrete adapter may reuse `integration-runtime` technical primitives at the Worker composition boundary. Provider acceptance or delivery never implies that the user read the notification.

See [ADR-0014](../../../docs/08-架构决策/ADR-0014-自研通知中心与站内通知优先.md), [ADR-0020](../../../docs/08-架构决策/ADR-0020-第三方集成运行时与供应商适配器.md), the [module description](../../../docs/03-模块说明/通知中心.md), and the [first-stage scope](../../../docs/01-权威与基线/第一阶段通知范围.md).
