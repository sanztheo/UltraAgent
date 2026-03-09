/**
 * Team execution stage — wraps the team runtime into a pipeline stage.
 *
 * Delegates to the UltraAgent team infrastructure which starts CLI
 * workers in tmux panes.
 */

import type { PipelineStage, StageContext, StageResult } from "../types.js";

export interface TeamExecStageOptions {
  workerCount?: number;
  agentType?: string;
  useWorktrees?: boolean;
  extraEnv?: Record<string, string>;
}

export interface TeamExecDescriptor {
  task: string;
  workerCount: number;
  agentType: string;
  useWorktrees: boolean;
  cwd: string;
  extraEnv?: Record<string, string>;
}

export function createTeamExecStage(
  options: TeamExecStageOptions = {},
): PipelineStage {
  const workerCount = options.workerCount ?? 2;
  const agentType = options.agentType ?? "executor";

  return {
    name: "team-exec",

    async run(ctx: StageContext): Promise<StageResult> {
      const startTime = Date.now();

      try {
        const planArtifacts = ctx.artifacts["ultra-plan"] as
          | Record<string, unknown>
          | undefined;
        const planContext = planArtifacts
          ? `Plan from ultra-plan stage:\n${JSON.stringify(planArtifacts, null, 2)}\n\nTask: ${ctx.task}`
          : ctx.task;

        const descriptor: TeamExecDescriptor = {
          task: planContext,
          workerCount,
          agentType,
          useWorktrees: options.useWorktrees ?? false,
          cwd: ctx.cwd,
          extraEnv: options.extraEnv,
        };

        return {
          status: "completed",
          artifacts: {
            teamDescriptor: descriptor,
            workerCount,
            agentType,
            stage: "team-exec",
            instruction: buildTeamInstruction(descriptor),
          },
          duration_ms: Date.now() - startTime,
        };
      } catch (err) {
        return {
          status: "failed",
          artifacts: {},
          duration_ms: Date.now() - startTime,
          error: `team-exec stage failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  };
}

export function buildTeamInstruction(descriptor: TeamExecDescriptor): string {
  return `ua team ${descriptor.workerCount}:${descriptor.agentType} ${JSON.stringify(descriptor.task.slice(0, 500))}`;
}
