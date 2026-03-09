import { describe, expect, it } from "vitest";
import {
  NudgeTracker,
  type NudgeConfig,
} from "../../../src/team/idle-nudge.js";
import type {
  WorkerHeartbeat,
  WorkerStatus,
} from "../../../src/team/state/types.js";

describe("NudgeTracker", () => {
  const config: NudgeConfig = {
    idleThresholdMs: 1000,
    cooldownMs: 500,
    backoffFactor: 2,
    maxNudges: 3,
  };

  function makeStatus(
    state: string,
    updatedAtMs: number = Date.now(),
  ): WorkerStatus {
    return {
      state: state as WorkerStatus["state"],
      updated_at: new Date(updatedAtMs).toISOString(),
    };
  }

  function makeHeartbeat(alive: boolean = true): WorkerHeartbeat {
    return {
      pid: 123,
      last_turn_at: new Date().toISOString(),
      turn_count: 1,
      alive,
    };
  }


  describe("evaluate", () => {
    it("returns no_status when worker has no status", () => {
      const tracker = new NudgeTracker(config);
      const decision = tracker.evaluate("w1", null, null);
      expect(decision.shouldNudge).toBe(false);
      expect(decision.reason).toBe("no_status");
    });

    it("skips non-idle workers", () => {
      const tracker = new NudgeTracker(config);
      const decision = tracker.evaluate(
        "w1",
        makeStatus("working"),
        makeHeartbeat(),
      );
      expect(decision.shouldNudge).toBe(false);
      expect(decision.reason).toBe("state_is_working");
    });

    it("skips idle workers below threshold", () => {
      const tracker = new NudgeTracker(config);
      const now = Date.now();
      const decision = tracker.evaluate(
        "w1",
        makeStatus("idle", now - 500), // 500ms idle, threshold is 1000ms
        makeHeartbeat(),
        now,
      );
      expect(decision.shouldNudge).toBe(false);
      expect(decision.reason).toBe("idle_below_threshold");
    });

    it("nudges idle worker above threshold", () => {
      const tracker = new NudgeTracker(config);
      const now = Date.now();
      const decision = tracker.evaluate(
        "w1",
        makeStatus("idle", now - 2000), // 2s idle, threshold is 1s
        makeHeartbeat(),
        now,
      );
      expect(decision.shouldNudge).toBe(true);
      expect(decision.reason).toBe("first_nudge");
      expect(decision.nudgeCount).toBe(1);
    });

    it("skips dead workers", () => {
      const tracker = new NudgeTracker(config);
      const now = Date.now();
      const decision = tracker.evaluate(
        "w1",
        makeStatus("idle", now - 2000),
        makeHeartbeat(false),
        now,
      );
      expect(decision.shouldNudge).toBe(false);
      expect(decision.reason).toBe("worker_dead");
    });

    it("nudges even without heartbeat (heartbeat null)", () => {
      const tracker = new NudgeTracker(config);
      const now = Date.now();
      const decision = tracker.evaluate(
        "w1",
        makeStatus("idle", now - 2000),
        null,
        now,
      );
      expect(decision.shouldNudge).toBe(true);
    });
  });


  describe("cooldown", () => {
    it("respects cooldown after nudge", () => {
      const tracker = new NudgeTracker(config);
      const now = Date.now();
      const idleStatus = makeStatus("idle", now - 2000);

      // First nudge
      const d1 = tracker.evaluate("w1", idleStatus, makeHeartbeat(), now);
      expect(d1.shouldNudge).toBe(true);
      tracker.recordNudge("w1", now);

      // Immediately after — cooldown active
      const d2 = tracker.evaluate("w1", idleStatus, makeHeartbeat(), now + 100);
      expect(d2.shouldNudge).toBe(false);
      expect(d2.reason).toBe("cooldown_active");
    });

    it("allows nudge after cooldown expires", () => {
      const tracker = new NudgeTracker(config);
      const now = Date.now();
      const idleStatus = makeStatus("idle", now - 2000);

      tracker.recordNudge("w1", now);

      // After cooldown (500ms) + some buffer
      const d = tracker.evaluate("w1", idleStatus, makeHeartbeat(), now + 600);
      expect(d.shouldNudge).toBe(true);
      expect(d.nudgeCount).toBe(2);
    });
  });


  describe("backoff", () => {
    it("applies exponential backoff on repeated nudges", () => {
      const tracker = new NudgeTracker(config);
      const now = Date.now();

      // First nudge: cooldown = 500ms
      const r1 = tracker.recordNudge("w1", now);
      expect(r1.currentCooldownMs).toBe(500);

      // Second nudge: cooldown = 500 * 2 = 1000ms
      const r2 = tracker.recordNudge("w1", now + 600);
      expect(r2.currentCooldownMs).toBe(1000);

      // Third nudge: capped at idleThresholdMs (1000ms)
      const r3 = tracker.recordNudge("w1", now + 1700);
      expect(r3.currentCooldownMs).toBe(1000);
      expect(r3.exhausted).toBe(true);
    });
  });


  describe("max nudge cap", () => {
    it("stops nudging after max attempts", () => {
      const tracker = new NudgeTracker(config);
      const now = Date.now();
      const idleStatus = makeStatus("idle", now - 2000);

      // Exhaust all nudges
      for (let i = 0; i < config.maxNudges; i++) {
        tracker.recordNudge("w1", now + i * 10000);
      }

      const decision = tracker.evaluate(
        "w1",
        idleStatus,
        makeHeartbeat(),
        now + 100000,
      );
      expect(decision.shouldNudge).toBe(false);
      expect(decision.reason).toBe("nudge_limit_reached");
    });
  });


  describe("reset", () => {
    it("clears nudge record for a worker", () => {
      const tracker = new NudgeTracker(config);
      tracker.recordNudge("w1");
      tracker.reset("w1");
      expect(tracker.getRecord("w1")).toBeUndefined();
    });

    it("resets nudge count when worker becomes active", () => {
      const tracker = new NudgeTracker(config);
      const now = Date.now();

      // Record a nudge
      tracker.recordNudge("w1", now);

      // Worker becomes active — evaluate with non-idle status resets
      tracker.evaluate("w1", makeStatus("working"), makeHeartbeat(), now + 100);

      // Back to idle — should be treated as fresh
      const d = tracker.evaluate(
        "w1",
        makeStatus("idle", now),
        makeHeartbeat(),
        now + 2000,
      );
      expect(d.shouldNudge).toBe(true);
      expect(d.reason).toBe("first_nudge");
    });

    it("resetAll clears all records", () => {
      const tracker = new NudgeTracker(config);
      tracker.recordNudge("w1");
      tracker.recordNudge("w2");
      tracker.resetAll();
      expect(tracker.getAllRecords()).toEqual([]);
    });
  });


  describe("diagnostics", () => {
    it("getRecord returns undefined for unknown worker", () => {
      const tracker = new NudgeTracker(config);
      expect(tracker.getRecord("unknown")).toBeUndefined();
    });

    it("getAllRecords returns all tracked workers", () => {
      const tracker = new NudgeTracker(config);
      tracker.recordNudge("w1");
      tracker.recordNudge("w2");
      const records = tracker.getAllRecords();
      expect(records).toHaveLength(2);
      expect(records.map((r) => r.workerName).sort()).toEqual(["w1", "w2"]);
    });
  });
});
