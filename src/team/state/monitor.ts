/**
 * Team monitor snapshot — aggregated state for the runtime loop.
 *
 * Reads task statuses, worker heartbeats, and worker states into a single
 * snapshot that the orchestrator uses to decide next actions.
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { teamDir } from "../../utils/paths.js";
import { writeAtomic } from "./io.js";
import type { WorkerState } from "./types.js";

export interface TeamSummary {
  workerCount: number;
  tasks: {
    total: number;
    pending: number;
    blocked: number;
    in_progress: number;
    completed: number;
    failed: number;
  };
  workers: Array<{
    name: string;
    alive: boolean;
    lastTurnAt: string | null;
    turnsWithoutProgress: number;
  }>;
  nonReportingWorkers: string[];
  performance?: {
    total_ms: number;
    tasks_loaded_ms: number;
    workers_polled_ms: number;
  };
}

export interface MonitorSnapshotState {
  taskStatusById: Record<string, string>;
  workerAliveByName: Record<string, boolean>;
  workerStateByName: Record<string, string>;
  workerTurnCountByName: Record<string, number>;
  workerTaskIdByName: Record<string, string>;
  completedEventTaskIds: Record<string, boolean>;
  monitorTimings?: {
    list_tasks_ms: number;
    worker_scan_ms: number;
    total_ms: number;
    updated_at: string;
  };
}

export interface TeamPhaseState {
  current_phase: string;
  max_fix_attempts: number;
  current_fix_attempt: number;
  transitions: Array<{
    from: string;
    to: string;
    at: string;
    reason?: string;
  }>;
  updated_at: string;
}

interface SummarySnapshot {
  workerTurnCountByName: Record<string, number>;
  workerTaskByName: Record<string, string>;
}

function summarySnapshotPath(cwd: string): string {
  return join(teamDir(cwd), "summary-snapshot.json");
}

function monitorSnapshotPath(cwd: string): string {
  return join(teamDir(cwd), "monitor-snapshot.json");
}

function teamPhasePath(cwd: string): string {
  return join(teamDir(cwd), "phase.json");
}

async function readJsonFile<T>(path: string): Promise<T | null> {
  if (!existsSync(path)) return null;
  try {
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw) as T;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

export interface MonitorDeps {
  cwd: string;
  listWorkerNames: () => Promise<string[]>;
  listTasks: () => Promise<
    Array<{ id: string; status: string; owner?: string }>
  >;
  readWorkerHeartbeat: (workerName: string) => Promise<{
    alive: boolean;
    last_turn_at: string;
    turn_count: number;
  } | null>;
  readWorkerStatus: (
    workerName: string,
  ) => Promise<{ state: WorkerState; current_task_id?: string }>;
}

export async function getTeamSummary(deps: MonitorDeps): Promise<TeamSummary> {
  const summaryStartMs = performance.now();

  const tasksStartMs = performance.now();
  const tasks = await deps.listTasks();
  const tasksLoadedMs = performance.now() - tasksStartMs;
  const taskById = new Map(tasks.map((task) => [task.id, task] as const));
  const previousSnapshot = await readJsonFile<SummarySnapshot>(
    summarySnapshotPath(deps.cwd),
  );

  const counts = {
    total: tasks.length,
    pending: 0,
    blocked: 0,
    in_progress: 0,
    completed: 0,
    failed: 0,
  };
  for (const t of tasks) {
    if (t.status === "pending") counts.pending++;
    else if (t.status === "blocked") counts.blocked++;
    else if (t.status === "in_progress") counts.in_progress++;
    else if (t.status === "completed") counts.completed++;
    else if (t.status === "failed") counts.failed++;
  }

  const workerNames = await deps.listWorkerNames();
  const workerSummaries: TeamSummary["workers"] = [];
  const nonReportingWorkers: string[] = [];
  const nextSnapshot: SummarySnapshot = {
    workerTurnCountByName: {},
    workerTaskByName: {},
  };

  const workerPollStartMs = performance.now();
  const workerSignals = await Promise.all(
    workerNames.map(async (name) => {
      const [hb, status] = await Promise.all([
        deps.readWorkerHeartbeat(name),
        deps.readWorkerStatus(name),
      ]);
      return { name, hb, status };
    }),
  );
  const workersPolledMs = performance.now() - workerPollStartMs;

  for (const { name, hb, status } of workerSignals) {
    const alive = hb?.alive ?? false;
    const lastTurnAt = hb?.last_turn_at ?? null;
    const currentTaskId = status.current_task_id ?? "";
    const prevTaskId = previousSnapshot?.workerTaskByName[name] ?? "";
    const prevTurnCount = previousSnapshot?.workerTurnCountByName[name] ?? 0;
    const currentTask = currentTaskId
      ? (taskById.get(currentTaskId) ?? null)
      : null;

    const turnsWithoutProgress =
      hb &&
      status.state === "working" &&
      currentTask &&
      (currentTask.status === "pending" ||
        currentTask.status === "in_progress") &&
      currentTaskId === prevTaskId
        ? Math.max(0, hb.turn_count - prevTurnCount)
        : 0;

    if (alive && status.state === "working" && turnsWithoutProgress > 5) {
      nonReportingWorkers.push(name);
    }

    workerSummaries.push({ name, alive, lastTurnAt, turnsWithoutProgress });
    nextSnapshot.workerTurnCountByName[name] = hb?.turn_count ?? 0;
    nextSnapshot.workerTaskByName[name] = currentTaskId;
  }

  await writeAtomic(
    summarySnapshotPath(deps.cwd),
    JSON.stringify(nextSnapshot, null, 2),
  );

  return {
    workerCount: workerNames.length,
    tasks: counts,
    workers: workerSummaries,
    nonReportingWorkers,
    performance: {
      total_ms: Number((performance.now() - summaryStartMs).toFixed(2)),
      tasks_loaded_ms: Number(tasksLoadedMs.toFixed(2)),
      workers_polled_ms: Number(workersPolledMs.toFixed(2)),
    },
  };
}

export async function readMonitorSnapshot(
  cwd: string,
): Promise<MonitorSnapshotState | null> {
  const raw = await readJsonFile<Partial<MonitorSnapshotState>>(
    monitorSnapshotPath(cwd),
  );
  if (!raw) return null;

  return {
    taskStatusById: raw.taskStatusById ?? {},
    workerAliveByName: raw.workerAliveByName ?? {},
    workerStateByName: raw.workerStateByName ?? {},
    workerTurnCountByName: raw.workerTurnCountByName ?? {},
    workerTaskIdByName: raw.workerTaskIdByName ?? {},
    completedEventTaskIds: raw.completedEventTaskIds ?? {},
    monitorTimings:
      raw.monitorTimings && typeof raw.monitorTimings === "object"
        ? raw.monitorTimings
        : undefined,
  };
}

export async function writeMonitorSnapshot(
  cwd: string,
  snapshot: MonitorSnapshotState,
): Promise<void> {
  await writeAtomic(
    monitorSnapshotPath(cwd),
    JSON.stringify(snapshot, null, 2),
  );
}

export async function readTeamPhase(
  cwd: string,
): Promise<TeamPhaseState | null> {
  const raw = await readJsonFile<Partial<TeamPhaseState>>(teamPhasePath(cwd));
  if (!raw) return null;

  return {
    current_phase:
      typeof raw.current_phase === "string" ? raw.current_phase : "team-exec",
    max_fix_attempts:
      typeof raw.max_fix_attempts === "number" ? raw.max_fix_attempts : 3,
    current_fix_attempt:
      typeof raw.current_fix_attempt === "number" ? raw.current_fix_attempt : 0,
    transitions: Array.isArray(raw.transitions) ? raw.transitions : [],
    updated_at:
      typeof raw.updated_at === "string"
        ? raw.updated_at
        : new Date().toISOString(),
  };
}

export async function writeTeamPhase(
  cwd: string,
  phaseState: TeamPhaseState,
): Promise<void> {
  await writeAtomic(teamPhasePath(cwd), JSON.stringify(phaseState, null, 2));
}
