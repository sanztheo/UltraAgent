import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import {
  writeShutdownRequest,
  readShutdownRequest,
  isShutdownRequested,
  writeShutdownAck,
  readShutdownAcks,
} from "../../../src/team/state/shutdown.js";

let tempDir: string;

async function setup(): Promise<string> {
  tempDir = await mkdtemp(join(tmpdir(), "ua-shutdown-"));
  const teamDir = join(tempDir, ".ultraagent", "team");
  await mkdir(teamDir, { recursive: true });
  return tempDir;
}

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

describe("shutdown request", () => {
  it("writes and reads a shutdown request", async () => {
    const cwd = await setup();
    const written = await writeShutdownRequest(cwd, "user requested");
    expect(written.reason).toBe("user requested");
    expect(written.requested_at).toBeTruthy();

    const read = await readShutdownRequest(cwd);
    expect(read).toEqual(written);
  });

  it("returns null when no request exists", async () => {
    const cwd = await setup();
    expect(await readShutdownRequest(cwd)).toBeNull();
  });

  it("isShutdownRequested reflects file presence", async () => {
    const cwd = await setup();
    expect(isShutdownRequested(cwd)).toBe(false);
    await writeShutdownRequest(cwd, "test");
    expect(isShutdownRequested(cwd)).toBe(true);
  });
});

describe("shutdown acks", () => {
  it("writes and reads worker acks", async () => {
    const cwd = await setup();
    await writeShutdownAck(cwd, "worker-1");
    await writeShutdownAck(cwd, "worker-2");

    const acks = await readShutdownAcks(cwd);
    expect(acks).toHaveLength(2);
    const names = acks.map((a) => a.worker).sort();
    expect(names).toEqual(["worker-1", "worker-2"]);
  });

  it("returns empty array when no acks exist", async () => {
    const cwd = await setup();
    expect(await readShutdownAcks(cwd)).toEqual([]);
  });

  it("each ack has worker name and timestamp", async () => {
    const cwd = await setup();
    const ack = await writeShutdownAck(cwd, "w1");
    expect(ack.worker).toBe("w1");
    expect(ack.acked_at).toBeTruthy();
  });
});
