# Deployment Scripts

Repeatable environment deployment, health verification, rollback, and release metadata scripts.

## OPS-01 Release Metadata

- `verify-release.mjs` validates a version 1 release manifest and fails closed on floating application images, incomplete evidence gates, unexpected host placement, malformed hashes, Secret-like fields or non-independent operator/approver references.
- `render-release-variables.mjs` emits only the validated release ID and image references required by the production Compose templates. It never emits operator/approver references or Secret values.
- `release-manifest.mjs` contains the pure validation/rendering functions covered by `scripts/check/release-gates.test.mjs`.

These scripts validate evidence metadata; they do not execute a production release or prove the referenced tests, approval, restore point, Secret permissions, observability alerts or rollback rehearsal. Follow the versioned production Runbook and retain the underlying evidence outside the repository without sensitive payloads.
