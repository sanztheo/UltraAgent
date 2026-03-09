/**
 * Dynamic worker scaling for team mode.
 *
 * Provides scaleUp (add workers mid-session) and scaleDown (drain + remove).
 * Gated behind the ULTRA_TEAM_SCALING_ENABLED environment variable.
 *
 * Key design decisions:
 * - Monotonic worker index counter ensures unique names
 * - File-based scaling lock prevents concurrent scale operations
 * - 'draining' worker status for graceful transitions during scaleDown
 */

import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import {
  isTmuxAvailable,
  sendToWorker,
  waitForWorkerReady,
  isWorkerAlive,
  teardownWorkerPanes,
  buildWorkerStartupCommand,
  resolveWorkerCliPlan,
} from "./tmux-session.js";
import { writeWorkerStatus } from "./state/workers.js";
import { withScalingLock } from "./state/locks.js";
import { teamWorkersDir } from "../utils/paths.js";
import type { WorkerCli } from "./model-contract.js";

const ULTRA_TEAM_SCALING_ENABLED_ENV = "ULTRA_TEAM_SCALING_ENABLED";

export function isScalingEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = env[ULTRA_TEAM_SCALING_ENABLED_ENV];
  if (!raw) return false;
  const normalized = raw.trim().toLowerCase();
  return ["1", "true", "yes", "on", "enabled"].includes(normalized);
}

function assertScalingEnabled(env: NodeJS.ProcessEnv = process.env): void {
  if (!isScalingEnabled(env)) {
    throw new Error(
      `Dynamic scaling is disabled. Set ${ULTRA_TEAM_SCALING_ENABLED_ENV}=1 to enable.`,
    );
  }
}

export interface WorkerInfo {
  name: string;
  index: number;
  role: string;
  worker_cli: WorkerCli;
  pid?: number;
  pane_id?: string;
  working_dir: string;
}

export interface ScaleUpResult {
  ok: true;
  addedWorkers: WorkerInfo[];
  newWorkerCount: number;
  nextWorkerIndex: number;
}

export interface ScaleDownResult {
  ok: true;
  removedWorkers: string[];
  newWorkerCount: number;
}

export interface ScaleError {
  ok: false;
  error: string;
}

export interface TeamConfig {
  workers: WorkerInfo[];
  worker_count: number;
  max_workers: number;
  next_worker_index?: number;
  tmux_session: string;
  leader_pane_id?: string;
  hud_pane_id?: string;
}

export interface ScaleDownOptions {
  workerNames?: string[];
  count?: number;
  force?: boolean;
  drainTimeoutMs?: number;
}

