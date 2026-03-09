/**
 * Team event log — NDJSON append-only log with cursor-based polling.
 *
 * Events are appended as one JSON line per event to `.ultraagent/team/events/log.ndjson`.
 * The runtime monitor polls for new events using a cursor (last seen event_id).
 */

import { existsSync } from "node:fs";
import { appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { teamEventsDir } from "../../utils/paths.js";
import type { EventType } from "../contracts.js";
import type { TeamEvent, WorkerState } from "./types.js";

const EVENT_LOG_FILE = "log.ndjson";

const WAKEABLE_EVENT_TYPES = new Set<EventType>([
  "worker_state_changed",
  "task_completed",
  "task_failed",
  "worker_stopped",
  "message_received",
  "all_workers_idle",
  "leader_nudge",
]);

function eventLogPath(cwd: string): string {
  return join(teamEventsDir(cwd), EVENT_LOG_FILE);
}

function asWorkerState(value: unknown): WorkerState | undefined {
  if (typeof value !== "string") return undefined;
  const valid = [
    "idle",
    "working",
    "blocked",
    "done",
    "failed",
    "draining",
    "unknown",
  ];
  return valid.includes(value) ? (value as WorkerState) : undefined;
}

function normalizeRawEvent(raw: unknown): TeamEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const v = raw as Record<string, unknown>;

  const event_id = typeof v.event_id === "string" ? v.event_id.trim() : "";
  const type = typeof v.type === "string" ? v.type.trim() : "";
  const worker = typeof v.worker === "string" ? v.worker.trim() : "";
  const created_at =
    typeof v.created_at === "string" ? v.created_at.trim() : "";
  if (!event_id || !type || !worker || !created_at) return null;

  if (type === "worker_idle") {
    return {
      event_id,
      type: "worker_state_changed",
      worker,
      state: "idle",
      prev_state: asWorkerState(v.prev_state),
      created_at,
    };
  }

  return {
    event_id,
    type: type as EventType,
    worker,
    task_id: typeof v.task_id === "string" ? v.task_id : undefined,
    message_id:
      typeof v.message_id === "string" || v.message_id === null
        ? (v.message_id as string | null)
        : undefined,
    reason: typeof v.reason === "string" ? v.reason : undefined,
    state: asWorkerState(v.state),
    prev_state: asWorkerState(v.prev_state),
    created_at,
  };
}

function isDuplicateEvent(
  previous: TeamEvent | null,
  current: TeamEvent,
): boolean {
  if (!previous) return false;
  if (
    previous.type !== "worker_state_changed" ||
    current.type !== "worker_state_changed"
  )
    return false;
  return (
    previous.worker === current.worker &&
    previous.task_id === current.task_id &&
    previous.state === current.state &&
    previous.prev_state === current.prev_state
  );
}

export interface AppendEventInput {
  type: EventType;
  worker: string;
  task_id?: string;
  message_id?: string | null;
  reason?: string;
  state?: WorkerState;
  prev_state?: WorkerState;
}

export async function appendTeamEvent(
  cwd: string,
  input: AppendEventInput,
): Promise<TeamEvent> {
  const event: TeamEvent = {
    event_id: randomUUID(),
    type: input.type,
    worker: input.worker,
    task_id: input.task_id,
    message_id: input.message_id,
    reason: input.reason,
    state: input.state,
    prev_state: input.prev_state,
    created_at: new Date().toISOString(),
  };

  const path = eventLogPath(cwd);
  await appendFile(path, JSON.stringify(event) + "\n", "utf-8");
  return event;
}

export async function readTeamEvents(
  cwd: string,
  opts: { afterEventId?: string; wakeableOnly?: boolean } = {},
): Promise<TeamEvent[]> {
  const path = eventLogPath(cwd);
  if (!existsSync(path)) return [];

  const raw = await readFile(path, "utf-8").catch(() => "");
  if (!raw.trim()) return [];

  const events: TeamEvent[] = [];
  let started = !opts.afterEventId;
  let previous: TeamEvent | null = null;

  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const normalized = normalizeRawEvent(parsed);
    if (!normalized) continue;
    if (!started) {
      if (normalized.event_id === opts.afterEventId) started = true;
      continue;
    }
    if (isDuplicateEvent(previous, normalized)) continue;
    previous = normalized;
    if (opts.wakeableOnly && !WAKEABLE_EVENT_TYPES.has(normalized.type))
      continue;
    events.push(normalized);
  }

  return events;
}

export async function getLatestEventCursor(cwd: string): Promise<string> {
  const events = await readTeamEvents(cwd);
  return events.at(-1)?.event_id ?? "";
}

export async function waitForTeamEvent(
  cwd: string,
  opts: {
    afterEventId?: string;
    timeoutMs: number;
    pollMs?: number;
    wakeableOnly?: boolean;
  },
): Promise<{
  status: "event" | "timeout";
  event?: TeamEvent;
  cursor: string;
}> {
  const deadline = Date.now() + Math.max(0, Math.floor(opts.timeoutMs));
  let pollMs = Math.max(25, Math.floor(opts.pollMs ?? 100));
  const baseline = opts.afterEventId ?? (await getLatestEventCursor(cwd));

  while (Date.now() <= deadline) {
    const events = await readTeamEvents(cwd, {
      afterEventId: baseline,
      wakeableOnly: opts.wakeableOnly !== false,
    });
    const event = events[0];
    if (event) {
      return { status: "event", event, cursor: event.event_id };
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
    pollMs = Math.min(Math.floor(pollMs * 1.5), 500);
  }

  return { status: "timeout", cursor: baseline };
}
