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

export function scriptsDir(): string {
  return join(globalConfigDir(), "scripts");
}

export function projectName(cwd: string): string {
  return resolve(cwd).split("/").pop() ?? "project";
}
