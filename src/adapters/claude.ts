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
  private ccAvailable: boolean | undefined;

  /** Check if `cc` alias/binary is available (cached) */
  private async hasCc(): Promise<boolean> {
    if (this.ccAvailable === undefined) {
      // cc is typically a shell alias — check via shell
      const result = await execCommand("sh", ["-ic", "command -v cc"]);
      this.ccAvailable =
        result.exitCode === 0 && result.stdout.includes("claude");
    }
    return this.ccAvailable;
  }

  async getInteractiveLaunchCommand(
    options: LaunchOptions,
  ): Promise<ShellCommand> {
    // Use `cc` if available — it's an alias for `claude --dangerously-skip-permissions`
    const useCc = await this.hasCc();

    if (useCc) {
      // cc already includes --dangerously-skip-permissions
      // Only add extra args (no permission flags needed)
      return { command: "cc", args: [...(options.extraArgs ?? [])] };
    }

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
