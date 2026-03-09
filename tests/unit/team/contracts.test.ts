import { describe, expect, it } from "vitest";
import {
  APPROVAL_STATUSES,
  EVENT_TYPES,
  TASK_ID_PATTERN,
  TASK_STATUSES,
  TASK_TRANSITIONS,
  TERMINAL_STATUSES,
  WORKER_NAME_PATTERN,
  canTransition,
  isTerminalStatus,
} from "../../../src/team/contracts.js";

describe("contracts", () => {
  describe("TASK_STATUSES", () => {
    it("contains all expected statuses", () => {
      expect(TASK_STATUSES).toEqual([
        "pending",
        "blocked",
        "in_progress",
        "completed",
        "failed",
      ]);
    });
  });

  describe("isTerminalStatus", () => {
    it("returns true for completed", () => {
      expect(isTerminalStatus("completed")).toBe(true);
    });

    it("returns true for failed", () => {
      expect(isTerminalStatus("failed")).toBe(true);
    });

    it("returns false for pending", () => {
      expect(isTerminalStatus("pending")).toBe(false);
    });

    it("returns false for in_progress", () => {
      expect(isTerminalStatus("in_progress")).toBe(false);
    });

    it("returns false for blocked", () => {
      expect(isTerminalStatus("blocked")).toBe(false);
    });
  });

  describe("canTransition", () => {
    it("allows in_progress → completed", () => {
      expect(canTransition("in_progress", "completed")).toBe(true);
    });

    it("allows in_progress → failed", () => {
      expect(canTransition("in_progress", "failed")).toBe(true);
    });

    it("rejects pending → completed (must claim first)", () => {
      expect(canTransition("pending", "completed")).toBe(false);
    });

    it("rejects completed → pending (terminal)", () => {
      expect(canTransition("completed", "pending")).toBe(false);
    });

    it("rejects failed → in_progress (terminal)", () => {
      expect(canTransition("failed", "in_progress")).toBe(false);
    });

    it("rejects same-status transition", () => {
      expect(canTransition("pending", "pending")).toBe(false);
    });

    it("rejects blocked → completed", () => {
      expect(canTransition("blocked", "completed")).toBe(false);
    });
  });

  describe("TASK_TRANSITIONS", () => {
    it("only in_progress has allowed transitions", () => {
      for (const status of TASK_STATUSES) {
        const transitions = TASK_TRANSITIONS[status];
        if (status === "in_progress") {
          expect(transitions).toEqual(["completed", "failed"]);
        } else {
          expect(transitions).toEqual([]);
        }
      }
    });
  });

  describe("TERMINAL_STATUSES", () => {
    it("contains exactly completed and failed", () => {
      expect(TERMINAL_STATUSES.size).toBe(2);
      expect(TERMINAL_STATUSES.has("completed")).toBe(true);
      expect(TERMINAL_STATUSES.has("failed")).toBe(true);
    });
  });

  describe("validation patterns", () => {
    it("TASK_ID_PATTERN accepts valid task IDs", () => {
      expect(TASK_ID_PATTERN.test("1")).toBe(true);
      expect(TASK_ID_PATTERN.test("42")).toBe(true);
      expect(TASK_ID_PATTERN.test("99999")).toBe(true);
    });

    it("TASK_ID_PATTERN rejects invalid task IDs", () => {
      expect(TASK_ID_PATTERN.test("")).toBe(false);
      expect(TASK_ID_PATTERN.test("abc")).toBe(false);
      expect(TASK_ID_PATTERN.test("-1")).toBe(false);
      expect(TASK_ID_PATTERN.test("../1")).toBe(false);
    });

    it("WORKER_NAME_PATTERN accepts valid worker names", () => {
      expect(WORKER_NAME_PATTERN.test("worker-1")).toBe(true);
      expect(WORKER_NAME_PATTERN.test("a")).toBe(true);
      expect(WORKER_NAME_PATTERN.test("my-agent-42")).toBe(true);
    });

    it("WORKER_NAME_PATTERN rejects invalid worker names", () => {
      expect(WORKER_NAME_PATTERN.test("")).toBe(false);
      expect(WORKER_NAME_PATTERN.test("-invalid")).toBe(false);
      expect(WORKER_NAME_PATTERN.test("UPPER")).toBe(false);
      expect(WORKER_NAME_PATTERN.test("has space")).toBe(false);
      expect(WORKER_NAME_PATTERN.test("../hack")).toBe(false);
    });
  });

  describe("EVENT_TYPES", () => {
    it("has at least the core event types", () => {
      expect(EVENT_TYPES).toContain("task_completed");
      expect(EVENT_TYPES).toContain("task_failed");
      expect(EVENT_TYPES).toContain("worker_idle");
      expect(EVENT_TYPES).toContain("approval_decision");
    });
  });

  describe("APPROVAL_STATUSES", () => {
    it("contains pending, approved, rejected", () => {
      expect(APPROVAL_STATUSES).toEqual(["pending", "approved", "rejected"]);
    });
  });
});
