import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assertPathWithinDir,
  claim,
  createTask,
  getApproval,
  getTask,
  listTasks,
  releaseClaim,
  setApproval,
  transition,
  validateTaskId,
  validateWorkerName,
} from "../../../src/team/state.js";

// The facade resolves paths from cwd. We fake a cwd so that
// .ultraagent/team/ lives inside our tmpdir.
describe("state facade", () => {
  let fakeCwd: string;

  beforeEach(async () => {
    fakeCwd = await mkdtemp(join(tmpdir(), "ultra-facade-"));
  });

  afterEach(async () => {
    await rm(fakeCwd, { recursive: true, force: true });
  });

  // ── Validation ───────────────────────────────────────────────────

  describe("validateTaskId", () => {
    it("accepts valid IDs", () => {
      expect(() => validateTaskId("1")).not.toThrow();
      expect(() => validateTaskId("42")).not.toThrow();
    });

    it("rejects invalid IDs", () => {
      expect(() => validateTaskId("abc")).toThrow("Invalid task ID");
      expect(() => validateTaskId("../1")).toThrow("Invalid task ID");
      expect(() => validateTaskId("")).toThrow("Invalid task ID");
    });
  });

  describe("validateWorkerName", () => {
    it("accepts valid names", () => {
      expect(() => validateWorkerName("worker-1")).not.toThrow();
      expect(() => validateWorkerName("a")).not.toThrow();
    });

    it("rejects invalid names", () => {
      expect(() => validateWorkerName("-bad")).toThrow("Invalid worker name");
      expect(() => validateWorkerName("UPPER")).toThrow("Invalid worker name");
      expect(() => validateWorkerName("")).toThrow("Invalid worker name");
    });
  });

  describe("assertPathWithinDir", () => {
    it("allows paths inside root", () => {
      expect(() => assertPathWithinDir("/a/b/c", "/a/b")).not.toThrow();
    });

    it("allows root itself", () => {
      expect(() => assertPathWithinDir("/a/b", "/a/b")).not.toThrow();
    });

    it("rejects path traversal", () => {
      expect(() => assertPathWithinDir("/a/b/../c", "/a/b")).toThrow(
        "Path traversal",
      );
    });
  });

  // ── Task CRUD via facade ─────────────────────────────────────────

  describe("task operations", () => {
    it("create → get → list round-trip", async () => {
      const task = await createTask(fakeCwd, {
        subject: "Facade test",
        description: "Works",
      });
      expect(task.id).toBe("1");

      const fetched = await getTask(fakeCwd, "1");
      expect(fetched).not.toBeNull();
      expect(fetched!.subject).toBe("Facade test");

      const all = await listTasks(fakeCwd);
      expect(all).toHaveLength(1);
    });

    it("claim → transition → verify", async () => {
      await createTask(fakeCwd, { subject: "X", description: "x" });

      const claimResult = await claim(fakeCwd, "1", "worker-1");
      expect(claimResult.ok).toBe(true);
      if (!claimResult.ok) return;

      const transResult = await transition(
        fakeCwd,
        "1",
        "in_progress",
        "completed",
        claimResult.claimToken,
      );
      expect(transResult.ok).toBe(true);

      const final = await getTask(fakeCwd, "1");
      expect(final!.status).toBe("completed");
    });

    it("claim → release → re-claim by another worker", async () => {
      await createTask(fakeCwd, { subject: "Y", description: "y" });

      const c1 = await claim(fakeCwd, "1", "worker-1");
      if (!c1.ok) throw new Error("claim failed");

      await releaseClaim(fakeCwd, "1", c1.claimToken);

      const c2 = await claim(fakeCwd, "1", "worker-2");
      expect(c2.ok).toBe(true);
      if (c2.ok) expect(c2.task.owner).toBe("worker-2");
    });
  });

  // ── Approvals via facade ─────────────────────────────────────────

  describe("approval operations", () => {
    it("set → get round-trip", async () => {
      await setApproval(fakeCwd, {
        task_id: "1",
        required: true,
        status: "pending",
        reviewer: "leader",
        decision_reason: "",
        decided_at: new Date().toISOString(),
      });

      const result = await getApproval(fakeCwd, "1");
      expect(result).not.toBeNull();
      expect(result!.status).toBe("pending");
    });

    it("returns null for missing approval", async () => {
      const result = await getApproval(fakeCwd, "999");
      expect(result).toBeNull();
    });
  });
});
