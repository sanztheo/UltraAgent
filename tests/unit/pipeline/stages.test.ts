import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createUltraPlanStage } from "../../../src/pipeline/stages/ultra-plan.js";
import {
  createTeamExecStage,
  buildTeamInstruction,
} from "../../../src/pipeline/stages/team-exec.js";
import {
  createUltraVerifyStage,
  buildVerifyInstruction,
} from "../../../src/pipeline/stages/ultra-verify.js";
import type { StageContext } from "../../../src/pipeline/types.js";

let tempDir: string;

async function setup(): Promise<string> {
  tempDir = await mkdtemp(join(tmpdir(), "ua-stages-"));
  return tempDir;
}

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

function baseCtx(cwd: string): StageContext {
  return { task: "build the feature", artifacts: {}, cwd };
}

describe("ultra-plan stage", () => {
  it("has the correct name", () => {
    const stage = createUltraPlanStage();
    expect(stage.name).toBe("ultra-plan");
  });

  it("canSkip returns false when no plans dir", async () => {
    const cwd = await setup();
    const stage = createUltraPlanStage();
    expect(stage.canSkip!(baseCtx(cwd))).toBe(false);
  });

  it("canSkip returns true when plan file exists", async () => {
    const cwd = await setup();
    const plansDir = join(cwd, ".ultraagent", "plans");
    await mkdir(plansDir, { recursive: true });
    await writeFile(join(plansDir, "plan-test.md"), "# Plan");

    const stage = createUltraPlanStage();
    expect(stage.canSkip!(baseCtx(cwd))).toBe(true);
  });

  it("canSkip ignores non-plan files", async () => {
    const cwd = await setup();
    const plansDir = join(cwd, ".ultraagent", "plans");
    await mkdir(plansDir, { recursive: true });
    await writeFile(join(plansDir, "notes.md"), "# Notes");

    const stage = createUltraPlanStage();
    expect(stage.canSkip!(baseCtx(cwd))).toBe(false);
  });

  it("run returns completed with artifacts", async () => {
    const cwd = await setup();
    const stage = createUltraPlanStage();
    const result = await stage.run(baseCtx(cwd));
    expect(result.status).toBe("completed");
    expect(result.artifacts.stage).toBe("ultra-plan");
    expect(result.artifacts.task).toBe("build the feature");
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it("discovers existing plan files", async () => {
    const cwd = await setup();
    const plansDir = join(cwd, ".ultraagent", "plans");
    await mkdir(plansDir, { recursive: true });
    await writeFile(join(plansDir, "plan-one.md"), "# Plan 1");
    await writeFile(join(plansDir, "plan-two.md"), "# Plan 2");

    const stage = createUltraPlanStage();
    const result = await stage.run(baseCtx(cwd));
    const plans = result.artifacts.existingPlans as string[];
    expect(plans).toHaveLength(2);
  });
});

describe("team-exec stage", () => {
  it("has the correct name", () => {
    const stage = createTeamExecStage();
    expect(stage.name).toBe("team-exec");
  });

  it("uses defaults when no options provided", async () => {
    const cwd = await setup();
    const stage = createTeamExecStage();
    const result = await stage.run(baseCtx(cwd));
    expect(result.status).toBe("completed");
    expect(result.artifacts.workerCount).toBe(2);
    expect(result.artifacts.agentType).toBe("executor");
  });

  it("respects custom options", async () => {
    const cwd = await setup();
    const stage = createTeamExecStage({
      workerCount: 4,
      agentType: "designer",
    });
    const result = await stage.run(baseCtx(cwd));
    expect(result.artifacts.workerCount).toBe(4);
    expect(result.artifacts.agentType).toBe("designer");
  });

  it("includes plan context from previous stage", async () => {
    const cwd = await setup();
    const stage = createTeamExecStage();
    const ctx: StageContext = {
      ...baseCtx(cwd),
      artifacts: { "ultra-plan": { task: "planned task" } },
    };
    const result = await stage.run(ctx);
    const instruction = result.artifacts.instruction as string;
    expect(instruction).toContain("ua team");
  });

  it("buildTeamInstruction formats correctly", () => {
    const instruction = buildTeamInstruction({
      task: "do the thing",
      workerCount: 3,
      agentType: "executor",
      useWorktrees: false,
      cwd: "/tmp",
    });
    expect(instruction).toContain("ua team 3:executor");
    expect(instruction).toContain("do the thing");
  });
});

describe("ultra-verify stage", () => {
  it("has the correct name", () => {
    const stage = createUltraVerifyStage();
    expect(stage.name).toBe("ultra-verify");
  });

  it("uses default max iterations", async () => {
    const cwd = await setup();
    const stage = createUltraVerifyStage();
    const result = await stage.run(baseCtx(cwd));
    expect(result.status).toBe("completed");
    expect(result.artifacts.maxIterations).toBe(10);
  });

  it("respects custom max iterations", async () => {
    const cwd = await setup();
    const stage = createUltraVerifyStage({ maxIterations: 5 });
    const result = await stage.run(baseCtx(cwd));
    expect(result.artifacts.maxIterations).toBe(5);
  });

  it("includes execution artifacts from previous stage", async () => {
    const cwd = await setup();
    const stage = createUltraVerifyStage();
    const ctx: StageContext = {
      ...baseCtx(cwd),
      artifacts: { "team-exec": { workerCount: 3 } },
    };
    const result = await stage.run(ctx);
    const descriptor = result.artifacts.verifyDescriptor as Record<
      string,
      unknown
    >;
    expect(descriptor.executionArtifacts).toEqual({ workerCount: 3 });
  });

  it("buildVerifyInstruction formats correctly", () => {
    const instruction = buildVerifyInstruction({
      task: "verify the feature",
      maxIterations: 7,
      cwd: "/tmp",
      executionArtifacts: {},
    });
    expect(instruction).toContain("ua verify (max 7 iterations)");
    expect(instruction).toContain("verify the feature");
  });
});
