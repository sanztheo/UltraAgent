import { tmuxCapturePane } from "./commands.js";
import { sleep } from "../utils/process.js";
import { logger } from "../utils/logger.js";

const PROMPT_PATTERNS = [/\$\s*$/m, />\s*$/m, /%\s*$/m, /❯\s*$/m, /#\s*$/m];

const CLI_READY_PATTERNS = [
  /claude.*>/i,
  /codex.*>/i,
  /gemini.*>/i,
  /waiting for input/i,
  /ready/i,
  /type .* to begin/i,
];

export function isPaneReady(content: string): boolean {
  const trimmed = content.trimEnd();
  if (trimmed.length === 0) {
    return false;
  }

  const lastLine = trimmed.split("\n").pop() ?? "";

  for (const pattern of CLI_READY_PATTERNS) {
    if (pattern.test(lastLine)) {
      return true;
    }
  }

  for (const pattern of PROMPT_PATTERNS) {
    if (pattern.test(lastLine)) {
      return true;
    }
  }

  return false;
}

export async function waitForPaneReady(
  paneTarget: string,
  options?: { timeoutMs?: number; intervalMs?: number },
): Promise<boolean> {
  const timeout = options?.timeoutMs ?? 30_000;
  const interval = options?.intervalMs ?? 500;
  const start = Date.now();

  while (Date.now() - start < timeout) {
    const content = await tmuxCapturePane(paneTarget);
    if (isPaneReady(content)) {
      logger.debug(`Pane ${paneTarget} is ready`, "pane");
      return true;
    }
    await sleep(interval);
  }

  logger.warn(`Pane ${paneTarget} not ready after ${timeout}ms`, "pane");
  return false;
}
