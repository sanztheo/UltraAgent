import { homedir } from "node:os";
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

export class ClaudeAdapter extends BaseAdapter {
  readonly name = "claude" as const;
  protected readonly binary = "claude";

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
    const args = ["-p", prompt];
    const format = options?.outputFormat ?? "json";
    args.push("--output-format", format);
    return args;
  }

  getInstructionFilePath(scope: "global" | "project", cwd: string): string {
    if (scope === "global") {
      return join(homedir(), ".claude", "CLAUDE.md");
    }
    return join(cwd, "CLAUDE.md");
  }

  async registerMcpServer(
    name: string,
    command: string,
    args: string[],
  ): Promise<void> {
    const mcpArgs = [
      "mcp",
      "add",
      "-s",
      "project",
      name,
      "--",
      command,
      ...args,
    ];
    logger.debug(
      `Registering MCP server: ${this.binary} ${mcpArgs.join(" ")}`,
      this.name,
    );

    const result = await execCommand(this.binary, mcpArgs);
    if (result.exitCode !== 0) {
      throw new Error(
        `Failed to register MCP server "${name}": ${result.stderr}`,
      );
    }
    logger.debug(`MCP server "${name}" registered`, this.name);
  }

  getPermissionFlags(mode: PermissionMode): string[] {
    switch (mode) {
      case "default":
        return [];
      case "auto":
        return ["--allowedTools", "Edit,Write,Bash,Read,Glob,Grep,WebFetch"];
      case "yolo":
        return ["--dangerously-skip-permissions"];
    }
  }
}
