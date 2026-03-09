import { describe, expect, it } from "vitest";
import { sleep } from "../../../src/utils/sleep.js";

describe("sleep", () => {
  it("resolves after the specified duration", async () => {
    const start = Date.now();
    await sleep(50);
    const elapsed = Date.now() - start;
    // Allow 15ms tolerance for timer imprecision
    expect(elapsed).toBeGreaterThanOrEqual(40);
  });

  it("can be cancelled with AbortSignal", async () => {
    const controller = new AbortController();

    // Cancel after 20ms
    setTimeout(() => controller.abort(), 20);

    const start = Date.now();
    await expect(sleep(5000, controller.signal)).rejects.toThrow();
    const elapsed = Date.now() - start;

    // Should have been cancelled well before 5s
    expect(elapsed).toBeLessThan(500);
  });

  it("rejects with the abort reason", async () => {
    const controller = new AbortController();
    const reason = new Error("custom reason");

    setTimeout(() => controller.abort(reason), 10);

    await expect(sleep(5000, controller.signal)).rejects.toThrow(
      "custom reason",
    );
  });

  it("resolves immediately with 0ms", async () => {
    const start = Date.now();
    await sleep(0);
    expect(Date.now() - start).toBeLessThan(50);
  });
});
