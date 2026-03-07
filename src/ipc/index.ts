import type { AgentName, AgentResponse } from '../config/types.js';
import { logger } from '../utils/logger.js';
import { askViaPipe } from './pipe.js';

const ALL_AGENTS: readonly AgentName[] = ['claude', 'codex', 'gemini'];

export class IpcCoordinator {
  constructor(
    private readonly config: {
      defaultTimeoutMs: number;
      maxPayloadBytes: number;
    },
  ) {}

  async askAgent(agent: AgentName, prompt: string): Promise<AgentResponse> {
    this.validatePayload(prompt);
    logger.info(`askAgent → ${agent}`, 'ipc');

    return askViaPipe(agent, prompt, {
      timeoutMs: this.config.defaultTimeoutMs,
    });
  }

  async broadcast(prompt: string, agents?: AgentName[]): Promise<AgentResponse[]> {
    this.validatePayload(prompt);
    const targets = agents ?? [...ALL_AGENTS];
    logger.info(`broadcast → [${targets.join(', ')}]`, 'ipc');

    const results = await Promise.allSettled(
      targets.map((agent) =>
        askViaPipe(agent, prompt, {
          timeoutMs: this.config.defaultTimeoutMs,
        }),
      ),
    );

    return results.map((result, i) => {
      if (result.status === 'fulfilled') {
        return result.value;
      }
      const target = targets[i] ?? ('claude' as AgentName);
      logger.warn(
        `Broadcast to ${target} failed: ${result.reason instanceof Error ? result.reason.message : 'Unknown'}`,
        'ipc',
      );
      return {
        agent: target,
        content: `Error: ${result.reason instanceof Error ? result.reason.message : 'Unknown error'}`,
        exitCode: 1,
        durationMs: 0,
      };
    });
  }

  async assignTask(
    agent: AgentName,
    task: string,
    options?: { canCode?: boolean; files?: string[] },
  ): Promise<AgentResponse> {
    this.validatePayload(task);
    logger.info(`assignTask → ${agent}`, 'ipc');

    const parts = [
      'You have been assigned the following task by UltraAgent orchestrator.',
      'Complete it thoroughly and report your results.',
      '',
      `Task: ${task}`,
    ];

    if (options?.canCode) {
      parts.push('', 'You are allowed to write and modify code.');
    }

    if (options?.files && options.files.length > 0) {
      parts.push('', `Relevant files: ${options.files.join(', ')}`);
    }

    return askViaPipe(agent, parts.join('\n'), {
      timeoutMs: this.config.defaultTimeoutMs,
    });
  }

  private validatePayload(data: string): void {
    const size = Buffer.byteLength(data, 'utf-8');
    if (size > this.config.maxPayloadBytes) {
      throw new Error(`Payload too large: ${size} bytes exceeds limit of ${this.config.maxPayloadBytes} bytes`);
    }
  }
}

export { askViaPipe } from './pipe.js';
export { handleCliBridge } from './cli-bridge.js';
