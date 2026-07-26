# Flowable

Pinned runtime configuration, database ownership, deployment settings, operational checks, and upgrade notes. Business process definitions do not belong in this directory.

The `bpmn/` directory contains test-only, business-neutral assets used by PRC-01 integration verification. Production BPMN definitions require a confirmed owning process, version/release review, rollback guidance and acceptance tests; they must not be copied from the synthetic asset.

`compose.integration.yml` only exposes Flowable on a loopback test port when combined with the base Compose file by the Workflow integration runner. Credentials remain temporary Compose Secret files and are removed with the isolated project.
