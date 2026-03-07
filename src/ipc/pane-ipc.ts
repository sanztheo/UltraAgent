import type { AgentName, AgentResponse } from "../config/types.js";
import { tmuxSendKeys } from "../tmux/commands.js";
import { loadState } from "../orchestrator/state.js";
import { sleep } from "../utils/process.js";
import { execCommand } from "../utils/shell.js";
import { logger } from "../utils/logger.js";

const PROMPT_RE = /[$ > › % ❯ # ❮]\s*$/m;

/** Capture full scrollback history of a pane (not just visible area) */
async function captureFullPane(paneId: string): Promise<string> {
  const result = await execCommand("tmux", [
    "capture-pane",
    "-t",
    paneId,
    "-p",
    "-J",
    "-S",
    "-",
  ]);
  return result.stdout;
}

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

  // Capture full scrollback before sending
  const before = await captureFullPane(pane.paneId);
  const beforeLineCount = before.trimEnd().split("\n").length;

  // Send the prompt to the interactive pane
  await tmuxSendKeys(pane.paneId, prompt);

  // Wait for CLI to start processing
  await sleep(3_000);

  // Poll for response completion
  let lastContent = "";
  let stableChecks = 0;
  const STABLE_THRESHOLD = 6; // stable for 3s (6 * 500ms)

  while (Date.now() - start < timeout) {
    const content = await captureFullPane(pane.paneId);
    const currentLineCount = content.trimEnd().split("\n").length;
    const hasNewContent = currentLineCount > beforeLineCount + 1;

    if (hasNewContent && content === lastContent) {
      stableChecks++;
      if (stableChecks >= STABLE_THRESHOLD) {
        // Content stabilized — likely done
        logger.debug(
          `${agentName} response complete (content stable)`,
          "pane-ipc",
        );
        break;
      }
    } else {
      stableChecks = 0;
    }

    lastContent = content;
    await sleep(500);
  }

  // Capture final full scrollback and extract response
  const after = await captureFullPane(pane.paneId);
  const response = extractResponse(prompt, after);
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

function extractResponse(prompt: string, fullCapture: string): string {
  const lines = fullCapture.split("\n");

  // Find the line that contains our prompt (search from the end for the most recent)
  const promptSnippet = prompt.slice(0, 60).trim();
  let promptLineIndex = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i]?.includes(promptSnippet)) {
      promptLineIndex = i;
      break;
    }
  }

  if (promptLineIndex === -1) {
    // Fallback: return last 20 lines minus prompt lines
    logger.warn(
      "Could not find prompt in pane capture, using tail fallback",
      "pane-ipc",
    );
    const tail = lines.slice(-20);
    return cleanResponseLines(tail);
  }

  // Everything after the prompt line is the response
  const responseLines = lines.slice(promptLineIndex + 1);
  return cleanResponseLines(responseLines);
}

function cleanResponseLines(lines: string[]): string {
  // Remove empty trailing lines and prompt-only lines
  const cleaned = [...lines];

  while (cleaned.length > 0) {
    const last = cleaned[cleaned.length - 1]?.trim() ?? "";
    if (
      last === "" ||
      PROMPT_RE.test(last) ||
      /^[>›]\s*(Type your|$)/.test(last)
    ) {
      cleaned.pop();
    } else {
      break;
    }
  }

  // Remove leading empty lines
  while (cleaned.length > 0 && (cleaned[0]?.trim() ?? "") === "") {
    cleaned.shift();
  }

  return cleaned.join("\n").trim();
}
