import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  executeTeamApiOperation,
  resolveTeamApiOperation,
} from "../../../src/team/api-interop.js";
import { createTask, claim } from "../../../src/team/facade/tasks.js";
import { writeWorkerStatus } from "../../../src/team/state/workers.js";
import {
  teamDir,
  teamTasksDir,
  teamWorkersDir,
} from "../../../src/utils/paths.js";
import { mkdir } from "node:fs/promises";

describe("api-interop", () => {
  let testCwd: string;

  beforeEach(async () => {
    testCwd = await mkdtemp(join(tmpdir(), "ultra-api-"));
    await mkdir(teamDir(testCwd), { recursive: true });
    await mkdir(teamTasksDir(testCwd), { recursive: true });
    await mkdir(teamWorkersDir(testCwd), { recursive: true });
  });

  afterEach(async () => {
    await rm(testCwd, { recursive: true, force: true });
  });

  describe("resolveTeamApiOperation", () => {
    it("resolves kebab-case names", () => {
      expect(resolveTeamApiOperation("send-message")).toBe("send-message");
      expect(resolveTeamApiOperation("claim-task")).toBe("claim-task");
    });

    it("resolves underscore names", () => {
      expect(resolveTeamApiOperation("send_message")).toBe("send-message");
      expect(resolveTeamApiOperation("list_tasks")).toBe("list-tasks");
    });

    it("returns null for unknown operations", () => {
      expect(resolveTeamApiOperation("do-magic")).toBeNull();
    });
  });

  describe("executeTeamApiOperation", () => {
    it("create-task creates and returns task", async () => {
      const result = await executeTeamApiOperation(
        "create-task",
        { subject: "Test task", description: "A test" },
        testCwd,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.task).toBeTruthy();
      }
    });

    it("list-tasks returns tasks", async () => {
      await createTask(testCwd, {
        subject: "Task 1",
        description: "First",
      });
      const result = await executeTeamApiOperation("list-tasks", {}, testCwd);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.count).toBe(1);
      }
    });

    it("read-task returns 404 for missing task", async () => {
      const result = await executeTeamApiOperation(
        "read-task",
        { task: "999" },
        testCwd,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("task_not_found");
      }
    });

    it("claim-task claims an existing task", async () => {
      const task = await createTask(testCwd, {
        subject: "Claimable",
        description: "A task to claim",
      });
      const result = await executeTeamApiOperation(
        "claim-task",
        { task: task.id, worker: "worker-1" },
        testCwd,
      );
      expect(result.ok).toBe(true);
    });

    it("read-worker-status returns status", async () => {
      await writeWorkerStatus(teamWorkersDir(testCwd), "worker-1", "idle");
      const result = await executeTeamApiOperation(
        "read-worker-status",
        { worker: "worker-1" },
        testCwd,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        const status = result.data.status as { state: string };
        expect(status.state).toBe("idle");
      }
    });

    it("returns error for missing required fields", async () => {
      const result = await executeTeamApiOperation(
        "send-message",
        { from: "leader" },
        testCwd,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("operation_failed");
      }
    });

    it("returns error for invalid worker name", async () => {
      const result = await executeTeamApiOperation(
        "read-worker-status",
        { worker: "INVALID" },
        testCwd,
      );
      expect(result.ok).toBe(false);
    });

    it("list-workers returns worker names", async () => {
      await mkdir(join(teamWorkersDir(testCwd), "worker-1"), {
        recursive: true,
      });
      await mkdir(join(teamWorkersDir(testCwd), "worker-2"), {
        recursive: true,
      });
      const result = await executeTeamApiOperation("list-workers", {}, testCwd);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.count).toBe(2);
      }
    });
  });
});
