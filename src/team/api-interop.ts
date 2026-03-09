/**
 * Team API interop — dispatches CLI operations to facade functions.
 *
 * Workers call: `ultraagent team api <operation> --arg value`
 * This module receives the parsed operation + args and delegates
 * to the appropriate facade function.
 *
 * Adapted from OMX: removed team_name (single-team model),
 * uses our facade directly, only exposes implemented operations.
 */

import { TASK_ID_PATTERN, WORKER_NAME_PATTERN } from "./contracts.js";
import * as facade from "./facade/index.js";
import type { TaskStatus } from "./contracts.js";
import { TASK_STATUSES, APPROVAL_STATUSES } from "./contracts.js";
import type { ApprovalStatus } from "./contracts.js";

export const TEAM_API_OPERATIONS = [
  "send-message",
  "broadcast",
  "mailbox-list",
  "mailbox-mark-delivered",
  "mailbox-mark-notified",
  "create-task",
  "read-task",
  "list-tasks",
  "claim-task",
  "transition-task",
  "release-task-claim",
  "read-worker-status",
  "read-worker-heartbeat",
  "update-worker-heartbeat",
  "list-workers",
  "read-task-approval",
  "write-task-approval",
] as const;

export type TeamApiOperation = (typeof TEAM_API_OPERATIONS)[number];

export type TeamApiEnvelope =
  | {
      ok: true;
      operation: TeamApiOperation;
      data: Record<string, unknown>;
    }
  | {
      ok: false;
      operation: TeamApiOperation | "unknown";
      error: { code: string; message: string };
    };

export function resolveTeamApiOperation(name: string): TeamApiOperation | null {
  const normalized = name.trim().toLowerCase().replaceAll("_", "-");
  if (TEAM_API_OPERATIONS.includes(normalized as TeamApiOperation)) {
    return normalized as TeamApiOperation;
  }
  return null;
}

function requireString(args: Record<string, unknown>, field: string): string {
  const value = String(args[field] ?? "").trim();
  if (!value) throw new Error(`${field} is required`);
  return value;
}

function requireTaskId(args: Record<string, unknown>, field = "task"): string {
  const value = requireString(args, field);
  if (!TASK_ID_PATTERN.test(value)) {
    throw new Error(`Invalid ${field}: "${value}". Must be digits only.`);
  }
  return value;
}

function requireWorkerName(
  args: Record<string, unknown>,
  field = "worker",
): string {
  const value = requireString(args, field);
  if (!WORKER_NAME_PATTERN.test(value)) {
    throw new Error(
      `Invalid ${field}: "${value}". Must match /^[a-z0-9][a-z0-9-]{0,63}$/.`,
    );
  }
  return value;
}

function requireTaskStatus(
  args: Record<string, unknown>,
  field: string,
): TaskStatus {
  const value = requireString(args, field);
  if (!TASK_STATUSES.includes(value as TaskStatus)) {
    throw new Error(
      `Invalid ${field}: "${value}". Must be one of: ${TASK_STATUSES.join(", ")}`,
    );
  }
  return value as TaskStatus;
}

