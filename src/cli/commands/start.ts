import { loadConfig } from "../../config/index.js";
import { startSession } from "../../orchestrator/session.js";
import { logger } from "../../utils/logger.js";

export async function startCommand(): Promise<void> {
  const cwd = process.cwd();

  try {
    const config = loadConfig(cwd);
    await startSession(config, cwd);
  } catch (error) {
    logger.error(
      `Failed to start: ${error instanceof Error ? error.message : String(error)}`,
      "cli",
    );
    process.exit(1);
  }
}
