/**
 * Team state types — shared interfaces for tasks, workers, events, and dispatch.
 * Adapted from OMX, simplified for UltraAgent's single-team-per-project model.
 */

import type { ApprovalStatus, EventType, TaskStatus } from "../contracts.js";

// ── Task types ─────────────────────────────────────────────────────────

export interface TeamTask {
  id: string;
  subject: string;
  description: string;
  status: TaskStatus;
  requires_code_change?: boolean;
  role?: string;
  owner?: string;
  result?: string;
  error?: string;
  blocked_by?: string[];
  depends_on?: string[];
  version: number;
  claim?: TaskClaim;
  created_at: string;
  completed_at?: string;
}

export interface TaskClaim {
  owner: string;
  token: string;
  leased_until: string;
}

// ── Task operation results ─────────────────────────────────────────────

export type TaskReadiness =
  | { ready: true }
  | { ready: false; reason: "blocked_dependency"; dependencies: string[] };

export type ClaimTaskResult =
  | { ok: true; task: TeamTask; claimToken: string }
  | {
      ok: false;
      error:
        | "claim_conflict"
        | "blocked_dependency"
        | "task_not_found"
        | "already_terminal"
        | "worker_not_found";
      dependencies?: string[];
    };

export type TransitionTaskResult =
  | { ok: true; task: TeamTask }
  | {
      ok: false;
      error:
        | "claim_conflict"
        | "invalid_transition"
        | "task_not_found"
        | "already_terminal"
        | "lease_expired";
    };

export type ReleaseTaskClaimResult =
  | { ok: true; task: TeamTask }
  | {
      ok: false;
      error:
        | "claim_conflict"
        | "task_not_found"
        | "already_terminal"
        | "lease_expired";
    };

// ── Worker types ───────────────────────────────────────────────────────

export type WorkerState =
  | "idle"
  | "working"
  | "blocked"
  | "done"
  | "failed"
  | "draining"
  | "unknown";

export interface WorkerStatus {
  state: WorkerState;
  current_task_id?: string;
  reason?: string;
  updated_at: string;
}

export interface WorkerHeartbeat {
  pid: number;
  last_turn_at: string;
  turn_count: number;
  alive: boolean;
}

// ── Event types ────────────────────────────────────────────────────────

export interface TeamEvent {
  event_id: string;
  type: EventType;
  worker: string;
  task_id?: string;
  message_id?: string | null;
  reason?: string;
  state?: WorkerState;
  prev_state?: WorkerState;
  metadata?: Record<string, unknown>;
  created_at: string;
}

// ── Mailbox types (Phase 2) ────────────────────────────────────────────

export interface MailboxMessage {
  message_id: string;
  from_worker: string;
  to_worker: string;
  body: string;
  created_at: string;
  notified_at?: string;
  delivered_at?: string;
}

// ── Mailbox aggregate ─────────────────────────────────────────────────

export interface TeamMailbox {
  worker: string;
  messages: MailboxMessage[];
}

// ── Dispatch types (Phase 2) ──────────────────────────────────────────

export type DispatchRequestKind = "inbox" | "mailbox" | "nudge";
export type DispatchRequestStatus =
  | "pending"
  | "notified"
  | "delivered"
  | "failed";
export type DispatchTransportPreference =
  | "hook_preferred_with_fallback"
  | "transport_direct"
  | "prompt_stdin";

export interface DispatchRequest {
  request_id: string;
  kind: DispatchRequestKind;
  to_worker: string;
  worker_index?: number;
  pane_id?: string;
  trigger_message: string;
  message_id?: string;
  inbox_correlation_key?: string;
  transport_preference: DispatchTransportPreference;
  fallback_allowed: boolean;
  status: DispatchRequestStatus;
  attempt_count: number;
  created_at: string;
  updated_at: string;
  notified_at?: string;
  delivered_at?: string;
  failed_at?: string;
  last_reason?: string;
}

export interface DispatchRequestInput {
  kind: DispatchRequestKind;
  to_worker: string;
  worker_index?: number;
  pane_id?: string;
  trigger_message: string;
  message_id?: string;
  inbox_correlation_key?: string;
  transport_preference?: DispatchTransportPreference;
  fallback_allowed?: boolean;
  last_reason?: string;
}

// ── Dispatch transport & outcome ──────────────────────────────────────

export type DispatchTransport =
  | "hook"
  | "prompt_stdin"
  | "tmux_send_keys"
  | "mailbox"
  | "none";

export interface DispatchOutcome {
  ok: boolean;
  transport: DispatchTransport;
  reason: string;
  request_id?: string;
  message_id?: string;
  to_worker?: string;
}

// ── Approval types ─────────────────────────────────────────────────────

export interface TaskApprovalRecord {
  task_id: string;
  required: boolean;
  status: ApprovalStatus;
  reviewer: string;
  decision_reason: string;
  decided_at: string;
}

// ── Monitor snapshot (Phase 6) ─────────────────────────────────────────

export interface MonitorSnapshot {
  taskStatusById: Record<string, string>;
  workerAliveByName: Record<string, boolean>;
  workerStateByName: Record<string, string>;
  workerTurnCountByName: Record<string, number>;
  workerTaskIdByName: Record<string, string>;
  completedEventTaskIds: Record<string, boolean>;
}

// ── Task input (for creating tasks) ────────────────────────────────────

export interface CreateTaskInput {
  subject: string;
  description: string;
  requires_code_change?: boolean;
  role?: string;
  owner?: string;
  depends_on?: string[];
}
