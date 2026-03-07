/**
 * File-based locks using atomic mkdir.
 *
 * mkdir is atomic on all major filesystems — if two processes race,
 * exactly one succeeds and the other gets EEXIST. The lock directory
 * contains an `owner` file with a unique token so only the holder
 * can release it. Stale locks (from crashed processes) are recovered
 * based on mtime.
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const DEFAULT_STALE_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 5_000;
const RETRY_MS = 25;

export interface LockOptions {
  /** Lock is considered stale after this many ms (default 30s). */
  staleMs?: number;
  /** Give up acquiring the lock after this many ms (default 5s). */
  timeoutMs?: number;
}

function ownerToken(): string {
  return `${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}`;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function recoverStaleLock(lockDir: string, staleMs: number): Promise<boolean> {
  try {
    const info = await stat(lockDir);
    if (Date.now() - info.mtimeMs > staleMs) {
      await rm(lockDir, { recursive: true, force: true });
      return true;
    }
  } catch {
    /* lock disappeared between check and stat — that's fine */
  }
  return false;
}

/**
 * Acquire a directory-based lock, execute `fn`, then release.
 * Throws if the lock cannot be acquired within `timeoutMs`.
 */
export async function withLock<T>(lockDir: string, options: LockOptions, fn: () => Promise<T>): Promise<T> {
  const staleMs = options.staleMs ?? DEFAULT_STALE_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const ownerPath = join(lockDir, 'owner');
  const token = ownerToken();
  const deadline = Date.now() + timeoutMs;

  await mkdir(dirname(lockDir), { recursive: true });

  while (true) {
    try {
      await mkdir(lockDir);
      try {
        await writeFile(ownerPath, token, 'utf-8');
      } catch (error) {
        await rm(lockDir, { recursive: true, force: true });
        throw error;
      }
      break;
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code !== 'EEXIST') throw error;
      if (await recoverStaleLock(lockDir, staleMs)) continue;
      if (Date.now() > deadline) {
        throw new Error(`Lock timeout: ${lockDir}`);
      }
      await sleep(RETRY_MS);
    }
  }

  try {
    return await fn();
  } finally {
    try {
      const currentOwner = await readFile(ownerPath, 'utf-8');
      if (currentOwner.trim() === token) {
        await rm(lockDir, { recursive: true, force: true });
      }
    } catch {
      /* best-effort cleanup */
    }
  }
}

/**
 * Like `withLock`, but returns `{ ok: false }` on timeout instead of throwing.
 * Used by task claiming where contention is expected.
 */
export async function tryLock<T>(
  lockDir: string,
  options: LockOptions,
  fn: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false }> {
  const staleMs = options.staleMs ?? DEFAULT_STALE_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const ownerPath = join(lockDir, 'owner');
  const token = ownerToken();
  const deadline = Date.now() + timeoutMs;

  await mkdir(dirname(lockDir), { recursive: true });

  while (true) {
    try {
      await mkdir(lockDir);
      break;
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code !== 'EEXIST') throw error;
      if (await recoverStaleLock(lockDir, staleMs)) continue;
      if (Date.now() > deadline) return { ok: false };
      await sleep(RETRY_MS);
    }
  }

  try {
    try {
      await writeFile(ownerPath, token, 'utf-8');
    } catch (error) {
      await rm(lockDir, { recursive: true, force: true });
      throw error;
    }
    return { ok: true, value: await fn() };
  } finally {
    try {
      const currentOwner = await readFile(ownerPath, 'utf-8');
      if (currentOwner.trim() === token) {
        await rm(lockDir, { recursive: true, force: true });
      }
    } catch {
      /* best-effort cleanup */
    }
  }
}

// ── Convenience wrappers ───────────────────────────────────────────────

const LOCK_OPTS: LockOptions = {
  staleMs: DEFAULT_STALE_MS,
  timeoutMs: DEFAULT_TIMEOUT_MS,
};

export async function withTeamLock<T>(teamDir: string, fn: () => Promise<T>): Promise<T> {
  return withLock(join(teamDir, '.lock.create-task'), LOCK_OPTS, fn);
}

export async function withTaskClaimLock<T>(
  tasksDir: string,
  taskId: string,
  fn: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false }> {
  return tryLock(join(tasksDir, `.lock.claim-${taskId}`), LOCK_OPTS, fn);
}

export async function withMailboxLock<T>(mailboxDir: string, workerName: string, fn: () => Promise<T>): Promise<T> {
  if (!existsSync(mailboxDir)) {
    throw new Error(`Mailbox directory not found: ${mailboxDir}`);
  }
  return withLock(join(mailboxDir, `.lock.${workerName}`), LOCK_OPTS, fn);
}

export async function withScalingLock<T>(teamDir: string, fn: () => Promise<T>): Promise<T> {
  return withLock(join(teamDir, '.lock.scaling'), { staleMs: DEFAULT_STALE_MS, timeoutMs: 10_000 }, fn);
}
