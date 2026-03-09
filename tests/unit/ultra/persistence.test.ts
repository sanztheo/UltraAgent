import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import {
  listCanonicalPlanFiles,
  writePlan,
  recordVisualFeedback,
  ensureCanonicalArtifacts,
  readProgress,
} from "../../../src/ultra/persistence.js";

let tempDir: string;

async function setup(): Promise<string> {
  tempDir = await mkdtemp(join(tmpdir(), "ua-persistence-"));
  return tempDir;
}

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

describe("listCanonicalPlanFiles", () => {
  it("returns empty array when no plans dir", async () => {
    const cwd = await setup();
    const plans = await listCanonicalPlanFiles(cwd);
    expect(plans).toEqual([]);
  });

  it("lists plan files sorted", async () => {
    const cwd = await setup();
    await writePlan(cwd, "Alpha Plan", "Content A");
    await writePlan(cwd, "Beta Plan", "Content B");

    const plans = await listCanonicalPlanFiles(cwd);
    expect(plans).toHaveLength(2);
    expect(plans[0]).toContain("plan-alpha-plan");
    expect(plans[1]).toContain("plan-beta-plan");
  });
});

describe("writePlan", () => {
  it("creates a markdown file with title and content", async () => {
    const cwd = await setup();
    const planPath = await writePlan(cwd, "My Feature", "Build the feature");

    expect(existsSync(planPath)).toBe(true);
    const content = await readFile(planPath, "utf-8");
    expect(content).toContain("# My Feature");
    expect(content).toContain("Build the feature");
    expect(content).toContain("SHA256:");
  });

  it("avoids duplicate filenames by appending counter", async () => {
    const cwd = await setup();
    const path1 = await writePlan(cwd, "Same Title", "Content 1");
    const path2 = await writePlan(cwd, "Same Title", "Content 2");

    expect(path1).not.toBe(path2);
    expect(existsSync(path1)).toBe(true);
    expect(existsSync(path2)).toBe(true);
  });

  it("slugifies title for filename", async () => {
    const cwd = await setup();
    const planPath = await writePlan(cwd, "Hello World!! 2024", "content");
    expect(planPath).toContain("plan-hello-world-2024");
  });

  it("handles empty title gracefully", async () => {
    const cwd = await setup();
    const planPath = await writePlan(cwd, "", "content");
    expect(planPath).toContain("plan-untitled");
  });
});

describe("recordVisualFeedback", () => {
  it("records feedback to progress ledger", async () => {
    const cwd = await setup();
    await ensureCanonicalArtifacts(cwd);

    await recordVisualFeedback(cwd, {
      score: 85,
      verdict: "revise",
      category_match: true,
      differences: ["color mismatch"],
      suggestions: ["use darker shade"],
    });

    const progress = await readProgress(cwd);
    expect(progress.visual_feedback).toHaveLength(1);
    const entry = progress.visual_feedback![0] as Record<string, unknown>;
    expect(entry.score).toBe(85);
    expect(entry.verdict).toBe("revise");
    expect(entry.passes_threshold).toBe(false);
  });

  it("uses custom threshold", async () => {
    const cwd = await setup();
    await ensureCanonicalArtifacts(cwd);

    await recordVisualFeedback(cwd, {
      score: 85,
      verdict: "pass",
      category_match: true,
      differences: [],
      suggestions: [],
      threshold: 80,
    });

    const progress = await readProgress(cwd);
    const entry = progress.visual_feedback![0] as Record<string, unknown>;
    expect(entry.passes_threshold).toBe(true);
    expect(entry.threshold).toBe(80);
  });

  it("limits next_actions to 5 entries", async () => {
    const cwd = await setup();
    await ensureCanonicalArtifacts(cwd);

    await recordVisualFeedback(cwd, {
      score: 50,
      verdict: "revise",
      category_match: false,
      differences: ["d1", "d2", "d3"],
      suggestions: ["s1", "s2", "s3"],
    });

    const progress = await readProgress(cwd);
    const entry = progress.visual_feedback![0] as Record<string, unknown>;
    const nextActions = entry.next_actions as string[];
    expect(nextActions.length).toBeLessThanOrEqual(5);
  });

  it("caps visual feedback history at 30 entries", async () => {
    const cwd = await setup();
    await ensureCanonicalArtifacts(cwd);

    for (let i = 0; i < 35; i++) {
      await recordVisualFeedback(cwd, {
        score: i,
        verdict: "revise",
        category_match: true,
        differences: [],
        suggestions: [],
      });
    }

    const progress = await readProgress(cwd);
    expect(progress.visual_feedback!.length).toBe(30);
  });
});

describe("ensureCanonicalArtifacts", () => {
  it("creates progress file and plans directory", async () => {
    const cwd = await setup();
    const artifacts = await ensureCanonicalArtifacts(cwd);

    expect(existsSync(artifacts.canonicalProgressPath)).toBe(true);
    expect(existsSync(join(cwd, ".ultraagent", "plans"))).toBe(true);
  });

  it("returns existing plan path", async () => {
    const cwd = await setup();
    const planPath = await writePlan(cwd, "existing plan", "content");
    const artifacts = await ensureCanonicalArtifacts(cwd);
    expect(artifacts.canonicalPlanPath).toBe(planPath);
  });

  it("returns undefined plan path when no plans exist", async () => {
    const cwd = await setup();
    const artifacts = await ensureCanonicalArtifacts(cwd);
    expect(artifacts.canonicalPlanPath).toBeUndefined();
  });
});

describe("readProgress", () => {
  it("returns empty ledger when no file exists", async () => {
    const cwd = await setup();
    const progress = await readProgress(cwd);
    expect(progress.schema_version).toBe(1);
    expect(progress.entries).toEqual([]);
    expect(progress.visual_feedback).toEqual([]);
  });

  it("preserves created_at across reads", async () => {
    const cwd = await setup();
    await ensureCanonicalArtifacts(cwd);

    const first = await readProgress(cwd);
    const second = await readProgress(cwd);
    expect(first.created_at).toBe(second.created_at);
  });
});
