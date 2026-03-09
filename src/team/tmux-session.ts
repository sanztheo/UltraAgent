/**
 * Team-specific tmux session management.
 *
 * Builds on src/tmux/commands.ts primitives to provide:
 * - Multi-pane team layout (leader left, workers stacked right)
 * - CLI-agnostic worker launch (claude/codex/gemini)
 * - Robust message delivery to worker panes
 * - Worker readiness detection and teardown
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import type { WorkerCli } from "./model-contract.js";
import { execCommand } from "../utils/shell.js";
import { sleep } from "../utils/process.js";

export interface TeamSession {
  name: string;
  workerCount: number;
  cwd: string;
  workerPaneIds: string[];
  leaderPaneId: string;
  hudPaneId: string | null;
}

export interface WorkerProcessLaunchSpec {
  workerCli: WorkerCli;
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface PaneTeardownSummary {
  attemptedPaneIds: string[];
  excluded: { leader: number; hud: number; invalid: number };
  kill: { attempted: number; succeeded: number; failed: number };
}

export interface PaneTeardownOptions {
  leaderPaneId?: string | null;
  hudPaneId?: string | null;
  graceMs?: number;
}

function runTmux(
  args: string[],
): { ok: true; stdout: string } | { ok: false; stderr: string } {
  const result = spawnSync("tmux", args, { encoding: "utf-8" });
  if (result.error) {
    return { ok: false, stderr: result.error.message };
  }
  if (result.status !== 0) {
    return {
      ok: false,
      stderr: (result.stderr || "").trim() || `tmux exited ${result.status}`,
    };
  }
  return { ok: true, stdout: (result.stdout || "").trim() };
}

async function runTmuxAsync(
  args: string[],
): Promise<{ ok: true; stdout: string } | { ok: false; stderr: string }> {
  const result = await execCommand("tmux", args);
  if (result.exitCode !== 0) {
    return { ok: false, stderr: result.stderr.trim() || "tmux command failed" };
  }
  return { ok: true, stdout: result.stdout.trim() };
}

async function sendKeyAsync(target: string, key: string): Promise<void> {
  const result = await runTmuxAsync(["send-keys", "-t", target, key]);
  if (!result.ok) {
    throw new Error(`sendKeyAsync: failed to send ${key}: ${result.stderr}`);
  }
}

async function capturePaneAsync(target: string): Promise<string> {
  const result = await runTmuxAsync([
    "capture-pane",
    "-t",
    target,
    "-p",
    "-S",
    "-80",
  ]);
  if (!result.ok) return "";
  return result.stdout;
}

export function isTmuxAvailable(): boolean {
  const result = spawnSync("tmux", ["-V"], { encoding: "utf-8" });
  if (result.error) return false;
  return result.status === 0;
}

export function isWsl2(): boolean {
  if (process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP) {
    return true;
  }
  try {
    const version = readFileSync("/proc/version", "utf-8");
    return /microsoft/i.test(version);
  } catch {
    return false;
  }
}

export function isNativeWindows(): boolean {
  return process.platform === "win32" && !isWsl2();
}

export function sanitizeTeamName(name: string): string {
  const replaced = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-/, "")
    .replace(/-$/, "");

  const truncated = replaced.slice(0, 30).replace(/-$/, "");
  if (truncated.trim() === "") {
    throw new Error("sanitizeTeamName: empty after sanitization");
  }
  return truncated;
}

function paneTarget(
  sessionName: string,
  workerIndex: number,
  workerPaneId?: string,
): string {
  if (workerPaneId && workerPaneId.startsWith("%")) return workerPaneId;
  if (sessionName.includes(":")) {
    return `${sessionName}.${workerIndex}`;
  }
  return `${sessionName}:${workerIndex}`;
}

function shellQuoteSingle(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function paneLooksReady(captured: string): boolean {
  const content = captured.trimEnd();
  if (content === "") return false;

  const lines = content
    .split("\n")
    .map((l) => l.replace(/\r/g, ""))
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() !== "");

  if (paneIsBootstrapping(lines)) return false;

  const lastLine = lines.length > 0 ? (lines[lines.length - 1] ?? "") : "";
  if (/^\s*[›>❯]\s*/u.test(lastLine)) return true;

  const hasCodexPromptLine = lines.some((line) => /^\s*›\s*/u.test(line));
  const hasClaudePromptLine = lines.some((line) => /^\s*❯\s*/u.test(line));
  if (hasCodexPromptLine || hasClaudePromptLine) return true;

  return false;
}

