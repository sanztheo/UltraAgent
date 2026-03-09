/**
 * Facade validation — input guards shared across all facade modules.
 */

import { resolve, sep } from "node:path";

import { TASK_ID_PATTERN, WORKER_NAME_PATTERN } from "../contracts.js";

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
