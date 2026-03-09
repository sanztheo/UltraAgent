/**
 * Facade: worker operations bound to `cwd`.
 */

import { teamWorkersDir } from "../../utils/paths.js";
import {
  isWorkerAlive,
  listWorkers,
  readWorkerHeartbeat,
  readWorkerStatus,
  updateWorkerHeartbeat,
  writeWorkerHeartbeat,
  writeWorkerStatus,
} from "../state/workers.js";
import type {
  WorkerHeartbeat,
  WorkerState,
  WorkerStatus,
} from "../state/types.js";
import { validateWorkerName } from "./validation.js";

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