export function paneIsBootstrapping(lines: string[]): boolean {
  return lines.some(
    (line) =>
      /\b(loading|initializing|starting up)\b/i.test(line) ||
      /\bmodel:\s*loading\b/i.test(line) ||
      /\bconnecting\s+to\b/i.test(line),
  );
}

export function paneHasActiveTask(captured: string): boolean {
  const lines = captured
    .split("\n")
    .map((line) => line.replace(/\r/g, "").trim())
    .filter((line) => line.length > 0);

  const tail = lines.slice(-40);
  if (tail.some((line) => /esc to interrupt/i.test(line))) return true;
  if (tail.some((line) => /\bbackground terminal running\b/i.test(line)))
    return true;
  if (
    tail.some((line) =>
      /^[·✻]\s+[A-Za-z][A-Za-z0-9''-]*(?:\s+[A-Za-z][A-Za-z0-9''-]*){0,3}(?:…|\.{3})$/u.test(
        line,
      ),
    )
  )
    return true;
  return false;
}

export function normalizeTmuxCapture(value: string): string {
  return value.replace(/\r/g, "").replace(/\s+/g, " ").trim();
}

export function resolveWorkerCli(
  launchArgs: string[] = [],
  env: NodeJS.ProcessEnv = process.env,
): WorkerCli {
  const raw = String(env.ULTRA_TEAM_WORKER_CLI ?? "auto")
    .trim()
    .toLowerCase();
  if (raw === "claude" || raw === "codex" || raw === "gemini") return raw;

  const model = extractModelOverride(launchArgs);
  if (model && /claude/i.test(model)) return "claude";
  if (model && /gemini/i.test(model)) return "gemini";
  return "claude";
}

export function resolveWorkerCliPlan(
  workerCount: number,
  launchArgs: string[] = [],
  env: NodeJS.ProcessEnv = process.env,
): WorkerCli[] {
  if (!Number.isInteger(workerCount) || workerCount < 1) {
    throw new Error(`workerCount must be >= 1 (got ${workerCount})`);
  }

  const rawMap = String(env.ULTRA_TEAM_WORKER_CLI_MAP ?? "").trim();
  if (rawMap === "") {
    const cli = resolveWorkerCli(launchArgs, env);
    return Array.from({ length: workerCount }, () => cli);
  }

  const entries = rawMap.split(",").map((part) => part.trim());
  if (entries.length === 0 || entries.every((part) => part.length === 0)) {
    throw new Error(
      `Invalid ULTRA_TEAM_WORKER_CLI_MAP value "${rawMap}". ` +
        `Expected comma-separated values: auto|codex|claude|gemini.`,
    );
  }

  if (entries.length !== 1 && entries.length !== workerCount) {
    throw new Error(
      `Invalid ULTRA_TEAM_WORKER_CLI_MAP length ${entries.length}; ` +
        `expected 1 or ${workerCount} comma-separated values.`,
    );
  }

  const expanded =
    entries.length === 1
      ? Array.from({ length: workerCount }, () => entries[0] as string)
      : entries;

  return expanded.map((entry) => {
    const normalized = entry.trim().toLowerCase();
    if (
      normalized === "claude" ||
      normalized === "codex" ||
      normalized === "gemini"
    )
      return normalized;
    return resolveWorkerCli(launchArgs, env);
  });
}

function extractModelOverride(args: string[]): string | null {
  let model: string | null = null;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--model") {
      const maybeValue = args[i + 1];
      if (
        typeof maybeValue === "string" &&
        maybeValue.trim() !== "" &&
        !maybeValue.startsWith("-")
      ) {
        model = maybeValue.trim();
        i += 1;
      }
      continue;
    }
    if (arg?.startsWith("--model=")) {
      const inline = arg.slice("--model=".length).trim();
      if (inline !== "") model = inline;
    }
  }
  return model;
}

function translateWorkerLaunchArgsForCli(
  workerCli: WorkerCli,
  args: string[],
): string[] {
  if (workerCli === "codex") return [...args];
  if (workerCli === "gemini") {
    const model = extractModelOverride(args);
    const geminiModel = model && /gemini/i.test(model) ? model : null;
    const translated = ["--approval-mode", "yolo"];
    if (geminiModel) translated.push("--model", geminiModel);
    return translated;
  }
  return ["--dangerously-skip-permissions"];
}

function resolveAbsoluteBinaryPath(binary: string): string {
  const finder = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(finder, [binary], {
    encoding: "utf-8",
    timeout: 5000,
  });
  if (result.status === 0 && result.stdout.trim()) {
    return result.stdout.trim().split("\n")[0] ?? binary;
  }
  return binary;
}

