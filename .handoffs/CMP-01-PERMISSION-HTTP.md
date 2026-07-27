# CMP-01 Permission / HTTP Contract Line

- Status: SELF_REVIEW
- Owner: permission/HTTP contract line
- Allowed paths: Task Center and Notification source OpenAPI, `contracts/permissions`, this handoff, and the dedicated contract test

## Known Facts

- IAM-03 accepts only bounded namespaced permission resources and stable actions declared by the owning module.
- Task Center and Notifications already expose reviewed internal HTTP operations, but those operations previously had no exact IAM-03 `PermissionRequest` mapping.
- Permission checks do not replace current-principal filtering, structured data-scope translation, or current object-level authorization by the resource-owning module.

## Allowed Assumptions

- `platform.task-center` and `platform.notifications` may own business-neutral technical permissions for their existing HTTP capabilities.
- The unread count uses the same Notification `list` permission because it is an aggregate over the same current-principal visible collection, not a separate resource authority.
- These platform HTTP permissions currently declare no scope dimensions. Policy publication may bind them only with an explicit resource-wide scope; Task Center/Notification ownership checks remain mandatory.

## Forbidden Assumptions

- No CRM resource, action, role, role bundle, grant, administrator, organizational policy, SLA, approval route, or data-scope value may be inferred.
- A successful function permission check must not be treated as proof that the caller may access a particular task or notification.
- Frontend visibility, Keycloak roles, Position text, notification receipt, or task assignment must not be interpreted as an effective grant.

## Non-goals

- This line does not publish a production policy snapshot, select policy storage, assign grants, or define permission administrators.
- This line does not implement API controllers, module query filtering, audit persistence, generated OpenAPI bundles, or generated clients.
- This line does not add Registry, Form, File, external, or CRM domain permissions.

## Contract Decisions

- Every existing Task Center and Notification HTTP operation has a versioned `x-ai-crm-permission` binding whose `resource` and `action` are the exact IAM-03 `PermissionRequest`.
- The binding records `owner` and a stable `code`; contract tests enforce `code === resource + ":" + action` and exact agreement with the platform catalog.
- The catalog contains eight unique business-neutral permission declarations and intentionally contains no roles or grants.

## Unresolved Questions

- Real role bundles, grants, administrators, approval and publication workflow, persistence, retention, and organization policy remain unconfirmed.
- Whether future reviewed module scopes add dimensions is unresolved and requires an additive contract review plus owning-module query translation.
- Registry, Form, File and other protected HTTP surfaces remain outside this contract line.

## Validation Evidence

- `node --test scripts/check/permission-http-contracts.test.mjs`: 2/2 passed. It validates both schemas, all nine HTTP operation bindings, eight unique catalog declarations, exact PermissionRequest/code agreement, Owner namespace ownership, full catalog use, and absence of role/grant fields.
- `pnpm exec eslint scripts/check/permission-http-contracts.test.mjs --max-warnings 0`: passed.
- `pnpm --filter @ai-crm/platform-task-center test`: 35/35 ordinary tests passed; 3 PostgreSQL integration tests remained intentionally skipped by the ordinary package command.
- `pnpm --filter @ai-crm/platform-notifications test`: 18/18 ordinary tests passed; 3 PostgreSQL integration tests remained intentionally skipped by the ordinary package command.
- Read-only `renderArtifacts(process.cwd())`: all source OpenAPI documents, JSON Schemas, and AsyncAPI documents validated and five artifacts rendered in memory; generated files were not written by this line.
- `git diff --check`: passed.

## Separate Review Checklist

- Authorization: implementer self-review passed; every operation has an exact declared PermissionRequest, ownership is namespace-checked, and the contracts preserve owning-module object checks.
- Idempotency: HTTP semantics are unchanged; permission declarations add no mutation.
- Transactions: not applicable; contracts add no storage operation.
- Migrations: not applicable; no database schema changes.
- Observability: mappings contain only bounded technical identifiers and no identity, object, request, or Secret values.
- Backward compatibility: additive OpenAPI extensions; existing paths, operations, payloads, responses, and audience declarations are unchanged.
- Secrets: no Secret or credential material is introduced.
- Failure modes: missing/unknown permission remains IAM-03 fail-closed behavior; no fallback grant is declared.
