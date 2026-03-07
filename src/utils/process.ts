import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function isProcessRunning(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function killProcess(
  pid: number,
  signal: NodeJS.Signals = "SIGTERM",
): Promise<void> {
  try {
    process.kill(pid, signal);
  } catch {
    // Process already dead
  }
}

export async function waitForOutput(
  command: string,
  args: readonly string[],
  predicate: (output: string) => boolean,
  options?: { intervalMs?: number; timeoutMs?: number },
): Promise<boolean> {
  const interval = options?.intervalMs ?? 500;
  const timeout = options?.timeoutMs ?? 30_000;
  const start = Date.now();

  while (Date.now() - start < timeout) {
    try {
      const { stdout } = await execFileAsync(command, [...args], {
        timeout: 5_000,
      });
      if (predicate(stdout)) {
        return true;
      }
    } catch {
      // Command failed, keep polling
    }
    await sleep(interval);
  }
  return false;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
