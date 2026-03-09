/**
 * Ultra phase contract — phase definitions and state validation.
 *
 * Renamed from OMX's "Ralph" system. Manages the high-level lifecycle:
 * starting → executing → verifying → fixing → complete/failed/cancelled
 *
 * This is distinct from team phases (team-plan, team-exec, etc.).
 * Ultra phases track the overall pipeline lifecycle, while team phases
 * track the orchestration within a team execution.
 */

export const ULTRA_PHASES = [
  "starting",
  "executing",
  "verifying",
  "fixing",
  "complete",
  "failed",
  "cancelled",
] as const;

export type UltraPhase = (typeof ULTRA_PHASES)[number];

const ULTRA_PHASE_SET = new Set<string>(ULTRA_PHASES);
const ULTRA_TERMINAL_PHASES = new Set<UltraPhase>([
  "complete",
  "failed",
  "cancelled",
]);

const LEGACY_PHASE_ALIASES: Record<string, UltraPhase> = {
  start: "starting",
  started: "starting",
  execution: "executing",
  execute: "executing",
  verify: "verifying",
  verification: "verifying",
  fix: "fixing",
  completed: "complete",
  fail: "failed",
  error: "failed",
  cancel: "cancelled",
};

export interface PhaseNormalizationResult {
  phase?: UltraPhase;
  warning?: string;
  error?: string;
}

export function normalizeUltraPhase(
  rawPhase: unknown,
): PhaseNormalizationResult {
  if (typeof rawPhase !== "string" || rawPhase.trim() === "") {
    return { error: "ultra.current_phase must be a non-empty string" };
  }

  const normalized = rawPhase.trim().toLowerCase();
  if (ULTRA_PHASE_SET.has(normalized)) {
    return { phase: normalized as UltraPhase };
  }

  const alias = LEGACY_PHASE_ALIASES[normalized];
  if (alias) {
    return {
      phase: alias,
      warning: `normalized legacy phase "${rawPhase}" -> "${alias}"`,
    };
  }

  return {
    error: `ultra.current_phase must be one of: ${ULTRA_PHASES.join(", ")}`,
  };
}

export function isTerminalUltraPhase(phase: UltraPhase): boolean {
  return ULTRA_TERMINAL_PHASES.has(phase);
}

export interface UltraStateValidationResult {
  ok: boolean;
  state?: Record<string, unknown>;
  warning?: string;
  error?: string;
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || value.trim() === "") return false;
  return Number.isFinite(Date.parse(value));
}

export function validateAndNormalizeUltraState(
  candidate: Record<string, unknown>,
  options?: { nowIso?: string },
): UltraStateValidationResult {
  const nowIso = options?.nowIso ?? new Date().toISOString();
  const next: Record<string, unknown> = { ...candidate };
  let warning: string | undefined;

  if (next.current_phase != null) {
    const phase = normalizeUltraPhase(next.current_phase);
    if (phase.error) return { ok: false, error: phase.error };
    next.current_phase = phase.phase;
    if (phase.warning) warning = phase.warning;
  }

  if (next.active === true) {
    if (next.iteration == null) next.iteration = 0;
    if (next.max_iterations == null) next.max_iterations = 50;
    if (next.current_phase == null) next.current_phase = "starting";
    if (next.started_at == null) next.started_at = nowIso;
  }

  if (next.iteration != null) {
    const value = asFiniteNumber(next.iteration);
    if (value === null || !Number.isInteger(value) || value < 0) {
      return {
        ok: false,
        error: "ultra.iteration must be a finite integer >= 0",
      };
    }
  }

  if (next.max_iterations != null) {
    const value = asFiniteNumber(next.max_iterations);
    if (value === null || !Number.isInteger(value) || value <= 0) {
      return {
        ok: false,
        error: "ultra.max_iterations must be a finite integer > 0",
      };
    }
  }

  if (
    typeof next.current_phase === "string" &&
    ULTRA_TERMINAL_PHASES.has(next.current_phase as UltraPhase)
  ) {
    if (next.active === true) {
      return {
        ok: false,
        error: "terminal ultra phases require active=false",
      };
    }
    if (next.completed_at == null) {
      next.completed_at = nowIso;
    }
  }

  if (next.started_at != null && !isIsoTimestamp(next.started_at)) {
    return {
      ok: false,
      error: "ultra.started_at must be an ISO8601 timestamp",
    };
  }
  if (next.completed_at != null && !isIsoTimestamp(next.completed_at)) {
    return {
      ok: false,
      error: "ultra.completed_at must be an ISO8601 timestamp",
    };
  }

  return { ok: true, state: next, warning };
}
