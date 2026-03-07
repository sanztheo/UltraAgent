import type { AgentName, AgentResponse } from "../config/types.js";
import { tmuxSendKeys } from "../tmux/commands.js";
import { loadState } from "../orchestrator/state.js";
import { askViaPipe } from "./pipe.js";
import { logger } from "../utils/logger.js";

/**
 * Hybrid IPC: sends the prompt to the visible tmux pane (so the user sees it)
 * while simultaneously running the CLI in non-interactive pipe mode for clean data capture.
 */
export async function askHybrid(
  agentName: AgentName,
  prompt: string,
  options?: { cwd?: string; timeoutMs?: number },
): Promise<AgentResponse> {
  const cwd = options?.cwd ?? process.cwd();

  // Visual: send prompt to tmux pane so user sees the interaction
  await sendToPane(agentName, prompt, cwd);

  // Data: get clean response via non-interactive pipe
  const response = await askViaPipe(agentName, prompt, {
    cwd,
    timeoutMs: options?.timeoutMs,
  });

  logger.info(
    `Hybrid IPC: ${agentName} responded (${response.content.length} chars, exit ${response.exitCode})`,
    "ipc:hybrid",
  );

  return response;
}

async function sendToPane(
  agentName: AgentName,
  prompt: string,
  cwd: string,
): Promise<void> {
  try {
    const state = loadState(cwd);
    if (!state) {
      return;
    }

    const pane = state.panes.find((p) => p.agent === agentName);
    if (!pane) {
      return;
    }

    await tmuxSendKeys(pane.paneId, prompt);
    logger.debug(
      `Prompt sent to ${agentName} pane for visual feedback`,
      "ipc:hybrid",
    );
  } catch {
    // Visual feedback is best-effort — don't fail the IPC call
    logger.debug(
      `Could not send to ${agentName} pane (best-effort)`,
      "ipc:hybrid",
    );
  }
}
