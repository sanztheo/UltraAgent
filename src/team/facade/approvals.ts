/**
 * Facade: approval operations bound to `cwd`.
 */

import { teamApprovalsDir } from "../../utils/paths.js";
import { readTaskApproval, writeTaskApproval } from "../state/approvals.js";
import type { TaskApprovalRecord } from "../state/types.js";
import { validateTaskId } from "./validation.js";

export async function getApproval(
  cwd: string,
  taskId: string,
): Promise<TaskApprovalRecord | null> {
  validateTaskId(taskId);
  return readTaskApproval(teamApprovalsDir(cwd), taskId);
}

export async function setApproval(
  cwd: string,
  approval: TaskApprovalRecord,
): Promise<void> {
  validateTaskId(approval.task_id);
  return writeTaskApproval(teamApprovalsDir(cwd), approval);
}
