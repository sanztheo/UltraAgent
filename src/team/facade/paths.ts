/**
 * Facade path accessors — resolve raw team directories from `cwd`.
 */

import {
  teamApprovalsDir,
  teamDir,
  teamDispatchDir,
  teamEventsDir,
  teamMailboxDir,
  teamTasksDir,
  teamWorkersDir,
} from "../../utils/paths.js";

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
