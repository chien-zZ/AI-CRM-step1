# AI Contracts

Provider-neutral schemas for registered AI use cases, safe invocation envelopes, data-policy and prompt/model version references, structured output, call status, usage metadata, non-authoritative proposals, and human-review requirements belong here after review.

Contracts must not expose provider SDK types, raw prompts/responses, chain-of-thought, model credentials, arbitrary provider parameters, CRM fields, or executable tool definitions. A valid AI response is not a domain command or business fact.

No real use-case, model, provider payload, Prompt, customer field, scoring rule, RAG document, or tool schema is created until its Owner, data boundary, model region, contract, budget, acceptance set, retention, authorization, and human-confirmation behavior are approved.

See [ADR-0024](../../docs/08-架构决策/ADR-0024-AI网关与AI治理边界.md).
