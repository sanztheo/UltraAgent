import type { AgentName } from "../config/types.js";
import type { CliAdapter } from "./types.js";
import { ClaudeAdapter } from "./claude.js";
import { CodexAdapter } from "./codex.js";
import { GeminiAdapter } from "./gemini.js";

const ADAPTERS: Record<AgentName, () => CliAdapter> = {
  claude: () => new ClaudeAdapter(),
  codex: () => new CodexAdapter(),
  gemini: () => new GeminiAdapter(),
};

export function createAdapter(name: AgentName): CliAdapter {
  return ADAPTERS[name]();
}

export async function getAvailableAdapters(): Promise<CliAdapter[]> {
  const all = Object.values(ADAPTERS).map((factory) => factory());
  const checks = await Promise.all(
    all.map(async (adapter) => ({
      adapter,
      available: await adapter.isAvailable(),
    })),
  );
  return checks.filter((c) => c.available).map((c) => c.adapter);
}

export type { CliAdapter } from "./types.js";
