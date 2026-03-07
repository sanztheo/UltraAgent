import type { AgentName, AgentResponse } from "../config/types.js";
import { tmuxSendKeys, tmuxCapturePane } from "../tmux/commands.js";
import { loadState } from "../orchestrator/state.js";
import { sleep } from "../utils/process.js";
import { logger } from "../utils/logger.js";

const PROMPT_RE = /[$ > › % ❯ # ❮ ›]\s*$/m;

export async function askViaPane(
  agentName: AgentName,
  prompt: string,
  options?: { cwd?: string; timeoutMs?: number },
): Promise<AgentResponse> {
  const cwd = options?.cwd ?? process.cwd();
  const timeout = options?.timeoutMs ?? 120_000;
  const start = Date.now();

  const state = loadState(cwd);
  if (!state) {
    throw new Error("No active UltraAgent session found");
  }

  const pane = state.panes.find((p) => p.agent === agentName);
  if (!pane) {
    throw new Error(`No pane found for agent "${agentName}"`);
  }

  logger.info(
    `Sending prompt to ${agentName} in pane ${pane.paneId}`,
    "pane-ipc",
  );

  // Capture baseline content
  const baseline = await tmuxCapturePane(pane.paneId);
  const baselineLength = baseline.trimEnd().length;

  // Send the prompt to the interactive pane
  await tmuxSendKeys(pane.paneId, prompt);

  // Wait for CLI to start processing
  await sleep(2_000);

  // Poll for response completion
  let lastContent = "";
  let stableChecks = 0;
  const STABLE_THRESHOLD = 4; // stable for 2s (4 * 500ms)

  while (Date.now() - start < timeout) {
    const content = await tmuxCapturePane(pane.paneId);
    const trimmed = content.trimEnd();

    const hasNewContent = trimmed.length > baselineLength + 10;

    if (hasNewContent && trimmed === lastContent) {
      stableChecks++;

      if (stableChecks >= STABLE_THRESHOLD) {
        // Content stabilized — check for prompt return
        const lastLines = trimmed.split("\n").slice(-3).join("\n");
        if (PROMPT_RE.test(lastLines)) {
          logger.debug(
            `${agentName} response complete (prompt returned)`,
            "pane-ipc",
          );
          break;
        }
      }
    } else {
      stableChecks = 0;
    }

    lastContent = trimmed;
    await sleep(500);
  }

  // Capture final content and extract response
  const finalContent = await tmuxCapturePane(pane.paneId);
  const response = extractResponse(baseline, finalContent);
  const durationMs = Date.now() - start;

  logger.info(
    `${agentName} responded in ${durationMs}ms (${response.length} chars)`,
    "pane-ipc",
  );

  return {
    agent: agentName,
    content: response,
    exitCode: 0,
    durationMs,
  };
}

function extractResponse(baseline: string, final: string): string {
  const baselineLines = baseline.trimEnd().split("\n");
  const finalLines = final.trimEnd().split("\n");

  // New lines = everything after baseline
  const newLines = finalLines.slice(baselineLines.length);

  // Remove prompt-only lines at the end
  while (newLines.length > 0) {
    const last = newLines[newLines.length - 1]?.trim() ?? "";
    if (last === "" || /^[$ > › % ❯ # ❮]$/.test(last)) {
      newLines.pop();
    } else {
      break;
    }
  }

  // Remove the first line (the prompt we sent)
  if (newLines.length > 0) {
    newLines.shift();
  }

  return newLines.join("\n").trim();
}
