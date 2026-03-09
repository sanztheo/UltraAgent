import { describe, expect, it } from "vitest";
import {
  paneLooksReady,
  paneIsBootstrapping,
  paneHasActiveTask,
  normalizeTmuxCapture,
  sanitizeTeamName,
  resolveWorkerCli,
  resolveWorkerCliPlan,
} from "../../../src/team/tmux-session.js";

describe("tmux-session", () => {
  describe("sanitizeTeamName", () => {
    it("lowercases and strips special chars", () => {
      expect(sanitizeTeamName("My Team!")).toBe("my-team");
    });

    it("collapses multiple hyphens", () => {
      expect(sanitizeTeamName("a---b")).toBe("a-b");
    });

    it("truncates to 30 chars", () => {
      const long = "a".repeat(50);
      expect(sanitizeTeamName(long).length).toBeLessThanOrEqual(30);
    });

    it("strips leading/trailing hyphens", () => {
      expect(sanitizeTeamName("-hello-")).toBe("hello");
    });

    it("throws on empty result", () => {
      expect(() => sanitizeTeamName("!!!")).toThrow("empty after sanitization");
    });
  });

  describe("paneLooksReady", () => {
    it("returns false for empty content", () => {
      expect(paneLooksReady("")).toBe(false);
    });

    it("detects › prompt", () => {
      expect(paneLooksReady("some output\n› ")).toBe(true);
    });

    it("detects ❯ prompt", () => {
      expect(paneLooksReady("some output\n❯ ")).toBe(true);
    });

    it("detects > prompt", () => {
      expect(paneLooksReady("some output\n> ")).toBe(true);
    });

    it("returns false when bootstrapping", () => {
      expect(paneLooksReady("loading model...\n› ")).toBe(false);
    });

    it("returns false without prompt character", () => {
      expect(paneLooksReady("All done.")).toBe(false);
    });
  });

  describe("paneIsBootstrapping", () => {
    it("detects loading", () => {
      expect(paneIsBootstrapping(["loading model..."])).toBe(true);
    });

    it("detects initializing", () => {
      expect(paneIsBootstrapping(["initializing workspace"])).toBe(true);
    });

    it("detects connecting", () => {
      expect(paneIsBootstrapping(["connecting to server"])).toBe(true);
    });

    it("returns false for normal content", () => {
      expect(paneIsBootstrapping(["ready to go", "› "])).toBe(false);
    });
  });

  describe("paneHasActiveTask", () => {
    it("detects esc to interrupt", () => {
      expect(paneHasActiveTask("Working... (esc to interrupt)")).toBe(true);
    });

    it("detects background terminal running", () => {
      expect(paneHasActiveTask("1 background terminal running")).toBe(true);
    });

    it("detects Claude activity indicator", () => {
      expect(paneHasActiveTask("· Thinking…")).toBe(true);
    });

    it("returns false for idle pane", () => {
      expect(paneHasActiveTask("› ")).toBe(false);
    });
  });

  describe("normalizeTmuxCapture", () => {
    it("collapses whitespace", () => {
      expect(normalizeTmuxCapture("  hello   world  ")).toBe("hello world");
    });

    it("strips carriage returns", () => {
      expect(normalizeTmuxCapture("line1\r\nline2")).toBe("line1 line2");
    });

    it("handles empty string", () => {
      expect(normalizeTmuxCapture("")).toBe("");
    });
  });

  describe("resolveWorkerCli", () => {
    it("defaults to claude", () => {
      expect(resolveWorkerCli([], {})).toBe("claude");
    });

    it("respects ULTRA_TEAM_WORKER_CLI env", () => {
      expect(resolveWorkerCli([], { ULTRA_TEAM_WORKER_CLI: "codex" })).toBe(
        "codex",
      );
    });

    it("detects claude model in launch args", () => {
      expect(resolveWorkerCli(["--model", "claude-sonnet-4"], {})).toBe(
        "claude",
      );
    });

    it("detects gemini model in launch args", () => {
      expect(resolveWorkerCli(["--model", "gemini-2.5-pro"], {})).toBe(
        "gemini",
      );
    });

    it("env override takes precedence over args", () => {
      expect(
        resolveWorkerCli(["--model", "gemini-pro"], {
          ULTRA_TEAM_WORKER_CLI: "claude",
        }),
      ).toBe("claude");
    });
  });

  describe("resolveWorkerCliPlan", () => {
    it("returns uniform plan when no map", () => {
      const plan = resolveWorkerCliPlan(3, [], {
        ULTRA_TEAM_WORKER_CLI: "codex",
      });
      expect(plan).toEqual(["codex", "codex", "codex"]);
    });

    it("expands single-entry map to all workers", () => {
      const plan = resolveWorkerCliPlan(3, [], {
        ULTRA_TEAM_WORKER_CLI_MAP: "gemini",
      });
      expect(plan).toEqual(["gemini", "gemini", "gemini"]);
    });

    it("uses per-worker map when length matches", () => {
      const plan = resolveWorkerCliPlan(3, [], {
        ULTRA_TEAM_WORKER_CLI_MAP: "claude,codex,gemini",
      });
      expect(plan).toEqual(["claude", "codex", "gemini"]);
    });

    it("throws on mismatched map length", () => {
      expect(() =>
        resolveWorkerCliPlan(3, [], {
          ULTRA_TEAM_WORKER_CLI_MAP: "claude,codex",
        }),
      ).toThrow("expected 1 or 3");
    });

    it("throws on zero workerCount", () => {
      expect(() => resolveWorkerCliPlan(0)).toThrow("workerCount must be >= 1");
    });
  });
});
