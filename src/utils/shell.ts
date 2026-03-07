import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface ExecResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export async function execCommand(
  command: string,
  args: readonly string[],
  options?: {
    cwd?: string;
    env?: Record<string, string>;
    timeoutMs?: number;
  },
): Promise<ExecResult> {
  try {
    const { stdout, stderr } = await execFileAsync(command, [...args], {
      cwd: options?.cwd,
      env: options?.env ? { ...process.env, ...options.env } : undefined,
      timeout: options?.timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (error: unknown) {
    if (isExecFileError(error)) {
      return {
        stdout: String(error.stdout ?? ''),
        stderr: String(error.stderr ?? ''),
        exitCode: typeof error.code === 'number' ? error.code : 1,
      };
    }
    throw error;
  }
}

export function spawnInteractive(
  command: string,
  args: readonly string[],
  options?: {
    cwd?: string;
    env?: Record<string, string>;
  },
): ReturnType<typeof spawn> {
  return spawn(command, [...args], {
    cwd: options?.cwd,
    env: options?.env ? { ...process.env, ...options.env } : undefined,
    stdio: 'inherit',
  });
}

export async function which(binary: string): Promise<string | undefined> {
  try {
    const result = await execCommand('which', [binary]);
    return result.exitCode === 0 ? result.stdout.trim() : undefined;
  } catch {
    return undefined;
  }
}

function isExecFileError(error: unknown): error is { stdout?: string; stderr?: string; code?: number | string } {
  return typeof error === 'object' && error !== null && 'code' in error;
}
