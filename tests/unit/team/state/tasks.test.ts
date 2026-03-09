import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  claimTask,
  computeTaskReadiness,
  createTeamTask,
  listTeamTasks,
  readTask,
  releaseTaskClaim,
  transitionTask,
} from "../../../../src/team/state/tasks.js";

describe("tasks", () => {
  let testDir: string;
  let teamDir: string;
  let tasksDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "ultra-tasks-"));
    teamDir = join(testDir, "team");
    tasksDir = join(testDir, "team", "tasks");
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  // ── Create ─────────────────────────────────────────────────────────

  describe("createTeamTask", () => {
    it("creates a task with auto-increment ID starting at 1", async () => {
      const task = await createTeamTask(teamDir, tasksDir, {
        subject: "First task",
        description: "Do something",
      });

      expect(task.id).toBe("1");
      expect(task.subject).toBe("First task");
      expect(task.status).toBe("pending");
      expect(task.version).toBe(1);
      expect(task.created_at).toBeTruthy();
    });

    it("increments IDs across multiple creates", async () => {
      const t1 = await createTeamTask(teamDir, tasksDir, {
        subject: "A",
        description: "a",
      });
      const t2 = await createTeamTask(teamDir, tasksDir, {
        subject: "B",
        description: "b",
      });
      const t3 = await createTeamTask(teamDir, tasksDir, {
        subject: "C",
        description: "c",
      });

      expect(t1.id).toBe("1");
      expect(t2.id).toBe("2");
      expect(t3.id).toBe("3");
    });

    it("sets status to blocked when depends_on is provided", async () => {
      await createTeamTask(teamDir, tasksDir, {
        subject: "A",
        description: "a",
      });
      const t2 = await createTeamTask(teamDir, tasksDir, {
        subject: "B",
        description: "b",
        depends_on: ["1"],
      });

      expect(t2.status).toBe("blocked");
    });
  });

  // ── Read ───────────────────────────────────────────────────────────

  describe("readTask", () => {
    it("returns null for non-existent task", async () => {
      const task = await readTask(tasksDir, "999");
      expect(task).toBeNull();
    });

    it("reads a created task", async () => {
      await createTeamTask(teamDir, tasksDir, {
        subject: "Test",
        description: "desc",
      });
      const task = await readTask(tasksDir, "1");

      expect(task).not.toBeNull();
      expect(task!.subject).toBe("Test");
    });
  });

  // ── Claim ──────────────────────────────────────────────────────────

  describe("claimTask", () => {
    it("claims a pending task successfully", async () => {
      await createTeamTask(teamDir, tasksDir, {
        subject: "Claimable",
        description: "yes",
      });
      const result = await claimTask(tasksDir, "1", "worker-1");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.task.status).toBe("in_progress");
        expect(result.task.owner).toBe("worker-1");
        expect(result.task.claim?.owner).toBe("worker-1");
        expect(result.claimToken).toBeTruthy();
        expect(result.task.version).toBe(2);
      }
    });

    it("rejects claiming a non-existent task", async () => {
      const result = await claimTask(tasksDir, "999", "worker-1");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe("task_not_found");
    });

    it("rejects claiming an already-claimed task", async () => {
      await createTeamTask(teamDir, tasksDir, {
        subject: "X",
        description: "x",
      });
      await claimTask(tasksDir, "1", "worker-1");

      const result = await claimTask(tasksDir, "1", "worker-2");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe("claim_conflict");
    });

    it("rejects claiming a blocked task (unmet dependencies)", async () => {
      await createTeamTask(teamDir, tasksDir, {
        subject: "A",
        description: "a",
      });
      await createTeamTask(teamDir, tasksDir, {
        subject: "B",
        description: "b",
        depends_on: ["1"],
      });

      const result = await claimTask(tasksDir, "2", "worker-1");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe("blocked_dependency");
    });
  });

  // ── Transition ─────────────────────────────────────────────────────

  describe("transitionTask", () => {
    it("transitions in_progress → completed", async () => {
      await createTeamTask(teamDir, tasksDir, {
        subject: "T",
        description: "t",
      });
      const claim = await claimTask(tasksDir, "1", "worker-1");
      if (!claim.ok) throw new Error("claim failed");

      const result = await transitionTask(
        tasksDir,
        "1",
        "in_progress",
        "completed",
        claim.claimToken,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.task.status).toBe("completed");
        expect(result.task.completed_at).toBeTruthy();
        expect(result.task.claim).toBeUndefined();
      }
    });

    it("transitions in_progress → failed", async () => {
      await createTeamTask(teamDir, tasksDir, {
        subject: "T",
        description: "t",
      });
      const claim = await claimTask(tasksDir, "1", "worker-1");
      if (!claim.ok) throw new Error("claim failed");

      const result = await transitionTask(
        tasksDir,
        "1",
        "in_progress",
        "failed",
        claim.claimToken,
      );
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.task.status).toBe("failed");
    });

    it("rejects invalid transition (pending → completed)", async () => {
      await createTeamTask(teamDir, tasksDir, {
        subject: "T",
        description: "t",
      });
      const result = await transitionTask(
        tasksDir,
        "1",
        "pending",
        "completed",
        "fake-token",
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe("invalid_transition");
    });

    it("rejects wrong claim token", async () => {
      await createTeamTask(teamDir, tasksDir, {
        subject: "T",
        description: "t",
      });
      const claim = await claimTask(tasksDir, "1", "worker-1");
      if (!claim.ok) throw new Error("claim failed");

      const result = await transitionTask(
        tasksDir,
        "1",
        "in_progress",
        "completed",
        "wrong-token",
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe("claim_conflict");
    });

    it("rejects transition on already-terminal task", async () => {
      await createTeamTask(teamDir, tasksDir, {
        subject: "T",
        description: "t",
      });
      const claim = await claimTask(tasksDir, "1", "worker-1");
      if (!claim.ok) throw new Error("claim failed");

      await transitionTask(
        tasksDir,
        "1",
        "in_progress",
        "completed",
        claim.claimToken,
      );
      const result = await transitionTask(
        tasksDir,
        "1",
        "in_progress",
        "failed",
        claim.claimToken,
      );
      expect(result.ok).toBe(false);
    });
  });

  // ── Release claim ──────────────────────────────────────────────────

  describe("releaseTaskClaim", () => {
    it("releases a claimed task back to pending", async () => {
      await createTeamTask(teamDir, tasksDir, {
        subject: "T",
        description: "t",
      });
      const claim = await claimTask(tasksDir, "1", "worker-1");
      if (!claim.ok) throw new Error("claim failed");

      const result = await releaseTaskClaim(tasksDir, "1", claim.claimToken);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.task.status).toBe("pending");
        expect(result.task.owner).toBeUndefined();
        expect(result.task.claim).toBeUndefined();
      }
    });

    it("rejects release with wrong token", async () => {
      await createTeamTask(teamDir, tasksDir, {
        subject: "T",
        description: "t",
      });
      await claimTask(tasksDir, "1", "worker-1");

      const result = await releaseTaskClaim(tasksDir, "1", "wrong-token");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe("claim_conflict");
    });
  });

  // ── Readiness ──────────────────────────────────────────────────────

  describe("computeTaskReadiness", () => {
    it("returns ready for task without dependencies", async () => {
      await createTeamTask(teamDir, tasksDir, {
        subject: "A",
        description: "a",
      });
      const readiness = await computeTaskReadiness(tasksDir, "1");
      expect(readiness.ready).toBe(true);
    });

    it("returns not-ready when dependencies are incomplete", async () => {
      await createTeamTask(teamDir, tasksDir, {
        subject: "A",
        description: "a",
      });
      await createTeamTask(teamDir, tasksDir, {
        subject: "B",
        description: "b",
        depends_on: ["1"],
      });

      const readiness = await computeTaskReadiness(tasksDir, "2");
      expect(readiness.ready).toBe(false);
      if (!readiness.ready) {
        expect(readiness.dependencies).toContain("1");
      }
    });

    it("returns ready when all dependencies are completed", async () => {
      await createTeamTask(teamDir, tasksDir, {
        subject: "A",
        description: "a",
      });
      await createTeamTask(teamDir, tasksDir, {
        subject: "B",
        description: "b",
        depends_on: ["1"],
      });

      // Complete task 1
      const claim = await claimTask(tasksDir, "1", "worker-1");
      if (!claim.ok) throw new Error("claim failed");
      await transitionTask(
        tasksDir,
        "1",
        "in_progress",
        "completed",
        claim.claimToken,
      );

      const readiness = await computeTaskReadiness(tasksDir, "2");
      expect(readiness.ready).toBe(true);
    });
  });

  // ── List ───────────────────────────────────────────────────────────

  describe("listTeamTasks", () => {
    it("returns empty array when no tasks exist", async () => {
      const tasks = await listTeamTasks(tasksDir);
      expect(tasks).toEqual([]);
    });

    it("returns all tasks sorted by ID", async () => {
      await createTeamTask(teamDir, tasksDir, {
        subject: "C",
        description: "c",
      });
      await createTeamTask(teamDir, tasksDir, {
        subject: "A",
        description: "a",
      });
      await createTeamTask(teamDir, tasksDir, {
        subject: "B",
        description: "b",
      });

      const tasks = await listTeamTasks(tasksDir);
      expect(tasks).toHaveLength(3);
      expect(tasks[0]!.id).toBe("1");
      expect(tasks[1]!.id).toBe("2");
      expect(tasks[2]!.id).toBe("3");
    });
  });
});
