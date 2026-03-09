/**
 * Team state facade — barrel re-export.
 *
 * All facade methods are split by domain in `facade/`.
 * This file preserves the single-import contract:
 *   import { getTask, sendMessage, ... } from "./state.js"
 */
export * from "./facade/index.js";
export type {
  ClaimTaskResult,
  CreateTaskInput,
  ReleaseTaskClaimResult,
  TaskApprovalRecord,
  TaskReadiness,
  TeamTask,
  TransitionTaskResult,
} from "./state/types.js";

export type {
  WorkerState,
  WorkerStatus,
  WorkerHeartbeat,
  TeamEvent,
} from "./state/types.js";

export type { MailboxMessage, MonitorSnapshot } from "./state/types.js";

export type {
  DispatchRequest,
  DispatchRequestInput,
  DispatchRequestKind,
  DispatchRequestStatus,
  DispatchOutcome,
  DispatchTransport,
  TeamMailbox,
} from "./state/types.js";
