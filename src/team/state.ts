/**
 * Team state facade — high-level API that resolves paths from `cwd`
 * and delegates to the low-level state modules.
 *
 * OMX packed 1672 lines here (types + re-exports + path resolution + env parsing).
 * We keep it lean: types live in state/types.ts, paths in utils/paths.ts,
 * operations in state/tasks.ts, state/locks.ts, etc.
 * This facade just wires cwd → paths → operations.
 */

import { resolve, sep } from "node:path";

import {
  teamApprovalsDir,
  teamDir,
  teamDispatchDir,
  teamEventsDir,
  teamMailboxDir,
  teamTasksDir,
  teamWorkersDir,
} from "../utils/paths.js";
import { TASK_ID_PATTERN, WORKER_NAME_PATTERN } from "./contracts.js";
import { readTaskApproval, writeTaskApproval } from "./state/approvals.js";
import {
  enqueueDispatchRequest,
  listDispatchRequests,
  markDispatchRequestDelivered,
  markDispatchRequestNotified,
  readDispatchRequest,
} from "./state/dispatch.js";
import { withTeamLock } from "./state/locks.js";
import {
  broadcastMessage,
  listMailboxMessages,
  markMessageDelivered,
  markMessageNotified,
  sendDirectMessage,
} from "./state/mailbox.js";
import {
  isWorkerAlive,
  listWorkers,
  readWorkerHeartbeat,
  readWorkerStatus,
  updateWorkerHeartbeat,
  writeWorkerHeartbeat,
  writeWorkerStatus,
} from "./state/workers.js";
import {
  claimTask,
  computeTaskReadiness,
  createTeamTask,
  listTeamTasks,
  readTask,
  releaseTaskClaim,
  transitionTask,
} from "./state/tasks.js";
import type {
  ClaimTaskResult,
  CreateTaskInput,
  DispatchRequest,
  DispatchRequestInput,
  DispatchRequestKind,
  DispatchRequestStatus,
  MailboxMessage,
  ReleaseTaskClaimResult,
  TaskApprovalRecord,
  TaskReadiness,
  TeamTask,
  TransitionTaskResult,
  WorkerHeartbeat,
  WorkerState,
  WorkerStatus,
} from "./state/types.js";

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

// ── Validation ───────────────────────────────────────────────────────

export function validateTaskId(taskId: string): void {
  if (!TASK_ID_PATTERN.test(taskId)) {
    throw new Error(
      `Invalid task ID: "${taskId}". Must be a positive integer (digits only, max 20 digits).`,
    );
  }
}

export function validateWorkerName(name: string): void {
  if (!WORKER_NAME_PATTERN.test(name)) {
    throw new Error(
      `Invalid worker name: "${name}". Must match /^[a-z0-9][a-z0-9-]{0,63}$/.`,
    );
  }
}

export function assertPathWithinDir(filePath: string, rootDir: string): void {
  const normalizedRoot = resolve(rootDir);
  const normalizedPath = resolve(filePath);
  if (
    normalizedPath !== normalizedRoot &&
    !normalizedPath.startsWith(normalizedRoot + sep)
  ) {
    throw new Error(
      "Path traversal detected: path is outside the allowed directory",
    );
  }
}

// ── Facade: task operations bound to cwd ─────────────────────────────

export async function getTask(
  cwd: string,
  taskId: string,
): Promise<TeamTask | null> {
  validateTaskId(taskId);
  return readTask(teamTasksDir(cwd), taskId);
}

export async function getTaskReadiness(
  cwd: string,
  taskId: string,
): Promise<TaskReadiness> {
  validateTaskId(taskId);
  return computeTaskReadiness(teamTasksDir(cwd), taskId);
}

export async function createTask(
  cwd: string,
  input: CreateTaskInput,
): Promise<TeamTask> {
  return createTeamTask(teamDir(cwd), teamTasksDir(cwd), input);
}

export async function claim(
  cwd: string,
  taskId: string,
  workerName: string,
): Promise<ClaimTaskResult> {
  validateTaskId(taskId);
  validateWorkerName(workerName);
  return claimTask(teamTasksDir(cwd), taskId, workerName);
}

export async function transition(
  cwd: string,
  taskId: string,
  from: import("./contracts.js").TaskStatus,
  to: import("./contracts.js").TaskStatus,
  claimToken: string,
): Promise<TransitionTaskResult> {
  validateTaskId(taskId);
  return transitionTask(teamTasksDir(cwd), taskId, from, to, claimToken);
}

export async function releaseClaim(
  cwd: string,
  taskId: string,
  claimToken: string,
): Promise<ReleaseTaskClaimResult> {
  validateTaskId(taskId);
  return releaseTaskClaim(teamTasksDir(cwd), taskId, claimToken);
}

export async function listTasks(cwd: string): Promise<TeamTask[]> {
  return listTeamTasks(teamTasksDir(cwd));
}

// ── Facade: approvals ────────────────────────────────────────────────

export async function getApproval(
  cwd: string,
  taskId: string,
): Promise<TaskApprovalRecord | null> {
  validateTaskId(taskId);
  return readTaskApproval(teamApprovalsDir(cwd), taskId);
}

