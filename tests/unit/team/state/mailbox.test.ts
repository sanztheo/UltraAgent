import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  broadcastMessage,
  listMailboxMessages,
  markMessageDelivered,
  markMessageNotified,
  sendDirectMessage,
} from "../../../../src/team/state/mailbox.js";

describe("mailbox", () => {
  let testDir: string;
  let mailboxDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "ultra-mailbox-"));
    mailboxDir = join(testDir, "mailbox");
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });


  describe("sendDirectMessage", () => {
    it("creates a message with a UUID and timestamps", async () => {
      const msg = await sendDirectMessage(
        mailboxDir,
        "leader",
        "worker-1",
        "Hello worker",
      );

      expect(msg.message_id).toBeTruthy();
      expect(msg.from_worker).toBe("leader");
      expect(msg.to_worker).toBe("worker-1");
      expect(msg.body).toBe("Hello worker");
      expect(msg.created_at).toBeTruthy();
      expect(msg.notified_at).toBeUndefined();
      expect(msg.delivered_at).toBeUndefined();
    });

    it("persists the message to the worker mailbox file", async () => {
      await sendDirectMessage(
        mailboxDir,
        "leader",
        "worker-1",
        "task assigned",
      );

      const raw = await readFile(join(mailboxDir, "worker-1.json"), "utf-8");
      const parsed = JSON.parse(raw);
      expect(parsed.worker).toBe("worker-1");
      expect(parsed.messages).toHaveLength(1);
      expect(parsed.messages[0].body).toBe("task assigned");
    });

    it("appends multiple messages to same worker", async () => {
      await sendDirectMessage(mailboxDir, "leader", "worker-1", "msg 1");
      await sendDirectMessage(mailboxDir, "leader", "worker-1", "msg 2");
      await sendDirectMessage(mailboxDir, "worker-2", "worker-1", "msg 3");

      const messages = await listMailboxMessages(mailboxDir, "worker-1");
      expect(messages).toHaveLength(3);
      expect(messages[0]!.body).toBe("msg 1");
      expect(messages[2]!.from_worker).toBe("worker-2");
    });
  });


  describe("broadcastMessage", () => {
    it("sends to all workers except the sender", async () => {
      const workers = ["leader", "worker-1", "worker-2", "worker-3"];
      const msgs = await broadcastMessage(
        mailboxDir,
        "leader",
        "broadcast!",
        workers,
      );

      expect(msgs).toHaveLength(3);
      expect(msgs.map((m) => m.to_worker).sort()).toEqual([
        "worker-1",
        "worker-2",
        "worker-3",
      ]);

      // Verify each worker has exactly one message
      for (const worker of ["worker-1", "worker-2", "worker-3"]) {
        const inbox = await listMailboxMessages(mailboxDir, worker);
        expect(inbox).toHaveLength(1);
        expect(inbox[0]!.body).toBe("broadcast!");
      }
    });

    it("skips the sender in the broadcast", async () => {
      const msgs = await broadcastMessage(mailboxDir, "worker-1", "hi", [
        "worker-1",
        "worker-2",
      ]);
      expect(msgs).toHaveLength(1);
      expect(msgs[0]!.to_worker).toBe("worker-2");

      const selfInbox = await listMailboxMessages(mailboxDir, "worker-1");
      expect(selfInbox).toHaveLength(0);
    });
  });


  describe("markMessageDelivered", () => {
    it("sets delivered_at on an existing message", async () => {
      const msg = await sendDirectMessage(
        mailboxDir,
        "leader",
        "worker-1",
        "test",
      );

      const result = await markMessageDelivered(
        mailboxDir,
        "worker-1",
        msg.message_id,
      );
      expect(result).toBe(true);

      const messages = await listMailboxMessages(mailboxDir, "worker-1");
      expect(messages[0]!.delivered_at).toBeTruthy();
    });

    it("is idempotent — does not overwrite delivered_at", async () => {
      const msg = await sendDirectMessage(
        mailboxDir,
        "leader",
        "worker-1",
        "test",
      );

      await markMessageDelivered(mailboxDir, "worker-1", msg.message_id);
      const msgs1 = await listMailboxMessages(mailboxDir, "worker-1");
      const firstDelivered = msgs1[0]!.delivered_at;

      await markMessageDelivered(mailboxDir, "worker-1", msg.message_id);
      const msgs2 = await listMailboxMessages(mailboxDir, "worker-1");
      expect(msgs2[0]!.delivered_at).toBe(firstDelivered);
    });

    it("returns false for non-existent message", async () => {
      await sendDirectMessage(mailboxDir, "leader", "worker-1", "test");
      const result = await markMessageDelivered(
        mailboxDir,
        "worker-1",
        "non-existent-id",
      );
      expect(result).toBe(false);
    });
  });


  describe("markMessageNotified", () => {
    it("sets notified_at on an existing message", async () => {
      const msg = await sendDirectMessage(
        mailboxDir,
        "leader",
        "worker-1",
        "test",
      );

      const result = await markMessageNotified(
        mailboxDir,
        "worker-1",
        msg.message_id,
      );
      expect(result).toBe(true);

      const messages = await listMailboxMessages(mailboxDir, "worker-1");
      expect(messages[0]!.notified_at).toBeTruthy();
    });
  });


  describe("listMailboxMessages", () => {
    it("returns empty array for worker with no mailbox", async () => {
      const messages = await listMailboxMessages(mailboxDir, "ghost-worker");
      expect(messages).toEqual([]);
    });
  });
});
