#!/usr/bin/env node

import { startMcpServer } from "../src/mcp/server.js";

startMcpServer().catch((error: unknown) => {
  console.error(
    "MCP server failed:",
    error instanceof Error ? error.message : String(error),
  );
  process.exit(1);
});
