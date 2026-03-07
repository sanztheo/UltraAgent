/**
 * Team state types — shared interfaces for tasks, workers, events, and dispatch.
 * Adapted from OMX, simplified for UltraAgent's single-team-per-project model.
 */

import type { ApprovalStatus, EventType, TaskStatus } from '../contracts.js';

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

export type TaskReadiness = { ready: true } | { ready: false; reason: 'blocked_dependency'; dependencies: string[] };

export type ClaimTaskResult =
  | { ok: true; task: TeamTask; claimToken: string }
  | {
      ok: false;
      error: 'claim_conflict' | 'blocked_dependency' | 'task_not_found' | 'already_terminal' | 'worker_not_found';
      dependencies?: string[];
    };

export type TransitionTaskResult =
  | { ok: true; task: TeamTask }
  | {
      ok: false;
      error: 'claim_conflict' | 'invalid_transition' | 'task_not_found' | 'already_terminal' | 'lease_expired';
    };

export type ReleaseTaskClaimResult =
  | { ok: true; task: TeamTask }
  | {
      ok: false;
      error: 'claim_conflict' | 'task_not_found' | 'already_terminal' | 'lease_expired';
    };

// ── Worker types ───────────────────────────────────────────────────────

export type WorkerState = 'idle' | 'working' | 'blocked' | 'done' | 'failed' | 'draining' | 'unknown';

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
