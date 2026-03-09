import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  readTaskApproval,
  writeTaskApproval,
} from "../../../../src/team/state/approvals.js";
import type { TaskApprovalRecord } from "../../../../src/team/state/types.js";

describe("approvals", () => {
  let approvalsDir: string;

  beforeEach(async () => {
    approvalsDir = await mkdtemp(join(tmpdir(), "ultra-approvals-"));
  });

  afterEach(async () => {
    await rm(approvalsDir, { recursive: true, force: true });
  });

  const sampleApproval: TaskApprovalRecord = {
    task_id: "1",
    required: true,
    status: "approved",
    reviewer: "leader",
    decision_reason: "Looks good",
    decided_at: new Date().toISOString(),
  };

  it("writes and reads an approval", async () => {
    await writeTaskApproval(approvalsDir, sampleApproval);
    const result = await readTaskApproval(approvalsDir, "1");

    expect(result).not.toBeNull();
    expect(result!.task_id).toBe("1");
    expect(result!.status).toBe("approved");
    expect(result!.reviewer).toBe("leader");
  });

  it("returns null for non-existent approval", async () => {
    const result = await readTaskApproval(approvalsDir, "999");
    expect(result).toBeNull();
  });

  it("overwrites existing approval", async () => {
    await writeTaskApproval(approvalsDir, sampleApproval);
    await writeTaskApproval(approvalsDir, {
      ...sampleApproval,
      status: "rejected",
    });

    const result = await readTaskApproval(approvalsDir, "1");
    expect(result!.status).toBe("rejected");
  });
});
