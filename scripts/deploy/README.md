# Deployment Scripts

Repeatable environment deployment, health verification, rollback, and release metadata scripts.

## OPS-01 Release Metadata

- `verify-release.mjs` validates a version 1 release manifest and fails closed on floating application images, evidence gates without a bounded reference and content digest, unexpected host placement, malformed hashes, Secret-like fields or non-independent operator/approver references.
- `render-release-variables.mjs` requires an explicit `staging` or `production` target, rejects a manifest for a different environment, and emits only the validated release ID and image references. It never emits operator/approver references or Secret values.
- `release-manifest.mjs` contains the pure validation/rendering functions covered by `scripts/check/release-gates.test.mjs`.

These scripts validate evidence metadata and content bindings; they do not execute a production release or prove the trusted origin of the referenced tests, approval, restore point, Secret permissions, observability alerts or rollback rehearsal. The release authority must resolve each `evidence://` reference in its approved evidence store, recompute the digest and verify its CI/approval identity before deployment. Follow the versioned production Runbook and retain the underlying evidence outside the repository without sensitive payloads.

The API and Worker production images are defined by `apps/api/Dockerfile` and `apps/worker/Dockerfile`. The application-image workflow builds both exact commit artifacts, exports their filesystems, and invokes the joint migration verifier before a non-PR run may publish commit-addressed images. Registry-returned digests, rather than tags alone, are the production Compose and release-manifest inputs.

Before embedding migrations, both application Dockerfiles invoke `sanitize-application-artifact.mjs`. It removes and then rejects `src`, `coverage`, `test-fixtures`, `.turbo`, `*.test.*`, `*.map`, and `*.tsbuildinfo` only in the application payload and the real package directories for pnpm-deployed `@ai-crm` runtime dependencies. Third-party package contents are not traversed or modified. Forbidden names on symbolic links remove only the link itself; other links are never followed for cleanup, and unresolved links or package links outside the artifact fail closed.

## OPS-G3 Migration Artifact Integrity

- `generate-migration-manifest.mjs` recursively inventories every file in the reviewed repository `packages/database/migrations` and `packages/platform-modules/*/migrations` directories. It writes a deterministic version 1 manifest with safe relative paths, sizes and SHA-256 digests and refuses to overwrite an existing output.
- Both immutable API and Worker artifacts must contain those complete directories at their reviewed `packages/**/migrations` paths and the exact manifest at `/app/ai-crm-migrations.manifest.json`. The manifest digest is the release manifest `artifacts.migrationHead` value.
- `verify-application-migration-artifacts.mjs` requires both unpacked image filesystems in one release gate. It reads each manifest only from the fixed artifact-root location, verifies the same approved digest, then rejects an omitted API or Worker artifact, missing directories/files, extra files, changed size/content, malformed paths, unsupported versions and symbolic links. `verify-migration-artifact.mjs` remains a single-artifact diagnostic.

Example using only synthetic/local paths:

```text
node scripts/deploy/generate-migration-manifest.mjs <reviewed-repository-root> <staging-directory>/ai-crm-migrations.manifest.json
node scripts/deploy/verify-application-migration-artifacts.mjs <unpacked-api-root> <unpacked-worker-root> <approved-migration-manifest-sha256>
```

The approved digest must come from the reviewed build evidence and must match the release manifest; a manifest carried inside an image is not its own trust root. These scripts do not build, pull, inspect a registry, run migrations or authorize a release.
