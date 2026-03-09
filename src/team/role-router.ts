/**
 * Role router — maps task descriptions to agent roles using heuristics.
 *
 * Two layers:
 * - Layer 1 (Prompt loading): load role `.md` files from a configurable directory
 * - Layer 2 (Heuristic routing): keyword-based role assignment with confidence scoring
 *
 * Adapted from OMX: same heuristics, no OMX-specific dependencies.
 */

import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import type { TeamPhase } from "./orchestrator.js";

const SAFE_ROLE_PATTERN = /^[a-z][a-z0-9-]*$/;

export async function loadRolePrompt(
  role: string,
  promptsDir: string,
): Promise<string | null> {
  if (!SAFE_ROLE_PATTERN.test(role)) return null;
  const filePath = join(promptsDir, `${role}.md`);
  try {
    const content = await readFile(filePath, "utf-8");
    return content.trim() || null;
  } catch {
    return null;
  }
}

export function isKnownRole(role: string, promptsDir: string): boolean {
  if (!SAFE_ROLE_PATTERN.test(role)) return false;
  return existsSync(join(promptsDir, `${role}.md`));
}

export async function listAvailableRoles(
  promptsDir: string,
): Promise<string[]> {
  try {
    const files = await readdir(promptsDir);
    return files
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.slice(0, -3))
      .sort();
  } catch {
    return [];
  }
}

export interface RoleRouterResult {
  role: string;
  confidence: "high" | "medium" | "low";
  reason: string;
}

const ROLE_KEYWORDS: ReadonlyArray<{
  role: string;
  keywords: readonly string[];
}> = [
  {
    role: "test-engineer",
    keywords: [
      "test",
      "spec",
      "coverage",
      "tdd",
      "jest",
      "vitest",
      "mocha",
      "pytest",
      "unit test",
      "integration test",
      "e2e",
    ],
  },
  {
    role: "designer",
    keywords: [
      "ui",
      "component",
      "layout",
      "css",
      "design",
      "responsive",
      "tailwind",
      "react",
      "frontend",
      "styling",
      "ux",
    ],
  },
  {
    role: "build-fixer",
    keywords: [
      "build",
      "compile",
      "tsc",
      "type error",
      "typescript error",
      "build error",
      "compilation",
    ],
  },
  {
    role: "debugger",
    keywords: [
      "debug",
      "investigate",
      "root cause",
      "regression",
      "stack trace",
      "bisect",
      "diagnose",
    ],
  },
  {
    role: "writer",
    keywords: [
      "doc",
      "readme",
      "migration guide",
      "changelog",
      "comment",
      "documentation",
      "api doc",
    ],
  },
  {
    role: "quality-reviewer",
    keywords: [
      "review",
      "audit",
      "quality",
      "lint",
      "anti-pattern",
      "code review",
    ],
  },
  {
    role: "security-reviewer",
    keywords: [
      "security",
      "auth",
      "owasp",
      "xss",
      "injection",
      "cve",
      "vulnerability",
      "authentication",
      "authorization",
    ],
  },
  {
    role: "code-simplifier",
    keywords: [
      "refactor",
      "simplify",
      "clean up",
      "reduce complexity",
      "consolidate",
    ],
  },
];

const PHASE_CONTEXT_LABELS: Partial<Record<TeamPhase, string>> = {
  "team-verify": "verifier",
  "team-fix": "build-fixer",
  "team-plan": "planner",
  "team-prd": "analyst",
};

export function routeTaskToRole(
  taskSubject: string,
  taskDescription: string,
  phase: TeamPhase | null,
  fallbackRole: string,
): RoleRouterResult {
  const text = `${taskSubject} ${taskDescription}`.toLowerCase();

  let bestRole = "";
  let bestCount = 0;
  let bestKeyword = "";

  for (const { role, keywords } of ROLE_KEYWORDS) {
    let count = 0;
    let matchedKeyword = "";
    for (const kw of keywords) {
      if (text.includes(kw)) {
        count++;
        if (!matchedKeyword) matchedKeyword = kw;
      }
    }
    if (count > bestCount) {
      bestCount = count;
      bestRole = role;
      bestKeyword = matchedKeyword;
    }
  }

  if (bestCount >= 2) {
    return {
      role: bestRole,
      confidence: "high",
      reason: `matched ${bestCount} keywords in ${bestRole} category (e.g., "${bestKeyword}")`,
    };
  }

  if (bestCount === 1) {
    return {
      role: bestRole,
      confidence: "medium",
      reason: `matched keyword "${bestKeyword}" for ${bestRole}`,
    };
  }

  if (phase) {
    const phaseDefault = PHASE_CONTEXT_LABELS[phase];
    if (phaseDefault) {
      return {
        role: fallbackRole,
        confidence: "low",
        reason: `no keyword match; phase ${phase} suggests ${phaseDefault} but using fallback`,
      };
    }
  }

  return {
    role: fallbackRole,
    confidence: "low",
    reason: "no keyword match; using fallback role",
  };
}
