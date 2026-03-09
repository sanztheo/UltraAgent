import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  queueBroadcastMailboxMessage,
  queueDirectMailboxMessage,
  queueInboxInstruction,
  waitForDispatchReceipt,
  type TeamNotifier,
} from "../../../src/team/mcp-comm.js";
import { listMailboxMessages } from "../../../src/team/state/mailbox.js";
import {
  markDispatchRequestNotified,
  readDispatchRequest,
} from "../../../src/team/state/dispatch.js";

describe("mcp-comm", () => {
  let testDir: string;
  let mailboxDir: string;
  let dispatchDir: string;
  let inboxDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "ultra-mcp-comm-"));
    mailboxDir = join(testDir, "mailbox");
    dispatchDir = join(testDir, "dispatch");
    inboxDir = join(testDir, "inbox");
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  const successNotifier: TeamNotifier = () => ({
    ok: true,
    transport: "tmux_send_keys",
    reason: "sent_via_tmux",
  });

  // Notifier that returns ok but stays "pending" (hook queued, not confirmed)
  const pendingNotifier: TeamNotifier = () => ({
    ok: true,
    transport: "hook",
    reason: "queued_for_hook_dispatch",
  });

  const failingNotifier: TeamNotifier = () => ({
    ok: false,
    transport: "none",
    reason: "worker_unreachable",
  });

  const throwingNotifier: TeamNotifier = () => {
    throw new Error("connection refused");
  };

  // ── queueInboxInstruction ─────────────────────────────────────────

  describe("queueInboxInstruction", () => {
    it("writes inbox file and enqueues dispatch", async () => {
      const outcome = await queueInboxInstruction({
        dispatchDir,
        inboxDir,
        workerName: "worker-1",
        workerIndex: 0,
        inbox: "# Task: do something\nPlease complete this.",
        triggerMessage: "check your inbox",
        notify: successNotifier,
      });

      expect(outcome.ok).toBe(true);
      expect(outcome.request_id).toBeTruthy();

      // Verify inbox file was written
      const inboxContent = await readFile(
        join(inboxDir, "worker-1.md"),
        "utf-8",
      );
      expect(inboxContent).toContain("do something");
    });

    it("returns dedup outcome on duplicate dispatch", async () => {
      // Use pendingNotifier so the first request stays "pending" and can be deduped
      await queueInboxInstruction({
        dispatchDir,
        inboxDir,
        workerName: "worker-1",
        workerIndex: 0,
        inbox: "task",
        triggerMessage: "check inbox",
        notify: pendingNotifier,
      });

      const outcome = await queueInboxInstruction({
        dispatchDir,
        inboxDir,
        workerName: "worker-1",
        workerIndex: 0,
        inbox: "task updated",
        triggerMessage: "check inbox",
        notify: pendingNotifier,
      });

      expect(outcome.ok).toBe(false);
      expect(outcome.reason).toBe("duplicate_pending_dispatch_request");
    });

    it("handles notifier exceptions gracefully", async () => {
      const outcome = await queueInboxInstruction({
        dispatchDir,
        inboxDir,
        workerName: "worker-1",
        workerIndex: 0,
        inbox: "task",
        triggerMessage: "go",
        notify: throwingNotifier,
      });

      expect(outcome.ok).toBe(false);
      expect(outcome.reason).toContain("notify_exception");
      expect(outcome.reason).toContain("connection refused");
    });
  });

  // ── queueDirectMailboxMessage ─────────────────────────────────────

  describe("queueDirectMailboxMessage", () => {
    it("sends message and enqueues dispatch on success", async () => {
      const outcome = await queueDirectMailboxMessage({
        mailboxDir,
        dispatchDir,
        fromWorker: "leader",
        toWorker: "worker-1",
        toWorkerIndex: 0,
        body: "your task is ready",
        triggerMessage: "new message from leader",
        notify: successNotifier,
      });

      expect(outcome.ok).toBe(true);
      expect(outcome.message_id).toBeTruthy();
      expect(outcome.to_worker).toBe("worker-1");

      // Verify message was persisted
      const messages = await listMailboxMessages(mailboxDir, "worker-1");
      expect(messages).toHaveLength(1);
      expect(messages[0]!.body).toBe("your task is ready");

      // Verify message was marked notified
      expect(messages[0]!.notified_at).toBeTruthy();
    });

    it("marks dispatch as notified on confirmed notification", async () => {
      const outcome = await queueDirectMailboxMessage({
        mailboxDir,
        dispatchDir,
        fromWorker: "leader",
        toWorker: "worker-1",
        body: "hello",
        triggerMessage: "msg",
        notify: successNotifier,
      });

      const dispatch = await readDispatchRequest(
        dispatchDir,
        outcome.request_id!,
      );
      expect(dispatch).not.toBeNull();
      expect(dispatch!.status).toBe("notified");
    });

    it("does not mark notified on failed notification", async () => {
      const outcome = await queueDirectMailboxMessage({
        mailboxDir,
        dispatchDir,
        fromWorker: "leader",
        toWorker: "worker-1",
        body: "hello",
        triggerMessage: "msg",
        transportPreference: "transport_direct",
        notify: failingNotifier,
      });

      expect(outcome.ok).toBe(false);

      const dispatch = await readDispatchRequest(
        dispatchDir,
        outcome.request_id!,
      );
      expect(dispatch).not.toBeNull();
      expect(dispatch!.status).toBe("failed");
    });
  });

  // ── queueBroadcastMailboxMessage ──────────────────────────────────

  describe("queueBroadcastMailboxMessage", () => {
    it("broadcasts to all recipients and creates dispatch per worker", async () => {
      const outcomes = await queueBroadcastMailboxMessage({
        mailboxDir,
        dispatchDir,
        fromWorker: "leader",
        recipients: [
          { workerName: "worker-1", workerIndex: 0 },
          { workerName: "worker-2", workerIndex: 1 },
        ],
        body: "team update",
        triggerFor: (name) => `message for ${name}`,
        notify: successNotifier,
      });

      expect(outcomes).toHaveLength(2);
      expect(outcomes.every((o) => o.ok)).toBe(true);

      // Each worker has the message
      for (const worker of ["worker-1", "worker-2"]) {
        const msgs = await listMailboxMessages(mailboxDir, worker);
        expect(msgs).toHaveLength(1);
        expect(msgs[0]!.body).toBe("team update");
      }
    });
  });

  // ── waitForDispatchReceipt ────────────────────────────────────────

  describe("waitForDispatchReceipt", () => {
    it("returns immediately for already-notified request", async () => {
      const outcome = await queueInboxInstruction({
        dispatchDir,
        inboxDir,
        workerName: "worker-1",
        workerIndex: 0,
        inbox: "task",
        triggerMessage: "go",
        notify: successNotifier,
      });

      const receipt = await waitForDispatchReceipt(
        dispatchDir,
        outcome.request_id!,
        {
          timeoutMs: 1000,
        },
      );

      expect(receipt).not.toBeNull();
      expect(receipt!.status).toBe("notified");
    });

    it("returns null for non-existent request", async () => {
      const receipt = await waitForDispatchReceipt(
        dispatchDir,
        "non-existent",
        {
          timeoutMs: 100,
        },
      );

      expect(receipt).toBeNull();
    });

    it("times out on pending request", async () => {
      // Use a notifier that succeeds but with hook transport + queued reason
      // so the dispatch stays pending
      const hookQueuedNotifier: TeamNotifier = () => ({
        ok: true,
        transport: "hook",
        reason: "queued_for_hook_dispatch",
      });

      const outcome = await queueInboxInstruction({
        dispatchDir,
        inboxDir,
        workerName: "worker-1",
        workerIndex: 0,
        inbox: "task",
        triggerMessage: "go-unique",
        notify: hookQueuedNotifier,
      });

      const receipt = await waitForDispatchReceipt(
        dispatchDir,
        outcome.request_id!,
        {
          timeoutMs: 150,
          pollMs: 25,
        },
      );

      // Should return the request in its current state (still pending)
      expect(receipt).not.toBeNull();
      expect(receipt!.status).toBe("pending");
    });
  });
});
