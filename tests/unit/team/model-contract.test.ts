import { describe, expect, it } from "vitest";
import {
  isLowComplexityRole,
  parseWorkerArgs,
  parseWorkerFlags,
  resolveWorkerLaunchConfig,
} from "../../../src/team/model-contract.js";

describe("model-contract", () => {
  describe("parseWorkerArgs", () => {
    it("returns empty array for undefined", () => {
      expect(parseWorkerArgs(undefined)).toEqual([]);
    });

    it("returns empty array for empty string", () => {
      expect(parseWorkerArgs("")).toEqual([]);
      expect(parseWorkerArgs("   ")).toEqual([]);
    });

    it("splits whitespace-delimited args", () => {
      expect(parseWorkerArgs("--model gpt-4 --verbose")).toEqual([
        "--model",
        "gpt-4",
        "--verbose",
      ]);
    });
  });

  describe("parseWorkerFlags", () => {
    it("extracts --model flag", () => {
      const result = parseWorkerFlags(["--model", "claude-sonnet-4-20250514"]);
      expect(result.model).toBe("claude-sonnet-4-20250514");
      expect(result.passthrough).toEqual([]);
    });

    it("extracts --model=value flag", () => {
      const result = parseWorkerFlags(["--model=gpt-4"]);
      expect(result.model).toBe("gpt-4");
    });

    it("ignores --model without value", () => {
      const result = parseWorkerFlags(["--model"]);
      expect(result.model).toBeUndefined();
    });

    it("ignores --model with flag-like value", () => {
      const result = parseWorkerFlags(["--model", "--verbose"]);
      expect(result.model).toBeUndefined();
      expect(result.passthrough).toContain("--verbose");
    });

    it("detects codex bypass flag", () => {
      const result = parseWorkerFlags([
        "--dangerously-bypass-approvals-and-sandbox",
      ]);
      expect(result.bypassSecurity).toBe(true);
    });

    it("detects claude bypass flag", () => {
      const result = parseWorkerFlags(["--dangerously-skip-permissions"]);
      expect(result.bypassSecurity).toBe(true);
    });

    it("detects --madmax alias", () => {
      const result = parseWorkerFlags(["--madmax"]);
      expect(result.bypassSecurity).toBe(true);
    });

    it("passes through unknown flags", () => {
      const result = parseWorkerFlags(["--verbose", "--timeout", "30"]);
      expect(result.passthrough).toEqual(["--verbose", "--timeout", "30"]);
      expect(result.bypassSecurity).toBe(false);
      expect(result.model).toBeUndefined();
    });

    it("extracts --reasoning-effort", () => {
      const result = parseWorkerFlags(["--reasoning-effort", "high"]);
      expect(result.reasoningEffort).toBe("high");
    });

    it("extracts -c model_reasoning_effort=low", () => {
      const result = parseWorkerFlags(["-c", "model_reasoning_effort=low"]);
      expect(result.reasoningEffort).toBe("low");
    });

    it("handles all flags together", () => {
      const result = parseWorkerFlags([
        "--model",
        "gpt-4",
        "--madmax",
        "--reasoning-effort",
        "medium",
        "--verbose",
      ]);
      expect(result.model).toBe("gpt-4");
      expect(result.bypassSecurity).toBe(true);
      expect(result.reasoningEffort).toBe("medium");
      expect(result.passthrough).toEqual(["--verbose"]);
    });
  });

  describe("resolveWorkerLaunchConfig", () => {
    it("creates a config from raw args", () => {
      const config = resolveWorkerLaunchConfig(
        "claude",
        "--model claude-sonnet-4-20250514 --madmax",
      );
      expect(config.cli).toBe("claude");
      expect(config.model).toBe("claude-sonnet-4-20250514");
      expect(config.bypassSecurity).toBe(true);
    });

    it("falls back to default model", () => {
      const config = resolveWorkerLaunchConfig("codex", "", {
        model: "fallback-model",
      });
      expect(config.model).toBe("fallback-model");
    });

    it("prefers explicit model over default", () => {
      const config = resolveWorkerLaunchConfig("gemini", "--model explicit", {
        model: "fallback",
      });
      expect(config.model).toBe("explicit");
    });
  });

  describe("isLowComplexityRole", () => {
    it("returns true for known low-complexity roles", () => {
      expect(isLowComplexityRole("explore")).toBe(true);
      expect(isLowComplexityRole("explorer")).toBe(true);
      expect(isLowComplexityRole("style-reviewer")).toBe(true);
      expect(isLowComplexityRole("writer")).toBe(true);
    });

    it("returns true for roles ending in -low", () => {
      expect(isLowComplexityRole("custom-low")).toBe(true);
    });

    it("returns false for standard roles", () => {
      expect(isLowComplexityRole("executor")).toBe(false);
      expect(isLowComplexityRole("planner")).toBe(false);
    });

    it("returns false for undefined/empty", () => {
      expect(isLowComplexityRole(undefined)).toBe(false);
      expect(isLowComplexityRole("")).toBe(false);
    });

    it("is case-insensitive", () => {
      expect(isLowComplexityRole("EXPLORE")).toBe(true);
      expect(isLowComplexityRole("Writer")).toBe(true);
    });
  });
});
