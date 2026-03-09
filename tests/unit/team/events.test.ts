import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import {
  appendTeamEvent,
  readTeamEvents,
  getLatestEventCursor,
} from "../../../src/team/state/events.js";

let tempDir: string;

async function setup(): Promise<string> {
  tempDir = await mkdtemp(join(tmpdir(), "ua-events-"));
  const eventsDir = join(tempDir, ".ultraagent", "team", "events");
  await mkdir(eventsDir, { recursive: true });
  return tempDir;
}

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

describe("appendTeamEvent", () => {
  it("appends an event and returns it with id and timestamp", async () => {
    const cwd = await setup();
    const event = await appendTeamEvent(cwd, {
      type: "task_completed",
      worker: "w1",
      task_id: "1",
    });
    expect(event.event_id).toBeTruthy();
    expect(event.type).toBe("task_completed");
    expect(event.worker).toBe("w1");
    expect(event.task_id).toBe("1");
    expect(event.created_at).toBeTruthy();
  });
});

describe("readTeamEvents", () => {
  it("returns empty array when no events exist", async () => {
    const cwd = await setup();
    const events = await readTeamEvents(cwd);
    expect(events).toEqual([]);
  });

  it("reads all appended events", async () => {
    const cwd = await setup();
    await appendTeamEvent(cwd, { type: "task_completed", worker: "w1" });
    await appendTeamEvent(cwd, { type: "task_failed", worker: "w2" });
    const events = await readTeamEvents(cwd);
    expect(events).toHaveLength(2);
    expect(events[0]?.type).toBe("task_completed");
    expect(events[1]?.type).toBe("task_failed");
  });

  it("supports cursor-based pagination with afterEventId", async () => {
    const cwd = await setup();
    const e1 = await appendTeamEvent(cwd, {
      type: "task_completed",
      worker: "w1",
    });
    await appendTeamEvent(cwd, { type: "task_failed", worker: "w2" });
    const after = await readTeamEvents(cwd, {
      afterEventId: e1.event_id,
    });
    expect(after).toHaveLength(1);
    expect(after[0]?.type).toBe("task_failed");
  });

  it("deduplicates consecutive identical worker_state_changed events", async () => {
    const cwd = await setup();
    await appendTeamEvent(cwd, {
      type: "worker_state_changed",
      worker: "w1",
      state: "idle",
      prev_state: "working",
    });
    await appendTeamEvent(cwd, {
      type: "worker_state_changed",
      worker: "w1",
      state: "idle",
      prev_state: "working",
    });
    const events = await readTeamEvents(cwd);
    expect(events).toHaveLength(1);
  });

  it("filters to wakeable events only when requested", async () => {
    const cwd = await setup();
    await appendTeamEvent(cwd, {
      type: "task_completed",
      worker: "w1",
    });
    await appendTeamEvent(cwd, {
      type: "shutdown_ack",
      worker: "w1",
    });
    const wakeable = await readTeamEvents(cwd, { wakeableOnly: true });
    expect(wakeable).toHaveLength(1);
    expect(wakeable[0]?.type).toBe("task_completed");
  });

  it("normalizes legacy worker_idle to worker_state_changed", async () => {
    const cwd = await setup();
    await appendTeamEvent(cwd, {
      type: "worker_idle" as "worker_state_changed",
      worker: "w1",
      prev_state: "working",
    });
    const events = await readTeamEvents(cwd);
    expect(events[0]?.type).toBe("worker_state_changed");
    expect(events[0]?.state).toBe("idle");
  });
});

describe("getLatestEventCursor", () => {
  it("returns empty string when no events", async () => {
    const cwd = await setup();
    expect(await getLatestEventCursor(cwd)).toBe("");
  });

  it("returns the last event id", async () => {
    const cwd = await setup();
    await appendTeamEvent(cwd, { type: "task_completed", worker: "w1" });
    const e2 = await appendTeamEvent(cwd, {
      type: "task_failed",
      worker: "w2",
    });
    expect(await getLatestEventCursor(cwd)).toBe(e2.event_id);
  });
});
