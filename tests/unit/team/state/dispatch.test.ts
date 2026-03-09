import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  enqueueDispatchRequest,
  listDispatchRequests,
  markDispatchRequestDelivered,
  markDispatchRequestNotified,
  normalizeDispatchRequest,
  readDispatchRequest,
  transitionDispatchRequest,
} from "../../../../src/team/state/dispatch.js";

describe("dispatch", () => {
  let testDir: string;
  let dispatchDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "ultra-dispatch-"));
    dispatchDir = join(testDir, "dispatch");
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });


  describe("normalizeDispatchRequest", () => {
    it("normalizes a valid partial request", () => {
      const result = normalizeDispatchRequest({
        kind: "mailbox",
        to_worker: "worker-1",
        trigger_message: "new message",
      });

      expect(result).not.toBeNull();
      expect(result!.kind).toBe("mailbox");
      expect(result!.to_worker).toBe("worker-1");
      expect(result!.status).toBe("pending");
      expect(result!.request_id).toBeTruthy();
      expect(result!.fallback_allowed).toBe(true);
      expect(result!.transport_preference).toBe("hook_preferred_with_fallback");
    });

    it("returns null for missing kind", () => {
      expect(
        normalizeDispatchRequest({ to_worker: "w", trigger_message: "m" }),
      ).toBeNull();
    });

    it("returns null for empty to_worker", () => {
      expect(
        normalizeDispatchRequest({
          kind: "inbox",
          to_worker: "",
          trigger_message: "m",
        }),
      ).toBeNull();
    });

    it("returns null for empty trigger_message", () => {
      expect(
        normalizeDispatchRequest({
          kind: "inbox",
          to_worker: "w",
          trigger_message: "",
        }),
      ).toBeNull();
    });
  });


  describe("enqueueDispatchRequest", () => {
    it("enqueues a new request", async () => {
      const { request, deduped } = await enqueueDispatchRequest(dispatchDir, {
        kind: "inbox",
        to_worker: "worker-1",
        trigger_message: "check inbox",
      });

      expect(deduped).toBe(false);
      expect(request.kind).toBe("inbox");
      expect(request.status).toBe("pending");
      expect(request.attempt_count).toBe(0);
    });

    it("deduplicates equivalent pending inbox requests by trigger_message", async () => {
      await enqueueDispatchRequest(dispatchDir, {
        kind: "inbox",
        to_worker: "worker-1",
        trigger_message: "check inbox",
      });

      const { deduped } = await enqueueDispatchRequest(dispatchDir, {
        kind: "inbox",
        to_worker: "worker-1",
        trigger_message: "check inbox",
      });

      expect(deduped).toBe(true);
    });

    it("deduplicates mailbox requests by message_id", async () => {
      await enqueueDispatchRequest(dispatchDir, {
        kind: "mailbox",
        to_worker: "worker-1",
        trigger_message: "msg",
        message_id: "msg-123",
      });

      const { deduped } = await enqueueDispatchRequest(dispatchDir, {
        kind: "mailbox",
        to_worker: "worker-1",
        trigger_message: "msg different",
        message_id: "msg-123",
      });

      expect(deduped).toBe(true);
    });

    it("does not dedup different workers", async () => {
      await enqueueDispatchRequest(dispatchDir, {
        kind: "inbox",
        to_worker: "worker-1",
        trigger_message: "check inbox",
      });

      const { deduped } = await enqueueDispatchRequest(dispatchDir, {
        kind: "inbox",
        to_worker: "worker-2",
        trigger_message: "check inbox",
      });

      expect(deduped).toBe(false);
    });

    it("throws for mailbox request without message_id", async () => {
      await expect(
        enqueueDispatchRequest(dispatchDir, {
          kind: "mailbox",
          to_worker: "worker-1",
          trigger_message: "msg",
        }),
      ).rejects.toThrow("message_id");
    });
  });


  describe("readDispatchRequest", () => {
    it("returns null for non-existent request", async () => {
      const result = await readDispatchRequest(dispatchDir, "non-existent");
      expect(result).toBeNull();
    });

    it("reads an enqueued request", async () => {
      const { request } = await enqueueDispatchRequest(dispatchDir, {
        kind: "nudge",
        to_worker: "worker-1",
        trigger_message: "wake up",
      });

      const result = await readDispatchRequest(dispatchDir, request.request_id);
      expect(result).not.toBeNull();
      expect(result!.kind).toBe("nudge");
    });
  });


  describe("listDispatchRequests", () => {
    it("returns empty array when no requests", async () => {
      const result = await listDispatchRequests(dispatchDir);
      expect(result).toEqual([]);
    });

    it("filters by status", async () => {
      await enqueueDispatchRequest(dispatchDir, {
        kind: "inbox",
        to_worker: "worker-1",
        trigger_message: "a",
      });
      await enqueueDispatchRequest(dispatchDir, {
        kind: "inbox",
        to_worker: "worker-2",
        trigger_message: "b",
      });

      const pending = await listDispatchRequests(dispatchDir, {
        status: "pending",
      });
      expect(pending).toHaveLength(2);

      const notified = await listDispatchRequests(dispatchDir, {
        status: "notified",
      });
      expect(notified).toHaveLength(0);
    });

    it("filters by kind and to_worker", async () => {
      await enqueueDispatchRequest(dispatchDir, {
        kind: "inbox",
        to_worker: "worker-1",
        trigger_message: "a",
      });
      await enqueueDispatchRequest(dispatchDir, {
        kind: "nudge",
        to_worker: "worker-1",
        trigger_message: "b",
      });
      await enqueueDispatchRequest(dispatchDir, {
        kind: "inbox",
        to_worker: "worker-2",
        trigger_message: "c",
      });

      const result = await listDispatchRequests(dispatchDir, {
        kind: "inbox",
        to_worker: "worker-1",
      });
      expect(result).toHaveLength(1);
      expect(result[0]!.trigger_message).toBe("a");
    });

    it("respects limit", async () => {
      for (let i = 0; i < 5; i++) {
        await enqueueDispatchRequest(dispatchDir, {
          kind: "inbox",
          to_worker: "worker-1",
          trigger_message: `msg-${i}`,
        });
      }

      const result = await listDispatchRequests(dispatchDir, { limit: 2 });
      expect(result).toHaveLength(2);
    });
  });


  describe("transitionDispatchRequest", () => {
    it("transitions pending -> notified", async () => {
      const { request } = await enqueueDispatchRequest(dispatchDir, {
        kind: "inbox",
        to_worker: "worker-1",
        trigger_message: "go",
      });

      const result = await transitionDispatchRequest(
        dispatchDir,
        request.request_id,
        "pending",
        "notified",
      );

      expect(result).not.toBeNull();
      expect(result!.status).toBe("notified");
      expect(result!.notified_at).toBeTruthy();
      expect(result!.attempt_count).toBe(1);
    });

    it("transitions notified -> delivered", async () => {
      const { request } = await enqueueDispatchRequest(dispatchDir, {
        kind: "inbox",
        to_worker: "worker-1",
        trigger_message: "go",
      });

      await transitionDispatchRequest(
        dispatchDir,
        request.request_id,
        "pending",
        "notified",
      );
      const result = await transitionDispatchRequest(
        dispatchDir,
        request.request_id,
        "notified",
        "delivered",
      );

      expect(result).not.toBeNull();
      expect(result!.status).toBe("delivered");
      expect(result!.delivered_at).toBeTruthy();
    });

    it("rejects invalid transition (pending -> delivered)", async () => {
      const { request } = await enqueueDispatchRequest(dispatchDir, {
        kind: "inbox",
        to_worker: "worker-1",
        trigger_message: "go",
      });

      const result = await transitionDispatchRequest(
        dispatchDir,
        request.request_id,
        "pending",
        "delivered",
      );

      expect(result).toBeNull();
    });

    it("returns null for non-existent request", async () => {
      const result = await transitionDispatchRequest(
        dispatchDir,
        "ghost",
        "pending",
        "notified",
      );
      expect(result).toBeNull();
    });
  });


  describe("markDispatchRequestNotified", () => {
    it("marks a pending request as notified", async () => {
      const { request } = await enqueueDispatchRequest(dispatchDir, {
        kind: "inbox",
        to_worker: "worker-1",
        trigger_message: "go",
      });

      const result = await markDispatchRequestNotified(
        dispatchDir,
        request.request_id,
      );
      expect(result).not.toBeNull();
      expect(result!.status).toBe("notified");
    });

    it("is idempotent on already-notified request", async () => {
      const { request } = await enqueueDispatchRequest(dispatchDir, {
        kind: "inbox",
        to_worker: "worker-1",
        trigger_message: "go",
      });

      await markDispatchRequestNotified(dispatchDir, request.request_id);
      const result = await markDispatchRequestNotified(
        dispatchDir,
        request.request_id,
      );
      expect(result).not.toBeNull();
      expect(result!.status).toBe("notified");
    });
  });

  describe("markDispatchRequestDelivered", () => {
    it("marks a notified request as delivered", async () => {
      const { request } = await enqueueDispatchRequest(dispatchDir, {
        kind: "inbox",
        to_worker: "worker-1",
        trigger_message: "go",
      });

      await markDispatchRequestNotified(dispatchDir, request.request_id);
      const result = await markDispatchRequestDelivered(
        dispatchDir,
        request.request_id,
      );
      expect(result).not.toBeNull();
      expect(result!.status).toBe("delivered");
    });
  });
});
