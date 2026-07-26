# Audit contracts

`audit-record.v1.schema.json` is the transport-neutral contract for explicit, append-only security audit facts. Records contain stable actor/context, action, resource, result, bounded reason, controlled changes, and W3C trace correlation. Sensitive changes disclose only that a value changed; credentials, request bodies, raw payloads, and inferred log facts are outside this contract.
