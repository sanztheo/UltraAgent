/**
 * Pipeline orchestrator — sequences stages and persists state.
 *
 * Adapted from OMX: replaces ModeState with simple file-based persistence
 * via writeAtomic. Sequences: ultra-plan -> team-exec -> ultra-verify.
 */

import { existsSync } from "fs";
import { readFile } from "fs/promises";
import { join } from "path";
import { writeAtomic } from "../team/state/io.js";
import type {
  PipelineConfig,
  PipelineResult,
  PipelineState,
  StageContext,
  StageResult,
} from "./types.js";

function pipelineStatePath(cwd: string): string {
  return join(cwd, ".ultraagent", "pipeline-state.json");
}

export async function runPipeline(
  config: PipelineConfig,
): Promise<PipelineResult> {
  validateConfig(config);

  const cwd = config.cwd ?? process.cwd();
  const maxVerifyIterations = config.maxVerifyIterations ?? 10;
  const workerCount = config.workerCount ?? 2;
  const agentType = config.agentType ?? "executor";
  const startTime = Date.now();

  const pipelineState: PipelineState = {
    pipeline_name: config.name,
    pipeline_stages: config.stages.map((s) => s.name),
    pipeline_stage_index: 0,
    pipeline_stage_results: {},
    pipeline_max_verify_iterations: maxVerifyIterations,
    pipeline_worker_count: workerCount,
    pipeline_agent_type: agentType,
    active: true,
    current_phase: `stage:${config.stages[0]!.name}`,
    started_at: new Date().toISOString(),
  };
  await persistState(cwd, pipelineState);

  const stageResults: Record<string, StageResult> = {};
  const artifacts: Record<string, unknown> = {};
  let previousResult: StageResult | undefined;
  let lastStageName: string | undefined;

  for (let i = 0; i < config.stages.length; i++) {
    const stage = config.stages[i]!;

    const ctx: StageContext = {
      task: config.task,
      artifacts: { ...artifacts },
      previousStageResult: previousResult,
      cwd,
      sessionId: config.sessionId,
    };

    if (lastStageName && config.onStageTransition) {
      config.onStageTransition(lastStageName, stage.name);
    }

    if (stage.canSkip?.(ctx)) {
      const skippedResult: StageResult = {
        status: "skipped",
        artifacts: {},
        duration_ms: 0,
      };
      stageResults[stage.name] = skippedResult;
      pipelineState.pipeline_stage_index = i;
      pipelineState.pipeline_stage_results = { ...stageResults };
      pipelineState.current_phase = `stage:${stage.name}:skipped`;
      await persistState(cwd, pipelineState);

      lastStageName = stage.name;
      previousResult = skippedResult;
      continue;
    }

    pipelineState.pipeline_stage_index = i;
    pipelineState.current_phase = `stage:${stage.name}`;
    await persistState(cwd, pipelineState);

    let result: StageResult;
    try {
      result = await stage.run(ctx);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      result = {
        status: "failed",
        artifacts: {},
        duration_ms: Date.now() - startTime,
        error: `Stage ${stage.name} threw: ${errorMsg}`,
      };
    }

    stageResults[stage.name] = result;
    if (result.artifacts) {
      Object.assign(artifacts, { [stage.name]: result.artifacts });
    }

    pipelineState.pipeline_stage_results = { ...stageResults };
    pipelineState.current_phase = `stage:${stage.name}:${result.status}`;
    await persistState(cwd, pipelineState);

    if (result.status === "failed") {
      pipelineState.active = false;
      pipelineState.current_phase = "failed";
      pipelineState.completed_at = new Date().toISOString();
      pipelineState.error = result.error;
      await persistState(cwd, pipelineState);

      return {
        status: "failed",
        stageResults,
        duration_ms: Date.now() - startTime,
        artifacts,
        error: result.error,
        failedStage: stage.name,
      };
    }

    lastStageName = stage.name;
    previousResult = result;
  }

  pipelineState.active = false;
  pipelineState.current_phase = "complete";
  pipelineState.completed_at = new Date().toISOString();
  await persistState(cwd, pipelineState);

  return {
    status: "completed",
    stageResults,
    duration_ms: Date.now() - startTime,
    artifacts,
  };
}

export async function canResumePipeline(cwd: string): Promise<boolean> {
  const state = await readPipelineState(cwd);
  if (!state) return false;
  return (
    state.active === true &&
    state.current_phase !== "complete" &&
    state.current_phase !== "failed"
  );
}

export async function readPipelineState(
  cwd: string,
): Promise<PipelineState | null> {
  const filePath = pipelineStatePath(cwd);
  if (!existsSync(filePath)) return null;
  try {
    const raw = await readFile(filePath, "utf-8");
    return JSON.parse(raw) as PipelineState;
  } catch {
    return null;
  }
}

export async function cancelPipeline(cwd: string): Promise<void> {
  const state = await readPipelineState(cwd);
  if (!state) return;
  state.active = false;
  state.current_phase = "cancelled";
  state.completed_at = new Date().toISOString();
  await persistState(cwd, state);
}

export function createAutopilotPipelineConfig(
  task: string,
  options: {
    cwd?: string;
    sessionId?: string;
    maxVerifyIterations?: number;
    workerCount?: number;
    agentType?: string;
    stages: PipelineConfig["stages"];
    onStageTransition?: PipelineConfig["onStageTransition"];
  },
): PipelineConfig {
  return {
    name: "autopilot",
    task,
    stages: options.stages,
    cwd: options.cwd,
    sessionId: options.sessionId,
    maxVerifyIterations: options.maxVerifyIterations ?? 10,
    workerCount: options.workerCount ?? 2,
    agentType: options.agentType ?? "executor",
    onStageTransition: options.onStageTransition,
  };
}

async function persistState(cwd: string, state: PipelineState): Promise<void> {
  await writeAtomic(pipelineStatePath(cwd), JSON.stringify(state, null, 2));
}

function validateConfig(config: PipelineConfig): void {
  if (!config.name || config.name.trim() === "") {
    throw new Error("Pipeline config requires a non-empty name");
  }
  if (!config.task || config.task.trim() === "") {
    throw new Error("Pipeline config requires a non-empty task");
  }
  if (!config.stages || config.stages.length === 0) {
    throw new Error("Pipeline config requires at least one stage");
  }

  const names = new Set<string>();
  for (const stage of config.stages) {
    if (!stage.name || stage.name.trim() === "") {
      throw new Error("Every pipeline stage must have a non-empty name");
    }
    if (names.has(stage.name)) {
      throw new Error(`Duplicate stage name: ${stage.name}`);
    }
    names.add(stage.name);
  }

  if (config.maxVerifyIterations != null) {
    if (
      !Number.isInteger(config.maxVerifyIterations) ||
      config.maxVerifyIterations <= 0
    ) {
      throw new Error("maxVerifyIterations must be a positive integer");
    }
  }

  if (config.workerCount != null) {
    if (!Number.isInteger(config.workerCount) || config.workerCount <= 0) {
      throw new Error("workerCount must be a positive integer");
    }
  }
}
