import { z } from 'zod';

const AgentNameSchema = z.enum(['claude', 'codex', 'gemini']);

export const askAgentInputSchema = {
  agent: AgentNameSchema.describe('Target AI agent to ask'),
  prompt: z.string().min(1).describe('The prompt to send to the agent'),
};

export const broadcastInputSchema = {
  prompt: z.string().min(1).describe('The prompt to broadcast to agents'),
  agents: z.array(AgentNameSchema).optional().describe('Specific agents to target (defaults to all)'),
};

export const assignTaskInputSchema = {
  agent: AgentNameSchema.describe('Target agent for the task'),
  task: z.string().min(1).describe('The task description to assign'),
  can_code: z.boolean().optional().describe('Whether the agent is allowed to write code'),
  files: z.array(z.string()).optional().describe('Relevant file paths for the task'),
};

export const TOOL_DEFINITIONS = {
  ultra_ask_agent: {
    description: 'Ask a specific AI CLI agent (claude, codex, or gemini) a question and get its response.',
    inputSchema: askAgentInputSchema,
  },
  ultra_broadcast: {
    description: 'Broadcast a prompt to multiple AI CLI agents simultaneously and collect all responses.',
    inputSchema: broadcastInputSchema,
  },
  ultra_assign_task: {
    description: 'Assign a task to a specific AI CLI agent with optional code permissions and file context.',
    inputSchema: assignTaskInputSchema,
  },
} as const;
