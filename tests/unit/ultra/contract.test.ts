import { describe, expect, it } from "vitest";
import {
  isTerminalUltraPhase,
  normalizeUltraPhase,
  ULTRA_PHASES,
  validateAndNormalizeUltraState,
} from "../../../src/ultra/contract.js";

describe("ultra/contract", () => {
  describe("normalizeUltraPhase", () => {
    it("accepts valid phases", () => {
      for (const phase of ULTRA_PHASES) {
        const result = normalizeUltraPhase(phase);
        expect(result.phase).toBe(phase);
        expect(result.error).toBeUndefined();
      }
    });

    it("normalizes legacy aliases", () => {
      expect(normalizeUltraPhase("start")).toEqual({
        phase: "starting",
        warning: expect.stringContaining("normalized"),
      });
      expect(normalizeUltraPhase("verify")).toEqual({
        phase: "verifying",
        warning: expect.stringContaining("normalized"),
      });
      expect(normalizeUltraPhase("completed")).toEqual({
        phase: "complete",
        warning: expect.stringContaining("normalized"),
      });
    });

    it("rejects invalid phases", () => {
      const result = normalizeUltraPhase("invalid");
      expect(result.error).toBeTruthy();
      expect(result.phase).toBeUndefined();
    });

    it("rejects non-string input", () => {
      expect(normalizeUltraPhase(42).error).toBeTruthy();
      expect(normalizeUltraPhase(null).error).toBeTruthy();
      expect(normalizeUltraPhase("").error).toBeTruthy();
    });
  });

  describe("isTerminalUltraPhase", () => {
    it("complete is terminal", () => {
      expect(isTerminalUltraPhase("complete")).toBe(true);
    });

    it("failed is terminal", () => {
      expect(isTerminalUltraPhase("failed")).toBe(true);
    });

    it("cancelled is terminal", () => {
      expect(isTerminalUltraPhase("cancelled")).toBe(true);
    });

    it("executing is not terminal", () => {
      expect(isTerminalUltraPhase("executing")).toBe(false);
    });
  });

  describe("validateAndNormalizeUltraState", () => {
    it("validates minimal active state", () => {
      const result = validateAndNormalizeUltraState({ active: true });
      expect(result.ok).toBe(true);
      expect(result.state?.current_phase).toBe("starting");
      expect(result.state?.iteration).toBe(0);
      expect(result.state?.max_iterations).toBe(50);
    });

    it("normalizes legacy phase in state", () => {
      const result = validateAndNormalizeUltraState({
        current_phase: "execution",
      });
      expect(result.ok).toBe(true);
      expect(result.state?.current_phase).toBe("executing");
      expect(result.warning).toContain("normalized");
    });

    it("rejects invalid iteration", () => {
      const result = validateAndNormalizeUltraState({ iteration: -1 });
      expect(result.ok).toBe(false);
      expect(result.error).toContain("iteration");
    });

    it("rejects zero max_iterations", () => {
      const result = validateAndNormalizeUltraState({ max_iterations: 0 });
      expect(result.ok).toBe(false);
      expect(result.error).toContain("max_iterations");
    });

    it("rejects active=true with terminal phase", () => {
      const result = validateAndNormalizeUltraState({
        active: true,
        current_phase: "complete",
      });
      expect(result.ok).toBe(false);
      expect(result.error).toContain("terminal");
    });

    it("sets completed_at for terminal phases", () => {
      const result = validateAndNormalizeUltraState({
        active: false,
        current_phase: "failed",
      });
      expect(result.ok).toBe(true);
      expect(result.state?.completed_at).toBeTruthy();
    });

    it("rejects invalid timestamps", () => {
      const result = validateAndNormalizeUltraState({
        started_at: "not-a-date",
      });
      expect(result.ok).toBe(false);
      expect(result.error).toContain("ISO8601");
    });

    it("accepts valid complete state", () => {
      const result = validateAndNormalizeUltraState({
        active: false,
        current_phase: "complete",
        iteration: 3,
        max_iterations: 50,
        started_at: "2024-01-01T00:00:00.000Z",
      });
      expect(result.ok).toBe(true);
    });
  });
});
