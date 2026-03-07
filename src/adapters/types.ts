import type {
  AgentName,
  AgentResponse,
  AgentRole,
  AskOptions,
  LaunchOptions,
  PermissionMode,
  ShellCommand,
} from '../config/types.js';

export interface CliAdapter {
  readonly name: AgentName;
  isAvailable(): Promise<boolean>;
  getInteractiveLaunchCommand(options: LaunchOptions): ShellCommand | Promise<ShellCommand>;
  askNonInteractive(prompt: string, options?: AskOptions): Promise<AgentResponse>;
  getInstructionFilePath(scope: 'global' | 'project', cwd: string): string;
  injectInstructions(role: AgentRole, content: string, cwd: string): Promise<void>;
  registerMcpServer(name: string, command: string, args: string[]): Promise<void>;
  getPermissionFlags(mode: PermissionMode): string[];
}
