import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { logger } from '../utils/logger.js';
import {
  createAskAgentHandler,
  createAssignTaskHandler,
  createBroadcastHandler,
  createGetTaskResultHandler,
  createListTasksHandler,
  createReportCompleteHandler,
  createWatchAgentsHandler,
} from './handlers.js';
import { TOOL_DEFINITIONS } from './tools.js';

export async function startMcpServer(): Promise<void> {
  const server = new McpServer({ name: 'ultraagent', version: '0.3.0' }, { capabilities: { tools: {} } });

  const askHandler = createAskAgentHandler();
  const broadcastHandler = createBroadcastHandler();
  const assignHandler = createAssignTaskHandler();
  const getResultHandler = createGetTaskResultHandler();
  const listHandler = createListTasksHandler();
  const watchHandler = createWatchAgentsHandler();
  const reportHandler = createReportCompleteHandler();

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

  server.tool(
    'ultra_get_task_result',
    TOOL_DEFINITIONS.ultra_get_task_result.description,
    TOOL_DEFINITIONS.ultra_get_task_result.inputSchema,
    async (args) => getResultHandler(args),
  );

  server.tool(
    'ultra_list_tasks',
    TOOL_DEFINITIONS.ultra_list_tasks.description,
    TOOL_DEFINITIONS.ultra_list_tasks.inputSchema,
    async () => listHandler(),
  );

  server.tool(
    'ultra_watch_agents',
    TOOL_DEFINITIONS.ultra_watch_agents.description,
    TOOL_DEFINITIONS.ultra_watch_agents.inputSchema,
    async () => watchHandler(),
  );

  server.tool(
    'ultra_report_complete',
    TOOL_DEFINITIONS.ultra_report_complete.description,
    TOOL_DEFINITIONS.ultra_report_complete.inputSchema,
    async (args) => reportHandler(args),
  );

  const transport = new StdioServerTransport();
  logger.info('Starting UltraAgent MCP server on stdio', 'mcp');
  await server.connect(transport);
}
