import type { AgentName, AgentResponse } from '../config/types.js';
import type { IpcCoordinator } from '../ipc/index.js';

function formatResponse(response: AgentResponse): {
  content: Array<{ type: 'text'; text: string }>;
} {
  return {
    content: [
      {
        type: 'text' as const,
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
  content: Array<{ type: 'text'; text: string }>;
} {
  return {
    content: [
      {
        type: 'text' as const,
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

export function createAskAgentHandler(coordinator: IpcCoordinator) {
  return async (args: {
    agent: AgentName;
    prompt: string;
  }): Promise<{ content: Array<{ type: 'text'; text: string }> }> => {
    const response = await coordinator.askAgent(args.agent, args.prompt);
    return formatResponse(response);
  };
}

export function createBroadcastHandler(coordinator: IpcCoordinator) {
  return async (args: {
    prompt: string;
    agents?: AgentName[];
  }): Promise<{ content: Array<{ type: 'text'; text: string }> }> => {
    const responses = await coordinator.broadcast(args.prompt, args.agents);
    return formatMultiResponse(responses);
  };
}

export function createAssignTaskHandler(coordinator: IpcCoordinator) {
  return async (args: {
    agent: AgentName;
    task: string;
    can_code?: boolean;
    files?: string[];
  }): Promise<{ content: Array<{ type: 'text'; text: string }> }> => {
    const response = await coordinator.assignTask(args.agent, args.task, {
      canCode: args.can_code,
      files: args.files,
    });
    return formatResponse(response);
  };
}
