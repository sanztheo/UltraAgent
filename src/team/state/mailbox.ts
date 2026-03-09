/**
 * Mailbox system — file-based messaging between workers.
 *
 * Each worker has a JSON file at `<mailboxDir>/<worker>.json` containing
 * an array of messages. All writes go through the mailbox lock to prevent
 * concurrent corruption. Events are appended for monitoring (Phase 6).
 */

import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { writeAtomic } from "./io.js";
import { withMailboxLock } from "./locks.js";
import type { MailboxMessage, TeamMailbox } from "./types.js";

function mailboxFilePath(mailboxDir: string, workerName: string): string {
  return join(mailboxDir, `${workerName}.json`);
}

async function readMailbox(
  mailboxDir: string,
  workerName: string,
): Promise<TeamMailbox> {
  const filePath = mailboxFilePath(mailboxDir, workerName);
  if (!existsSync(filePath)) {
    return { worker: workerName, messages: [] };
  }
  try {
    const raw = await readFile(filePath, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      Array.isArray((parsed as TeamMailbox).messages)
    ) {
      return parsed as TeamMailbox;
    }
    return { worker: workerName, messages: [] };
  } catch {
    return { worker: workerName, messages: [] };
  }
}

async function writeMailbox(
  mailboxDir: string,
  mailbox: TeamMailbox,
): Promise<void> {
  await writeAtomic(
    mailboxFilePath(mailboxDir, mailbox.worker),
    JSON.stringify(mailbox, null, 2),
  );
}

async function ensureMailboxDir(mailboxDir: string): Promise<void> {
  if (!existsSync(mailboxDir)) {
    await mkdir(mailboxDir, { recursive: true });
  }
}

export async function sendDirectMessage(
  mailboxDir: string,
  fromWorker: string,
  toWorker: string,
  body: string,
): Promise<MailboxMessage> {
  const msg: MailboxMessage = {
    message_id: randomUUID(),
    from_worker: fromWorker,
    to_worker: toWorker,
    body,
    created_at: new Date().toISOString(),
  };

  await ensureMailboxDir(mailboxDir);

  await withMailboxLock(mailboxDir, toWorker, async () => {
    const mailbox = await readMailbox(mailboxDir, toWorker);
    mailbox.messages.push(msg);
    await writeMailbox(mailboxDir, mailbox);
  });

  return msg;
}

export async function broadcastMessage(
  mailboxDir: string,
  fromWorker: string,
  body: string,
  workerNames: string[],
): Promise<MailboxMessage[]> {
  const delivered: MailboxMessage[] = [];
  for (const target of workerNames) {
    if (target === fromWorker) continue;
    delivered.push(
      await sendDirectMessage(mailboxDir, fromWorker, target, body),
    );
  }
  return delivered;
}

export async function markMessageDelivered(
  mailboxDir: string,
  workerName: string,
  messageId: string,
): Promise<boolean> {
  return withMailboxLock(mailboxDir, workerName, async () => {
    const mailbox = await readMailbox(mailboxDir, workerName);
    const msg = mailbox.messages.find((m) => m.message_id === messageId);
    if (!msg) return false;
    if (!msg.delivered_at) {
      msg.delivered_at = new Date().toISOString();
      await writeMailbox(mailboxDir, mailbox);
    }
    return true;
  });
}

export async function markMessageNotified(
  mailboxDir: string,
  workerName: string,
  messageId: string,
): Promise<boolean> {
  return withMailboxLock(mailboxDir, workerName, async () => {
    const mailbox = await readMailbox(mailboxDir, workerName);
    const msg = mailbox.messages.find((m) => m.message_id === messageId);
    if (!msg) return false;
    msg.notified_at = new Date().toISOString();
    await writeMailbox(mailboxDir, mailbox);
    return true;
  });
}

export async function listMailboxMessages(
  mailboxDir: string,
  workerName: string,
): Promise<MailboxMessage[]> {
  const mailbox = await readMailbox(mailboxDir, workerName);
  return mailbox.messages;
}
