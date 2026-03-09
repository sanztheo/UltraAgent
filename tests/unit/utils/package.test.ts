import { describe, expect, it } from "vitest";
import { getPackageRoot } from "../../../src/utils/package.js";

describe("getPackageRoot", () => {
  it("returns a directory that contains package.json", async () => {
    const { existsSync } = await import("node:fs");
    const { join } = await import("node:path");

    const root = getPackageRoot();
    expect(existsSync(join(root, "package.json"))).toBe(true);
  });

  it("returns a string path", () => {
    const root = getPackageRoot();
    expect(typeof root).toBe("string");
    expect(root.length).toBeGreaterThan(0);
  });
});
