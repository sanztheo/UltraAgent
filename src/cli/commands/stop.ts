import { stopSession } from '../../orchestrator/session.js';
import { logger } from '../../utils/logger.js';

export async function stopCommand(): Promise<void> {
  const cwd = process.cwd();

  try {
    await stopSession(cwd);
  } catch (error) {
    logger.error(`Failed to stop: ${error instanceof Error ? error.message : String(error)}`, 'cli');
    process.exit(1);
  }
}
