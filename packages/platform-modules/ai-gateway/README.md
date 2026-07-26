# AI Gateway

Business-neutral AI use-case governance, prompt/model/data-policy versioning, budget and call metadata, structured output validation, and non-authoritative proposal semantics.

Owning modules define why AI is used, construct minimum authorized inputs, own the output meaning, and execute any confirmed domain command. This module never owns CRM facts or lets model output directly change domain state. Provider calls reuse `integration-runtime`; concrete model adapters are composed in `apps/api` or `apps/worker`.

The first stage contains only contracts, Fake Adapter conventions, synthetic fixtures, and a business-neutral proposal/confirmation walking skeleton. It has no real model provider, Prompt, customer data, RAG, vector database, tool execution, LiteLLM, LangChain, or LangGraph.

## First-stage runtime

- `createAiGatewayService` accepts an explicit registered-use-case list plus authorization, budget, model, and safe call-record ports.
- Invocation accepts only `synthetic` structured JSON, validates exact runtime envelopes and JSON Schema 2020-12 input/output, and returns a non-authoritative proposal plus safe call metadata.
- Operation IDs provide process-local in-flight and replay protection. Once execution begins, both success and failure become stable for that operation ID, so an unknown or failed model attempt is never charged or invoked again in-process. Returned values are cloned so callers cannot mutate later replays.
- Safe call records contain bounded actor/application and authorization-decision references, policy/schema versions, attempt count, trace metadata, and either proposal usage metadata or a fixed failure category. They never contain structured input/output, Prompt, response, credentials, or provider payloads.
- Confirmation accepts only an authenticated subject, reauthorizes against the same use case/resource, checks expiry, and returns a non-authoritative confirmation fact. It never executes a domain command.
- `./testing` exposes a deterministic Fake Adapter. Fixtures must remain synthetic.

This implementation intentionally has no persistence, HTTP route, retry loop, provider selection, Prompt content, production telemetry, or domain callback. Production composition and durable call/proposal storage require a later reviewed work package after a real owning use case is approved.

See [ADR-0024](../../../docs/08-架构决策/ADR-0024-AI网关与AI治理边界.md), the [module description](../../../docs/03-模块说明/AI网关.md), and the [first-stage scope](../../../docs/01-权威与基线/第一阶段AI能力范围.md).
