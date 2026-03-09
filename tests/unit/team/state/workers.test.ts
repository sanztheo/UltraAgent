import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  isWorkerAlive,
  listWorkers,
  readWorkerHeartbeat,
  readWorkerStatus,
  updateWorkerHeartbeat,
  writeWorkerHeartbeat,
  writeWorkerStatus,
} from "../../../../src/team/state/workers.js";
import type {
  WorkerHeartbeat,
  WorkerStatus,
} from "../../../../src/team/state/types.js";

describe("workers", () => {
  let workersDir: string;

  beforeEach(async () => {
    workersDir = await mkdtemp(join(tmpdir(), "ultra-workers-"));
  });

  afterEach(async () => {
    await rm(workersDir, { recursive: true, force: true });
  });


  describe("writeWorkerStatus / readWorkerStatus", () => {
    it("writes and reads status", async () => {
      const status = await writeWorkerStatus(
        workersDir,
        "worker-1",
        "working",
        {
          current_task_id: "42",
        },
      );

      expect(status.state).toBe("working");
      expect(status.current_task_id).toBe("42");
      expect(status.updated_at).toBeTruthy();

      const read = await readWorkerStatus(workersDir, "worker-1");
      expect(read).toEqual(status);
    });

    it("returns null for non-existent worker", async () => {
      const status = await readWorkerStatus(workersDir, "ghost");
      expect(status).toBeNull();
    });

    it("overwrites previous status", async () => {
      await writeWorkerStatus(workersDir, "worker-1", "idle");
      const updated = await writeWorkerStatus(
        workersDir,
        "worker-1",
        "blocked",
        {
          reason: "waiting on dependency",
        },
      );

      expect(updated.state).toBe("blocked");
      expect(updated.reason).toBe("waiting on dependency");

      const read = await readWorkerStatus(workersDir, "worker-1");
      expect(read?.state).toBe("blocked");
    });
  });


  describe("writeWorkerHeartbeat / readWorkerHeartbeat", () => {
    it("writes and reads heartbeat", async () => {
      const hb: WorkerHeartbeat = {
        pid: 12345,
        last_turn_at: new Date().toISOString(),
        turn_count: 1,
        alive: true,
      };

      await writeWorkerHeartbeat(workersDir, "worker-1", hb);
      const read = await readWorkerHeartbeat(workersDir, "worker-1");
      expect(read).toEqual(hb);
    });

    it("returns null for non-existent worker", async () => {
      const hb = await readWorkerHeartbeat(workersDir, "ghost");
      expect(hb).toBeNull();
    });
  });

  describe("updateWorkerHeartbeat", () => {
    it("creates heartbeat on first call", async () => {
      const hb = await updateWorkerHeartbeat(workersDir, "worker-1");
      expect(hb.alive).toBe(true);
      expect(hb.turn_count).toBe(1);
      expect(hb.last_turn_at).toBeTruthy();
    });

    it("increments turn_count on subsequent calls", async () => {
      await updateWorkerHeartbeat(workersDir, "worker-1");
      const hb2 = await updateWorkerHeartbeat(workersDir, "worker-1");
      expect(hb2.turn_count).toBe(2);

      const hb3 = await updateWorkerHeartbeat(workersDir, "worker-1");
      expect(hb3.turn_count).toBe(3);
    });

    it("preserves pid from existing heartbeat", async () => {
      const initial: WorkerHeartbeat = {
        pid: 99999,
        last_turn_at: new Date().toISOString(),
        turn_count: 5,
        alive: true,
      };
      await writeWorkerHeartbeat(workersDir, "worker-1", initial);

      const updated = await updateWorkerHeartbeat(workersDir, "worker-1");
      expect(updated.pid).toBe(99999);
      expect(updated.turn_count).toBe(6);
    });
  });


  describe("isWorkerAlive", () => {
    it("returns false for non-existent worker", async () => {
      const alive = await isWorkerAlive(workersDir, "ghost");
      expect(alive).toBe(false);
    });

    it("returns true for fresh heartbeat", async () => {
      await updateWorkerHeartbeat(workersDir, "worker-1");
      const alive = await isWorkerAlive(workersDir, "worker-1");
      expect(alive).toBe(true);
    });

    it("returns false for stale heartbeat", async () => {
      const staleHb: WorkerHeartbeat = {
        pid: 1,
        last_turn_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
        turn_count: 1,
        alive: true,
      };
      await writeWorkerHeartbeat(workersDir, "worker-1", staleHb);

      const alive = await isWorkerAlive(workersDir, "worker-1", 5 * 60 * 1000);
      expect(alive).toBe(false);
    });

    it("returns false for dead heartbeat", async () => {
      const deadHb: WorkerHeartbeat = {
        pid: 1,
        last_turn_at: new Date().toISOString(),
        turn_count: 1,
        alive: false,
      };
      await writeWorkerHeartbeat(workersDir, "worker-1", deadHb);

      const alive = await isWorkerAlive(workersDir, "worker-1");
      expect(alive).toBe(false);
    });
  });


  describe("listWorkers", () => {
    it("returns empty array for non-existent dir", async () => {
      const workers = await listWorkers(join(workersDir, "nonexistent"));
      expect(workers).toEqual([]);
    });

    it("lists worker directories sorted alphabetically", async () => {
      await mkdir(join(workersDir, "charlie"), { recursive: true });
      await mkdir(join(workersDir, "alpha"), { recursive: true });
      await mkdir(join(workersDir, "bravo"), { recursive: true });

      const workers = await listWorkers(workersDir);
      expect(workers).toEqual(["alpha", "bravo", "charlie"]);
    });

    it("ignores hidden directories", async () => {
      await mkdir(join(workersDir, ".lock"), { recursive: true });
      await mkdir(join(workersDir, "worker-1"), { recursive: true });

      const workers = await listWorkers(workersDir);
      expect(workers).toEqual(["worker-1"]);
    });
  });
});
