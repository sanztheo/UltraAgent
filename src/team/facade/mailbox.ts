/**
 * Facade: mailbox operations bound to `cwd`.
 */

import { teamMailboxDir } from "../../utils/paths.js";
import {
  broadcastMessage,
  listMailboxMessages,
  markMessageDelivered,
  markMessageNotified,
  sendDirectMessage,
} from "../state/mailbox.js";
import type { MailboxMessage } from "../state/types.js";
import { validateWorkerName } from "./validation.js";

export async function sendMessage(
  cwd: string,
  fromWorker: string,
  toWorker: string,
  body: string,
): Promise<MailboxMessage> {
  validateWorkerName(fromWorker);
  validateWorkerName(toWorker);
  return sendDirectMessage(teamMailboxDir(cwd), fromWorker, toWorker, body);
}

export async function broadcast(
  cwd: string,
  fromWorker: string,
  body: string,
  workerNames: string[],
): Promise<MailboxMessage[]> {
  validateWorkerName(fromWorker);
  for (const name of workerNames) validateWorkerName(name);
  return broadcastMessage(teamMailboxDir(cwd), fromWorker, body, workerNames);
}

export async function getMessages(
  cwd: string,
  workerName: string,
): Promise<MailboxMessage[]> {
  validateWorkerName(workerName);
  return listMailboxMessages(teamMailboxDir(cwd), workerName);
}

export async function markDelivered(
  cwd: string,
  workerName: string,
  messageId: string,
): Promise<boolean> {
  validateWorkerName(workerName);
  return markMessageDelivered(teamMailboxDir(cwd), workerName, messageId);
}

export async function markNotified(
  cwd: string,
  workerName: string,
  messageId: string,
): Promise<boolean> {
  validateWorkerName(workerName);
  return markMessageNotified(teamMailboxDir(cwd), workerName, messageId);
}
