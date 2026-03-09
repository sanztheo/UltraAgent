import { homedir } from "node:os";
import { join, resolve } from "node:path";

export function expandHome(filepath: string): string {
  if (filepath.startsWith("~/")) {
    return join(homedir(), filepath.slice(2));
  }
  return filepath;
}

export function globalConfigDir(): string {
  return join(homedir(), ".ultraagent");
}

export function globalConfigPath(): string {
  return join(globalConfigDir(), "config.json");
}

export function projectConfigPath(cwd: string): string {
  return join(resolve(cwd), ".ultraagent.json");
}

export function stateDir(cwd: string): string {
  return join(resolve(cwd), ".ultraagent");
}

export function statePath(cwd: string): string {
  return join(stateDir(cwd), "state.json");
}

export function tasksDir(cwd: string): string {
  return join(stateDir(cwd), "tasks");
}

export function scriptsDir(): string {
  return join(globalConfigDir(), "scripts");
}

export function teamDir(cwd: string): string {
  return join(stateDir(cwd), "team");
}

export function teamTasksDir(cwd: string): string {
  return join(teamDir(cwd), "tasks");
}

export function teamApprovalsDir(cwd: string): string {
  return join(teamDir(cwd), "approvals");
}

export function teamMailboxDir(cwd: string): string {
  return join(teamDir(cwd), "mailbox");
}

export function teamEventsDir(cwd: string): string {
  return join(teamDir(cwd), "events");
}

export function teamDispatchDir(cwd: string): string {
  return join(teamDir(cwd), "dispatch");
}

export function teamInboxDir(cwd: string): string {
  return join(teamDir(cwd), "inbox");
}

export function teamWorkersDir(cwd: string): string {
  return join(teamDir(cwd), "workers");
}

export function teamWorkerDir(cwd: string, workerName: string): string {
  return join(teamWorkersDir(cwd), workerName);
}

export function projectName(cwd: string): string {
  return resolve(cwd).split("/").pop() ?? "project";
}
