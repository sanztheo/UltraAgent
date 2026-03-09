import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  safeJsonParse,
  safeReadJsonFile,
} from "../../../src/utils/safe-json.js";

describe("safe-json", () => {
  describe("safeJsonParse", () => {
    it("parses valid JSON", () => {
      expect(safeJsonParse('{"a":1}', {})).toEqual({ a: 1 });
    });

    it("returns fallback on invalid JSON", () => {
      expect(safeJsonParse("not json", { fallback: true })).toEqual({
        fallback: true,
      });
    });

    it("returns fallback on empty string", () => {
      expect(safeJsonParse("", null)).toBeNull();
    });

    it("works with array fallback", () => {
      expect(safeJsonParse("broken", [])).toEqual([]);
    });
  });

  describe("safeReadJsonFile", () => {
    let testDir: string;

    beforeEach(async () => {
      testDir = await mkdtemp(join(tmpdir(), "ultra-json-"));
    });

    afterEach(async () => {
      await rm(testDir, { recursive: true, force: true });
    });

    it("reads valid JSON file", async () => {
      const path = join(testDir, "valid.json");
      await writeFile(path, '{"key":"value"}', "utf-8");

      const result = await safeReadJsonFile(path, {});
      expect(result).toEqual({ key: "value" });
    });

    it("returns fallback for missing file", async () => {
      const result = await safeReadJsonFile("/nonexistent/file.json", {
        missing: true,
      });
      expect(result).toEqual({ missing: true });
    });

    it("returns fallback for invalid JSON file", async () => {
      const path = join(testDir, "broken.json");
      await writeFile(path, "not json at all", "utf-8");

      const result = await safeReadJsonFile(path, []);
      expect(result).toEqual([]);
    });
  });
});
