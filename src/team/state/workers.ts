/**
 * Worker status & heartbeat — file-based tracking per worker.
 *
 * Each worker has a directory at `.ultraagent/team/workers/<name>/`
 * containing `status.json` and `heartbeat.json`.
 */

import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

import { safeReadJsonFile } from "../../utils/safe-json.js";
import { writeAtomic } from "./io.js";
import type { WorkerHeartbeat, WorkerState, WorkerStatus } from "./types.js";

function statusPath(workersDir: string, workerName: string): string {
  return join(workersDir, workerName, "status.json");
}

function heartbeatPath(workersDir: string, workerName: string): string {
  return join(workersDir, workerName, "heartbeat.json");
}

function isWorkerStatus(value: unknown): value is WorkerStatus {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.state === "string" && typeof obj.updated_at === "string";
}

function isWorkerHeartbeat(value: unknown): value is WorkerHeartbeat {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.pid === "number" && typeof obj.alive === "boolean";
}

export async function readWorkerStatus(
  workersDir: string,
  workerName: string,
): Promise<WorkerStatus | null> {
  const raw = await safeReadJsonFile<unknown>(
    statusPath(workersDir, workerName),
    null,
  );
  if (!raw || !isWorkerStatus(raw)) return null;
  return raw;
}

export async function writeWorkerStatus(
  workersDir: string,
  workerName: string,
  state: WorkerState,
  fields?: { current_task_id?: string; reason?: string },
): Promise<WorkerStatus> {
  const status: WorkerStatus = {
    state,
    current_task_id: fields?.current_task_id,
    reason: fields?.reason,
    updated_at: new Date().toISOString(),
  };
  await writeAtomic(
    statusPath(workersDir, workerName),
    JSON.stringify(status, null, 2),
  );
  return status;
}

export async function readWorkerHeartbeat(
  workersDir: string,
  workerName: string,
): Promise<WorkerHeartbeat | null> {
  const raw = await safeReadJsonFile<unknown>(
    heartbeatPath(workersDir, workerName),
    null,
  );
  if (!raw || !isWorkerHeartbeat(raw)) return null;
  return raw;
}

export async function writeWorkerHeartbeat(
  workersDir: string,
  workerName: string,
  heartbeat: WorkerHeartbeat,
): Promise<void> {
  await writeAtomic(
    heartbeatPath(workersDir, workerName),
    JSON.stringify(heartbeat, null, 2),
  );
}

export async function updateWorkerHeartbeat(
  workersDir: string,
  workerName: string,
): Promise<WorkerHeartbeat> {
  const existing = await readWorkerHeartbeat(workersDir, workerName);
  const heartbeat: WorkerHeartbeat = {
    pid: existing?.pid ?? process.pid,
    last_turn_at: new Date().toISOString(),
    turn_count: (existing?.turn_count ?? 0) + 1,
    alive: true,
  };
  await writeWorkerHeartbeat(workersDir, workerName, heartbeat);
  return heartbeat;
}

const DEFAULT_HEARTBEAT_STALE_MS = 5 * 60 * 1000;

export async function isWorkerAlive(
  workersDir: string,
  workerName: string,
  staleMs: number = DEFAULT_HEARTBEAT_STALE_MS,
): Promise<boolean> {
  const hb = await readWorkerHeartbeat(workersDir, workerName);
  if (!hb) return false;
  if (!hb.alive) return false;
  const elapsed = Date.now() - new Date(hb.last_turn_at).getTime();
  return elapsed < staleMs;
}

export async function listWorkers(workersDir: string): Promise<string[]> {
  if (!existsSync(workersDir)) return [];
  const entries = await readdir(workersDir, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => e.name)
    .sort();
}
