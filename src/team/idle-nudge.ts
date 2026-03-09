/**
 * Idle nudge tracker — detects workers stuck in "idle" state too long
 * and generates nudge dispatch requests.
 *
 * Transport-agnostic: the tracker only decides WHEN to nudge,
 * the caller decides HOW (tmux, hook, etc.).
 *
 * Key design choices:
 * - Per-worker cooldown prevents nudge storms
 * - Exponential backoff on repeated nudges to the same worker
 * - Max nudge cap to avoid infinite retry loops
 */

import type { WorkerHeartbeat, WorkerStatus } from "./state/types.js";

export interface NudgeConfig {
  /** How long a worker can be idle before first nudge (ms). Default: 60s */
  idleThresholdMs: number;
  /** Minimum time between nudges to the same worker (ms). Default: 30s */
  cooldownMs: number;
  /** Backoff multiplier for repeated nudges. Default: 1.5 */
  backoffFactor: number;
  /** Maximum nudge count before giving up on a worker. Default: 5 */
  maxNudges: number;
}

const DEFAULT_CONFIG: NudgeConfig = {
  idleThresholdMs: 60_000,
  cooldownMs: 30_000,
  backoffFactor: 1.5,
  maxNudges: 5,
};

export interface NudgeRecord {
  workerName: string;
  nudgeCount: number;
  lastNudgeAt: string;
  currentCooldownMs: number;
  exhausted: boolean;
}

export interface NudgeDecision {
  shouldNudge: boolean;
  workerName: string;
  reason: string;
  nudgeCount: number;
}

export class NudgeTracker {
  private readonly config: NudgeConfig;
  private readonly records = new Map<string, NudgeRecord>();

  constructor(config: Partial<NudgeConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Evaluate whether a worker needs a nudge based on its current status
   * and heartbeat. Returns a decision with reason.
   */
  evaluate(
    workerName: string,
    status: WorkerStatus | null,
    heartbeat: WorkerHeartbeat | null,
    now: number = Date.now(),
  ): NudgeDecision {
    const base: Pick<NudgeDecision, "workerName"> = { workerName };

    // No status means worker hasn't started — don't nudge
    if (!status) {
      return {
        ...base,
        shouldNudge: false,
        reason: "no_status",
        nudgeCount: 0,
      };
    }

    // Only nudge idle workers
    if (status.state !== "idle") {
      // Worker is active — reset their nudge record
      this.records.delete(workerName);
      return {
        ...base,
        shouldNudge: false,
        reason: `state_is_${status.state}`,
        nudgeCount: 0,
      };
    }

    // Check if idle long enough
    const idleSince = new Date(status.updated_at).getTime();
    const idleDuration = now - idleSince;
    if (idleDuration < this.config.idleThresholdMs) {
      return {
        ...base,
        shouldNudge: false,
        reason: "idle_below_threshold",
        nudgeCount: this.records.get(workerName)?.nudgeCount ?? 0,
      };
    }

    // Check heartbeat — if worker has no heartbeat, it may be dead
    if (heartbeat && !heartbeat.alive) {
      return {
        ...base,
        shouldNudge: false,
        reason: "worker_dead",
        nudgeCount: this.records.get(workerName)?.nudgeCount ?? 0,
      };
    }

    const record = this.records.get(workerName);

    // Check max nudge cap
    if (record?.exhausted) {
      return {
        ...base,
        shouldNudge: false,
        reason: "nudge_limit_reached",
        nudgeCount: record.nudgeCount,
      };
    }

    // Check cooldown
    if (record) {
      const elapsed = now - new Date(record.lastNudgeAt).getTime();
      if (elapsed < record.currentCooldownMs) {
        return {
          ...base,
          shouldNudge: false,
          reason: "cooldown_active",
          nudgeCount: record.nudgeCount,
        };
      }
    }

    // Nudge is warranted
    const newCount = (record?.nudgeCount ?? 0) + 1;
    return {
      ...base,
      shouldNudge: true,
      reason: newCount === 1 ? "first_nudge" : `nudge_${newCount}`,
      nudgeCount: newCount,
    };
  }

  /**
   * Record that a nudge was sent. Call this AFTER successfully dispatching
   * the nudge, not before.
   */
  recordNudge(workerName: string, now: number = Date.now()): NudgeRecord {
    const existing = this.records.get(workerName);
    const nudgeCount = (existing?.nudgeCount ?? 0) + 1;
    const currentCooldownMs = existing
      ? Math.min(
          existing.currentCooldownMs * this.config.backoffFactor,
          this.config.idleThresholdMs,
        )
      : this.config.cooldownMs;

    const record: NudgeRecord = {
      workerName,
      nudgeCount,
      lastNudgeAt: new Date(now).toISOString(),
      currentCooldownMs,
      exhausted: nudgeCount >= this.config.maxNudges,
    };

    this.records.set(workerName, record);
    return record;
  }

  /** Reset nudge tracking for a worker (e.g., when they become active). */
  reset(workerName: string): void {
    this.records.delete(workerName);
  }

  /** Reset all nudge tracking. */
  resetAll(): void {
    this.records.clear();
  }

  /** Get current nudge record for a worker (for diagnostics). */
  getRecord(workerName: string): NudgeRecord | undefined {
    return this.records.get(workerName);
  }

  /** Get all nudge records (for diagnostics). */
  getAllRecords(): NudgeRecord[] {
    return [...this.records.values()];
  }
}
