import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import {
  runPipeline,
  canResumePipeline,
  readPipelineState,
  cancelPipeline,
  createAutopilotPipelineConfig,
} from "../../../src/pipeline/orchestrator.js";
import type {
  PipelineStage,
  StageContext,
  StageResult,
  PipelineConfig,
} from "../../../src/pipeline/types.js";

let tempDir: string;

async function setup(): Promise<string> {
  tempDir = await mkdtemp(join(tmpdir(), "ua-pipeline-"));
  await mkdir(join(tempDir, ".ultraagent", "team"), { recursive: true });
  return tempDir;
}

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

function successStage(name: string): PipelineStage {
  return {
    name,
    async run(ctx: StageContext): Promise<StageResult> {
      return {
        status: "completed",
        artifacts: { stage: name, task: ctx.task },
        duration_ms: 1,
      };
    },
  };
}

function failingStage(name: string, error: string): PipelineStage {
  return {
    name,
    async run(): Promise<StageResult> {
      return {
        status: "failed",
        artifacts: {},
        duration_ms: 1,
        error,
      };
    },
  };
}

function skippableStage(name: string): PipelineStage {
  return {
    name,
    canSkip() {
      return true;
    },
    async run(ctx: StageContext): Promise<StageResult> {
      return {
        status: "completed",
        artifacts: { stage: name },
        duration_ms: 1,
      };
    },
  };
}

function throwingStage(name: string): PipelineStage {
  return {
    name,
    async run(): Promise<StageResult> {
      throw new Error("stage_threw");
    },
  };
}

describe("runPipeline", () => {
  it("runs all stages to completion", async () => {
    const cwd = await setup();
    const result = await runPipeline({
      name: "test",
      task: "build it",
      stages: [successStage("s1"), successStage("s2")],
      cwd,
    });
    expect(result.status).toBe("completed");
    expect(Object.keys(result.stageResults)).toEqual(["s1", "s2"]);
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
    expect(result.error).toBeUndefined();
  });

  it("stops on first failing stage", async () => {
    const cwd = await setup();
    const result = await runPipeline({
      name: "test",
      task: "build it",
      stages: [
        successStage("s1"),
        failingStage("s2", "boom"),
        successStage("s3"),
      ],
      cwd,
    });
    expect(result.status).toBe("failed");
    expect(result.failedStage).toBe("s2");
    expect(result.error).toBe("boom");
    expect(result.stageResults["s3"]).toBeUndefined();
  });

  it("skips stages with canSkip returning true", async () => {
    const cwd = await setup();
    const result = await runPipeline({
      name: "test",
      task: "build it",
      stages: [skippableStage("s1"), successStage("s2")],
      cwd,
    });
    expect(result.status).toBe("completed");
    expect(result.stageResults["s1"]!.status).toBe("skipped");
    expect(result.stageResults["s2"]!.status).toBe("completed");
  });

  it("catches stage exceptions as failures", async () => {
    const cwd = await setup();
    const result = await runPipeline({
      name: "test",
      task: "build it",
      stages: [throwingStage("s1")],
      cwd,
    });
    expect(result.status).toBe("failed");
    expect(result.error).toContain("Stage s1 threw: stage_threw");
  });

  it("passes artifacts from previous stages", async () => {
    const cwd = await setup();
    let capturedArtifacts: Record<string, unknown> = {};
    const capturingStage: PipelineStage = {
      name: "s2",
      async run(ctx) {
        capturedArtifacts = ctx.artifacts;
        return { status: "completed", artifacts: {}, duration_ms: 1 };
      },
    };

    await runPipeline({
      name: "test",
      task: "build it",
      stages: [successStage("s1"), capturingStage],
      cwd,
    });
    expect(capturedArtifacts["s1"]).toBeDefined();
  });

  it("calls onStageTransition callback", async () => {
    const cwd = await setup();
    const transitions: Array<[string, string]> = [];
    await runPipeline({
      name: "test",
      task: "build it",
      stages: [successStage("s1"), successStage("s2"), successStage("s3")],
      cwd,
      onStageTransition: (from, to) => transitions.push([from, to]),
    });
    expect(transitions).toEqual([
      ["s1", "s2"],
      ["s2", "s3"],
    ]);
  });

  it("persists pipeline state after completion", async () => {
    const cwd = await setup();
    await runPipeline({
      name: "test",
      task: "build it",
      stages: [successStage("s1")],
      cwd,
    });
    const state = await readPipelineState(cwd);
    expect(state).not.toBeNull();
    expect(state!.active).toBe(false);
    expect(state!.current_phase).toBe("complete");
    expect(state!.completed_at).toBeTruthy();
  });

  it("persists pipeline state after failure", async () => {
    const cwd = await setup();
    await runPipeline({
      name: "test",
      task: "build it",
      stages: [failingStage("s1", "error!")],
      cwd,
    });
    const state = await readPipelineState(cwd);
    expect(state!.active).toBe(false);
    expect(state!.current_phase).toBe("failed");
    expect(state!.error).toBe("error!");
  });
});

