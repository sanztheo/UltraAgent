/**
 * Team orchestration — phase state machine and context generation.
 *
 * Defines the 5-phase pipeline: plan → prd → exec → verify → fix (loop)
 * with terminal states: complete, failed, cancelled.
 *
 * Adapted from OMX: CLI-agnostic, uses UltraAgent types.
 */

export type TeamPhase =
  | "team-plan"
  | "team-prd"
  | "team-exec"
  | "team-verify"
  | "team-fix";

export type TerminalPhase = "complete" | "failed" | "cancelled";

export interface TeamPhaseState {
  current_phase: TeamPhase | TerminalPhase;
  max_fix_attempts: number;
  current_fix_attempt: number;
  transitions: Array<{
    from: string;
    to: string;
    at: string;
    reason?: string;
  }>;
  updated_at: string;
}

export interface TeamOrchestratorState {
  active: boolean;
  phase: TeamPhase | TerminalPhase;
  task_description: string;
  created_at: string;
  phase_transitions: Array<{
    from: string;
    to: string;
    at: string;
    reason?: string;
  }>;
  max_fix_attempts: number;
  current_fix_attempt: number;
}

const TERMINAL_PHASES: readonly TerminalPhase[] = [
  "complete",
  "failed",
  "cancelled",
];

const FIX_LOOP_EXCEEDED_REASON = "team-fix loop limit reached";

const TRANSITIONS: Record<TeamPhase, Array<TeamPhase | TerminalPhase>> = {
  "team-plan": ["team-prd"],
  "team-prd": ["team-exec"],
  "team-exec": ["team-verify"],
  "team-verify": ["team-fix", "complete", "failed"],
  "team-fix": ["team-exec", "team-verify", "complete", "failed"],
};

export function isValidTransition(
  from: TeamPhase,
  to: TeamPhase | TerminalPhase,
): boolean {
  const allowed = TRANSITIONS[from];
  return allowed ? allowed.includes(to) : false;
}

export function isTerminalPhase(
  phase: TeamPhase | TerminalPhase,
): phase is TerminalPhase {
  return TERMINAL_PHASES.includes(phase as TerminalPhase);
}

export function canResumeState(state: TeamOrchestratorState): boolean {
  return state.active && !isTerminalPhase(state.phase);
}

export function createOrchestratorState(
  taskDescription: string,
  maxFixAttempts: number = 3,
): TeamOrchestratorState {
  return {
    active: true,
    phase: "team-plan",
    task_description: taskDescription,
    created_at: new Date().toISOString(),
    phase_transitions: [],
    max_fix_attempts: maxFixAttempts,
    current_fix_attempt: 0,
  };
}

export function transitionPhase(
  state: TeamOrchestratorState,
  to: TeamPhase | TerminalPhase,
  reason?: string,
): TeamOrchestratorState {
  const from = state.phase;

  if (isTerminalPhase(from)) {
    throw new Error(`Cannot transition from terminal phase: ${from}`);
  }

  if (!isValidTransition(from, to)) {
    throw new Error(`Invalid transition: ${from} -> ${to}`);
  }

  const nextFixAttempt =
    to === "team-fix"
      ? state.current_fix_attempt + 1
      : state.current_fix_attempt;

  // Fix loop exceeded → force fail
  if (to === "team-fix" && nextFixAttempt > state.max_fix_attempts) {
    return {
      ...state,
      phase: "failed",
      active: false,
      phase_transitions: [
        ...state.phase_transitions,
        {
          from,
          to: "failed",
          at: new Date().toISOString(),
          reason: `${FIX_LOOP_EXCEEDED_REASON} (${state.max_fix_attempts})`,
        },
      ],
    };
  }

  return {
    ...state,
    phase: to,
    active: !isTerminalPhase(to),
    current_fix_attempt: nextFixAttempt,
    phase_transitions: [
      ...state.phase_transitions,
      { from, to, at: new Date().toISOString(), reason },
    ],
  };
}

export function getPhaseAgents(phase: TeamPhase): string[] {
  switch (phase) {
    case "team-plan":
      return ["analyst", "planner"];
    case "team-prd":
      return ["product-manager", "analyst"];
    case "team-exec":
      return ["executor", "designer", "test-engineer"];
    case "team-verify":
      return ["verifier", "quality-reviewer", "security-reviewer"];
    case "team-fix":
      return ["executor", "build-fixer", "debugger"];
    default: {
      const _exhaustive: never = phase;
      throw new Error(`Unknown team phase: ${_exhaustive}`);
    }
  }
}

export function getPhaseInstructions(phase: TeamPhase): string {
  switch (phase) {
    case "team-plan":
      return "PHASE: Planning. Use /analyst for requirements, /planner for task breakdown. Output: task list with dependencies.";
    case "team-prd":
      return "PHASE: Requirements. Use /product-manager for PRD, /analyst for acceptance criteria. Output: explicit scope and success metrics.";
    case "team-exec":
      return "PHASE: Execution. Use /executor for implementation, /test-engineer for tests. Output: working code with tests.";
    case "team-verify":
      return "PHASE: Verification. Use /verifier for evidence collection, /quality-reviewer for review. Output: pass/fail with evidence.";
    case "team-fix":
      return "PHASE: Fixing. Use /debugger for root cause, /executor for fixes. Output: fixed code, re-verify needed.";
    default: {
      const _exhaustive: never = phase;
      throw new Error(`Unknown team phase: ${_exhaustive}`);
    }
  }
}
