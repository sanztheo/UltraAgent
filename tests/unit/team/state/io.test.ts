import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeAtomic } from "../../../../src/team/state/io.js";

describe("writeAtomic", () => {
  let testDir: string;

  beforeEach(async () => {
    const { mkdtemp } = await import("node:fs/promises");
    testDir = await mkdtemp(join(tmpdir(), "ultra-io-"));
  });

  afterEach(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(testDir, { recursive: true, force: true });
  });

  it("writes a file atomically", async () => {
    const filePath = join(testDir, "test.json");
    await writeAtomic(filePath, '{"hello":"world"}');

    const content = await readFile(filePath, "utf-8");
    expect(content).toBe('{"hello":"world"}');
  });

  it("creates intermediate directories", async () => {
    const filePath = join(testDir, "deep", "nested", "file.json");
    await writeAtomic(filePath, "data");

    expect(existsSync(filePath)).toBe(true);
    const content = await readFile(filePath, "utf-8");
    expect(content).toBe("data");
  });

  it("overwrites existing file", async () => {
    const filePath = join(testDir, "overwrite.json");
    await writeAtomic(filePath, "first");
    await writeAtomic(filePath, "second");

    const content = await readFile(filePath, "utf-8");
    expect(content).toBe("second");
  });

  it("leaves no tmp files on success", async () => {
    const filePath = join(testDir, "clean.json");
    await writeAtomic(filePath, "data");

    const { readdir } = await import("node:fs/promises");
    const files = await readdir(testDir);
    expect(files).toEqual(["clean.json"]);
  });
});
