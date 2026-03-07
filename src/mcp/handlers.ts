import type { AgentName, AgentResponse } from "../config/types.js";
import type { IpcCoordinator } from "../ipc/index.js";
import { createTask, completeTask, getTask, listTasks } from "./task-store.js";
import { tmuxCapturePane } from "../tmux/commands.js";
import { loadState } from "../orchestrator/state.js";
import { logger } from "../utils/logger.js";

function formatResponse(response: AgentResponse): {
  content: Array<{ type: "text"; text: string }>;
} {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            agent: response.agent,
            content: response.content,
            exitCode: response.exitCode,
            durationMs: response.durationMs,
          },
          null,
          2,
        ),
      },
    ],
  };
}

function formatMultiResponse(responses: AgentResponse[]): {
  content: Array<{ type: "text"; text: string }>;
} {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          responses.map((r) => ({
            agent: r.agent,
            content: r.content,
            exitCode: r.exitCode,
            durationMs: r.durationMs,
          })),
          null,
          2,
        ),
      },
    ],
  };
}

function errorResponse(error: unknown): {
  content: Array<{ type: "text"; text: string }>;
} {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: "text" as const, text: `Error: ${message}` }],
  };
}

export function createAskAgentHandler(coordinator: IpcCoordinator) {
  return async (args: {
    agent: AgentName;
    prompt: string;
  }): Promise<{ content: Array<{ type: "text"; text: string }> }> => {
    try {
      const response = await coordinator.askAgent(args.agent, args.prompt);
      return formatResponse(response);
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export function createBroadcastHandler(coordinator: IpcCoordinator) {
  return async (args: {
    prompt: string;
    agents?: AgentName[];
  }): Promise<{ content: Array<{ type: "text"; text: string }> }> => {
    try {
      const responses = await coordinator.broadcast(args.prompt, args.agents);
      return formatMultiResponse(responses);
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export function createAssignTaskHandler(coordinator: IpcCoordinator) {
  return async (args: {
    agent: AgentName;
    task: string;
    can_code?: boolean;
    files?: string[];
  }): Promise<{ content: Array<{ type: "text"; text: string }> }> => {
    try {
      // Create task entry and return immediately — work runs in background
      const entry = createTask(args.agent, args.task);

      // Fire-and-forget: run in background, update task store on completion
      coordinator
        .assignTask(args.agent, args.task, {
          canCode: args.can_code,
          files: args.files,
        })
        .then((result) => completeTask(entry.id, result))
        .catch((error) => {
          const message =
            error instanceof Error ? error.message : String(error);
          logger.warn(`Task ${entry.id} failed: ${message}`, "mcp");
          completeTask(entry.id, {
            agent: args.agent,
            content: `Error: ${message}`,
            exitCode: 1,
            durationMs: Date.now() - entry.startedAt,
          });
        });

      return jsonResponse({
        taskId: entry.id,
        agent: entry.agent,
        status: "running",
        message: `Task assigned to ${args.agent}. Use ultra_get_task_result("${entry.id}") to get the result when ready, or ultra_list_tasks() to monitor progress.`,
      });
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export function createGetTaskResultHandler() {
  return async (args: {
    task_id: string;
  }): Promise<{ content: Array<{ type: "text"; text: string }> }> => {
    const entry = getTask(args.task_id);
    if (!entry) {
      return jsonResponse({ error: `Task "${args.task_id}" not found` });
    }

    const elapsed = (entry.completedAt ?? Date.now()) - entry.startedAt;

    if (entry.status === "running") {
      return jsonResponse({
        taskId: entry.id,
        agent: entry.agent,
        status: "running",
        elapsedMs: elapsed,
        message: "Task is still running. Check again in a few seconds.",
      });
    }

    return jsonResponse({
      taskId: entry.id,
      agent: entry.agent,
      status: entry.status,
      durationMs: elapsed,
      content: entry.result?.content ?? "[No content]",
      exitCode: entry.result?.exitCode ?? 1,
    });
  };
}

export function createListTasksHandler() {
  return async (): Promise<{
    content: Array<{ type: "text"; text: string }>;
  }> => {
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
  return async (): Promise<{
    content: Array<{ type: "text"; text: string }>;
  }> => {
    try {
      const state = loadState(process.cwd());
      if (!state) {
        return jsonResponse({ error: "No active UltraAgent session" });
      }

      const snapshots: Record<string, string> = {};
      for (const pane of state.panes) {
        if (pane.role === "chef") continue; // skip chef pane
        const content = await tmuxCapturePane(pane.paneId);
        // Last 15 lines for a quick overview
        const lines = content.split("\n").filter((l) => l.trim());
        snapshots[pane.agent] = lines.slice(-15).join("\n") || "(idle)";
      }

      return jsonResponse({ agents: snapshots });
    } catch (error) {
      return errorResponse(error);
    }
  };
}

function jsonResponse(data: unknown): {
  content: Array<{ type: "text"; text: string }>;
} {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}
