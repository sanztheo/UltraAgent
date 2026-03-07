import type { AgentName, AgentResponse } from "../config/types.js";
import { logger } from "../utils/logger.js";

export type TaskStatus = "running" | "done" | "error";

export interface TaskEntry {
  readonly id: string;
  readonly agent: AgentName;
  readonly description: string;
  status: TaskStatus;
  readonly startedAt: number;
  completedAt?: number;
  result?: AgentResponse;
}

const tasks = new Map<string, TaskEntry>();
let counter = 0;

function generateId(): string {
  counter++;
  return `task-${Date.now().toString(36)}-${counter}`;
}

export function createTask(agent: AgentName, description: string): TaskEntry {
  const id = generateId();
  const entry: TaskEntry = {
    id,
    agent,
    description,
    status: "running",
    startedAt: Date.now(),
  };
  tasks.set(id, entry);
  logger.info(`Task ${id} created for ${agent}`, "task-store");
  return entry;
}

export function completeTask(id: string, result: AgentResponse): void {
  const entry = tasks.get(id);
  if (!entry) return;
  entry.status = result.exitCode === 0 ? "done" : "error";
  entry.completedAt = Date.now();
  entry.result = result;
  logger.info(
    `Task ${id} completed (${entry.status}, ${entry.completedAt - entry.startedAt}ms)`,
    "task-store",
  );
}

export function getTask(id: string): TaskEntry | undefined {
  return tasks.get(id);
}

export function listTasks(): TaskEntry[] {
  return [...tasks.values()].sort((a, b) => b.startedAt - a.startedAt);
}

export function clearCompletedTasks(): number {
  let cleared = 0;
  for (const [id, entry] of tasks) {
    if (entry.status !== "running") {
      tasks.delete(id);
      cleared++;
    }
  }
  return cleared;
}
