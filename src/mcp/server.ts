import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { IpcCoordinator } from '../ipc/index.js';
import { logger } from '../utils/logger.js';
import { createAskAgentHandler, createAssignTaskHandler, createBroadcastHandler } from './handlers.js';
import { TOOL_DEFINITIONS } from './tools.js';

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_PAYLOAD_BYTES = 1_024 * 1_024; // 1 MB

export async function startMcpServer(): Promise<void> {
  const coordinator = new IpcCoordinator({
    defaultTimeoutMs: DEFAULT_TIMEOUT_MS,
    maxPayloadBytes: MAX_PAYLOAD_BYTES,
  });

  const server = new McpServer({ name: 'ultraagent', version: '0.1.0' }, { capabilities: { tools: {} } });

  const askHandler = createAskAgentHandler(coordinator);
  const broadcastHandler = createBroadcastHandler(coordinator);
  const assignHandler = createAssignTaskHandler(coordinator);

  server.tool(
    'ultra_ask_agent',
    TOOL_DEFINITIONS.ultra_ask_agent.description,
    TOOL_DEFINITIONS.ultra_ask_agent.inputSchema,
    async (args) => askHandler(args),
  );

  server.tool(
    'ultra_broadcast',
    TOOL_DEFINITIONS.ultra_broadcast.description,
    TOOL_DEFINITIONS.ultra_broadcast.inputSchema,
    async (args) => broadcastHandler(args),
  );

  server.tool(
    'ultra_assign_task',
    TOOL_DEFINITIONS.ultra_assign_task.description,
    TOOL_DEFINITIONS.ultra_assign_task.inputSchema,
    async (args) => assignHandler(args),
  );

  const transport = new StdioServerTransport();
  logger.info('Starting UltraAgent MCP server on stdio', 'mcp');
  await server.connect(transport);
}
