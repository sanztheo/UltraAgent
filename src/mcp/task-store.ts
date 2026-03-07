import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentName, AgentResponse } from '../config/types.js';
import { logger } from '../utils/logger.js';
import { tasksDir } from '../utils/paths.js';

export type TaskStatus = 'running' | 'done' | 'error';

export interface TaskEntry {
  id: string;
  agent: AgentName;
  description: string;
  status: TaskStatus;
  startedAt: number;
  completedAt?: number;
  result?: AgentResponse;
}

function getTasksDir(): string {
  const dir = tasksDir(process.cwd());
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function taskFilePath(id: string): string {
  return join(getTasksDir(), `${id}.json`);
}

function generateId(): string {
  return `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function createTask(agent: AgentName, description: string): TaskEntry {
  const entry: TaskEntry = {
    id: generateId(),
    agent,
    description,
    status: 'running',
    startedAt: Date.now(),
  };
  writeFileSync(taskFilePath(entry.id), JSON.stringify(entry, null, 2));
  logger.info(`Task ${entry.id} created for ${agent}`, 'task-store');
  return entry;
}

export function completeTask(id: string, result: AgentResponse): void {
  const entry = getTask(id);
  if (!entry) return;
  entry.status = result.exitCode === 0 ? 'done' : 'error';
  entry.completedAt = Date.now();
  entry.result = result;
  writeFileSync(taskFilePath(id), JSON.stringify(entry, null, 2));
  logger.info(`Task ${id} completed (${entry.status}, ${entry.completedAt - entry.startedAt}ms)`, 'task-store');
}

export function getTask(id: string): TaskEntry | undefined {
  const path = taskFilePath(id);
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as TaskEntry;
  } catch {
    return undefined;
  }
}

export function listTasks(): TaskEntry[] {
  const dir = getTasksDir();
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  const tasks: TaskEntry[] = [];
  for (const file of files) {
    try {
      const content = readFileSync(join(dir, file), 'utf-8');
      tasks.push(JSON.parse(content) as TaskEntry);
    } catch {
      /* skip corrupt files */
    }
  }
  return tasks.sort((a, b) => b.startedAt - a.startedAt);
}