export function buildWorkerProcessLaunchSpec(
  workerIndex: number,
  launchArgs: string[] = [],
  extraEnv: Record<string, string> = {},
  workerCliOverride?: WorkerCli,
): WorkerProcessLaunchSpec {
  const workerCli =
    workerCliOverride ?? resolveWorkerCli(launchArgs, process.env);
  const cliLaunchArgs = translateWorkerLaunchArgsForCli(workerCli, launchArgs);
  const resolvedCliPath = resolveAbsoluteBinaryPath(workerCli);

  const workerEnv: Record<string, string> = {
    ULTRA_TEAM_WORKER_INDEX: String(workerIndex),
  };
  for (const [key, value] of Object.entries(extraEnv)) {
    if (typeof value !== "string" || value.trim() === "") continue;
    workerEnv[key] = value;
  }

  return {
    workerCli,
    command: resolvedCliPath,
    args: cliLaunchArgs,
    env: workerEnv,
  };
}

export function buildWorkerStartupCommand(
  workerIndex: number,
  launchArgs: string[] = [],
  cwd: string = process.cwd(),
  extraEnv: Record<string, string> = {},
  workerCliOverride?: WorkerCli,
): string {
  const spec = buildWorkerProcessLaunchSpec(
    workerIndex,
    launchArgs,
    extraEnv,
    workerCliOverride,
  );
  void cwd;

  const quotedArgs = spec.args.map(shellQuoteSingle).join(" ");
  const cliInvocation =
    quotedArgs.length > 0
      ? `exec ${spec.command} ${quotedArgs}`
      : `exec ${spec.command}`;
  const envParts = Object.entries(spec.env).map(
    ([key, value]) => `${key}=${shellQuoteSingle(value)}`,
  );
  const envStr = envParts.length > 0 ? `env ${envParts.join(" ")} ` : "";

  return `${envStr}${cliInvocation}`;
}

export function createTeamSession(
  workerCount: number,
  cwd: string,
  workerLaunchArgs: string[] = [],
  workerStartups: Array<{
    cwd?: string;
    env?: Record<string, string>;
    launchArgs?: string[];
    workerCli?: WorkerCli;
  }> = [],
): TeamSession {
  if (!isTmuxAvailable()) {
    throw new Error("tmux is not available");
  }
  if (!Number.isInteger(workerCount) || workerCount < 1) {
    throw new Error(`workerCount must be >= 1 (got ${workerCount})`);
  }
  if (!process.env.TMUX) {
    throw new Error("team mode requires running inside tmux leader pane");
  }

  const defaultCliPlan = resolveWorkerCliPlan(
    workerCount,
    workerLaunchArgs,
    process.env,
  );
  const workerCliPlan =
    workerStartups.length > 0
      ? workerStartups.map(
          (startup, index) => startup.workerCli ?? defaultCliPlan[index]!,
        )
      : defaultCliPlan;

  const rollbackPaneIds: string[] = [];
  try {
    const tmuxPaneTarget = process.env.TMUX_PANE;
    const displayArgs = tmuxPaneTarget
      ? ["display-message", "-p", "-t", tmuxPaneTarget, "#S:#I #{pane_id}"]
      : ["display-message", "-p", "#S:#I #{pane_id}"];
    const context = runTmux(displayArgs);
    if (!context.ok) {
      throw new Error(
        `failed to detect current tmux target: ${context.stderr}`,
      );
    }
    const [sessionAndWindow = "", detectedLeaderPaneId = ""] =
      context.stdout.split(" ");
    const [sessionName, windowIndex] = (sessionAndWindow || "").split(":");
    if (
      !sessionName ||
      !windowIndex ||
      !detectedLeaderPaneId ||
      !detectedLeaderPaneId.startsWith("%")
    ) {
      throw new Error(`failed to parse current tmux target: ${context.stdout}`);
    }
    const teamTarget = `${sessionName}:${windowIndex}`;
    const leaderPaneId = detectedLeaderPaneId;

    const workerPaneIds: string[] = [];
    let rightStackRootPaneId: string | null = null;
    for (let i = 1; i <= workerCount; i++) {
      const startup = workerStartups[i - 1] || {};
      const workerCwd = startup.cwd || cwd;
      const workerEnv = startup.env || {};
      const launchArgsForWorker = startup.launchArgs || workerLaunchArgs;
      const cmd = buildWorkerStartupCommand(
        i,
        launchArgsForWorker,
        workerCwd,
        workerEnv,
        workerCliPlan[i - 1],
      );

      const splitDirection = i === 1 ? "-h" : "-v";
      const splitTarget =
        i === 1 ? leaderPaneId : (rightStackRootPaneId ?? leaderPaneId);
      const split = runTmux([
        "split-window",
        splitDirection,
        "-t",
        splitTarget,
        "-d",
        "-P",
        "-F",
        "#{pane_id}",
        "-c",
        workerCwd,
        cmd,
      ]);
      if (!split.ok) {
        throw new Error(`failed to create worker pane ${i}: ${split.stderr}`);
      }
      const paneId = split.stdout.split("\n")[0]?.trim();
      if (!paneId || !paneId.startsWith("%")) {
        throw new Error(`failed to capture worker pane id for worker ${i}`);
      }
      workerPaneIds.push(paneId);
      rollbackPaneIds.push(paneId);
      if (i === 1) rightStackRootPaneId = paneId;
    }

    runTmux(["select-layout", "-t", teamTarget, "main-vertical"]);

    const windowWidthResult = runTmux([
      "display-message",
      "-p",
      "-t",
      teamTarget,
      "#{window_width}",
    ]);
    if (windowWidthResult.ok) {
      const width = Number.parseInt(
        windowWidthResult.stdout.split("\n")[0]?.trim() || "",
        10,
      );
      if (Number.isFinite(width) && width >= 40) {
        const half = String(Math.floor(width / 2));
        runTmux([
          "set-window-option",
          "-t",
          teamTarget,
          "main-pane-width",
          half,
        ]);
        runTmux(["select-layout", "-t", teamTarget, "main-vertical"]);
      }
    }

    runTmux(["select-pane", "-t", leaderPaneId]);

    if (process.env.ULTRA_TEAM_MOUSE !== "0") {
      enableMouseScrolling(sessionName);
    }

    return {
      name: teamTarget,
      workerCount,
      cwd,
      workerPaneIds,
      leaderPaneId,
      hudPaneId: null,
    };
  } catch (error) {
    for (const paneId of rollbackPaneIds) {
      runTmux(["kill-pane", "-t", paneId]);
    }
    throw error;
  }
}

