// `@hub/log/ops` (P86): the ops log, what failed or happened in the server and every package. The agent session log (P54) is
// the rest of `@hub/log` and shares nothing with this but the folder. Core page: `@docs/core/28-ops-log.md`.
export { OPS_LEVELS, OPS_SOURCES, LEVEL_RANK, isOpsLevel, isOpsSource, type OpsLevel, type OpsLine, type OpsSource } from "./line";
export { ops, writeOps, configureOps, setOpsSink, captureOps, resetOps, humanLine, errFields, type OpsLogger, type OpsFields } from "./logger";
export { withAction, currentAction } from "./action";
export { redactOps, redactText, redactFields, errorFields, isSecretKey, isBodyKey } from "./redact";
export { appendOps, readOps, pruneOps, opsStoreOf, opsFileOf, opsLineOf, opsSignature, OPS_KEEP_DAYS, OPS_SOFT_CAP, OPS_HARD_CAP, type OpsStore, type OpsFilter } from "./store";
