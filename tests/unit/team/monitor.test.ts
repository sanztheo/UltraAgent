import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import {
  getTeamSummary,
  readMonitorSnapshot,
  writeMonitorSnapshot,
  readTeamPhase,
  writeTeamPhase,
  type MonitorDeps,
  type MonitorSnapshotState,
  type TeamPhaseState,
} from "../../../src/team/state/monitor.js";

let tempDir: string;

async function setup(): Promise<string> {
  tempDir = await mkdtemp(join(tmpdir(), "ua-monitor-"));
  const teamDir = join(tempDir, ".ultraagent", "team");
  await mkdir(teamDir, { recursive: true });
  return tempDir;
}

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

function makeDeps(overrides: Partial<MonitorDeps> = {}): MonitorDeps {
  const cwd = tempDir;
  return {
    cwd,
    listWorkerNames: async () => [],
    listTasks: async () => [],
    readWorkerHeartbeat: async () => null,
    readWorkerStatus: async () => ({ state: "idle" as const }),
    ...overrides,
  };
}

describe("getTeamSummary", () => {
  it("returns empty summary with no workers or tasks", async () => {
    await setup();
    const summary = await getTeamSummary(makeDeps());
    expect(summary.workerCount).toBe(0);
    expect(summary.tasks.total).toBe(0);
    expect(summary.workers).toEqual([]);
    expect(summary.nonReportingWorkers).toEqual([]);
    expect(summary.performance).toBeDefined();
  });

  it("counts task statuses correctly", async () => {
    await setup();
    const deps = makeDeps({
      listTasks: async () => [
        { id: "1", status: "pending" },
        { id: "2", status: "in_progress" },
        { id: "3", status: "completed" },
        { id: "4", status: "failed" },
        { id: "5", status: "blocked" },
      ],
    });
    const summary = await getTeamSummary(deps);
    expect(summary.tasks.total).toBe(5);
    expect(summary.tasks.pending).toBe(1);
    expect(summary.tasks.in_progress).toBe(1);
    expect(summary.tasks.completed).toBe(1);
    expect(summary.tasks.failed).toBe(1);
    expect(summary.tasks.blocked).toBe(1);
  });

  it("reports alive workers", async () => {
    await setup();
    const deps = makeDeps({
      listWorkerNames: async () => ["w1", "w2"],
      readWorkerHeartbeat: async (name) =>
        name === "w1"
          ? {
              alive: true,
              last_turn_at: new Date().toISOString(),
              turn_count: 3,
            }
          : null,
      readWorkerStatus: async () => ({ state: "idle" as const }),
    });
    const summary = await getTeamSummary(deps);
    expect(summary.workerCount).toBe(2);
    expect(summary.workers[0]?.alive).toBe(true);
    expect(summary.workers[1]?.alive).toBe(false);
  });

  it("detects non-reporting workers after 5 turns without progress", async () => {
    await setup();
    // First call to establish baseline
    const deps = makeDeps({
      listWorkerNames: async () => ["w1"],
      listTasks: async () => [{ id: "t1", status: "in_progress" }],
      readWorkerHeartbeat: async () => ({
        alive: true,
        last_turn_at: new Date().toISOString(),
        turn_count: 10,
      }),
      readWorkerStatus: async () => ({
        state: "working" as const,
        current_task_id: "t1",
      }),
    });
    // First pass establishes snapshot
    await getTeamSummary(deps);
    // Second pass with same task but turn_count advanced by 6
    const deps2 = makeDeps({
      ...deps,
      readWorkerHeartbeat: async () => ({
        alive: true,
        last_turn_at: new Date().toISOString(),
        turn_count: 16,
      }),
      readWorkerStatus: async () => ({
        state: "working" as const,
        current_task_id: "t1",
      }),
      listWorkerNames: async () => ["w1"],
      listTasks: async () => [{ id: "t1", status: "in_progress" }],
    });
    const summary = await getTeamSummary(deps2);
    expect(summary.nonReportingWorkers).toContain("w1");
  });
});

describe("MonitorSnapshot read/write", () => {
  it("returns null when no snapshot exists", async () => {
    await setup();
    expect(await readMonitorSnapshot(tempDir)).toBeNull();
  });

  it("round-trips a snapshot", async () => {
    await setup();
    const snapshot: MonitorSnapshotState = {
      taskStatusById: { "1": "completed" },
      workerAliveByName: { w1: true },
      workerStateByName: { w1: "working" },
      workerTurnCountByName: { w1: 5 },
      workerTaskIdByName: { w1: "1" },
      completedEventTaskIds: { "1": true },
    };
    await writeMonitorSnapshot(tempDir, snapshot);
    const read = await readMonitorSnapshot(tempDir);
    expect(read).toEqual(snapshot);
  });
});

describe("TeamPhase read/write", () => {
  it("returns null when no phase exists", async () => {
    await setup();
    expect(await readTeamPhase(tempDir)).toBeNull();
  });

  it("round-trips phase state", async () => {
    await setup();
    const phase: TeamPhaseState = {
      current_phase: "verification",
      max_fix_attempts: 3,
      current_fix_attempt: 1,
      transitions: [
        { from: "team-exec", to: "verification", at: new Date().toISOString() },
      ],
      updated_at: new Date().toISOString(),
    };
    await writeTeamPhase(tempDir, phase);
    const read = await readTeamPhase(tempDir);
    expect(read).toEqual(phase);
  });
});
