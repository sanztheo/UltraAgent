/**
 * Team state facade — high-level API that resolves paths from `cwd`
 * and delegates to the low-level state modules.
 *
 * OMX packed 1672 lines here (types + re-exports + path resolution + env parsing).
 * We keep it lean: types live in state/types.ts, paths in utils/paths.ts,
 * operations in state/tasks.ts, state/locks.ts, etc.
 * This facade just wires cwd → paths → operations.
 */

import { resolve, sep } from 'node:path';

import { teamApprovalsDir, teamDir, teamEventsDir, teamMailboxDir, teamTasksDir } from '../utils/paths.js';
import { TASK_ID_PATTERN, WORKER_NAME_PATTERN } from './contracts.js';
import { readTaskApproval, writeTaskApproval } from './state/approvals.js';
import { withTeamLock } from './state/locks.js';
import {
  claimTask,
  computeTaskReadiness,
  createTeamTask,
  listTeamTasks,
  readTask,
  releaseTaskClaim,
  transitionTask,
} from './state/tasks.js';
import type {
  ClaimTaskResult,
  CreateTaskInput,
  ReleaseTaskClaimResult,
  TaskApprovalRecord,
  TaskReadiness,
  TeamTask,
  TransitionTaskResult,
} from './state/types.js';

// ── Re-exports for convenience ───────────────────────────────────────

export type {
  ClaimTaskResult,
  CreateTaskInput,
  ReleaseTaskClaimResult,
  TaskApprovalRecord,
  TaskReadiness,
  TeamTask,
  TransitionTaskResult,
};

export type {
  WorkerState,
  WorkerStatus,
  WorkerHeartbeat,
  TeamEvent,
} from './state/types.js';
export type { MailboxMessage, MonitorSnapshot } from './state/types.js';

// ── Validation ───────────────────────────────────────────────────────

export function validateTaskId(taskId: string): void {
  if (!TASK_ID_PATTERN.test(taskId)) {
    throw new Error(`Invalid task ID: "${taskId}". Must be a positive integer (digits only, max 20 digits).`);
  }
}

export function validateWorkerName(name: string): void {
  if (!WORKER_NAME_PATTERN.test(name)) {
    throw new Error(`Invalid worker name: "${name}". Must match /^[a-z0-9][a-z0-9-]{0,63}$/.`);
  }
}

export function assertPathWithinDir(filePath: string, rootDir: string): void {
  const normalizedRoot = resolve(rootDir);
  const normalizedPath = resolve(filePath);
  if (normalizedPath !== normalizedRoot && !normalizedPath.startsWith(normalizedRoot + sep)) {
    throw new Error('Path traversal detected: path is outside the allowed directory');
  }
}

// ── Facade: task operations bound to cwd ─────────────────────────────

export async function getTask(cwd: string, taskId: string): Promise<TeamTask | null> {
  validateTaskId(taskId);
  return readTask(teamTasksDir(cwd), taskId);
}

export async function getTaskReadiness(cwd: string, taskId: string): Promise<TaskReadiness> {
  validateTaskId(taskId);
  return computeTaskReadiness(teamTasksDir(cwd), taskId);
}

export async function createTask(cwd: string, input: CreateTaskInput): Promise<TeamTask> {
  return createTeamTask(teamDir(cwd), teamTasksDir(cwd), input);
}

export async function claim(cwd: string, taskId: string, workerName: string): Promise<ClaimTaskResult> {
  validateTaskId(taskId);
  validateWorkerName(workerName);
  return claimTask(teamTasksDir(cwd), taskId, workerName);
}

export async function transition(
  cwd: string,
  taskId: string,
  from: import('./contracts.js').TaskStatus,
  to: import('./contracts.js').TaskStatus,
  claimToken: string,
): Promise<TransitionTaskResult> {
  validateTaskId(taskId);
  return transitionTask(teamTasksDir(cwd), taskId, from, to, claimToken);
}

export async function releaseClaim(cwd: string, taskId: string, claimToken: string): Promise<ReleaseTaskClaimResult> {
  validateTaskId(taskId);
  return releaseTaskClaim(teamTasksDir(cwd), taskId, claimToken);
}

export async function listTasks(cwd: string): Promise<TeamTask[]> {
  return listTeamTasks(teamTasksDir(cwd));
}

// ── Facade: approvals ────────────────────────────────────────────────

export async function getApproval(cwd: string, taskId: string): Promise<TaskApprovalRecord | null> {
  validateTaskId(taskId);
  return readTaskApproval(teamApprovalsDir(cwd), taskId);
}

export async function setApproval(cwd: string, approval: TaskApprovalRecord): Promise<void> {
  validateTaskId(approval.task_id);
  return writeTaskApproval(teamApprovalsDir(cwd), approval);
}

// ── Facade: team lock ────────────────────────────────────────────────

export async function withLock<T>(cwd: string, fn: () => Promise<T>): Promise<T> {
  return withTeamLock(teamDir(cwd), fn);
}

// ── Path accessors (for modules that need raw paths) ─────────────────

export function resolveTeamDir(cwd: string): string {
  return teamDir(cwd);
}

export function resolveTasksDir(cwd: string): string {
  return teamTasksDir(cwd);
}

export function resolveApprovalsDir(cwd: string): string {
  return teamApprovalsDir(cwd);
}

export function resolveMailboxDir(cwd: string): string {
  return teamMailboxDir(cwd);
}

export function resolveEventsDir(cwd: string): string {
  return teamEventsDir(cwd);
}
