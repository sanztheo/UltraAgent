import { z } from 'zod';

export const agentNameSchema = z.enum(['claude', 'codex', 'gemini']);
export const agentRoleSchema = z.enum(['chef', 'worker']);
export const permissionModeSchema = z.enum(['default', 'auto', 'yolo']);
export const tmuxLayoutSchema = z.enum(['tiled', 'main-vertical', 'main-horizontal']);

export const tmuxConfigSchema = z.object({
  layout: tmuxLayoutSchema,
  session_prefix: z.string().min(1),
});

export const permissionsConfigSchema = z.object({
  chef_mode: permissionModeSchema,
  worker_mode: permissionModeSchema,
});

export const ipcConfigSchema = z.object({
  default_timeout_ms: z.number().int().positive().max(300_000),
  max_payload_bytes: z.number().int().positive().max(10_485_760),
});

export const ultraAgentConfigSchema = z.object({
  chef: agentNameSchema,
  agents: z.array(agentNameSchema).min(1),
  tmux: tmuxConfigSchema,
  permissions: permissionsConfigSchema,
  ipc: ipcConfigSchema,
});
