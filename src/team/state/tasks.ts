/**
 * Task claiming, transitions, and readiness — the core of robust task management.
 *
 * Key concepts:
 * - A worker "claims" a pending task, getting a lease (15min) and a claim token.
 * - Only the claim holder can transition the task (completed/failed).
 * - Dependencies: a task with depends_on is blocked until all deps complete.
 * - All mutations go through locks to prevent concurrent corruption.
 */

import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { canTransition, isTerminalStatus } from '../contracts.js';
import type { TaskStatus } from '../contracts.js';
import { writeAtomic } from './io.js';
import { withTaskClaimLock, withTeamLock } from './locks.js';
import type {
  ClaimTaskResult,
  CreateTaskInput,
  ReleaseTaskClaimResult,
  TaskReadiness,
  TeamTask,
  TransitionTaskResult,
} from './types.js';

const LEASE_DURATION_MS = 15 * 60 * 1000;

// ── Helpers ────────────────────────────────────────────────────────────

function taskFilePath(tasksDir: string, taskId: string): string {
  return join(tasksDir, `task-${taskId}.json`);
}

function isTeamTask(value: unknown): value is TeamTask {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.id === 'string' && typeof obj.status === 'string' && typeof obj.subject === 'string';
}

export async function readTask(tasksDir: string, taskId: string): Promise<TeamTask | null> {
  const path = taskFilePath(tasksDir, taskId);
  if (!existsSync(path)) return null;
  try {
    const raw = await readFile(path, 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    if (!isTeamTask(parsed)) return null;
    return { ...parsed, version: parsed.version ?? 1 };
  } catch {
    return null;
  }
}

// ── Task readiness (dependency check) ──────────────────────────────────

export async function computeTaskReadiness(tasksDir: string, taskId: string): Promise<TaskReadiness> {
  const task = await readTask(tasksDir, taskId);
  if (!task) {
    return { ready: false, reason: 'blocked_dependency', dependencies: [] };
  }

  const depIds = task.depends_on ?? task.blocked_by ?? [];
  if (depIds.length === 0) return { ready: true };

  const depTasks = await Promise.all(depIds.map((id) => readTask(tasksDir, id)));
  const incomplete = depIds.filter((_, idx) => depTasks[idx]?.status !== 'completed');

  if (incomplete.length > 0) {
    return {
      ready: false,
      reason: 'blocked_dependency',
      dependencies: incomplete,
    };
  }
  return { ready: true };
}

// ── Create task ────────────────────────────────────────────────────────

export async function createTeamTask(teamDir: string, tasksDir: string, input: CreateTaskInput): Promise<TeamTask> {
  return withTeamLock(teamDir, async () => {
    let maxId = 0;
    if (existsSync(tasksDir)) {
      const entries = await readdir(tasksDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const match = /^task-(\d+)\.json$/.exec(entry.name);
        if (match) {
          const id = Number(match[1]);
          if (id > maxId) maxId = id;
        }
      }
    }

    const taskId = String(maxId + 1);
    const hasDeps = (input.depends_on?.length ?? 0) > 0;

    const task: TeamTask = {
      id: taskId,
      subject: input.subject,
      description: input.description,
      status: hasDeps ? 'blocked' : 'pending',
      requires_code_change: input.requires_code_change,
      role: input.role,
      owner: input.owner,
      depends_on: input.depends_on,
      version: 1,
      created_at: new Date().toISOString(),
    };

    await writeAtomic(taskFilePath(tasksDir, taskId), JSON.stringify(task, null, 2));
    return task;
  });
}

// ── Claim task ─────────────────────────────────────────────────────────

export async function claimTask(tasksDir: string, taskId: string, workerName: string): Promise<ClaimTaskResult> {
  const existing = await readTask(tasksDir, taskId);
  if (!existing) return { ok: false, error: 'task_not_found' };

  const readiness = await computeTaskReadiness(tasksDir, taskId);
  if (!readiness.ready) {
    return {
      ok: false,
      error: 'blocked_dependency',
      dependencies: readiness.dependencies,
    };
  }

  const lock = await withTaskClaimLock(tasksDir, taskId, async () => {
    const current = await readTask(tasksDir, taskId);
    if (!current) {
      return { ok: false as const, error: 'task_not_found' as const };
    }

    const innerReadiness = await computeTaskReadiness(tasksDir, taskId);
    if (!innerReadiness.ready) {
      return {
        ok: false as const,
        error: 'blocked_dependency' as const,
        dependencies: innerReadiness.dependencies,
      };
    }

    if (isTerminalStatus(current.status)) {
      return { ok: false as const, error: 'already_terminal' as const };
    }
    if (current.status === 'in_progress') {
      return { ok: false as const, error: 'claim_conflict' as const };
    }
    if (current.claim) {
      return { ok: false as const, error: 'claim_conflict' as const };
    }
    if (current.owner && current.owner !== workerName) {
      return { ok: false as const, error: 'claim_conflict' as const };
    }

    const claimToken = randomUUID();
    const updated: TeamTask = {
      ...current,
      status: 'in_progress',
      owner: workerName,
      claim: {
        owner: workerName,
        token: claimToken,
        leased_until: new Date(Date.now() + LEASE_DURATION_MS).toISOString(),
      },
      version: current.version + 1,
    };

    await writeAtomic(taskFilePath(tasksDir, taskId), JSON.stringify(updated, null, 2));
    return { ok: true as const, task: updated, claimToken };
  });

  if (!lock.ok) return { ok: false, error: 'claim_conflict' };
  return lock.value;
}

// ── Transition task status ─────────────────────────────────────────────

export async function transitionTask(
  tasksDir: string,
  taskId: string,
  from: TaskStatus,
  to: TaskStatus,
  claimToken: string,
): Promise<TransitionTaskResult> {
  if (!canTransition(from, to)) {
    return { ok: false, error: 'invalid_transition' };
  }

  const lock = await withTaskClaimLock(tasksDir, taskId, async () => {
    const current = await readTask(tasksDir, taskId);
    if (!current) {
      return { ok: false as const, error: 'task_not_found' as const };
    }

    if (isTerminalStatus(current.status)) {
      return { ok: false as const, error: 'already_terminal' as const };
    }
    if (current.status !== from || !canTransition(current.status, to)) {
      return { ok: false as const, error: 'invalid_transition' as const };
    }

    if (
      !current.owner ||
      !current.claim ||
      current.claim.owner !== current.owner ||
      current.claim.token !== claimToken
    ) {
      return { ok: false as const, error: 'claim_conflict' as const };
    }
    if (new Date(current.claim.leased_until) <= new Date()) {
      return { ok: false as const, error: 'lease_expired' as const };
    }

    const updated: TeamTask = {
      ...current,
      status: to,
      completed_at: new Date().toISOString(),
      claim: undefined,
      version: current.version + 1,
    };

    await writeAtomic(taskFilePath(tasksDir, taskId), JSON.stringify(updated, null, 2));
    return { ok: true as const, task: updated };
  });

  if (!lock.ok) return { ok: false, error: 'claim_conflict' };
  return lock.value;
}

// ── Release claim (give task back to pending) ──────────────────────────

export async function releaseTaskClaim(
  tasksDir: string,
  taskId: string,
  claimToken: string,
): Promise<ReleaseTaskClaimResult> {
  const lock = await withTaskClaimLock(tasksDir, taskId, async () => {
    const current = await readTask(tasksDir, taskId);
    if (!current) {
      return { ok: false as const, error: 'task_not_found' as const };
    }

    if (current.status === 'pending' && !current.claim && !current.owner) {
      return { ok: true as const, task: current };
    }
    if (isTerminalStatus(current.status)) {
      return { ok: false as const, error: 'already_terminal' as const };
    }

    if (
      !current.owner ||
      !current.claim ||
      current.claim.owner !== current.owner ||
      current.claim.token !== claimToken
    ) {
      return { ok: false as const, error: 'claim_conflict' as const };
    }
    if (new Date(current.claim.leased_until) <= new Date()) {
      return { ok: false as const, error: 'lease_expired' as const };
    }

    const updated: TeamTask = {
      ...current,
      status: 'pending',
      owner: undefined,
      claim: undefined,
      version: current.version + 1,
    };

    await writeAtomic(taskFilePath(tasksDir, taskId), JSON.stringify(updated, null, 2));
    return { ok: true as const, task: updated };
  });

  if (!lock.ok) return { ok: false, error: 'claim_conflict' };
  return lock.value;
}

// ── List tasks ─────────────────────────────────────────────────────────

export async function listTeamTasks(tasksDir: string): Promise<TeamTask[]> {
  if (!existsSync(tasksDir)) return [];

  const entries = await readdir(tasksDir, { withFileTypes: true });
  const matched = entries.flatMap((entry) => {
    if (!entry.isFile()) return [];
    const match = /^task-(\d+)\.json$/.exec(entry.name);
    if (!match) return [];
    return [{ id: match[1], fileName: entry.name }];
  });

  const loaded = await Promise.all(
    matched.map(async ({ fileName }) => {
      try {
        const raw = await readFile(join(tasksDir, fileName), 'utf-8');
        const parsed: unknown = JSON.parse(raw);
        if (!isTeamTask(parsed)) return null;
        return {
          ...parsed,
          version: parsed.version ?? 1,
        } as TeamTask;
      } catch {
        return null;
      }
    }),
  );

  const tasks: TeamTask[] = [];
  for (const task of loaded) {
    if (task) tasks.push(task);
  }
  return tasks.sort((a, b) => Number(a.id) - Number(b.id));
}