export function enableMouseScrolling(sessionTarget: string): boolean {
  const result = runTmux(["set-option", "-t", sessionTarget, "mouse", "on"]);
  if (!result.ok) return false;
  runTmux(["set-option", "-t", sessionTarget, "set-clipboard", "on"]);
  return true;
}

export function waitForWorkerReady(
  sessionName: string,
  workerIndex: number,
  timeoutMs: number = 15000,
  workerPaneId?: string,
): boolean {
  const initialBackoffMs = 300;
  const maxBackoffMs = 8000;
  const startedAt = Date.now();

  const check = (): boolean => {
    const result = runTmux([
      "capture-pane",
      "-t",
      paneTarget(sessionName, workerIndex, workerPaneId),
      "-p",
    ]);
    if (!result.ok) return false;
    return paneLooksReady(result.stdout);
  };

  let delayMs = initialBackoffMs;
  while (Date.now() - startedAt < timeoutMs) {
    if (check()) return true;
    const remaining = timeoutMs - (Date.now() - startedAt);
    if (remaining <= 0) break;
    const sleepMs = Math.max(0, Math.min(delayMs, remaining));
    spawnSync("sleep", [String(sleepMs / 1000)]);
    delayMs = Math.min(maxBackoffMs, delayMs * 2);
  }

  return false;
}

export async function sendToWorker(
  sessionName: string,
  workerIndex: number,
  text: string,
  workerPaneId?: string,
): Promise<void> {
  if (text.length >= 200) {
    throw new Error("sendToWorker: text must be < 200 characters");
  }
  if (text.trim().length === 0) {
    throw new Error("sendToWorker: text must be non-empty");
  }

  const target = paneTarget(sessionName, workerIndex, workerPaneId);

  const send = runTmux(["send-keys", "-t", target, "-l", "--", text]);
  if (!send.ok) {
    throw new Error(`sendToWorker: failed to send text: ${send.stderr}`);
  }

  await sleep(150);

  for (let round = 0; round < 4; round++) {
    await sleep(100);
    await sendKeyAsync(target, "C-m");
    await sleep(140);
    const captured = await capturePaneAsync(target);
    if (!normalizeTmuxCapture(captured).includes(normalizeTmuxCapture(text))) {
      return;
    }
    await sleep(140);
  }

  await sendKeyAsync(target, "C-m");
  await sleep(120);
  await sendKeyAsync(target, "C-m");
}

