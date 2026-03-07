import { join } from 'node:path';
import type { AskOptions, LaunchOptions, PermissionMode, ShellCommand } from '../config/types.js';
import { logger } from '../utils/logger.js';
import { execCommand } from '../utils/shell.js';
import { BaseAdapter } from './base.js';

export class GeminiAdapter extends BaseAdapter {
  readonly name = 'gemini' as const;
  protected readonly binary = 'gemini';

  getInteractiveLaunchCommand(options: LaunchOptions): ShellCommand {
    const args = [...this.getPermissionFlags(options.permissionMode), ...(options.extraArgs ?? [])];

    return { command: this.binary, args };
  }

  protected buildNonInteractiveArgs(prompt: string, _options?: AskOptions): string[] {
    return ['-p', prompt];
  }

  getInstructionFilePath(_scope: 'global' | 'project', cwd: string): string {
    return join(cwd, 'GEMINI.md');
  }

  async registerMcpServer(name: string, command: string, args: string[]): Promise<void> {
    // Gemini CLI: no "--" separator, and use --trust to auto-approve tool calls
    const mcpArgs = ['mcp', 'add', '--trust', name, command, ...args];
    logger.debug(`Registering MCP server: ${this.binary} ${mcpArgs.join(' ')}`, this.name);

    const result = await execCommand(this.binary, mcpArgs);
    if (result.exitCode !== 0) {
      logger.warn(`MCP registration may not be supported for gemini: ${result.stderr}`, this.name);
    } else {
      logger.debug(`MCP server "${name}" registered`, this.name);
    }
  }

  getPermissionFlags(mode: PermissionMode): string[] {
    switch (mode) {
      case 'default':
        return [];
      case 'auto':
        return ['--approval-mode', 'auto_edit'];
      case 'yolo':
        return ['-y'];
    }
  }
}
