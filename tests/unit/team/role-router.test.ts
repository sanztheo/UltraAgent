import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  isKnownRole,
  listAvailableRoles,
  loadRolePrompt,
  routeTaskToRole,
} from "../../../src/team/role-router.js";

describe("role-router", () => {
  let promptsDir: string;

  beforeEach(async () => {
    promptsDir = await mkdtemp(join(tmpdir(), "ultra-roles-"));
  });

  afterEach(async () => {
    await rm(promptsDir, { recursive: true, force: true });
  });

  describe("loadRolePrompt", () => {
    it("loads .md file for role", async () => {
      await writeFile(join(promptsDir, "executor.md"), "You are an executor.");
      const content = await loadRolePrompt("executor", promptsDir);
      expect(content).toBe("You are an executor.");
    });

    it("returns null for missing role", async () => {
      const content = await loadRolePrompt("ghost", promptsDir);
      expect(content).toBeNull();
    });

    it("returns null for invalid role name", async () => {
      const content = await loadRolePrompt("../escape", promptsDir);
      expect(content).toBeNull();
    });

    it("returns null for empty file", async () => {
      await writeFile(join(promptsDir, "empty.md"), "   ");
      const content = await loadRolePrompt("empty", promptsDir);
      expect(content).toBeNull();
    });
  });

  describe("isKnownRole", () => {
    it("returns true when .md exists", async () => {
      await writeFile(join(promptsDir, "debugger.md"), "debug");
      expect(isKnownRole("debugger", promptsDir)).toBe(true);
    });

    it("returns false when missing", () => {
      expect(isKnownRole("ghost", promptsDir)).toBe(false);
    });

    it("rejects invalid names", () => {
      expect(isKnownRole("INVALID", promptsDir)).toBe(false);
    });
  });

  describe("listAvailableRoles", () => {
    it("lists roles sorted alphabetically", async () => {
      await writeFile(join(promptsDir, "debugger.md"), "");
      await writeFile(join(promptsDir, "analyst.md"), "");
      await writeFile(join(promptsDir, "executor.md"), "");
      const roles = await listAvailableRoles(promptsDir);
      expect(roles).toEqual(["analyst", "debugger", "executor"]);
    });

    it("returns empty for non-existent dir", async () => {
      const roles = await listAvailableRoles("/tmp/nonexistent-roles-dir");
      expect(roles).toEqual([]);
    });

    it("ignores non-.md files", async () => {
      await writeFile(join(promptsDir, "notes.txt"), "");
      await writeFile(join(promptsDir, "executor.md"), "");
      const roles = await listAvailableRoles(promptsDir);
      expect(roles).toEqual(["executor"]);
    });
  });

  describe("routeTaskToRole", () => {
    it("high confidence: multiple keyword matches", () => {
      const result = routeTaskToRole(
        "Write unit tests",
        "Add vitest coverage for the API module",
        "team-exec",
        "executor",
      );
      expect(result.role).toBe("test-engineer");
      expect(result.confidence).toBe("high");
    });

    it("medium confidence: single keyword match", () => {
      const result = routeTaskToRole(
        "Write a readme",
        "Explain how to run the project",
        "team-exec",
        "executor",
      );
      expect(result.role).toBe("writer");
      expect(result.confidence).toBe("medium");
    });

    it("low confidence: no match uses fallback", () => {
      const result = routeTaskToRole(
        "Do something",
        "A plain job with nothing notable",
        "team-exec",
        "executor",
      );
      expect(result.role).toBe("executor");
      expect(result.confidence).toBe("low");
    });

    it("includes phase context in reason when no match", () => {
      const result = routeTaskToRole(
        "Generic task",
        "No keywords here",
        "team-verify",
        "executor",
      );
      expect(result.reason).toContain("team-verify");
    });

    it("routes security tasks correctly", () => {
      const result = routeTaskToRole(
        "Security audit",
        "Check for XSS and injection vulnerabilities",
        null,
        "executor",
      );
      expect(result.role).toBe("security-reviewer");
      expect(result.confidence).toBe("high");
    });

    it("routes refactoring tasks correctly", () => {
      const result = routeTaskToRole(
        "Refactor utils",
        "Simplify and consolidate helper functions",
        null,
        "executor",
      );
      expect(result.role).toBe("code-simplifier");
      expect(result.confidence).toBe("high");
    });
  });
});
