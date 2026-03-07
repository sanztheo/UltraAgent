import { createAdapter } from '../adapters/index.js';
import type { AgentName, AgentResponse, AskOptions } from '../config/types.js';
import { logger } from '../utils/logger.js';

const DEFAULT_TIMEOUT_MS = 60_000;

export async function askViaPipe(agentName: AgentName, prompt: string, options?: AskOptions): Promise<AgentResponse> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const adapter = createAdapter(agentName);

  logger.debug(`Sending prompt to ${agentName} (timeout: ${timeoutMs}ms)`, 'ipc:pipe');

  try {
    const response = await adapter.askNonInteractive(prompt, {
      ...options,
      timeoutMs,
    });

    logger.debug(`Got response from ${agentName} (exit: ${response.exitCode}, ${response.durationMs}ms)`, 'ipc:pipe');

    return response;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown IPC error';
    logger.error(`Pipe call to ${agentName} failed: ${message}`, 'ipc:pipe');

    return {
      agent: agentName,
      content: `Error: ${message}`,
      exitCode: 1,
      durationMs: 0,
    };
  }
}
