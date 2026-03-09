/**
 * Team contracts — shared constants, status enums, and transition rules.
 * All team modules depend on these; this file has zero internal imports.
 */

export const TASK_STATUSES = ['pending', 'blocked', 'in_progress', 'completed', 'failed'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TERMINAL_STATUSES: ReadonlySet<TaskStatus> = new Set(['completed', 'failed']);

/** Only `in_progress` tasks can transition (to completed or failed). */
export const TASK_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  pending: [],
  blocked: [],
  in_progress: ['completed', 'failed'],
  completed: [],
  failed: [],
};

export function isTerminalStatus(status: TaskStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return TASK_TRANSITIONS[from]?.includes(to) ?? false;
}

export const EVENT_TYPES = [
  'task_completed',
  'task_failed',
  'worker_state_changed',
  'worker_idle',
  'worker_stopped',
  'message_received',
  'all_workers_idle',
  'shutdown_ack',
  'approval_decision',
  'leader_nudge',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const APPROVAL_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const TASK_ID_PATTERN = /^\d{1,20}$/;
export const WORKER_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
