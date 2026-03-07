import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { IpcCoordinator } from "../ipc/index.js";
import { logger } from "../utils/logger.js";
import {
  createAskAgentHandler,
  createAssignTaskHandler,
  createBroadcastHandler,
  createGetTaskResultHandler,
  createListTasksHandler,
  createWatchAgentsHandler,
} from "./handlers.js";
import { TOOL_DEFINITIONS } from "./tools.js";

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_PAYLOAD_BYTES = 1_024 * 1_024; // 1 MB

export async function startMcpServer(): Promise<void> {
  const coordinator = new IpcCoordinator({
    defaultTimeoutMs: DEFAULT_TIMEOUT_MS,
    maxPayloadBytes: MAX_PAYLOAD_BYTES,
  });

  const server = new McpServer(
    { name: "ultraagent", version: "0.2.0" },
    { capabilities: { tools: {} } },
  );

  // Sync tools
  const askHandler = createAskAgentHandler(coordinator);
  const broadcastHandler = createBroadcastHandler(coordinator);

  server.tool(
    "ultra_ask_agent",
    TOOL_DEFINITIONS.ultra_ask_agent.description,
    TOOL_DEFINITIONS.ultra_ask_agent.inputSchema,
    async (args) => askHandler(args),
  );

  server.tool(
    "ultra_broadcast",
    TOOL_DEFINITIONS.ultra_broadcast.description,
    TOOL_DEFINITIONS.ultra_broadcast.inputSchema,
    async (args) => broadcastHandler(args),
  );

  // Async task tools
  const assignHandler = createAssignTaskHandler(coordinator);
  const getResultHandler = createGetTaskResultHandler();
  const listHandler = createListTasksHandler();
  const watchHandler = createWatchAgentsHandler();

  server.tool(
    "ultra_assign_task",
    TOOL_DEFINITIONS.ultra_assign_task.description,
    TOOL_DEFINITIONS.ultra_assign_task.inputSchema,
    async (args) => assignHandler(args),
  );

  server.tool(
    "ultra_get_task_result",
    TOOL_DEFINITIONS.ultra_get_task_result.description,
    TOOL_DEFINITIONS.ultra_get_task_result.inputSchema,
    async (args) => getResultHandler(args),
  );

  server.tool(
    "ultra_list_tasks",
    TOOL_DEFINITIONS.ultra_list_tasks.description,
    TOOL_DEFINITIONS.ultra_list_tasks.inputSchema,
    async () => listHandler(),
  );

  server.tool(
    "ultra_watch_agents",
    TOOL_DEFINITIONS.ultra_watch_agents.description,
    TOOL_DEFINITIONS.ultra_watch_agents.inputSchema,
    async () => watchHandler(),
  );

  const transport = new StdioServerTransport();
  logger.info("Starting UltraAgent MCP server on stdio", "mcp");
  await server.connect(transport);
}
