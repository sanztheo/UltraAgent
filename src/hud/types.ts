export interface LoopStateForHud {
  active: boolean;
  iteration: number;
  max_iterations: number;
}

export interface RefinementStateForHud {
  active: boolean;
  reinforcement_count?: number;
}

export interface AutopilotStateForHud {
  active: boolean;
  current_phase?: string;
}

export interface TeamStateForHud {
  active: boolean;
  current_phase?: string;
  agent_count?: number;
  team_name?: string;
}

export interface HudMetrics {
  total_turns: number;
  session_turns: number;
  last_activity: string;
  session_input_tokens?: number;
  session_output_tokens?: number;
  session_total_tokens?: number;
  five_hour_limit_pct?: number;
  weekly_limit_pct?: number;
}

export interface HudNotifyState {
  last_turn_at: string;
  turn_count: number;
  last_agent_output?: string;
}

export interface SessionStateForHud {
  session_id: string;
  started_at: string;
}

export interface HudRenderContext {
  version: string | null;
  gitBranch: string | null;
  loop: LoopStateForHud | null;
  refinement: RefinementStateForHud | null;
  autopilot: AutopilotStateForHud | null;
  team: TeamStateForHud | null;
  metrics: HudMetrics | null;
  hudNotify: HudNotifyState | null;
  session: SessionStateForHud | null;
}

export type HudPreset = "minimal" | "focused" | "full";

export interface HudConfig {
  preset: HudPreset;
}

export const DEFAULT_HUD_CONFIG: HudConfig = {
  preset: "focused",
};

export interface HudFlags {
  watch: boolean;
  json: boolean;
  tmux: boolean;
  preset?: HudPreset;
}
