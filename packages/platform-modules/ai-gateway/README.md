# AI Gateway

Business-neutral AI use-case governance, prompt/model/data-policy versioning, budget and call metadata, structured output validation, and non-authoritative proposal semantics.

Owning modules define why AI is used, construct minimum authorized inputs, own the output meaning, and execute any confirmed domain command. This module never owns CRM facts or lets model output directly change domain state. Provider calls reuse `integration-runtime`; concrete model adapters are composed in `apps/api` or `apps/worker`.

The first stage contains only contracts, Fake Adapter conventions, synthetic fixtures, and a business-neutral proposal/confirmation walking skeleton. It has no real model provider, Prompt, customer data, RAG, vector database, tool execution, LiteLLM, LangChain, or LangGraph.

See [ADR-0024](../../../docs/08-架构决策/ADR-0024-AI网关与AI治理边界.md), the [module description](../../../docs/03-模块说明/AI网关.md), and the [first-stage scope](../../../docs/01-权威与基线/第一阶段AI能力范围.md).
