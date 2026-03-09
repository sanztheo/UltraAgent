/**
 * Pipeline stage interfaces for UltraAgent.
 *
 * The pipeline sequences: ultra-plan -> team-exec -> ultra-verify.
 */

export interface StageContext {
  task: string;
  artifacts: Record<string, unknown>;
  previousStageResult?: StageResult;
  cwd: string;
  sessionId?: string;
}

export interface StageResult {
  status: "completed" | "failed" | "skipped";
  artifacts: Record<string, unknown>;
  duration_ms: number;
  error?: string;
}

export interface PipelineStage {
  readonly name: string;
  run(ctx: StageContext): Promise<StageResult>;
  canSkip?(ctx: StageContext): boolean;
}

export interface PipelineConfig {
  name: string;
  task: string;
  stages: PipelineStage[];
  cwd?: string;
  sessionId?: string;
  maxVerifyIterations?: number;
  workerCount?: number;
  agentType?: string;
  onStageTransition?: (from: string, to: string) => void;
}

export interface PipelineResult {
  status: "completed" | "failed" | "cancelled";
  stageResults: Record<string, StageResult>;
  duration_ms: number;
  artifacts: Record<string, unknown>;
  error?: string;
  failedStage?: string;
}

export interface PipelineState {
  pipeline_name: string;
  pipeline_stages: string[];
  pipeline_stage_index: number;
  pipeline_stage_results: Record<string, StageResult>;
  pipeline_max_verify_iterations: number;
  pipeline_worker_count: number;
  pipeline_agent_type: string;
  active: boolean;
  current_phase: string;
  started_at: string;
  completed_at?: string;
  error?: string;
}
