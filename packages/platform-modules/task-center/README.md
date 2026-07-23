# Task Center

Maintains a unified projection of work assigned by workflows and future business systems. Source systems remain authoritative for the underlying business state.

Commands are routed back to the source system; this module never completes a Flowable task or changes domain state on its own. Projection updates are idempotent, version-aware, replayable, and repairable through reconciliation.

See [ADR-0009](../../../docs/08-架构决策/ADR-0009-Flowable审批引擎与职责分离.md) and the [module description](../../../docs/03-模块说明/统一任务中心.md).