export async function setApproval(
  cwd: string,
  approval: TaskApprovalRecord,
): Promise<void> {
  validateTaskId(approval.task_id);
  return writeTaskApproval(teamApprovalsDir(cwd), approval);
}

// ── Facade: mailbox ──────────────────────────────────────────────────

export async function sendMessage(
  cwd: string,
  fromWorker: string,
  toWorker: string,
  body: string,
): Promise<MailboxMessage> {
  validateWorkerName(fromWorker);
  validateWorkerName(toWorker);
  return sendDirectMessage(teamMailboxDir(cwd), fromWorker, toWorker, body);
}

export async function broadcast(
  cwd: string,
  fromWorker: string,
  body: string,
  workerNames: string[],
): Promise<MailboxMessage[]> {
  validateWorkerName(fromWorker);
  for (const name of workerNames) validateWorkerName(name);
  return broadcastMessage(teamMailboxDir(cwd), fromWorker, body, workerNames);
}

export async function getMessages(
  cwd: string,
  workerName: string,
): Promise<MailboxMessage[]> {
  validateWorkerName(workerName);
  return listMailboxMessages(teamMailboxDir(cwd), workerName);
}

export async function markDelivered(
  cwd: string,
  workerName: string,
  messageId: string,
): Promise<boolean> {
  validateWorkerName(workerName);
  return markMessageDelivered(teamMailboxDir(cwd), workerName, messageId);
}

export async function markNotified(
  cwd: string,
  workerName: string,
  messageId: string,
): Promise<boolean> {
  validateWorkerName(workerName);
  return markMessageNotified(teamMailboxDir(cwd), workerName, messageId);
}

// ── Facade: dispatch ────────────────────────────────────────────────

export async function enqueueDispatch(
  cwd: string,
  input: DispatchRequestInput,
): Promise<{ request: DispatchRequest; deduped: boolean }> {
  return enqueueDispatchRequest(teamDispatchDir(cwd), input);
}

export async function getDispatch(
  cwd: string,
  requestId: string,
): Promise<DispatchRequest | null> {
  return readDispatchRequest(teamDispatchDir(cwd), requestId);
}

export async function listDispatches(
  cwd: string,
  opts?: {
    status?: DispatchRequestStatus;
    kind?: DispatchRequestKind;
    to_worker?: string;
    limit?: number;
  },
): Promise<DispatchRequest[]> {
  return listDispatchRequests(teamDispatchDir(cwd), opts);
}

export async function markDispatchNotified(
  cwd: string,
  requestId: string,
  patch?: Partial<DispatchRequest>,
): Promise<DispatchRequest | null> {
  return markDispatchRequestNotified(teamDispatchDir(cwd), requestId, patch);
}

export async function markDispatchDelivered(
  cwd: string,
  requestId: string,
  patch?: Partial<DispatchRequest>,
): Promise<DispatchRequest | null> {
  return markDispatchRequestDelivered(teamDispatchDir(cwd), requestId, patch);
}

// ── Facade: workers ─────────────────────────────────────────────────

export async function getWorkerStatus(
  cwd: string,
  workerName: string,
): Promise<WorkerStatus | null> {
  validateWorkerName(workerName);
  return readWorkerStatus(teamWorkersDir(cwd), workerName);
}

export async function setWorkerStatus(
  cwd: string,
  workerName: string,
  state: WorkerState,
  fields?: { current_task_id?: string; reason?: string },
): Promise<WorkerStatus> {
  validateWorkerName(workerName);
  return writeWorkerStatus(teamWorkersDir(cwd), workerName, state, fields);
}

export async function getWorkerHeartbeat(
  cwd: string,
  workerName: string,
): Promise<WorkerHeartbeat | null> {
  validateWorkerName(workerName);
  return readWorkerHeartbeat(teamWorkersDir(cwd), workerName);
}

export async function setWorkerHeartbeat(
  cwd: string,
  workerName: string,
  heartbeat: WorkerHeartbeat,
): Promise<void> {
  validateWorkerName(workerName);
  return writeWorkerHeartbeat(teamWorkersDir(cwd), workerName, heartbeat);
}

export async function touchWorkerHeartbeat(
  cwd: string,
  workerName: string,
): Promise<WorkerHeartbeat> {
  validateWorkerName(workerName);
  return updateWorkerHeartbeat(teamWorkersDir(cwd), workerName);
}

export async function checkWorkerAlive(
  cwd: string,
  workerName: string,
  staleMs?: number,
): Promise<boolean> {
  validateWorkerName(workerName);
  return isWorkerAlive(teamWorkersDir(cwd), workerName, staleMs);
}

export async function getWorkerNames(cwd: string): Promise<string[]> {
  return listWorkers(teamWorkersDir(cwd));
}

// ── Facade: team lock ────────────────────────────────────────────────

export async function withLock<T>(
  cwd: string,
  fn: () => Promise<T>,
): Promise<T> {
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

export function resolveDispatchDir(cwd: string): string {
  return teamDispatchDir(cwd);
}

export function resolveWorkersDir(cwd: string): string {
  return teamWorkersDir(cwd);
}
