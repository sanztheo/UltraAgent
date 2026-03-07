import { z } from 'zod';

const AgentNameSchema = z.enum(['claude', 'codex', 'gemini']);

export const askAgentInputSchema = {
  agent: AgentNameSchema.describe('Target AI agent to ask'),
  prompt: z.string().min(1).describe('The prompt to send to the agent'),
};

export const broadcastInputSchema = {
  prompt: z.string().min(1).describe('The prompt to broadcast to agents'),
  agents: z.array(AgentNameSchema).optional().describe('Specific agents to target (defaults to all workers)'),
};

export const assignTaskInputSchema = {
  agent: AgentNameSchema.describe('Target agent for the task'),
  task: z.string().min(1).describe('The task description to assign'),
  can_code: z.boolean().optional().describe('Whether the agent is allowed to write code'),
  files: z.array(z.string()).optional().describe('Relevant file paths for the task'),
};

export const getTaskResultInputSchema = {
  task_id: z.string().min(1).describe('The task ID returned by ultra_assign_task'),
};

export const reportCompleteInputSchema = {
  task_id: z.string().min(1).describe('The task ID to report as complete'),
  result: z
    .string()
    .optional()
    .describe('Optional short summary. If omitted, your full chat output is captured automatically from the terminal.'),
  exit_code: z.number().optional().describe('Exit code: 0 = success, non-zero = error. Defaults to 0.'),
};

export const TOOL_DEFINITIONS = {
  ultra_ask_agent: {
    description:
      'Send a question to a worker agent. Returns immediately with a taskId — the worker will call ultra_report_complete when done, and the chef gets notified automatically.',
    inputSchema: askAgentInputSchema,
  },
  ultra_broadcast: {
    description: 'Send a prompt to all worker agents simultaneously. Returns immediately with taskIds for each worker.',
    inputSchema: broadcastInputSchema,
  },
  ultra_assign_task: {
    description:
      'Assign a structured task to a worker agent. Returns immediately with a taskId — the worker will call ultra_report_complete when done.',
    inputSchema: assignTaskInputSchema,
  },
  ultra_get_task_result: {
    description:
      'Wait for a background task to finish and return its result. Blocks until the worker calls ultra_report_complete.',
    inputSchema: getTaskResultInputSchema,
  },
  ultra_list_tasks: {
    description: 'List all tasks with their current status, agent, and elapsed time.',
    inputSchema: {},
  },
  ultra_watch_agents: {
    description: "Get a live snapshot of each worker's tmux pane (last 15 lines).",
    inputSchema: {},
  },
  ultra_report_complete: {
    description:
      'Report task completion. Workers MUST call this tool when they finish an assigned task. This stores the result and notifies the chef automatically.',
    inputSchema: reportCompleteInputSchema,
  },
} as const;
