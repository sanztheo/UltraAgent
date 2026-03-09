import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyWorkerOverlay,
  generateInitialInbox,
  generateMailboxTriggerMessage,
  generateShutdownInbox,
  generateTaskAssignmentInbox,
  generateTriggerMessage,
  generateWorkerOverlay,
  stripWorkerOverlay,
} from "../../../src/team/worker-bootstrap.js";
import type { TeamTask } from "../../../src/team/state/types.js";

describe("worker-bootstrap", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "ultra-bootstrap-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });


  describe("generateWorkerOverlay", () => {
    it("includes START and END markers", () => {
      const overlay = generateWorkerOverlay();
      expect(overlay).toContain("<!-- ULTRAAGENT:TEAM:WORKER:START -->");
      expect(overlay).toContain("<!-- ULTRAAGENT:TEAM:WORKER:END -->");
    });

    it("includes protocol instructions", () => {
      const overlay = generateWorkerOverlay();
      expect(overlay).toContain("team_worker_protocol");
      expect(overlay).toContain("ultraagent team api");
      expect(overlay).toContain("claim-task");
    });
  });


  describe("applyWorkerOverlay / stripWorkerOverlay", () => {
    it("applies overlay to new file", async () => {
      const agentsMd = join(testDir, "AGENTS.md");
      const overlay = generateWorkerOverlay();

      await applyWorkerOverlay(agentsMd, overlay);

      const content = await readFile(agentsMd, "utf-8");
      expect(content).toContain("ULTRAAGENT:TEAM:WORKER:START");
      expect(content).toContain("ULTRAAGENT:TEAM:WORKER:END");
    });

    it("applies overlay to existing file preserving content", async () => {
      const agentsMd = join(testDir, "AGENTS.md");
      await writeFile(agentsMd, "# My Agents\n\nExisting content here.\n");

      const overlay = generateWorkerOverlay();
      await applyWorkerOverlay(agentsMd, overlay);

      const content = await readFile(agentsMd, "utf-8");
      expect(content).toContain("Existing content here.");
      expect(content).toContain("ULTRAAGENT:TEAM:WORKER:START");
    });

    it("is idempotent — re-applying replaces old overlay", async () => {
      const agentsMd = join(testDir, "AGENTS.md");
      await writeFile(agentsMd, "# Base\n");

      const overlay = generateWorkerOverlay();
      await applyWorkerOverlay(agentsMd, overlay);
      await applyWorkerOverlay(agentsMd, overlay);

      const content = await readFile(agentsMd, "utf-8");
      const startCount =
        content.split("ULTRAAGENT:TEAM:WORKER:START").length - 1;
      expect(startCount).toBe(1);
    });

    it("strips overlay cleanly", async () => {
      const agentsMd = join(testDir, "AGENTS.md");
      await writeFile(agentsMd, "# Base\n");

      await applyWorkerOverlay(agentsMd, generateWorkerOverlay());
      await stripWorkerOverlay(agentsMd);

      const content = await readFile(agentsMd, "utf-8");
      expect(content).not.toContain("ULTRAAGENT:TEAM:WORKER:START");
      expect(content).toContain("# Base");
    });

    it("strip is safe on non-existent file", async () => {
      const agentsMd = join(testDir, "nonexistent.md");
      await expect(stripWorkerOverlay(agentsMd)).resolves.toBeUndefined();
    });
  });


  describe("generateInitialInbox", () => {
    const tasks: TeamTask[] = [
      {
        id: "1",
        subject: "Setup API",
        description: "Create REST endpoints",
        status: "pending",
        version: 1,
        created_at: new Date().toISOString(),
      },
      {
        id: "2",
        subject: "Write tests",
        description: "Unit tests for API",
        status: "pending",
        depends_on: ["1"],
        role: "tester",
        version: 1,
        created_at: new Date().toISOString(),
      },
    ];

    it("includes worker name and task list", () => {
      const inbox = generateInitialInbox("worker-1", tasks);
      expect(inbox).toContain("worker-1");
      expect(inbox).toContain("Setup API");
      expect(inbox).toContain("Write tests");
    });

    it("includes dependency info", () => {
      const inbox = generateInitialInbox("worker-1", tasks);
      expect(inbox).toContain("Depends on: 1");
    });

    it("includes role info", () => {
      const inbox = generateInitialInbox("worker-1", tasks);
      expect(inbox).toContain("Role: tester");
    });

    it("includes specialization section when rolePromptContent provided", () => {
      const inbox = generateInitialInbox("worker-1", tasks, {
        workerRole: "backend-dev",
        rolePromptContent: "You focus on backend Rust development.",
      });
      expect(inbox).toContain("backend-dev");
      expect(inbox).toContain("You focus on backend Rust development.");
    });

    it("includes ACK instructions", () => {
      const inbox = generateInitialInbox("worker-1", tasks);
      expect(inbox).toContain("send-message");
      expect(inbox).toContain("ACK");
    });
  });

  describe("generateTaskAssignmentInbox", () => {
    it("includes task ID and description", () => {
      const inbox = generateTaskAssignmentInbox(
        "worker-1",
        "42",
        "Implement caching layer",
      );
      expect(inbox).toContain("42");
      expect(inbox).toContain("Implement caching layer");
      expect(inbox).toContain("worker-1");
    });
  });

  describe("generateShutdownInbox", () => {
    it("includes shutdown protocol", () => {
      const inbox = generateShutdownInbox("worker-1");
      expect(inbox).toContain("Shutdown");
      expect(inbox).toContain("shutdown-ack.json");
      expect(inbox).toContain("worker-1");
    });
  });


  describe("generateTriggerMessage", () => {
    it("is short and references inbox path", () => {
      const msg = generateTriggerMessage("worker-1");
      expect(msg.length).toBeLessThan(200);
      expect(msg).toContain("inbox/worker-1.md");
    });
  });

  describe("generateMailboxTriggerMessage", () => {
    it("includes message count", () => {
      const msg = generateMailboxTriggerMessage("worker-1", 3);
      expect(msg).toContain("3");
      expect(msg).toContain("mailbox/worker-1.json");
    });

    it("handles non-finite count gracefully", () => {
      const msg = generateMailboxTriggerMessage("worker-1", NaN);
      expect(msg).toContain("1 new message");
    });

    it("clamps fractional count to floor", () => {
      const msg = generateMailboxTriggerMessage("worker-1", 2.7);
      expect(msg).toContain("2 new message");
    });
  });
});
