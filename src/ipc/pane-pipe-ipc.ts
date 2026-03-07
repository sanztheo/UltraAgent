import { writeFile, readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentName, AgentResponse } from "../config/types.js";
import { tmuxSendKeys, tmuxCapturePane } from "../tmux/commands.js";
import { loadState } from "../orchestrator/state.js";
import { sleep } from "../utils/process.js";
import { logger } from "../utils/logger.js";

const CTX = "ipc:pane-pipe";

const ERROR_PATTERNS = [
  /usage limit/i,
  /rate limit/i,
  /quota exceeded/i,
  /too many requests/i,
  /error 429/i,
  /overloaded/i,
  /credit balance/i,
  /command not found/i,
];

/** Build the shell command to run the agent non-interactively */
function buildAgentCommand(
  agent: AgentName,
  promptFile: string,
  responseFile: string,
): string {
  switch (agent) {
    case "claude":
      return `claude -p "$(cat '${promptFile}')" --output-format text 2>&1 | tee '${responseFile}'`;
    case "gemini":
      // Gemini reads prompt from stdin — safest, no shell expansion
      return `cat '${promptFile}' | gemini 2>&1 | tee '${responseFile}'`;
    case "codex":
      return `codex exec "$(cat '${promptFile}')" 2>&1 | tee '${responseFile}'`;
  }
}

/**
 * Run a non-interactive pipe command inside the worker's tmux pane.
 * Output streams visibly in the pane AND is captured to a temp file.
 */
export async function askViaPanePipe(
  agentName: AgentName,
  prompt: string,
  options?: { cwd?: string; timeoutMs?: number },
): Promise<AgentResponse> {
  const cwd = options?.cwd ?? process.cwd();
  const timeout = options?.timeoutMs ?? 120_000;
  const start = Date.now();

  const state = loadState(cwd);
  if (!state) throw new Error("No active UltraAgent session found");

  const pane = state.panes.find((p) => p.agent === agentName);
  if (!pane) throw new Error(`No pane found for agent "${agentName}"`);

  // Unique IDs for temp files
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const promptFile = join(tmpdir(), `ua-prompt-${id}.txt`);
  const responseFile = join(tmpdir(), `ua-resp-${id}.txt`);
  const doneMarker = `UA_DONE_${id}`;

  // Write prompt to temp file (avoids all shell escaping issues)
  await writeFile(promptFile, prompt, "utf-8");

  // Build the full command: agent pipe + tee + done marker
  const agentCmd = buildAgentCommand(agentName, promptFile, responseFile);
  const fullCmd = `${agentCmd}; echo '${doneMarker}'`;

  logger.info(`Pane-pipe → ${agentName} (${prompt.length} chars)`, CTX);

  // Send command to the worker's shell pane (visible to user!)
  await tmuxSendKeys(pane.paneId, fullCmd);

  // Poll for completion
  let responseText = "";

  while (Date.now() - start < timeout) {
    const paneContent = await tmuxCapturePane(pane.paneId);

    // Check for done marker → command finished
    if (paneContent.includes(doneMarker)) {
      // Read final response from file
      try {
        const content = await readFile(responseFile, "utf-8");
        if (content.trim()) responseText = content.trim();
      } catch {
        /* file might not exist if command failed */
      }
      break;
    }

    // Check for errors (rate limit, not found, etc.)
    const lastLines = paneContent.split("\n").slice(-10).join("\n");
    for (const pattern of ERROR_PATTERNS) {
      if (pattern.test(lastLines)) {
        const match = lastLines.split("\n").find((line) => pattern.test(line));
        responseText = `Error: ${match?.trim() ?? "Agent error detected"}`;
        break;
      }
    }
    if (responseText.startsWith("Error:")) break;

    // Read partial response (for logging)
    try {
      const partial = await readFile(responseFile, "utf-8");
      if (partial.trim().length > 0) {
        logger.debug(
          `${agentName} partial: ${partial.trim().length} chars`,
          CTX,
        );
      }
    } catch {
      /* not ready yet */
    }

    await sleep(2_000);
  }

  // Cleanup temp files
  for (const f of [promptFile, responseFile]) {
    try {
      await unlink(f);
    } catch {
      /* best effort */
    }
  }

  const durationMs = Date.now() - start;

  if (!responseText) {
    logger.warn(`No response from ${agentName} after ${durationMs}ms`, CTX);
    responseText = "[No response — agent may have timed out]";
  } else {
    logger.info(
      `${agentName} responded (${responseText.length} chars, ${durationMs}ms)`,
      CTX,
    );
  }

  return {
    agent: agentName,
    content: responseText,
    exitCode: responseText.startsWith("Error:") ? 1 : 0,
    durationMs,
  };
}
