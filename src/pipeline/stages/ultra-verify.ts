/**
 * Ultra-verify stage — verification phase of the pipeline.
 *
 * Takes execution results from team-exec and orchestrates
 * evidence-based verification with configurable iteration count.
 */

import type { PipelineStage, StageContext, StageResult } from "../types.js";

export interface UltraVerifyStageOptions {
  maxIterations?: number;
}

export interface UltraVerifyDescriptor {
  task: string;
  maxIterations: number;
  cwd: string;
  sessionId?: string;
  executionArtifacts: Record<string, unknown>;
}

export function createUltraVerifyStage(
  options: UltraVerifyStageOptions = {},
): PipelineStage {
  const maxIterations = options.maxIterations ?? 10;

  return {
    name: "ultra-verify",

    async run(ctx: StageContext): Promise<StageResult> {
      const startTime = Date.now();

      try {
        const teamArtifacts = ctx.artifacts["team-exec"] as
          | Record<string, unknown>
          | undefined;

        const descriptor: UltraVerifyDescriptor = {
          task: ctx.task,
          maxIterations,
          cwd: ctx.cwd,
          sessionId: ctx.sessionId,
          executionArtifacts: teamArtifacts ?? {},
        };

        return {
          status: "completed",
          artifacts: {
            verifyDescriptor: descriptor,
            maxIterations,
            stage: "ultra-verify",
            instruction: buildVerifyInstruction(descriptor),
          },
          duration_ms: Date.now() - startTime,
        };
      } catch (err) {
        return {
          status: "failed",
          artifacts: {},
          duration_ms: Date.now() - startTime,
          error: `ultra-verify stage failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  };
}

export function buildVerifyInstruction(
  descriptor: UltraVerifyDescriptor,
): string {
  return `ua verify (max ${descriptor.maxIterations} iterations): ${descriptor.task.slice(0, 200)}`;
}
