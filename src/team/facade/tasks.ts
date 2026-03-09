/**
 * Facade: task operations bound to `cwd`.
 */

import { teamDir, teamTasksDir } from "../../utils/paths.js";
import {
  claimTask,
  computeTaskReadiness,
  createTeamTask,
  listTeamTasks,
  readTask,
  releaseTaskClaim,
  transitionTask,
} from "../state/tasks.js";
import type {
  ClaimTaskResult,
  CreateTaskInput,
  ReleaseTaskClaimResult,
  TaskReadiness,
  TeamTask,
  TransitionTaskResult,
} from "../state/types.js";
import { validateTaskId, validateWorkerName } from "./validation.js";

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
  from: import("../contracts.js").TaskStatus,
  to: import("../contracts.js").TaskStatus,
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