export function isWorkerAlive(
  sessionName: string,
  workerIndex: number,
  workerPaneId?: string,
): boolean {
  const result = runTmux([
    "list-panes",
    "-t",
    paneTarget(sessionName, workerIndex, workerPaneId),
    "-F",
    "#{pane_dead} #{pane_pid}",
  ]);
  if (!result.ok) return false;

  const line = result.stdout.split("\n")[0]?.trim();
  if (!line) return false;

  const parts = line.split(/\s+/);
  if (parts.length < 2) return false;

  const paneDead = parts[0];
  const pid = Number.parseInt(parts[1] ?? "", 10);

  if (paneDead === "1") return false;
  if (!Number.isFinite(pid)) return false;

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function getWorkerPanePid(
  sessionName: string,
  workerIndex: number,
  workerPaneId?: string,
): number | null {
  const result = runTmux([
    "list-panes",
    "-t",
    paneTarget(sessionName, workerIndex, workerPaneId),
    "-F",
    "#{pane_pid}",
  ]);
  if (!result.ok) return null;

  const firstLine = result.stdout.split("\n")[0]?.trim();
  if (!firstLine) return null;

  const pid = Number.parseInt(firstLine, 10);
  if (!Number.isFinite(pid)) return null;
  return pid;
}

export async function killWorker(
  sessionName: string,
  workerIndex: number,
  workerPaneId?: string,
  leaderPaneId?: string,
): Promise<void> {
  if (leaderPaneId && workerPaneId === leaderPaneId) return;

  await runTmuxAsync([
    "send-keys",
    "-t",
    paneTarget(sessionName, workerIndex, workerPaneId),
    "C-c",
  ]);
  await sleep(1000);

  if (isWorkerAlive(sessionName, workerIndex, workerPaneId)) {
    await runTmuxAsync([
      "send-keys",
      "-t",
      paneTarget(sessionName, workerIndex, workerPaneId),
      "C-d",
    ]);
    await sleep(1000);
  }

  if (isWorkerAlive(sessionName, workerIndex, workerPaneId)) {
    await runTmuxAsync([
      "kill-pane",
      "-t",
      paneTarget(sessionName, workerIndex, workerPaneId),
    ]);
  }
}

function normalizePaneTarget(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith("%")) return null;
  return trimmed;
}

export async function teardownWorkerPanes(
  paneIds: string[],
  options: PaneTeardownOptions = {},
): Promise<PaneTeardownSummary> {
  const leaderPaneId = normalizePaneTarget(options.leaderPaneId);
  const hudPaneId = normalizePaneTarget(options.hudPaneId);
  const excluded = { leader: 0, hud: 0, invalid: 0 };
  const killablePaneIds: string[] = [];
  const deduped = new Set<string>();

  for (const paneId of paneIds) {
    const normalized = normalizePaneTarget(paneId);
    if (!normalized) {
      excluded.invalid += 1;
      continue;
    }
    if (leaderPaneId && normalized === leaderPaneId) {
      excluded.leader += 1;
      continue;
    }
    if (hudPaneId && normalized === hudPaneId) {
      excluded.hud += 1;
      continue;
    }
    if (deduped.has(normalized)) continue;
    deduped.add(normalized);
    killablePaneIds.push(normalized);
  }

  const graceMs = options.graceMs ?? 2000;
  const perPaneGrace =
    killablePaneIds.length > 0
      ? Math.max(100, Math.floor(graceMs / killablePaneIds.length))
      : 0;

  const summary: PaneTeardownSummary = {
    attemptedPaneIds: killablePaneIds,
    excluded,
    kill: {
      attempted: killablePaneIds.length,
      succeeded: 0,
      failed: 0,
    },
  };

  for (const paneId of killablePaneIds) {
    const result = await runTmuxAsync(["kill-pane", "-t", paneId]);
    if (result.ok) summary.kill.succeeded += 1;
    else summary.kill.failed += 1;
    await sleep(perPaneGrace);
  }

  return summary;
}

export function notifyLeaderStatus(
  sessionName: string,
  message: string,
): boolean {
  if (!isTmuxAvailable()) return false;
  const trimmed = message.trim();
  if (!trimmed) return false;
  const capped = trimmed.length > 180 ? `${trimmed.slice(0, 177)}...` : trimmed;
  const result = runTmux(["display-message", "-t", sessionName, "--", capped]);
  return result.ok;
}

export function destroyTeamSession(sessionName: string): void {
  try {
    runTmux(["kill-session", "-t", sessionName]);
  } catch {
    // tolerate already-dead sessions
  }
}

export function listTeamSessions(): string[] {
  const result = runTmux(["list-sessions", "-F", "#{session_name}"]);
  if (!result.ok) return [];

  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}
