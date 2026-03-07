import type { AgentName, AgentResponse } from "../config/types.js";
import { createTask, completeTask, getTask, listTasks } from "./task-store.js";
import { tmuxCapturePane, tmuxSendKeys } from "../tmux/commands.js";
import { loadState } from "../orchestrator/state.js";
import { logger } from "../utils/logger.js";

type ToolResult = { content: Array<{ type: "text"; text: string }> };

function jsonResponse(data: unknown): ToolResult {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

function errorResponse(error: unknown): ToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: "text" as const, text: `Error: ${message}` }],
  };
}

function findAgentPane(agent: AgentName) {
  const state = loadState(process.cwd());
  return state?.panes.find((p) => p.agent === agent);
}

function findChefPane() {
  const state = loadState(process.cwd());
  return state?.panes.find((p) => p.role === "chef");
}

function buildReportInstruction(taskId: string): string {
  return [
    "",
    "",
    "IMPORTANT: When you finish, you MUST call the `ultra_report_complete` MCP tool with:",
    `  task_id: "${taskId}"`,
    "  result: your complete response",
    "  exit_code: 0 (success) or 1 (error)",
    "The chef is waiting for your report. Do NOT skip this step.",
  ].join("\n");
}

async function sendToWorkerPane(
  agent: AgentName,
  message: string,
): Promise<void> {
  const pane = findAgentPane(agent);
  if (!pane) throw new Error(`No pane found for agent "${agent}"`);
  await tmuxSendKeys(pane.paneId, message);
}

async function notifyChef(
  taskId: string,
  agent: AgentName,
  result: AgentResponse,
): Promise<void> {
  try {
    const chefPane = findChefPane();
    if (!chefPane) return;

    const status = result.exitCode === 0 ? "done" : "error";
    const content =
      result.content.length > 2000
        ? `${result.content.slice(0, 2000)}\n...(truncated)`
        : result.content;

    const notification = [
      `[UltraAgent] Worker ${agent} finished task ${taskId} (${status}).`,
      `Result:`,
      content,
    ].join(" ");

    await new Promise((r) => setTimeout(r, 1_000));
    await tmuxSendKeys(chefPane.paneId, notification);
    logger.info(`Chef notified about task ${taskId}`, "mcp");
  } catch (error) {
    logger.warn(
      `Failed to notify chef: ${error instanceof Error ? error.message : String(error)}`,
      "mcp",
    );
  }
}

// === Tool Handlers ===

