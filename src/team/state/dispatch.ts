/**
 * Dispatch system — queue of notification requests with deduplication.
 *
 * A dispatch request tracks the delivery of a message or inbox instruction
 * to a worker. Status machine: pending -> notified -> delivered | failed.
 * All mutations are protected by the dispatch lock.
 */

import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { safeReadJsonFile } from "../../utils/safe-json.js";
import { writeAtomic } from "./io.js";
import { withDispatchLock } from "./locks.js";
import type {
  DispatchRequest,
  DispatchRequestInput,
  DispatchRequestKind,
  DispatchRequestStatus,
} from "./types.js";

// ── Helpers ────────────────────────────────────────────────────────────

function requestsFilePath(dispatchDir: string): string {
  return join(dispatchDir, "requests.json");
}

async function readRequests(dispatchDir: string): Promise<DispatchRequest[]> {
  return safeReadJsonFile<DispatchRequest[]>(requestsFilePath(dispatchDir), []);
}

async function writeRequests(
  dispatchDir: string,
  requests: DispatchRequest[],
): Promise<void> {
  await writeAtomic(
    requestsFilePath(dispatchDir),
    JSON.stringify(requests, null, 2),
  );
}

function isDispatchKind(value: unknown): value is DispatchRequestKind {
  return value === "inbox" || value === "mailbox" || value === "nudge";
}

function isDispatchStatus(value: unknown): value is DispatchRequestStatus {
  return (
    value === "pending" ||
    value === "notified" ||
    value === "delivered" ||
    value === "failed"
  );
}

function canTransitionDispatchStatus(
  from: DispatchRequestStatus,
  to: DispatchRequestStatus,
): boolean {
  if (from === to) return true;
  if (from === "pending" && (to === "notified" || to === "failed")) return true;
  if (from === "notified" && (to === "delivered" || to === "failed"))
    return true;
  return false;
}

function equivalentPendingDispatch(
  existing: DispatchRequest,
  input: DispatchRequestInput,
): boolean {
  if (existing.status !== "pending") return false;
  if (existing.kind !== input.kind) return false;
  if (existing.to_worker !== input.to_worker) return false;

  if (input.kind === "mailbox") {
    return (
      Boolean(input.message_id) && existing.message_id === input.message_id
    );
  }
  if (input.kind === "inbox" && input.inbox_correlation_key) {
    return existing.inbox_correlation_key === input.inbox_correlation_key;
  }
  return existing.trigger_message === input.trigger_message;
}

// ── Normalize ──────────────────────────────────────────────────────────

export function normalizeDispatchRequest(
  raw: Partial<DispatchRequest>,
  nowIso: string = new Date().toISOString(),
): DispatchRequest | null {
  if (!isDispatchKind(raw.kind)) return null;
  if (typeof raw.to_worker !== "string" || raw.to_worker.trim() === "")
    return null;
  if (
    typeof raw.trigger_message !== "string" ||
    raw.trigger_message.trim() === ""
  )
    return null;

  const status = isDispatchStatus(raw.status) ? raw.status : "pending";
  return {
    request_id:
      typeof raw.request_id === "string" && raw.request_id.trim() !== ""
        ? raw.request_id
        : randomUUID(),
    kind: raw.kind,
    to_worker: raw.to_worker,
    worker_index:
      typeof raw.worker_index === "number" ? raw.worker_index : undefined,
    pane_id:
      typeof raw.pane_id === "string" && raw.pane_id !== ""
        ? raw.pane_id
        : undefined,
    trigger_message: raw.trigger_message,
    message_id:
      typeof raw.message_id === "string" && raw.message_id !== ""
        ? raw.message_id
        : undefined,
    inbox_correlation_key:
      typeof raw.inbox_correlation_key === "string" &&
      raw.inbox_correlation_key !== ""
        ? raw.inbox_correlation_key
        : undefined,
    transport_preference:
      raw.transport_preference === "transport_direct" ||
      raw.transport_preference === "prompt_stdin"
        ? raw.transport_preference
        : "hook_preferred_with_fallback",
    fallback_allowed: raw.fallback_allowed !== false,
    status,
    attempt_count: Number.isFinite(raw.attempt_count)
      ? Math.max(0, Math.floor(raw.attempt_count as number))
      : 0,
    created_at:
      typeof raw.created_at === "string" && raw.created_at !== ""
        ? raw.created_at
        : nowIso,
    updated_at:
      typeof raw.updated_at === "string" && raw.updated_at !== ""
        ? raw.updated_at
        : nowIso,
    notified_at:
      typeof raw.notified_at === "string" && raw.notified_at !== ""
        ? raw.notified_at
        : undefined,
    delivered_at:
      typeof raw.delivered_at === "string" && raw.delivered_at !== ""
        ? raw.delivered_at
        : undefined,
    failed_at:
      typeof raw.failed_at === "string" && raw.failed_at !== ""
        ? raw.failed_at
        : undefined,
    last_reason:
      typeof raw.last_reason === "string" && raw.last_reason !== ""
        ? raw.last_reason
        : undefined,
  };
}

