import { describe, expect, it } from "vitest";
import { parseWorktreeMode } from "../../../src/team/worktree.js";

describe("worktree", () => {
  describe("parseWorktreeMode", () => {
    it("returns disabled when no --worktree flag", () => {
      const result = parseWorktreeMode(["--model", "gpt-4"]);
      expect(result.mode.enabled).toBe(false);
      expect(result.remainingArgs).toEqual(["--model", "gpt-4"]);
    });

    it("parses --worktree without value as detached", () => {
      const result = parseWorktreeMode(["--worktree"]);
      expect(result.mode).toEqual({
        enabled: true,
        detached: true,
        name: null,
      });
      expect(result.remainingArgs).toEqual([]);
    });

    it("parses --worktree with branch name", () => {
      const result = parseWorktreeMode(["--worktree", "feature/foo"]);
      expect(result.mode).toEqual({
        enabled: true,
        detached: false,
        name: "feature/foo",
      });
      expect(result.remainingArgs).toEqual([]);
    });

    it("parses --worktree=branch-name", () => {
      const result = parseWorktreeMode(["--worktree=my-branch"]);
      expect(result.mode).toEqual({
        enabled: true,
        detached: false,
        name: "my-branch",
      });
    });

    it("parses -w shorthand", () => {
      const result = parseWorktreeMode(["-w", "dev"]);
      expect(result.mode).toEqual({
        enabled: true,
        detached: false,
        name: "dev",
      });
    });

    it("parses -w without value as detached", () => {
      const result = parseWorktreeMode(["-w"]);
      expect(result.mode).toEqual({
        enabled: true,
        detached: true,
        name: null,
      });
    });

    it("parses -w=value", () => {
      const result = parseWorktreeMode(["-w=hotfix"]);
      expect(result.mode).toEqual({
        enabled: true,
        detached: false,
        name: "hotfix",
      });
    });

    it("parses -wvalue (attached)", () => {
      const result = parseWorktreeMode(["-wstaging"]);
      expect(result.mode).toEqual({
        enabled: true,
        detached: false,
        name: "staging",
      });
    });

    it("does not consume next arg if it starts with -", () => {
      const result = parseWorktreeMode(["--worktree", "--model", "gpt-4"]);
      expect(result.mode).toEqual({
        enabled: true,
        detached: true,
        name: null,
      });
      expect(result.remainingArgs).toEqual(["--model", "gpt-4"]);
    });

    it("does not consume next arg if it contains colon", () => {
      const result = parseWorktreeMode(["--worktree", "3:debugger"]);
      expect(result.mode).toEqual({
        enabled: true,
        detached: true,
        name: null,
      });
      expect(result.remainingArgs).toEqual(["3:debugger"]);
    });

    it("preserves other args as remainingArgs", () => {
      const result = parseWorktreeMode([
        "--verbose",
        "--worktree",
        "main",
        "--dry-run",
      ]);
      expect(result.mode).toEqual({
        enabled: true,
        detached: false,
        name: "main",
      });
      expect(result.remainingArgs).toEqual(["--verbose", "--dry-run"]);
    });

    it("handles empty args", () => {
      const result = parseWorktreeMode([]);
      expect(result.mode.enabled).toBe(false);
      expect(result.remainingArgs).toEqual([]);
    });

    it("last --worktree wins", () => {
      const result = parseWorktreeMode(["--worktree", "a", "--worktree", "b"]);
      expect(result.mode).toEqual({
        enabled: true,
        detached: false,
        name: "b",
      });
    });
  });
});
