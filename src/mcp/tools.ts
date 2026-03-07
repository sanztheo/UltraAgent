import { z } from "zod";

const AgentNameSchema = z.enum(["claude", "codex", "gemini"]);

export const askAgentInputSchema = {
  agent: AgentNameSchema.describe("Target AI agent to ask"),
  prompt: z.string().min(1).describe("The prompt to send to the agent"),
};

export const broadcastInputSchema = {
  prompt: z.string().min(1).describe("The prompt to broadcast to agents"),
  agents: z
    .array(AgentNameSchema)
    .optional()
    .describe("Specific agents to target (defaults to all workers)"),
};

export const assignTaskInputSchema = {
  agent: AgentNameSchema.describe("Target agent for the task"),
  task: z.string().min(1).describe("The task description to assign"),
  can_code: z
    .boolean()
    .optional()
    .describe("Whether the agent is allowed to write code"),
  files: z
    .array(z.string())
    .optional()
    .describe("Relevant file paths for the task"),
};

export const getTaskResultInputSchema = {
  task_id: z
    .string()
    .min(1)
    .describe("The task ID returned by ultra_assign_task"),
};

export const TOOL_DEFINITIONS = {
  ultra_ask_agent: {
    description:
      "Ask a specific AI CLI agent a question and wait for its response (synchronous, for quick questions).",
    inputSchema: askAgentInputSchema,
  },
  ultra_broadcast: {
    description:
      "Broadcast a prompt to all worker agents simultaneously and wait for all responses.",
    inputSchema: broadcastInputSchema,
  },
  ultra_assign_task: {
    description:
      "Assign a task to a worker agent. Returns immediately with a taskId — the task runs in the background. Use ultra_get_task_result to check progress and retrieve the result.",
    inputSchema: assignTaskInputSchema,
  },
  ultra_get_task_result: {
    description:
      "Get the result of a background task by its ID. Returns status (running/done/error) and the result content when complete.",
    inputSchema: getTaskResultInputSchema,
  },
  ultra_list_tasks: {
    description:
      "List all tasks with their current status, agent, and elapsed time. Useful to monitor what workers are doing.",
    inputSchema: {},
  },
  ultra_watch_agents: {
    description:
      "Get a live snapshot of each worker's tmux pane (last 15 lines). See what each agent is currently doing.",
    inputSchema: {},
  },
} as const;
