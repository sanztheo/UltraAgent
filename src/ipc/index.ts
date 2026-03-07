import type { AgentName, AgentResponse } from "../config/types.js";
import { loadState } from "../orchestrator/state.js";
import { logger } from "../utils/logger.js";
import { askViaConversation } from "./conversation-ipc.js";

export class IpcCoordinator {
  constructor(
    private readonly config: {
      defaultTimeoutMs: number;
      maxPayloadBytes: number;
    },
  ) {}

  /** Get worker agents from session state (excludes the chef) */
  private getWorkers(): AgentName[] {
    const state = loadState(process.cwd());
    if (state) return [...state.workers];
    // Fallback if no state found
    return ["codex", "gemini"];
  }

  async askAgent(agent: AgentName, prompt: string): Promise<AgentResponse> {
    this.validatePayload(prompt);
    logger.info(`askAgent → ${agent}`, "ipc");

    return askViaConversation(agent, prompt, {
      timeoutMs: this.config.defaultTimeoutMs,
    });
  }

  async broadcast(
    prompt: string,
    agents?: AgentName[],
  ): Promise<AgentResponse[]> {
    this.validatePayload(prompt);
    const targets = agents ?? this.getWorkers();
    logger.info(`broadcast → [${targets.join(", ")}]`, "ipc");

    const results = await Promise.allSettled(
      targets.map((agent) =>
        askViaConversation(agent, prompt, {
          timeoutMs: this.config.defaultTimeoutMs,
        }),
      ),
    );

    return results.map((result, i) => {
      if (result.status === "fulfilled") return result.value;
      const agent = targets[i] ?? "claude";
      const message =
        result.reason instanceof Error
          ? result.reason.message
          : "Unknown error";
      logger.warn(`Broadcast to ${agent} failed: ${message}`, "ipc");
      return {
        agent,
        content: `Error: ${message}`,
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

    return askViaConversation(agent, parts.join("\n"), {
      timeoutMs: this.config.defaultTimeoutMs,
    });
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

export { askViaConversation } from "./conversation-ipc.js";
export { askViaPane } from "./pane-ipc.js";
export { askViaPipe } from "./pipe.js";
export { handleCliBridge } from "./cli-bridge.js";
