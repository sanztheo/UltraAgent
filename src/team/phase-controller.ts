/**
 * Phase controller — infers target phase from task counts
 * and reconciles persisted phase state with actual reality.
 *
 * Used by the runtime monitor to keep phase state consistent
 * with what tasks are actually doing.
 */

import {
  createOrchestratorState,
  isTerminalPhase,
  transitionPhase,
  type TeamOrchestratorState,
  type TeamPhase,
  type TeamPhaseState,
  type TerminalPhase,
} from "./orchestrator.js";

export interface TaskCounts {
  pending: number;
  blocked: number;
  in_progress: number;
  failed: number;
}

export function inferPhaseTargetFromTaskCounts(
  taskCounts: TaskCounts,
  options: { verificationPending?: boolean } = {},
): TeamPhase | TerminalPhase {
  const allTerminal =
    taskCounts.pending === 0 &&
    taskCounts.blocked === 0 &&
    taskCounts.in_progress === 0;

  if (allTerminal && taskCounts.failed === 0) {
    if (options.verificationPending) return "team-verify";
    return "complete";
  }
  if (allTerminal && taskCounts.failed > 0) return "team-fix";
  return "team-exec";
}

function defaultPhaseState(): TeamPhaseState {
  return {
    current_phase: "team-exec",
    max_fix_attempts: 3,
    current_fix_attempt: 0,
    transitions: [],
    updated_at: new Date().toISOString(),
  };
}

function toOrchestratorState(
  phaseState: TeamPhaseState,
): TeamOrchestratorState {
  const state = createOrchestratorState(
    "team-runtime-monitor",
    phaseState.max_fix_attempts,
  );
  return {
    ...state,
    active: !isTerminalPhase(phaseState.current_phase),
    phase: phaseState.current_phase,
    current_fix_attempt: phaseState.current_fix_attempt,
    phase_transitions: [...phaseState.transitions],
  };
}

function toPhaseState(state: TeamOrchestratorState): TeamPhaseState {
  return {
    current_phase: state.phase,
    max_fix_attempts: state.max_fix_attempts,
    current_fix_attempt: state.current_fix_attempt,
    transitions: [...state.phase_transitions],
    updated_at: new Date().toISOString(),
  };
}

function buildTransitionPath(
  from: TeamPhase | TerminalPhase,
  to: TeamPhase | TerminalPhase,
): Array<TeamPhase | TerminalPhase> {
  if (from === to) return [];

  const paths: Record<
    string,
    Record<string, Array<TeamPhase | TerminalPhase>>
  > = {
    "team-verify": {
      "team-plan": ["team-prd", "team-exec", "team-verify"],
      "team-prd": ["team-exec", "team-verify"],
      "team-exec": ["team-verify"],
      "team-fix": ["team-exec", "team-verify"],
    },
    "team-exec": {
      "team-plan": ["team-prd", "team-exec"],
      "team-prd": ["team-exec"],
      "team-fix": ["team-exec"],
    },
    "team-fix": {
      "team-plan": ["team-prd", "team-exec", "team-verify", "team-fix"],
      "team-prd": ["team-exec", "team-verify", "team-fix"],
      "team-exec": ["team-verify", "team-fix"],
      "team-verify": ["team-fix"],
    },
    complete: {
      "team-plan": ["team-prd", "team-exec", "team-verify", "complete"],
      "team-prd": ["team-exec", "team-verify", "complete"],
      "team-exec": ["team-verify", "complete"],
      "team-verify": ["complete"],
      "team-fix": ["complete"],
    },
    failed: {
      "team-plan": ["team-prd", "team-exec", "team-verify", "failed"],
      "team-prd": ["team-exec", "team-verify", "failed"],
      "team-exec": ["team-verify", "failed"],
      "team-verify": ["failed"],
      "team-fix": ["failed"],
    },
  };

  return paths[to]?.[from] ?? [];
}

export function reconcilePhaseStateForMonitor(
  persisted: TeamPhaseState | null,
  target: TeamPhase | TerminalPhase,
): TeamPhaseState {
  const now = new Date().toISOString();
  const base = persisted ?? defaultPhaseState();

  if (base.current_phase === target) {
    return { ...base, updated_at: now };
  }

  // Terminal → non-terminal: tasks were reopened
  if (isTerminalPhase(base.current_phase)) {
    if (isTerminalPhase(target)) return base;
    return {
      current_phase: target,
      max_fix_attempts: base.max_fix_attempts,
      current_fix_attempt: 0,
      transitions: [
        ...base.transitions,
        {
          from: base.current_phase,
          to: target,
          at: now,
          reason: "tasks_reopened",
        },
      ],
      updated_at: now,
    };
  }

  // Walk the transition path
  let state = toOrchestratorState(base);
  const path = buildTransitionPath(state.phase, target);
  for (const next of path) {
    if (state.phase === next) continue;
    if (isTerminalPhase(state.phase)) break;
    state = transitionPhase(state, next);
  }

  return toPhaseState(state);
}
