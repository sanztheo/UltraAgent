import { join } from "node:path";
import type {
  AskOptions,
  LaunchOptions,
  PermissionMode,
  ShellCommand,
} from "../config/types.js";
import { execCommand } from "../utils/shell.js";
import { logger } from "../utils/logger.js";
import { BaseAdapter } from "./base.js";

export class CodexAdapter extends BaseAdapter {
  readonly name = "codex" as const;
  protected readonly binary = "codex";

  getInteractiveLaunchCommand(options: LaunchOptions): ShellCommand {
    const args = [
      ...this.getPermissionFlags(options.permissionMode),
      ...(options.extraArgs ?? []),
    ];

    return { command: this.binary, args };
  }

  protected buildNonInteractiveArgs(
    prompt: string,
    options?: AskOptions,
  ): string[] {
    const args = ["exec", prompt];
    if (options?.outputFormat === "json") {
      args.push("--json");
    }
    return args;
  }

  getInstructionFilePath(_scope: "global" | "project", cwd: string): string {
    return join(cwd, "AGENTS.md");
  }

  async registerMcpServer(
    name: string,
    command: string,
    args: string[],
  ): Promise<void> {
    const mcpArgs = ["mcp", "add", name, "--", command, ...args];
    logger.debug(
      `Registering MCP server: ${this.binary} ${mcpArgs.join(" ")}`,
      this.name,
    );

    const result = await execCommand(this.binary, mcpArgs);
    if (result.exitCode !== 0) {
      logger.warn(
        `MCP registration failed for codex, falling back to AGENTS.md instructions: ${result.stderr}`,
        this.name,
      );
    } else {
      logger.debug(`MCP server "${name}" registered`, this.name);
    }
  }

  getPermissionFlags(mode: PermissionMode): string[] {
    switch (mode) {
      case "default":
        return [];
      case "auto":
        return ["--auto-edit"];
      case "yolo":
        return ["--full-auto"];
    }
  }
}
