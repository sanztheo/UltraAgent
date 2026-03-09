import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { tryLock, withLock } from "../../../../src/team/state/locks.js";

describe("locks", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "ultra-locks-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe("withLock", () => {
    it("executes the function and returns its result", async () => {
      const lockDir = join(testDir, "lock-1");
      const result = await withLock(lockDir, {}, async () => 42);
      expect(result).toBe(42);
    });

    it("cleans up the lock directory after success", async () => {
      const lockDir = join(testDir, "lock-cleanup");
      await withLock(lockDir, {}, async () => "done");
      expect(existsSync(lockDir)).toBe(false);
    });

    it("cleans up the lock directory after failure", async () => {
      const lockDir = join(testDir, "lock-fail");
      await expect(
        withLock(lockDir, {}, async () => {
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");
      expect(existsSync(lockDir)).toBe(false);
    });

    it("serializes concurrent access", async () => {
      const lockDir = join(testDir, "lock-serial");
      const order: number[] = [];

      const p1 = withLock(lockDir, { timeoutMs: 3000 }, async () => {
        order.push(1);
        await new Promise((r) => setTimeout(r, 50));
        order.push(2);
      });

      // Small delay to ensure p1 acquires first
      await new Promise((r) => setTimeout(r, 5));

      const p2 = withLock(lockDir, { timeoutMs: 3000 }, async () => {
        order.push(3);
      });

      await Promise.all([p1, p2]);
      // p1 should complete (1,2) before p2 starts (3)
      expect(order).toEqual([1, 2, 3]);
    });

    it("throws on timeout", async () => {
      const lockDir = join(testDir, "lock-timeout");

      // Acquire lock and hold it
      const { mkdir } = await import("node:fs/promises");
      await mkdir(lockDir, { recursive: true });

      await expect(
        withLock(
          lockDir,
          { timeoutMs: 100, staleMs: 60_000 },
          async () => "never",
        ),
      ).rejects.toThrow("Lock timeout");

      // Cleanup held lock
      await rm(lockDir, { recursive: true, force: true });
    });

    it("recovers stale locks", async () => {
      const lockDir = join(testDir, "lock-stale");

      // Create a "stale" lock
      const { mkdir, utimes } = await import("node:fs/promises");
      await mkdir(lockDir, { recursive: true });
      // Set mtime to 1 minute ago
      const past = new Date(Date.now() - 60_000);
      await utimes(lockDir, past, past);

      // Should recover and succeed with staleMs=1000
      const result = await withLock(
        lockDir,
        { staleMs: 1000, timeoutMs: 2000 },
        async () => "recovered",
      );
      expect(result).toBe("recovered");
    });
  });

  describe("tryLock", () => {
    it("returns ok:true with the value on success", async () => {
      const lockDir = join(testDir, "try-ok");
      const result = await tryLock(lockDir, {}, async () => "value");
      expect(result).toEqual({ ok: true, value: "value" });
    });

    it("returns ok:false on timeout (no throw)", async () => {
      const lockDir = join(testDir, "try-timeout");

      const { mkdir } = await import("node:fs/promises");
      await mkdir(lockDir, { recursive: true });

      const result = await tryLock(
        lockDir,
        { timeoutMs: 100, staleMs: 60_000 },
        async () => "never",
      );
      expect(result).toEqual({ ok: false });

      await rm(lockDir, { recursive: true, force: true });
    });
  });
});
