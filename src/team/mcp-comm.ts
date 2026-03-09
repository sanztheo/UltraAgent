/**
 * MCP communication layer — orchestrates mailbox + dispatch for inter-agent messaging.
 *
 * Three main operations:
 * - queueInboxInstruction: write inbox file + enqueue dispatch notification
 * - queueDirectMailboxMessage: send message + enqueue dispatch
 * - queueBroadcastMailboxMessage: broadcast to all workers + enqueue per recipient
 *
 * Each operation creates the message/inbox, enqueues a dispatch request,
 * then calls the provided notifier to actually deliver. If notification
 * is confirmed, the dispatch request transitions to "notified".
 *
 * waitForDispatchReceipt: poll until dispatch reaches a terminal status.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  enqueueDispatchRequest,
  markDispatchRequestNotified,
  readDispatchRequest,
  transitionDispatchRequest,
} from "./state/dispatch.js";
import {
  broadcastMessage,
  markMessageNotified,
  sendDirectMessage,
} from "./state/mailbox.js";
import type {
  DispatchOutcome,
  DispatchRequest,
  DispatchRequestInput,
  DispatchTransport,
} from "./state/types.js";

export interface NotifierTarget {
  workerName: string;
  workerIndex?: number;
  paneId?: string;
}

export type TeamNotifier = (
  target: NotifierTarget,
  message: string,
  context: { request: DispatchRequest; message_id?: string },
) => DispatchOutcome | Promise<DispatchOutcome>;

function isConfirmedNotification(outcome: DispatchOutcome): boolean {
  if (!outcome.ok) return false;
  if (outcome.transport !== "hook") return true;
  return outcome.reason !== "queued_for_hook_dispatch";
}

function fallbackTransportForPreference(
  preference: DispatchRequestInput["transport_preference"],
): DispatchTransport {
  if (preference === "prompt_stdin") return "prompt_stdin";
  if (preference === "transport_direct") return "tmux_send_keys";
  return "hook";
}

function notifyExceptionReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `notify_exception:${message}`;
}

async function safeNotify(
  notify: TeamNotifier,
  target: NotifierTarget,
  message: string,
  context: { request: DispatchRequest; message_id?: string },
  transportPreference: DispatchRequestInput["transport_preference"],
): Promise<DispatchOutcome> {
  try {
    return await Promise.resolve(notify(target, message, context));
  } catch (error) {
    return {
      ok: false,
      transport: fallbackTransportForPreference(transportPreference),
      reason: notifyExceptionReason(error),
    };
  }
}

async function markImmediateDispatchFailure(
  dispatchDir: string,
  request: DispatchRequest,
  reason: string,
  messageId?: string,
): Promise<void> {
  if (request.transport_preference === "hook_preferred_with_fallback") return;

  const current = await readDispatchRequest(dispatchDir, request.request_id);
  if (!current) return;
  if (
    current.status === "failed" ||
    current.status === "notified" ||
    current.status === "delivered"
  )
    return;

  await transitionDispatchRequest(
    dispatchDir,
    request.request_id,
    current.status,
    "failed",
    { message_id: messageId ?? current.message_id, last_reason: reason },
  ).catch(() => {});
}

async function writeWorkerInbox(
  inboxDir: string,
  workerName: string,
  content: string,
): Promise<void> {
  const filePath = join(inboxDir, `${workerName}.md`);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf-8");
}

export interface QueueInboxParams {
  dispatchDir: string;
  inboxDir: string;
  workerName: string;
  workerIndex: number;
  paneId?: string;
  inbox: string;
  triggerMessage: string;
  transportPreference?: DispatchRequestInput["transport_preference"];
  fallbackAllowed?: boolean;
  inboxCorrelationKey?: string;
  notify: TeamNotifier;
}

export async function queueInboxInstruction(
  params: QueueInboxParams,
): Promise<DispatchOutcome> {
  await writeWorkerInbox(params.inboxDir, params.workerName, params.inbox);

  const queued = await enqueueDispatchRequest(params.dispatchDir, {
    kind: "inbox",
    to_worker: params.workerName,
    worker_index: params.workerIndex,
    pane_id: params.paneId,
    trigger_message: params.triggerMessage,
    transport_preference: params.transportPreference,
    fallback_allowed: params.fallbackAllowed,
    inbox_correlation_key: params.inboxCorrelationKey,
  });

  if (queued.deduped) {
    return {
      ok: false,
      transport: "none",
      reason: "duplicate_pending_dispatch_request",
      request_id: queued.request.request_id,
    };
  }

  const notifyOutcome = await safeNotify(
    params.notify,
    {
      workerName: params.workerName,
      workerIndex: params.workerIndex,
      paneId: params.paneId,
    },
    params.triggerMessage,
    { request: queued.request },
    params.transportPreference,
  );

  const outcome: DispatchOutcome = {
    ...notifyOutcome,
    request_id: queued.request.request_id,
  };

  if (isConfirmedNotification(outcome)) {
    await markDispatchRequestNotified(
      params.dispatchDir,
      queued.request.request_id,
      {
        last_reason: outcome.reason,
      },
    );
  } else {
    await markImmediateDispatchFailure(
      params.dispatchDir,
      queued.request,
      outcome.reason,
    );
  }

  return outcome;
}

export interface QueueDirectMessageParams {
  mailboxDir: string;
  dispatchDir: string;
  fromWorker: string;
  toWorker: string;
  toWorkerIndex?: number;
  toPaneId?: string;
  body: string;
  triggerMessage: string;
  transportPreference?: DispatchRequestInput["transport_preference"];
  fallbackAllowed?: boolean;
  notify: TeamNotifier;
}

export async function queueDirectMailboxMessage(
  params: QueueDirectMessageParams,
): Promise<DispatchOutcome> {
  const message = await sendDirectMessage(
    params.mailboxDir,
    params.fromWorker,
    params.toWorker,
    params.body,
  );

  const queued = await enqueueDispatchRequest(params.dispatchDir, {
    kind: "mailbox",
    to_worker: params.toWorker,
    worker_index: params.toWorkerIndex,
    pane_id: params.toPaneId,
    trigger_message: params.triggerMessage,
    message_id: message.message_id,
    transport_preference: params.transportPreference,
    fallback_allowed: params.fallbackAllowed,
  });

  if (queued.deduped) {
    return {
      ok: false,
      transport: "none",
      reason: "duplicate_pending_dispatch_request",
      request_id: queued.request.request_id,
      message_id: message.message_id,
    };
  }

  const notifyOutcome = await safeNotify(
    params.notify,
    {
      workerName: params.toWorker,
      workerIndex: params.toWorkerIndex,
      paneId: params.toPaneId,
    },
    params.triggerMessage,
    { request: queued.request, message_id: message.message_id },
    params.transportPreference,
  );

  const outcome: DispatchOutcome = {
    ...notifyOutcome,
    request_id: queued.request.request_id,
    message_id: message.message_id,
    to_worker: params.toWorker,
  };

  if (isConfirmedNotification(outcome)) {
    await markMessageNotified(
      params.mailboxDir,
      params.toWorker,
      message.message_id,
    );
    await markDispatchRequestNotified(
      params.dispatchDir,
      queued.request.request_id,
      {
        message_id: message.message_id,
        last_reason: outcome.reason,
      },
    );
  } else {
    await markImmediateDispatchFailure(
      params.dispatchDir,
      queued.request,
      outcome.reason,
      message.message_id,
    );
  }

  return outcome;
}

export interface QueueBroadcastParams {
  mailboxDir: string;
  dispatchDir: string;
  fromWorker: string;
  recipients: Array<{
    workerName: string;
    workerIndex: number;
    paneId?: string;
  }>;
  body: string;
  triggerFor: (workerName: string) => string;
  transportPreference?: DispatchRequestInput["transport_preference"];
  fallbackAllowed?: boolean;
  notify: TeamNotifier;
}

export async function queueBroadcastMailboxMessage(
  params: QueueBroadcastParams,
): Promise<DispatchOutcome[]> {
  const workerNames = params.recipients.map((r) => r.workerName);
  const messages = await broadcastMessage(
    params.mailboxDir,
    params.fromWorker,
    params.body,
    workerNames,
  );
  const recipientByName = new Map(
    params.recipients.map((r) => [r.workerName, r]),
  );
  const outcomes: DispatchOutcome[] = [];

  for (const message of messages) {
    const recipient = recipientByName.get(message.to_worker);
    if (!recipient) continue;

    const queued = await enqueueDispatchRequest(params.dispatchDir, {
      kind: "mailbox",
      to_worker: recipient.workerName,
      worker_index: recipient.workerIndex,
      pane_id: recipient.paneId,
      trigger_message: params.triggerFor(recipient.workerName),
      message_id: message.message_id,
      transport_preference: params.transportPreference,
      fallback_allowed: params.fallbackAllowed,
    });

    if (queued.deduped) {
      outcomes.push({
        ok: false,
        transport: "none",
        reason: "duplicate_pending_dispatch_request",
        request_id: queued.request.request_id,
        message_id: message.message_id,
        to_worker: recipient.workerName,
      });
      continue;
    }

    const notifyOutcome = await safeNotify(
      params.notify,
      {
        workerName: recipient.workerName,
        workerIndex: recipient.workerIndex,
        paneId: recipient.paneId,
      },
      params.triggerFor(recipient.workerName),
      { request: queued.request, message_id: message.message_id },
      params.transportPreference,
    );

    const outcome: DispatchOutcome = {
      ...notifyOutcome,
      request_id: queued.request.request_id,
      message_id: message.message_id,
      to_worker: recipient.workerName,
    };
    outcomes.push(outcome);

    if (isConfirmedNotification(outcome)) {
      await markMessageNotified(
        params.mailboxDir,
        recipient.workerName,
        message.message_id,
      );
      await markDispatchRequestNotified(
        params.dispatchDir,
        queued.request.request_id,
        {
          message_id: message.message_id,
          last_reason: outcome.reason,
        },
      );
    } else {
      await markImmediateDispatchFailure(
        params.dispatchDir,
        queued.request,
        outcome.reason,
        message.message_id,
      );
    }
  }

  return outcomes;
}

export async function waitForDispatchReceipt(
  dispatchDir: string,
  requestId: string,
  options: { timeoutMs: number; pollMs?: number },
): Promise<DispatchRequest | null> {
  const timeoutMs = Math.max(0, Math.floor(options.timeoutMs));
  let currentPollMs = Math.max(25, Math.floor(options.pollMs ?? 50));
  const maxPollMs = 500;
  const backoffFactor = 1.5;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    const request = await readDispatchRequest(dispatchDir, requestId);
    if (!request) return null;
    if (
      request.status === "notified" ||
      request.status === "delivered" ||
      request.status === "failed"
    ) {
      return request;
    }
    const jitter = Math.random() * currentPollMs * 0.3;
    await new Promise((resolve) => setTimeout(resolve, currentPollMs + jitter));
    currentPollMs = Math.min(currentPollMs * backoffFactor, maxPollMs);
  }

  return readDispatchRequest(dispatchDir, requestId);
}