// ── Enqueue ────────────────────────────────────────────────────────────

export async function enqueueDispatchRequest(
  dispatchDir: string,
  input: DispatchRequestInput,
): Promise<{ request: DispatchRequest; deduped: boolean }> {
  if (!isDispatchKind(input.kind)) {
    throw new Error(`Invalid dispatch request kind: ${String(input.kind)}`);
  }
  if (
    input.kind === "mailbox" &&
    (!input.message_id || input.message_id.trim() === "")
  ) {
    throw new Error("mailbox dispatch requests require message_id");
  }

  return withDispatchLock(dispatchDir, async () => {
    const requests = await readRequests(dispatchDir);
    const existing = requests.find((req) =>
      equivalentPendingDispatch(req, input),
    );
    if (existing) return { request: existing, deduped: true };

    const nowIso = new Date().toISOString();
    const request = normalizeDispatchRequest(
      {
        request_id: randomUUID(),
        ...input,
        status: "pending",
        attempt_count: 0,
        created_at: nowIso,
        updated_at: nowIso,
      },
      nowIso,
    );
    if (!request) throw new Error("failed_to_normalize_dispatch_request");

    requests.push(request);
    await writeRequests(dispatchDir, requests);
    return { request, deduped: false };
  });
}

// ── Read & list ────────────────────────────────────────────────────────

export async function readDispatchRequest(
  dispatchDir: string,
  requestId: string,
): Promise<DispatchRequest | null> {
  const requests = await readRequests(dispatchDir);
  return requests.find((req) => req.request_id === requestId) ?? null;
}

export async function listDispatchRequests(
  dispatchDir: string,
  opts: {
    status?: DispatchRequestStatus;
    kind?: DispatchRequestKind;
    to_worker?: string;
    limit?: number;
  } = {},
): Promise<DispatchRequest[]> {
  const requests = await readRequests(dispatchDir);
  let filtered = requests;
  if (opts.status)
    filtered = filtered.filter((req) => req.status === opts.status);
  if (opts.kind) filtered = filtered.filter((req) => req.kind === opts.kind);
  if (opts.to_worker)
    filtered = filtered.filter((req) => req.to_worker === opts.to_worker);
  if (typeof opts.limit === "number" && opts.limit > 0)
    filtered = filtered.slice(0, opts.limit);
  return filtered;
}

// ── Transition ─────────────────────────────────────────────────────────

export async function transitionDispatchRequest(
  dispatchDir: string,
  requestId: string,
  from: DispatchRequestStatus,
  to: DispatchRequestStatus,
  patch: Partial<DispatchRequest> = {},
): Promise<DispatchRequest | null> {
  return withDispatchLock(dispatchDir, async () => {
    const requests = await readRequests(dispatchDir);
    const index = requests.findIndex((req) => req.request_id === requestId);
    if (index < 0) return null;

    const existing = requests[index]!;
    if (existing.status !== from && existing.status !== to) return null;
    if (!canTransitionDispatchStatus(existing.status, to)) return null;

    const nowIso = new Date().toISOString();
    const nextAttemptCount = Math.max(
      existing.attempt_count,
      Number.isFinite(patch.attempt_count)
        ? Math.floor(patch.attempt_count as number)
        : existing.status === to
          ? existing.attempt_count
          : existing.attempt_count + 1,
    );

    const next: DispatchRequest = {
      ...existing,
      ...patch,
      status: to,
      attempt_count: Math.max(0, nextAttemptCount),
      updated_at: nowIso,
    };
    if (to === "notified") next.notified_at = patch.notified_at ?? nowIso;
    if (to === "delivered") next.delivered_at = patch.delivered_at ?? nowIso;
    if (to === "failed") next.failed_at = patch.failed_at ?? nowIso;

    requests[index] = next;
    await writeRequests(dispatchDir, requests);
    return next;
  });
}

// ── Convenience transitions ────────────────────────────────────────────

export async function markDispatchRequestNotified(
  dispatchDir: string,
  requestId: string,
  patch: Partial<DispatchRequest> = {},
): Promise<DispatchRequest | null> {
  const current = await readDispatchRequest(dispatchDir, requestId);
  if (!current) return null;
  if (current.status === "notified" || current.status === "delivered")
    return current;
  return transitionDispatchRequest(
    dispatchDir,
    requestId,
    current.status,
    "notified",
    patch,
  );
}

export async function markDispatchRequestDelivered(
  dispatchDir: string,
  requestId: string,
  patch: Partial<DispatchRequest> = {},
): Promise<DispatchRequest | null> {
  const current = await readDispatchRequest(dispatchDir, requestId);
  if (!current) return null;
  if (current.status === "delivered") return current;
  return transitionDispatchRequest(
    dispatchDir,
    requestId,
    current.status,
    "delivered",
    patch,
  );
}
