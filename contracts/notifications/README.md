# Notification Contracts

Source contracts for explicit notification intents, stable recipient selectors and snapshots, immutable template releases, validated variables, in-app notification state, preferences, safe deep links, channel deliveries, receipts, and stable public errors.

Contracts distinguish notification generation, per-channel delivery, provider acceptance, provider delivery, and user read state. They do not contain provider SDK models, arbitrary URLs, executable templates, unconfirmed CRM notification types, or rules that replace Task and domain ownership.

The first-stage HTTP surface covers only in-app notifications and preferences. External channel contracts are added only when the corresponding channel is approved. See [ADR-0014](../../docs/08-架构决策/ADR-0014-自研通知中心与站内通知优先.md).
