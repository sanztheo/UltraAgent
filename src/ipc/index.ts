import type { AgentName, AgentResponse } from "../config/types.js";
import { logger } from "../utils/logger.js";
import { askViaPane } from "./pane-ipc.js";
import { askViaPipe } from "./pipe.js";

const ALL_AGENTS: readonly AgentName[] = ["claude", "codex", "gemini"];

export class IpcCoordinator {
  constructor(
    private readonly config: {
      defaultTimeoutMs: number;
      maxPayloadBytes: number;
    },
  ) {}

  async askAgent(agent: AgentName, prompt: string): Promise<AgentResponse> {
    this.validatePayload(prompt);
    logger.info(`askAgent → ${agent}`, "ipc");

    return this.ask(agent, prompt);
  }

  async broadcast(
    prompt: string,
    agents?: AgentName[],
  ): Promise<AgentResponse[]> {
    this.validatePayload(prompt);
    const targets = agents ?? [...ALL_AGENTS];
    logger.info(`broadcast → [${targets.join(", ")}]`, "ipc");

    // Broadcast sequentially to avoid overlapping pane inputs
    const responses: AgentResponse[] = [];
    for (const agent of targets) {
      try {
        const response = await this.ask(agent, prompt);
        responses.push(response);
      } catch (error) {
        logger.warn(
          `Broadcast to ${agent} failed: ${error instanceof Error ? error.message : "Unknown"}`,
          "ipc",
        );
        responses.push({
          agent,
          content: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
          exitCode: 1,
          durationMs: 0,
        });
      }
    }

    return responses;
  }

  async assignTask(
    agent: AgentName,
    task: string,
    options?: { canCode?: boolean; files?: string[] },
  ): Promise<AgentResponse> {
    this.validatePayload(task);
    logger.info(`assignTask → ${agent}`, "ipc");

    const parts = [
      "You have been assigned the following task by UltraAgent orchestrator.",
      "Complete it thoroughly and report your results.",
      "",
      `Task: ${task}`,
    ];

    if (options?.canCode) {
      parts.push("", "You are allowed to write and modify code.");
    }

    if (options?.files && options.files.length > 0) {
      parts.push("", `Relevant files: ${options.files.join(", ")}`);
    }

    return this.ask(agent, parts.join("\n"));
  }

  private async ask(agent: AgentName, prompt: string): Promise<AgentResponse> {
    // Try pane IPC first (sends to visible tmux pane), fall back to pipe
    try {
      return await askViaPane(agent, prompt, {
        timeoutMs: this.config.defaultTimeoutMs,
      });
    } catch (error) {
      logger.warn(
        `Pane IPC failed for ${agent}, falling back to pipe: ${error instanceof Error ? error.message : "Unknown"}`,
        "ipc",
      );
      return askViaPipe(agent, prompt, {
        timeoutMs: this.config.defaultTimeoutMs,
      });
    }
  }

  private validatePayload(data: string): void {
    const size = Buffer.byteLength(data, "utf-8");
    if (size > this.config.maxPayloadBytes) {
      throw new Error(
        `Payload too large: ${size} bytes exceeds limit of ${this.config.maxPayloadBytes} bytes`,
      );
    }
  }
}

export { askViaPane } from "./pane-ipc.js";
export { askViaPipe } from "./pipe.js";
export { handleCliBridge } from "./cli-bridge.js";
