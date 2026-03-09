import { describe, expect, it } from "vitest";
import {
  inferPhaseTargetFromTaskCounts,
  reconcilePhaseStateForMonitor,
} from "../../../src/team/phase-controller.js";
import type { TeamPhaseState } from "../../../src/team/orchestrator.js";

describe("phase-controller", () => {
  describe("inferPhaseTargetFromTaskCounts", () => {
    it("returns complete when all tasks succeeded", () => {
      const target = inferPhaseTargetFromTaskCounts({
        pending: 0,
        blocked: 0,
        in_progress: 0,
        failed: 0,
      });
      expect(target).toBe("complete");
    });

    it("returns team-verify when verification pending", () => {
      const target = inferPhaseTargetFromTaskCounts(
        { pending: 0, blocked: 0, in_progress: 0, failed: 0 },
        { verificationPending: true },
      );
      expect(target).toBe("team-verify");
    });

    it("returns team-fix when all terminal but some failed", () => {
      const target = inferPhaseTargetFromTaskCounts({
        pending: 0,
        blocked: 0,
        in_progress: 0,
        failed: 2,
      });
      expect(target).toBe("team-fix");
    });

    it("returns team-exec when tasks still running", () => {
      const target = inferPhaseTargetFromTaskCounts({
        pending: 1,
        blocked: 0,
        in_progress: 2,
        failed: 0,
      });
      expect(target).toBe("team-exec");
    });

    it("returns team-exec when tasks still pending", () => {
      const target = inferPhaseTargetFromTaskCounts({
        pending: 3,
        blocked: 0,
        in_progress: 0,
        failed: 0,
      });
      expect(target).toBe("team-exec");
    });
  });

  describe("reconcilePhaseStateForMonitor", () => {
    it("returns default state when persisted is null", () => {
      const result = reconcilePhaseStateForMonitor(null, "team-exec");
      expect(result.current_phase).toBe("team-exec");
    });

    it("returns same state when already at target", () => {
      const persisted: TeamPhaseState = {
        current_phase: "team-exec",
        max_fix_attempts: 3,
        current_fix_attempt: 0,
        transitions: [],
        updated_at: "2024-01-01T00:00:00.000Z",
      };
      const result = reconcilePhaseStateForMonitor(persisted, "team-exec");
      expect(result.current_phase).toBe("team-exec");
      expect(result.updated_at).not.toBe(persisted.updated_at);
    });

    it("walks transition path from exec to complete", () => {
      const persisted: TeamPhaseState = {
        current_phase: "team-exec",
        max_fix_attempts: 3,
        current_fix_attempt: 0,
        transitions: [],
        updated_at: "2024-01-01T00:00:00.000Z",
      };
      const result = reconcilePhaseStateForMonitor(persisted, "complete");
      expect(result.current_phase).toBe("complete");
      expect(result.transitions.length).toBeGreaterThanOrEqual(2);
    });

    it("handles terminal → non-terminal (tasks reopened)", () => {
      const persisted: TeamPhaseState = {
        current_phase: "complete",
        max_fix_attempts: 3,
        current_fix_attempt: 2,
        transitions: [],
        updated_at: "2024-01-01T00:00:00.000Z",
      };
      const result = reconcilePhaseStateForMonitor(persisted, "team-exec");
      expect(result.current_phase).toBe("team-exec");
      expect(result.current_fix_attempt).toBe(0);
      expect(result.transitions).toHaveLength(1);
      expect(result.transitions[0]!.reason).toBe("tasks_reopened");
    });

    it("stays terminal when target is also terminal", () => {
      const persisted: TeamPhaseState = {
        current_phase: "failed",
        max_fix_attempts: 3,
        current_fix_attempt: 3,
        transitions: [],
        updated_at: "2024-01-01T00:00:00.000Z",
      };
      const result = reconcilePhaseStateForMonitor(persisted, "complete");
      expect(result.current_phase).toBe("failed");
    });

    it("transitions from exec → fix through verify", () => {
      const persisted: TeamPhaseState = {
        current_phase: "team-exec",
        max_fix_attempts: 3,
        current_fix_attempt: 0,
        transitions: [],
        updated_at: "2024-01-01T00:00:00.000Z",
      };
      const result = reconcilePhaseStateForMonitor(persisted, "team-fix");
      expect(result.current_phase).toBe("team-fix");
      expect(result.current_fix_attempt).toBe(1);
    });
  });
});
