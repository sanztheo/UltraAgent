/**
 * Graceful shutdown — request/ack protocol via JSON files.
 *
 * Leader writes shutdown-request.json, workers ack via shutdown-ack/<worker>.json.
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { teamDir } from "../../utils/paths.js";
import { writeAtomic } from "./io.js";

interface ShutdownRequest {
  requested_at: string;
  reason: string;
}

interface ShutdownAck {
  worker: string;
  acked_at: string;
}

function shutdownRequestPath(cwd: string): string {
  return join(teamDir(cwd), "shutdown-request.json");
}

function shutdownAckDir(cwd: string): string {
  return join(teamDir(cwd), "shutdown-ack");
}

export async function writeShutdownRequest(
  cwd: string,
  reason: string,
): Promise<ShutdownRequest> {
  const request: ShutdownRequest = {
    requested_at: new Date().toISOString(),
    reason,
  };
  await writeAtomic(shutdownRequestPath(cwd), JSON.stringify(request, null, 2));
  return request;
}

export async function readShutdownRequest(
  cwd: string,
): Promise<ShutdownRequest | null> {
  const path = shutdownRequestPath(cwd);
  if (!existsSync(path)) return null;
  try {
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw) as Partial<ShutdownRequest>;
    if (typeof parsed.requested_at !== "string") return null;
    return {
      requested_at: parsed.requested_at,
      reason: typeof parsed.reason === "string" ? parsed.reason : "",
    };
  } catch {
    return null;
  }
}

export function isShutdownRequested(cwd: string): boolean {
  return existsSync(shutdownRequestPath(cwd));
}

export async function writeShutdownAck(
  cwd: string,
  workerName: string,
): Promise<ShutdownAck> {
  const dir = shutdownAckDir(cwd);
  await mkdir(dir, { recursive: true });
  const ack: ShutdownAck = {
    worker: workerName,
    acked_at: new Date().toISOString(),
  };
  await writeAtomic(
    join(dir, `${workerName}.json`),
    JSON.stringify(ack, null, 2),
  );
  return ack;
}

export async function readShutdownAcks(cwd: string): Promise<ShutdownAck[]> {
  const dir = shutdownAckDir(cwd);
  if (!existsSync(dir)) return [];
  try {
    const files = await readdir(dir);
    const acks: ShutdownAck[] = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const raw = await readFile(join(dir, file), "utf-8");
        const parsed = JSON.parse(raw) as Partial<ShutdownAck>;
        if (
          typeof parsed.worker === "string" &&
          typeof parsed.acked_at === "string"
        ) {
          acks.push({ worker: parsed.worker, acked_at: parsed.acked_at });
        }
      } catch {
        continue;
      }
    }
    return acks;
  } catch {
    return [];
  }
}
