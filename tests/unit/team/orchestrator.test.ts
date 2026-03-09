import { describe, expect, it } from "vitest";
import {
  createOrchestratorState,
  getPhaseAgents,
  getPhaseInstructions,
  isTerminalPhase,
  isValidTransition,
  canResumeState,
  transitionPhase,
  type TeamPhase,
} from "../../../src/team/orchestrator.js";

describe("orchestrator", () => {
  describe("isValidTransition", () => {
    it("allows plan → prd", () => {
      expect(isValidTransition("team-plan", "team-prd")).toBe(true);
    });

    it("allows verify → fix", () => {
      expect(isValidTransition("team-verify", "team-fix")).toBe(true);
    });

    it("allows verify → complete", () => {
      expect(isValidTransition("team-verify", "complete")).toBe(true);
    });

    it("allows fix → exec (re-execute after fix)", () => {
      expect(isValidTransition("team-fix", "team-exec")).toBe(true);
    });

    it("rejects plan → exec (must go through prd)", () => {
      expect(isValidTransition("team-plan", "team-exec")).toBe(false);
    });

    it("rejects exec → plan (no backwards)", () => {
      expect(isValidTransition("team-exec", "team-plan")).toBe(false);
    });
  });

  describe("isTerminalPhase", () => {
    it("complete is terminal", () => {
      expect(isTerminalPhase("complete")).toBe(true);
    });

    it("failed is terminal", () => {
      expect(isTerminalPhase("failed")).toBe(true);
    });

    it("cancelled is terminal", () => {
      expect(isTerminalPhase("cancelled")).toBe(true);
    });

    it("team-exec is not terminal", () => {
      expect(isTerminalPhase("team-exec")).toBe(false);
    });
  });

  describe("createOrchestratorState", () => {
    it("starts at team-plan", () => {
      const state = createOrchestratorState("build a cache");
      expect(state.phase).toBe("team-plan");
      expect(state.active).toBe(true);
      expect(state.current_fix_attempt).toBe(0);
      expect(state.max_fix_attempts).toBe(3);
    });

    it("accepts custom max fix attempts", () => {
      const state = createOrchestratorState("task", 5);
      expect(state.max_fix_attempts).toBe(5);
    });
  });

  describe("canResumeState", () => {
    it("can resume active non-terminal state", () => {
      const state = createOrchestratorState("task");
      expect(canResumeState(state)).toBe(true);
    });

    it("cannot resume terminal state", () => {
      let state = createOrchestratorState("task");
      state = transitionPhase(state, "team-prd");
      state = transitionPhase(state, "team-exec");
      state = transitionPhase(state, "team-verify");
      state = transitionPhase(state, "complete");
      expect(canResumeState(state)).toBe(false);
    });
  });

  describe("transitionPhase", () => {
    it("transitions plan → prd", () => {
      const state = createOrchestratorState("task");
      const next = transitionPhase(state, "team-prd");
      expect(next.phase).toBe("team-prd");
      expect(next.active).toBe(true);
      expect(next.phase_transitions).toHaveLength(1);
    });

    it("records transition history", () => {
      let state = createOrchestratorState("task");
      state = transitionPhase(state, "team-prd");
      state = transitionPhase(state, "team-exec");
      expect(state.phase_transitions).toHaveLength(2);
      expect(state.phase_transitions[0]!.from).toBe("team-plan");
      expect(state.phase_transitions[0]!.to).toBe("team-prd");
    });

    it("throws on invalid transition", () => {
      const state = createOrchestratorState("task");
      expect(() => transitionPhase(state, "team-exec")).toThrow(
        "Invalid transition",
      );
    });

    it("throws on transition from terminal phase", () => {
      let state = createOrchestratorState("task");
      state = transitionPhase(state, "team-prd");
      state = transitionPhase(state, "team-exec");
      state = transitionPhase(state, "team-verify");
      state = transitionPhase(state, "complete");
      expect(() => transitionPhase(state, "team-exec")).toThrow(
        "terminal phase",
      );
    });

    it("increments fix attempt on team-fix", () => {
      let state = createOrchestratorState("task");
      state = transitionPhase(state, "team-prd");
      state = transitionPhase(state, "team-exec");
      state = transitionPhase(state, "team-verify");
      state = transitionPhase(state, "team-fix");
      expect(state.current_fix_attempt).toBe(1);
    });

    it("forces fail when fix loop exceeds max", () => {
      let state = createOrchestratorState("task", 1);
      state = transitionPhase(state, "team-prd");
      state = transitionPhase(state, "team-exec");
      state = transitionPhase(state, "team-verify");
      state = transitionPhase(state, "team-fix"); // attempt 1, ok
      state = transitionPhase(state, "team-verify");
      // attempt 2 would exceed max of 1
      state = transitionPhase(state, "team-fix");
      expect(state.phase).toBe("failed");
      expect(state.active).toBe(false);
    });

    it("sets active=false on terminal transition", () => {
      let state = createOrchestratorState("task");
      state = transitionPhase(state, "team-prd");
      state = transitionPhase(state, "team-exec");
      state = transitionPhase(state, "team-verify");
      state = transitionPhase(state, "failed");
      expect(state.active).toBe(false);
    });

    it("preserves reason in transition", () => {
      const state = createOrchestratorState("task");
      const next = transitionPhase(state, "team-prd", "planning done");
      expect(next.phase_transitions[0]!.reason).toBe("planning done");
    });
  });

  describe("getPhaseAgents", () => {
    it("returns agents for each phase", () => {
      const phases: TeamPhase[] = [
        "team-plan",
        "team-prd",
        "team-exec",
        "team-verify",
        "team-fix",
      ];
      for (const phase of phases) {
        const agents = getPhaseAgents(phase);
        expect(agents.length).toBeGreaterThan(0);
      }
    });

    it("exec includes executor and test-engineer", () => {
      const agents = getPhaseAgents("team-exec");
      expect(agents).toContain("executor");
      expect(agents).toContain("test-engineer");
    });
  });

  describe("getPhaseInstructions", () => {
    it("returns non-empty instructions for each phase", () => {
      const phases: TeamPhase[] = [
        "team-plan",
        "team-prd",
        "team-exec",
        "team-verify",
        "team-fix",
      ];
      for (const phase of phases) {
        const instructions = getPhaseInstructions(phase);
        expect(instructions.length).toBeGreaterThan(20);
        expect(instructions).toContain("PHASE:");
      }
    });
  });
});