export function createAskAgentHandler() {
  return async (args: {
    agent: AgentName;
    prompt: string;
  }): Promise<ToolResult> => {
    try {
      const entry = createTask(args.agent, args.prompt);
      const prompt = args.prompt + buildReportInstruction(entry.id);
      await sendToWorkerPane(args.agent, prompt);

      return jsonResponse({
        taskId: entry.id,
        agent: args.agent,
        status: "running",
        message: `Question sent to ${args.agent}. Worker will call ultra_report_complete when done.`,
      });
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export function createAssignTaskHandler() {
  return async (args: {
    agent: AgentName;
    task: string;
    can_code?: boolean;
    files?: string[];
  }): Promise<ToolResult> => {
    try {
      const entry = createTask(args.agent, args.task);

      const parts = [`[UltraAgent Task ${entry.id}]`, "", args.task];
      if (args.can_code) {
        parts.push("", "You are allowed to write and modify code.");
      }
      if (args.files && args.files.length > 0) {
        parts.push("", `Relevant files: ${args.files.join(", ")}`);
      }
      parts.push(buildReportInstruction(entry.id));

      await sendToWorkerPane(args.agent, parts.join("\n"));

      return jsonResponse({
        taskId: entry.id,
        agent: args.agent,
        status: "running",
        message: `Task assigned to ${args.agent}. Worker will call ultra_report_complete when done.`,
      });
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export function createReportCompleteHandler() {
  return async (args: {
    task_id: string;
    result: string;
    exit_code?: number;
  }): Promise<ToolResult> => {
    try {
      const exitCode = args.exit_code ?? 0;
      const entry = getTask(args.task_id);

      if (!entry) {
        return jsonResponse({ error: `Task "${args.task_id}" not found` });
      }
      if (entry.status !== "running") {
        return jsonResponse({
          error: `Task "${args.task_id}" is already ${entry.status}`,
        });
      }

      const agentResult: AgentResponse = {
        agent: entry.agent,
        content: args.result,
        exitCode,
        durationMs: Date.now() - entry.startedAt,
      };
      completeTask(args.task_id, agentResult);
      await notifyChef(args.task_id, entry.agent, agentResult);

      return jsonResponse({
        ok: true,
        taskId: args.task_id,
        status: exitCode === 0 ? "done" : "error",
      });
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export function createBroadcastHandler() {
  return async (args: {
    prompt: string;
    agents?: AgentName[];
  }): Promise<ToolResult> => {
    try {
      const state = loadState(process.cwd());
      if (!state) {
        return jsonResponse({ error: "No active UltraAgent session" });
      }

      const targets = args.agents ?? [...state.workers];
      const tasks: Array<{ taskId: string; agent: AgentName }> = [];

      for (const agent of targets) {
        const entry = createTask(agent, args.prompt);
        const prompt = args.prompt + buildReportInstruction(entry.id);
        try {
          await sendToWorkerPane(agent, prompt);
          tasks.push({ taskId: entry.id, agent });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          completeTask(entry.id, {
            agent,
            content: `Error: ${message}`,
            exitCode: 1,
            durationMs: 0,
          });
        }
      }

      return jsonResponse({
        tasks,
        message: `Prompt sent to ${tasks.length} worker(s). Each will call ultra_report_complete when done.`,
      });
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export function createGetTaskResultHandler() {
  return async (args: { task_id: string }): Promise<ToolResult> => {
    const maxWaitMs = 180_000;
    const start = Date.now();

    while (Date.now() - start < maxWaitMs) {
      const entry = getTask(args.task_id);
      if (!entry) {
        return jsonResponse({ error: `Task "${args.task_id}" not found` });
      }

      if (entry.status !== "running") {
        return jsonResponse({
          taskId: entry.id,
          agent: entry.agent,
          status: entry.status,
          durationMs: (entry.completedAt ?? Date.now()) - entry.startedAt,
          content: entry.result?.content ?? "[No content]",
          exitCode: entry.result?.exitCode ?? 1,
        });
      }

      await new Promise((r) => setTimeout(r, 2_000));
    }

    return jsonResponse({
      taskId: args.task_id,
      status: "running",
      message:
        "Task still running after 3 min. Worker hasn't called ultra_report_complete yet.",
    });
  };
}

export function createListTasksHandler() {
  return async (): Promise<ToolResult> => {
    const tasks = listTasks();
    if (tasks.length === 0) {
      return jsonResponse({ tasks: [], message: "No tasks yet." });
    }

    const summary = tasks.map((t) => ({
      taskId: t.id,
      agent: t.agent,
      status: t.status,
      description: t.description.slice(0, 80),
      elapsedMs: (t.completedAt ?? Date.now()) - t.startedAt,
    }));

    return jsonResponse({ tasks: summary });
  };
}

export function createWatchAgentsHandler() {
  return async (): Promise<ToolResult> => {
    try {
      const state = loadState(process.cwd());
      if (!state) {
        return jsonResponse({ error: "No active UltraAgent session" });
      }

      const snapshots: Record<string, string> = {};
      for (const pane of state.panes) {
        if (pane.role === "chef") continue;
        const content = await tmuxCapturePane(pane.paneId);
        const lines = content.split("\n").filter((l) => l.trim());
        snapshots[pane.agent] = lines.slice(-15).join("\n") || "(idle)";
      }

      return jsonResponse({ agents: snapshots });
    } catch (error) {
      return errorResponse(error);
    }
  };
}
