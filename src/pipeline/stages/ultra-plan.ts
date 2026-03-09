/**
 * Ultra-plan stage — consensus planning.
 *
 * Discovers or produces a plan artifact at `.ultraagent/plans/`.
 * Structural adapter: actual agent orchestration happens at the skill layer.
 */

import { existsSync, readdirSync } from "fs";
import { readdir } from "fs/promises";
import { join } from "path";
import type { PipelineStage, StageContext, StageResult } from "../types.js";

const PLAN_PREFIX = "plan-";
const PLAN_SUFFIX = ".md";

export function createUltraPlanStage(): PipelineStage {
  return {
    name: "ultra-plan",

    canSkip(ctx: StageContext): boolean {
      const plansDir = join(ctx.cwd, ".ultraagent", "plans");
      if (!existsSync(plansDir)) return false;
      try {
        const files = readdirSync(plansDir) as string[];
        return files.some(
          (f: string) => f.startsWith(PLAN_PREFIX) && f.endsWith(PLAN_SUFFIX),
        );
      } catch {
        return false;
      }
    },

    async run(ctx: StageContext): Promise<StageResult> {
      const startTime = Date.now();
      const plansDir = join(ctx.cwd, ".ultraagent", "plans");

      try {
        const existingPlans = await discoverPlanFiles(plansDir);

        return {
          status: "completed",
          artifacts: {
            plansDir,
            task: ctx.task,
            existingPlans,
            stage: "ultra-plan",
            instruction: `Run consensus planning for: ${ctx.task}`,
          },
          duration_ms: Date.now() - startTime,
        };
      } catch (err) {
        return {
          status: "failed",
          artifacts: {},
          duration_ms: Date.now() - startTime,
          error: `ultra-plan stage failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  };
}

async function discoverPlanFiles(plansDir: string): Promise<string[]> {
  if (!existsSync(plansDir)) return [];
  try {
    const files = await readdir(plansDir);
    return files.filter((f) => f.endsWith(".md")).map((f) => join(plansDir, f));
  } catch {
    return [];
  }
}