export async function executeTeamApiOperation(
  operation: TeamApiOperation,
  args: Record<string, unknown>,
  cwd: string,
): Promise<TeamApiEnvelope> {
  try {
    switch (operation) {
      case "send-message": {
        const from = requireWorkerName(args, "from");
        const to = requireWorkerName(args, "to");
        const body = requireString(args, "body");
        const message = await facade.sendMessage(cwd, from, to, body);
        return { ok: true, operation, data: { message } };
      }

      case "broadcast": {
        const from = requireWorkerName(args, "from");
        const body = requireString(args, "body");
        const names = await facade.getWorkerNames(cwd);
        const messages = await facade.broadcast(cwd, from, body, names);
        return {
          ok: true,
          operation,
          data: { count: messages.length, messages },
        };
      }

      case "mailbox-list": {
        const worker = requireWorkerName(args);
        const messages = await facade.getMessages(cwd, worker);
        const includeDelivered = args.include_delivered !== false;
        const filtered = includeDelivered
          ? messages
          : messages.filter((m) => !m.delivered_at);
        return {
          ok: true,
          operation,
          data: { worker, count: filtered.length, messages: filtered },
        };
      }

      case "mailbox-mark-delivered": {
        const worker = requireWorkerName(args);
        const messageId = requireString(args, "message_id");
        const updated = await facade.markDelivered(cwd, worker, messageId);
        return {
          ok: true,
          operation,
          data: { worker, message_id: messageId, updated },
        };
      }

      case "mailbox-mark-notified": {
        const worker = requireWorkerName(args);
        const messageId = requireString(args, "message_id");
        const notified = await facade.markNotified(cwd, worker, messageId);
        return {
          ok: true,
          operation,
          data: { worker, message_id: messageId, notified },
        };
      }

      case "create-task": {
        const subject = requireString(args, "subject");
        const description = requireString(args, "description");
        const task = await facade.createTask(cwd, {
          subject,
          description,
          owner: (args.owner as string) ?? undefined,
          role: (args.role as string) ?? undefined,
          depends_on: (args.depends_on as string[]) ?? undefined,
          requires_code_change:
            (args.requires_code_change as boolean) ?? undefined,
        });
        return { ok: true, operation, data: { task } };
      }

      case "read-task": {
        const taskId = requireTaskId(args);
        const task = await facade.getTask(cwd, taskId);
        if (!task) {
          return {
            ok: false,
            operation,
            error: {
              code: "task_not_found",
              message: `Task ${taskId} not found`,
            },
          };
        }
        return { ok: true, operation, data: { task } };
      }

      case "list-tasks": {
        const tasks = await facade.listTasks(cwd);
        return { ok: true, operation, data: { count: tasks.length, tasks } };
      }

      case "claim-task": {
        const taskId = requireTaskId(args);
        const worker = requireWorkerName(args);
        const result = await facade.claim(cwd, taskId, worker);
        return {
          ok: true,
          operation,
          data: result as unknown as Record<string, unknown>,
        };
      }

      case "transition-task": {
        const taskId = requireTaskId(args);
        const from = requireTaskStatus(args, "from");
        const to = requireTaskStatus(args, "to");
        const claimToken = requireString(args, "claim_token");
        const result = await facade.transition(
          cwd,
          taskId,
          from,
          to,
          claimToken,
        );
        return {
          ok: true,
          operation,
          data: result as unknown as Record<string, unknown>,
        };
      }

      case "release-task-claim": {
        const taskId = requireTaskId(args);
        const claimToken = requireString(args, "claim_token");
        const result = await facade.releaseClaim(cwd, taskId, claimToken);
        return {
          ok: true,
          operation,
          data: result as unknown as Record<string, unknown>,
        };
      }

      case "read-worker-status": {
        const worker = requireWorkerName(args);
        const status = await facade.getWorkerStatus(cwd, worker);
        return { ok: true, operation, data: { worker, status } };
      }

      case "read-worker-heartbeat": {
        const worker = requireWorkerName(args);
        const heartbeat = await facade.getWorkerHeartbeat(cwd, worker);
        return { ok: true, operation, data: { worker, heartbeat } };
      }

      case "update-worker-heartbeat": {
        const worker = requireWorkerName(args);
        const heartbeat = await facade.touchWorkerHeartbeat(cwd, worker);
        return { ok: true, operation, data: { worker, heartbeat } };
      }

      case "list-workers": {
        const workers = await facade.getWorkerNames(cwd);
        return {
          ok: true,
          operation,
          data: { count: workers.length, workers },
        };
      }

      case "read-task-approval": {
        const taskId = requireTaskId(args);
        const approval = await facade.getApproval(cwd, taskId);
        return { ok: true, operation, data: { approval } };
      }

      case "write-task-approval": {
        const taskId = requireTaskId(args);
        const status = requireString(args, "status");
        if (!APPROVAL_STATUSES.includes(status as ApprovalStatus)) {
          throw new Error(
            `status must be one of: ${APPROVAL_STATUSES.join(", ")}`,
          );
        }
        const reviewer = requireString(args, "reviewer");
        const decisionReason = requireString(args, "decision_reason");
        const required = args.required !== false;
        await facade.setApproval(cwd, {
          task_id: taskId,
          required,
          status: status as ApprovalStatus,
          reviewer,
          decision_reason: decisionReason,
          decided_at: new Date().toISOString(),
        });
        return { ok: true, operation, data: { task_id: taskId, status } };
      }
    }
  } catch (error) {
    return {
      ok: false,
      operation,
      error: {
        code: "operation_failed",
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}
