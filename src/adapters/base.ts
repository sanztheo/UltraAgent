import { readFile, writeFile } from "node:fs/promises";
import type {
  AgentName,
  AgentRole,
  AgentResponse,
  AskOptions,
  LaunchOptions,
  PermissionMode,
  ShellCommand,
} from "../config/types.js";
import { execCommand, which } from "../utils/shell.js";
import { logger } from "../utils/logger.js";
import type { CliAdapter } from "./types.js";

const MARKER_START = "<!-- ULTRAAGENT:START -->";
const MARKER_END = "<!-- ULTRAAGENT:END -->";
const DEFAULT_TIMEOUT_MS = 120_000;

export abstract class BaseAdapter implements CliAdapter {
  abstract readonly name: AgentName;
  protected abstract readonly binary: string;

  abstract getInteractiveLaunchCommand(options: LaunchOptions): ShellCommand;
  abstract getInstructionFilePath(
    scope: "global" | "project",
    cwd: string,
  ): string;
  abstract registerMcpServer(
    name: string,
    command: string,
    args: string[],
  ): Promise<void>;
  abstract getPermissionFlags(mode: PermissionMode): string[];

  protected abstract buildNonInteractiveArgs(
    prompt: string,
    options?: AskOptions,
  ): string[];

  async isAvailable(): Promise<boolean> {
    const path = await which(this.binary);
    const available = path !== undefined;
    logger.debug(
      `${this.binary} ${available ? "found" : "not found"} at ${path ?? "N/A"}`,
      this.name,
    );
    return available;
  }

  async askNonInteractive(
    prompt: string,
    options?: AskOptions,
  ): Promise<AgentResponse> {
    const args = this.buildNonInteractiveArgs(prompt, options);
    const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    logger.debug(`Executing: ${this.binary} ${args.join(" ")}`, this.name);
    const start = performance.now();

    const result = await execCommand(this.binary, args, {
      cwd: options?.cwd,
      timeoutMs,
    });

    const durationMs = Math.round(performance.now() - start);

    if (result.exitCode !== 0) {
      logger.warn(
        `Non-interactive call exited with code ${result.exitCode}: ${result.stderr}`,
        this.name,
      );
    }

    return {
      agent: this.name,
      content: result.stdout,
      exitCode: result.exitCode,
      durationMs,
    };
  }

  async injectInstructions(
    role: AgentRole,
    content: string,
    cwd: string,
  ): Promise<void> {
    const filePath = this.getInstructionFilePath("project", cwd);
    const block = `${MARKER_START}\n# UltraAgent (${role})\n${content}\n${MARKER_END}`;

    let existing = "";
    try {
      existing = await readFile(filePath, "utf-8");
    } catch {
      // File doesn't exist yet — will be created
    }

    const startIdx = existing.indexOf(MARKER_START);
    const endIdx = existing.indexOf(MARKER_END);

    let updated: string;
    if (startIdx !== -1 && endIdx !== -1) {
      updated =
        existing.slice(0, startIdx) +
        block +
        existing.slice(endIdx + MARKER_END.length);
    } else {
      updated = existing ? `${existing}\n\n${block}\n` : `${block}\n`;
    }

    await writeFile(filePath, updated, "utf-8");
    logger.debug(`Injected ${role} instructions into ${filePath}`, this.name);
  }
}
