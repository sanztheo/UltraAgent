/**
 * Task approval system — gate sensitive tasks behind human/leader approval.
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { writeAtomic } from './io.js';
import type { TaskApprovalRecord } from './types.js';

function approvalFilePath(approvalsDir: string, taskId: string): string {
  return join(approvalsDir, `approval-${taskId}.json`);
}

export async function writeTaskApproval(approvalsDir: string, approval: TaskApprovalRecord): Promise<void> {
  await writeAtomic(approvalFilePath(approvalsDir, approval.task_id), JSON.stringify(approval, null, 2));
}

export async function readTaskApproval(approvalsDir: string, taskId: string): Promise<TaskApprovalRecord | null> {
  const path = approvalFilePath(approvalsDir, taskId);
  if (!existsSync(path)) return null;

  try {
    const raw = await readFile(path, 'utf-8');
    const parsed = JSON.parse(raw) as TaskApprovalRecord;
    if (parsed.task_id !== taskId) return null;
    if (!['pending', 'approved', 'rejected'].includes(parsed.status)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