export async function scaleUp(
  sessionName: string,
  count: number,
  agentType: string,
  cwd: string,
  config: TeamConfig,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ScaleUpResult | ScaleError> {
  assertScalingEnabled(env);

  if (!Number.isInteger(count) || count < 1) {
    return {
      ok: false,
      error: `count must be a positive integer (got ${count})`,
    };
  }

  if (!isTmuxAvailable()) {
    return { ok: false, error: "tmux is not available" };
  }

  const currentCount = config.workers.length;
  if (currentCount + count > config.max_workers) {
    return {
      ok: false,
      error: `Cannot add ${count} workers: would exceed max_workers (${currentCount} + ${count} > ${config.max_workers})`,
    };
  }

  return await withScalingLock(
    cwd,
    async (): Promise<ScaleUpResult | ScaleError> => {
      let nextIndex = config.next_worker_index ?? currentCount + 1;
      const addedWorkers: WorkerInfo[] = [];
      const workerCliPlan = resolveWorkerCliPlan(count, [], env);

      const rollbackScaleUp = (error: string, paneId?: string): ScaleError => {
        for (const w of addedWorkers) {
          const idx = config.workers.findIndex(
            (worker) => worker.name === w.name,
          );
          if (idx >= 0) {
            config.workers.splice(idx, 1);
          }
          if (w.pane_id) {
            try {
              spawnSync("tmux", ["kill-pane", "-t", w.pane_id], {
                stdio: "pipe",
              });
            } catch {
              // best effort
            }
          }
        }
        if (paneId) {
          try {
            spawnSync("tmux", ["kill-pane", "-t", paneId], { stdio: "pipe" });
          } catch {
            // best effort
          }
        }
        config.worker_count = config.workers.length;
        return { ok: false, error };
      };

      for (let i = 0; i < count; i++) {
        const workerIndex = nextIndex;
        nextIndex++;
        const workerName = `worker-${workerIndex}`;

        const workerDirPath = join(teamWorkersDir(cwd), workerName);
        await mkdir(workerDirPath, { recursive: true });

        const cmd = buildWorkerStartupCommand(
          workerIndex,
          [],
          cwd,
          {},
          workerCliPlan[i],
        );

        const splitTarget =
          config.workers.length > 0
            ? (config.workers[config.workers.length - 1]?.pane_id ??
              config.leader_pane_id ??
              "")
            : (config.leader_pane_id ?? "");
        const splitDirection =
          splitTarget === (config.leader_pane_id ?? "") ? "-h" : "-v";

        const result = spawnSync(
          "tmux",
          [
            "split-window",
            splitDirection,
            "-t",
            splitTarget,
            "-d",
            "-P",
            "-F",
            "#{pane_id}",
            "-c",
            cwd,
            cmd,
          ],
          { encoding: "utf-8" },
        );

        if (result.status !== 0) {
          return rollbackScaleUp(
            `Failed to create tmux pane for ${workerName}: ${(result.stderr || "").trim()}`,
          );
        }

        const paneId = (result.stdout || "").trim().split("\n")[0]?.trim();
        if (!paneId || !paneId.startsWith("%")) {
          return rollbackScaleUp(`Failed to capture pane ID for ${workerName}`);
        }

        const readyTimeoutMs = resolveWorkerReadyTimeoutMs(env);
        const skipReadyWait = env.ULTRA_TEAM_SKIP_READY_WAIT === "1";
        if (!skipReadyWait) {
          waitForWorkerReady(sessionName, workerIndex, readyTimeoutMs, paneId);
        }

        const triggerMessage = `You are ${workerName}. Check your inbox for instructions.`;
        try {
          await sendToWorker(sessionName, workerIndex, triggerMessage, paneId);
        } catch {
          return rollbackScaleUp(
            `scale_up_dispatch_failed:${workerName}`,
            paneId,
          );
        }

        const workerInfo: WorkerInfo = {
          name: workerName,
          index: workerIndex,
          role: agentType,
          worker_cli: workerCliPlan[i] ?? "claude",
          pane_id: paneId,
          working_dir: cwd,
        };

        addedWorkers.push(workerInfo);
        config.workers.push(workerInfo);
        config.worker_count = config.workers.length;
        config.next_worker_index = nextIndex;
      }

      return {
        ok: true,
        addedWorkers,
        newWorkerCount: config.worker_count,
        nextWorkerIndex: nextIndex,
      };
    },
  );
}

export async function scaleDown(
  sessionName: string,
  cwd: string,
  config: TeamConfig,
  options: ScaleDownOptions = {},
  env: NodeJS.ProcessEnv = process.env,
): Promise<ScaleDownResult | ScaleError> {
  assertScalingEnabled(env);
  const force = options.force === true;
  const drainTimeoutMs = options.drainTimeoutMs ?? 30_000;

  return await withScalingLock(
    cwd,
    async (): Promise<ScaleDownResult | ScaleError> => {
      let targetWorkers: WorkerInfo[];
      if (options.workerNames && options.workerNames.length > 0) {
        targetWorkers = [];
        for (const name of options.workerNames) {
          const w = config.workers.find((worker) => worker.name === name);
          if (!w) {
            return {
              ok: false,
              error: `Worker ${name} not found in team`,
            };
          }
          targetWorkers.push(w);
        }
      } else {
        const count = options.count ?? 1;
        if (!Number.isInteger(count) || count < 1) {
          return {
            ok: false,
            error: `count must be a positive integer (got ${count})`,
          };
        }
        const idleWorkers: WorkerInfo[] = [];
        for (const w of config.workers) {
          if (!isWorkerAlive(sessionName, w.index, w.pane_id)) {
            idleWorkers.push(w);
          }
        }
        if (idleWorkers.length < count && !force) {
          return {
            ok: false,
            error: `Not enough idle workers to remove: found ${idleWorkers.length}, requested ${count}. Use force=true to remove busy workers.`,
          };
        }
        targetWorkers = idleWorkers.slice(0, count);
        if (force && targetWorkers.length < count) {
          const remaining = count - targetWorkers.length;
          const targetNames = new Set(targetWorkers.map((w) => w.name));
          const nonIdle = config.workers.filter(
            (w) => !targetNames.has(w.name),
          );
          targetWorkers.push(...nonIdle.slice(0, remaining));
        }
      }

      if (targetWorkers.length === 0) {
        return { ok: false, error: "No workers selected for removal" };
      }

      if (config.workers.length - targetWorkers.length < 1) {
        return {
          ok: false,
          error: "Cannot remove all workers — at least 1 must remain",
        };
      }

      const workersDir = teamWorkersDir(cwd);
      for (const w of targetWorkers) {
        await writeWorkerStatus(workersDir, w.name, "draining", {
          reason: "scale_down requested by leader",
        });
      }

      if (!force) {
        const deadline = Date.now() + drainTimeoutMs;
        while (Date.now() < deadline) {
          const allDrained = targetWorkers.every(
            (w) => !isWorkerAlive(sessionName, w.index, w.pane_id),
          );
          if (allDrained) break;
          await new Promise((r) => setTimeout(r, 2_000));
        }
      }

      const targetPaneIds = targetWorkers
        .map((w) => w.pane_id)
        .filter(
          (paneId): paneId is string =>
            typeof paneId === "string" && paneId.trim().length > 0,
        );
      await teardownWorkerPanes(targetPaneIds, {
        leaderPaneId: config.leader_pane_id,
        hudPaneId: config.hud_pane_id,
      });

      const removedNames: string[] = targetWorkers.map((w) => w.name);
      const removedSet = new Set(removedNames);
      config.workers = config.workers.filter((w) => !removedSet.has(w.name));
      config.worker_count = config.workers.length;

      return {
        ok: true,
        removedWorkers: removedNames,
        newWorkerCount: config.worker_count,
      };
    },
  );
}

function resolveWorkerReadyTimeoutMs(env: NodeJS.ProcessEnv): number {
  const raw = env.ULTRA_TEAM_READY_TIMEOUT_MS;
  const parsed = Number.parseInt(String(raw ?? ""), 10);
  if (Number.isFinite(parsed) && parsed >= 5_000) return parsed;
  return 45_000;
}
