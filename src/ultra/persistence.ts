/**
 * Ultra persistence — plan and progress ledger management.
 *
 * Adapted from OMX's ralph/persistence.ts. Simplified:
 * - No legacy .omx migration (fresh codebase)
 * - Uses .ultraagent/ paths
 * - Atomic writes via writeAtomic
 */

import { createHash } from "crypto";
import { existsSync } from "fs";
import { mkdir, readFile, readdir } from "fs/promises";
import { join } from "path";
import { writeAtomic } from "../team/state/io.js";
import {
  VISUAL_NEXT_ACTIONS_LIMIT,
  type VisualVerdictStatus,
} from "../visual/constants.js";

const PLAN_PREFIX = "plan-";
const PLAN_SUFFIX = ".md";
const DEFAULT_VISUAL_THRESHOLD = 90;

export interface UltraVisualFeedback {
  score: number;
  verdict: VisualVerdictStatus;
  category_match: boolean;
  differences: string[];
  suggestions: string[];
  reasoning?: string;
  threshold?: number;
}

export interface UltraProgressLedger {
  schema_version: number;
  source?: string;
  source_sha256?: string;
  strategy?: string;
  created_at?: string;
  updated_at?: string;
  entries: Array<Record<string, unknown>>;
  visual_feedback?: Array<Record<string, unknown>>;
}

export interface UltraCanonicalArtifacts {
  canonicalPlanPath?: string;
  canonicalProgressPath: string;
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function slugify(raw: string): string {
  return (
    raw
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "untitled"
  );
}

function stableJson(value: unknown): string {
  if (value == null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, val]) => `${JSON.stringify(key)}:${stableJson(val)}`);
  return `{${entries.join(",")}}`;
}

function stableJsonPretty(value: unknown): string {
  return JSON.stringify(JSON.parse(stableJson(value)), null, 2);
}

function stateDir(cwd: string, sessionId?: string): string {
  if (sessionId) {
    return join(cwd, ".ultraagent", "sessions", sessionId);
  }
  return join(cwd, ".ultraagent");
}

export async function listCanonicalPlanFiles(cwd: string): Promise<string[]> {
  const plansDir = join(cwd, ".ultraagent", "plans");
  if (!existsSync(plansDir)) return [];
  try {
    const files = await readdir(plansDir);
    return files
      .filter(
        (file) => file.startsWith(PLAN_PREFIX) && file.endsWith(PLAN_SUFFIX),
      )
      .sort()
      .map((file) => join(plansDir, file));
  } catch {
    return [];
  }
}

export async function writePlan(
  cwd: string,
  title: string,
  content: string,
): Promise<string> {
  const plansDir = join(cwd, ".ultraagent", "plans");
  await mkdir(plansDir, { recursive: true });

  const baseSlug = slugify(title);
  let planPath = join(plansDir, `${PLAN_PREFIX}${baseSlug}${PLAN_SUFFIX}`);
  let counter = 1;
  while (existsSync(planPath)) {
    planPath = join(
      plansDir,
      `${PLAN_PREFIX}${baseSlug}-${counter}${PLAN_SUFFIX}`,
    );
    counter += 1;
  }

  const markdown = [
    `# ${title}`,
    "",
    `> SHA256: \`${sha256(content)}\``,
    `> Created: ${new Date().toISOString()}`,
    "",
    content,
    "",
  ].join("\n");

  await writeAtomic(planPath, markdown);
  return planPath;
}

async function ensureProgressLedgerFile(progressPath: string): Promise<void> {
  if (existsSync(progressPath)) return;
  const now = new Date().toISOString();
  const payload: UltraProgressLedger = {
    schema_version: 1,
    created_at: now,
    updated_at: now,
    entries: [],
    visual_feedback: [],
  };
  await mkdir(join(progressPath, ".."), { recursive: true });
  await writeAtomic(progressPath, `${stableJsonPretty(payload)}\n`);
}

async function readProgressLedger(
  progressPath: string,
): Promise<UltraProgressLedger> {
  if (!existsSync(progressPath)) {
    await ensureProgressLedgerFile(progressPath);
  }
  try {
    const parsed = JSON.parse(
      await readFile(progressPath, "utf-8"),
    ) as UltraProgressLedger;
    const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
    const visual_feedback = Array.isArray(parsed.visual_feedback)
      ? parsed.visual_feedback
      : [];
    const now = new Date().toISOString();
    return {
      ...parsed,
      schema_version:
        typeof parsed.schema_version === "number" ? parsed.schema_version : 1,
      entries,
      visual_feedback,
      created_at:
        typeof parsed.created_at === "string" ? parsed.created_at : now,
      updated_at: now,
    };
  } catch {
    const now = new Date().toISOString();
    return {
      schema_version: 1,
      created_at: now,
      updated_at: now,
      entries: [],
      visual_feedback: [],
    };
  }
}

export async function recordVisualFeedback(
  cwd: string,
  feedback: UltraVisualFeedback,
  sessionId?: string,
): Promise<void> {
  const progressPath = join(stateDir(cwd, sessionId), "progress.json");
  const ledger = await readProgressLedger(progressPath);
  const threshold = Number.isFinite(feedback.threshold)
    ? Number(feedback.threshold)
    : DEFAULT_VISUAL_THRESHOLD;

  const nextActions = [
    ...feedback.suggestions,
    ...feedback.differences.map((diff) => `Resolve difference: ${diff}`),
  ]
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, VISUAL_NEXT_ACTIONS_LIMIT);

  const entry = {
    recorded_at: new Date().toISOString(),
    score: feedback.score,
    verdict: feedback.verdict,
    category_match: feedback.category_match,
    threshold,
    passes_threshold: feedback.score >= threshold,
    differences: feedback.differences,
    suggestions: feedback.suggestions,
    reasoning: feedback.reasoning ?? "",
    next_actions: nextActions,
  };

  const visualFeedback = Array.isArray(ledger.visual_feedback)
    ? ledger.visual_feedback
    : [];
  visualFeedback.push(entry);
  ledger.visual_feedback = visualFeedback.slice(-30);
  ledger.updated_at = new Date().toISOString();

  await mkdir(join(progressPath, ".."), { recursive: true });
  await writeAtomic(progressPath, `${stableJsonPretty(ledger)}\n`);
}

export async function ensureCanonicalArtifacts(
  cwd: string,
  sessionId?: string,
): Promise<UltraCanonicalArtifacts> {
  const progressPath = join(stateDir(cwd, sessionId), "progress.json");
  await mkdir(join(cwd, ".ultraagent", "plans"), { recursive: true });
  await mkdir(stateDir(cwd, sessionId), { recursive: true });

  const planFiles = await listCanonicalPlanFiles(cwd);
  await ensureProgressLedgerFile(progressPath);

  return {
    canonicalPlanPath: planFiles[0],
    canonicalProgressPath: progressPath,
  };
}

export async function readProgress(
  cwd: string,
  sessionId?: string,
): Promise<UltraProgressLedger> {
  const progressPath = join(stateDir(cwd, sessionId), "progress.json");
  return readProgressLedger(progressPath);
}
