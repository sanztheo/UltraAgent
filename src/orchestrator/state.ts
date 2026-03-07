import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import type { SessionState } from "../config/types.js";
import { stateDir, statePath } from "../utils/paths.js";
import { logger } from "../utils/logger.js";

export function saveState(cwd: string, state: SessionState): void {
  const dir = stateDir(cwd);
  mkdirSync(dir, { recursive: true });
  writeFileSync(statePath(cwd), JSON.stringify(state, null, 2) + "\n");
  logger.debug(`State saved to ${statePath(cwd)}`, "state");
}

export function loadState(cwd: string): SessionState | undefined {
  const path = statePath(cwd);
  if (!existsSync(path)) {
    return undefined;
  }
  try {
    const content = readFileSync(path, "utf-8");
    return JSON.parse(content) as SessionState;
  } catch (error) {
    logger.warn(
      `Failed to load state: ${error instanceof Error ? error.message : String(error)}`,
      "state",
    );
    return undefined;
  }
}

export function clearState(cwd: string): void {
  const dir = stateDir(cwd);
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
    logger.debug("State directory cleared", "state");
  }
}

export function hasActiveSession(cwd: string): boolean {
  return existsSync(statePath(cwd));
}
