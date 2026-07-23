# Integration Contracts

Provider-neutral integration Port models, technical error categories, delivery/receipt envelopes, health semantics, and test fixtures belong here after review.

Concrete provider payloads do not become domain events or shared business models. Provider-specific signatures, headers, DTOs, API versions, and cursor formats remain private to the owning Adapter unless an external protocol contract must be documented explicitly.

No payment, SMS, WeCom, WeChat, course-platform, question-bank, or concrete AI-provider schema is created until its provider, capability Owner, official protocol, test account, data boundary, idempotency, retry, callback, and reconciliation behavior are approved. Provider-neutral AI governance contracts belong in `contracts/ai/` under ADR-0024. See [ADR-0020](../../docs/08-架构决策/ADR-0020-第三方集成运行时与供应商适配器.md) and [ADR-0024](../../docs/08-架构决策/ADR-0024-AI网关与AI治理边界.md).
