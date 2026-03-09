import { describe, expect, it } from "vitest";
import type {
  StageContext,
  StageResult,
  PipelineStage,
  PipelineConfig,
  PipelineResult,
  PipelineState,
} from "../../../src/pipeline/types.js";

describe("pipeline types", () => {
  it("StageContext has required fields", () => {
    const ctx: StageContext = {
      task: "test task",
      artifacts: {},
      cwd: "/tmp",
    };
    expect(ctx.task).toBe("test task");
    expect(ctx.artifacts).toEqual({});
    expect(ctx.cwd).toBe("/tmp");
    expect(ctx.sessionId).toBeUndefined();
    expect(ctx.previousStageResult).toBeUndefined();
  });

  it("StageResult accepts all status values", () => {
    const results: StageResult[] = [
      { status: "completed", artifacts: {}, duration_ms: 100 },
      { status: "failed", artifacts: {}, duration_ms: 50, error: "boom" },
      { status: "skipped", artifacts: {}, duration_ms: 0 },
    ];
    expect(results).toHaveLength(3);
    expect(results[0]!.status).toBe("completed");
    expect(results[1]!.error).toBe("boom");
  });

  it("PipelineStage interface is structurally correct", () => {
    const stage: PipelineStage = {
      name: "test-stage",
      async run(ctx) {
        return {
          status: "completed",
          artifacts: { result: ctx.task },
          duration_ms: 10,
        };
      },
      canSkip() {
        return false;
      },
    };
    expect(stage.name).toBe("test-stage");
    expect(typeof stage.run).toBe("function");
    expect(typeof stage.canSkip).toBe("function");
  });

  it("PipelineConfig accepts all optional fields", () => {
    const config: PipelineConfig = {
      name: "test",
      task: "build it",
      stages: [],
      cwd: "/tmp",
      sessionId: "s1",
      maxVerifyIterations: 5,
      workerCount: 3,
      agentType: "executor",
      onStageTransition: () => {},
    };
    expect(config.maxVerifyIterations).toBe(5);
  });

  it("PipelineResult accepts all status values", () => {
    const results: PipelineResult["status"][] = [
      "completed",
      "failed",
      "cancelled",
    ];
    expect(results).toHaveLength(3);
  });

  it("PipelineState has pipeline-specific fields", () => {
    const state: PipelineState = {
      pipeline_name: "autopilot",
      pipeline_stages: ["ultra-plan", "team-exec"],
      pipeline_stage_index: 0,
      pipeline_stage_results: {},
      pipeline_max_verify_iterations: 10,
      pipeline_worker_count: 2,
      pipeline_agent_type: "executor",
      active: true,
      current_phase: "stage:ultra-plan",
      started_at: new Date().toISOString(),
    };
    expect(state.pipeline_name).toBe("autopilot");
    expect(state.pipeline_stages).toHaveLength(2);
  });
});
