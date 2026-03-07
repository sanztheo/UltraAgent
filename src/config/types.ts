export type AgentName = 'claude' | 'codex' | 'gemini';
export type AgentRole = 'chef' | 'worker';
export type PermissionMode = 'default' | 'auto' | 'yolo';
export type TmuxLayout = 'tiled' | 'main-vertical' | 'main-horizontal';

export interface TmuxConfig {
  readonly layout: TmuxLayout;
  readonly session_prefix: string;
}

export interface PermissionsConfig {
  readonly chef_mode: PermissionMode;
  readonly worker_mode: PermissionMode;
}

export interface IpcConfig {
  readonly default_timeout_ms: number;
  readonly max_payload_bytes: number;
}

export interface UltraAgentConfig {
  readonly chef: AgentName;
  readonly agents: readonly AgentName[];
  readonly tmux: TmuxConfig;
  readonly permissions: PermissionsConfig;
  readonly ipc: IpcConfig;
}

export interface LaunchOptions {
  readonly role: AgentRole;
  readonly cwd: string;
  readonly permissionMode: PermissionMode;
  readonly extraArgs?: readonly string[];
}

export interface AskOptions {
  readonly cwd?: string;
  readonly timeoutMs?: number;
  readonly outputFormat?: 'json' | 'text';
}

export interface AgentResponse {
  readonly agent: AgentName;
  readonly content: string;
  readonly exitCode: number;
  readonly durationMs: number;
}

export interface ShellCommand {
  readonly command: string;
  readonly args: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
}

export interface SessionState {
  readonly sessionName: string;
  readonly chef: AgentName;
  readonly workers: readonly AgentName[];
  readonly panes: readonly PaneInfo[];
  readonly startedAt: string;
  readonly pid: number;
}

export interface PaneInfo {
  readonly paneId: string;
  readonly agent: AgentName;
  readonly role: AgentRole;
  readonly ready: boolean;
}