describe("validation", () => {
  it("rejects empty name", async () => {
    const cwd = await setup();
    await expect(
      runPipeline({ name: "", task: "x", stages: [successStage("s")], cwd }),
    ).rejects.toThrow("non-empty name");
  });

  it("rejects empty task", async () => {
    const cwd = await setup();
    await expect(
      runPipeline({ name: "x", task: "", stages: [successStage("s")], cwd }),
    ).rejects.toThrow("non-empty task");
  });

  it("rejects empty stages", async () => {
    const cwd = await setup();
    await expect(
      runPipeline({ name: "x", task: "x", stages: [], cwd }),
    ).rejects.toThrow("at least one stage");
  });

  it("rejects duplicate stage names", async () => {
    const cwd = await setup();
    await expect(
      runPipeline({
        name: "x",
        task: "x",
        stages: [successStage("dup"), successStage("dup")],
        cwd,
      }),
    ).rejects.toThrow("Duplicate stage name: dup");
  });

  it("rejects non-positive workerCount", async () => {
    const cwd = await setup();
    await expect(
      runPipeline({
        name: "x",
        task: "x",
        stages: [successStage("s")],
        cwd,
        workerCount: 0,
      }),
    ).rejects.toThrow("workerCount must be a positive integer");
  });

  it("rejects non-positive maxVerifyIterations", async () => {
    const cwd = await setup();
    await expect(
      runPipeline({
        name: "x",
        task: "x",
        stages: [successStage("s")],
        cwd,
        maxVerifyIterations: -1,
      }),
    ).rejects.toThrow("maxVerifyIterations must be a positive integer");
  });
});

describe("canResumePipeline", () => {
  it("returns false when no state file", async () => {
    const cwd = await setup();
    expect(await canResumePipeline(cwd)).toBe(false);
  });

  it("returns false after completion", async () => {
    const cwd = await setup();
    await runPipeline({
      name: "test",
      task: "build it",
      stages: [successStage("s1")],
      cwd,
    });
    expect(await canResumePipeline(cwd)).toBe(false);
  });

  it("returns false after failure", async () => {
    const cwd = await setup();
    await runPipeline({
      name: "test",
      task: "build it",
      stages: [failingStage("s1", "err")],
      cwd,
    });
    expect(await canResumePipeline(cwd)).toBe(false);
  });
});

describe("cancelPipeline", () => {
  it("marks pipeline as cancelled", async () => {
    const cwd = await setup();
    await runPipeline({
      name: "test",
      task: "build it",
      stages: [successStage("s1")],
      cwd,
    });
    await cancelPipeline(cwd);
    const state = await readPipelineState(cwd);
    expect(state!.current_phase).toBe("cancelled");
    expect(state!.active).toBe(false);
  });

  it("is a no-op when no state exists", async () => {
    const cwd = await setup();
    await cancelPipeline(cwd);
    expect(await readPipelineState(cwd)).toBeNull();
  });
});

describe("createAutopilotPipelineConfig", () => {
  it("creates config with defaults", () => {
    const config = createAutopilotPipelineConfig("build the app", {
      stages: [successStage("s1")],
    });
    expect(config.name).toBe("autopilot");
    expect(config.task).toBe("build the app");
    expect(config.maxVerifyIterations).toBe(10);
    expect(config.workerCount).toBe(2);
    expect(config.agentType).toBe("executor");
  });

  it("respects overrides", () => {
    const config = createAutopilotPipelineConfig("build", {
      stages: [successStage("s1")],
      maxVerifyIterations: 5,
      workerCount: 4,
      agentType: "designer",
      cwd: "/tmp",
    });
    expect(config.maxVerifyIterations).toBe(5);
    expect(config.workerCount).toBe(4);
    expect(config.agentType).toBe("designer");
    expect(config.cwd).toBe("/tmp");
  });
});
