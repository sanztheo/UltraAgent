/**
 * Worker launch configuration — CLI-agnostic model/flag resolution.
 *
 * OMX had Codex-specific flags (--dangerously-bypass-approvals-and-sandbox, --model, -c).
 * UltraAgent abstracts these into a unified launch config that each adapter
 * translates to CLI-specific flags.
 */

export type WorkerCli = 'claude' | 'codex' | 'gemini';

export interface WorkerLaunchConfig {
  cli: WorkerCli;
  model?: string;
  bypassSecurity: boolean;
  reasoningEffort?: string;
  extraArgs: string[];
}

const LOW_COMPLEXITY_ROLES = new Set(['explore', 'explorer', 'style-reviewer', 'writer']);

export function isLowComplexityRole(role?: string): boolean {
  if (!role) return false;
  const normalized = role.trim().toLowerCase();
  if (normalized === '') return false;
  if (normalized.endsWith('-low')) return true;
  return LOW_COMPLEXITY_ROLES.has(normalized);
}

export function parseWorkerArgs(raw: string | undefined): string[] {
  if (!raw || raw.trim() === '') return [];
  return raw
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface ParsedWorkerFlags {
  passthrough: string[];
  model?: string;
  bypassSecurity: boolean;
  reasoningEffort?: string;
}

/** Parse CLI-agnostic worker launch flags from a raw args array. */
export function parseWorkerFlags(args: string[]): ParsedWorkerFlags {
  const passthrough: string[] = [];
  let model: string | undefined;
  let bypassSecurity = false;
  let reasoningEffort: string | undefined;

  const bypassFlags = new Set([
    '--dangerously-bypass-approvals-and-sandbox', // codex
    '--dangerously-skip-permissions', // claude
    '--madmax', // alias
  ]);

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;

    if (bypassFlags.has(arg)) {
      bypassSecurity = true;
      continue;
    }

    if (arg === '--model') {
      const next = args[i + 1];
      if (typeof next === 'string' && next.trim().length > 0 && !next.startsWith('-')) {
        model = next.trim();
        i += 1;
      }
      continue;
    }

    if (arg.startsWith('--model=')) {
      const value = arg.slice('--model='.length).trim();
      if (value.length > 0) model = value;
      continue;
    }

    if (arg === '--reasoning-effort' || arg === '-c') {
      const next = args[i + 1];
      if (typeof next === 'string') {
        const isReasoning = arg === '--reasoning-effort' || /^model_reasoning_effort\s*=/.test(next.trim());
        if (isReasoning) {
          reasoningEffort = arg === '--reasoning-effort' ? next.trim() : next.split('=')[1]?.trim();
          i += 1;
          continue;
        }
      }
    }

    passthrough.push(arg);
  }

  return { passthrough, model, bypassSecurity, reasoningEffort };
}

/** Build a WorkerLaunchConfig from raw args + defaults. */
export function resolveWorkerLaunchConfig(
  cli: WorkerCli,
  rawArgs?: string,
  defaults?: { model?: string },
): WorkerLaunchConfig {
  const args = parseWorkerArgs(rawArgs);
  const parsed = parseWorkerFlags(args);

  return {
    cli,
    model: parsed.model ?? defaults?.model,
    bypassSecurity: parsed.bypassSecurity,
    reasoningEffort: parsed.reasoningEffort,
    extraArgs: parsed.passthrough,
  };
}
