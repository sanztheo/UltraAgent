import { resolve } from 'node:path';
import { createAdapter } from '../adapters/index.js';
import type { PaneInfo, SessionState, UltraAgentConfig } from '../config/types.js';
import { generateChefInstructions } from '../instructions/chef-prompt.js';
import { generateWorkerInstructions } from '../instructions/worker-prompt.js';
import {
  addPane,
  applyLayout,
  attachToSession,
  destroySession,
  isSessionActive,
  createSession as tmuxCreateSession,
} from '../tmux/index.js';
import { logger } from '../utils/logger.js';
import { projectName } from '../utils/paths.js';
import { clearState, hasActiveSession, loadState, saveState } from './state.js';

function buildSessionName(config: UltraAgentConfig, cwd: string): string {
  return `${config.tmux.session_prefix}-${projectName(cwd)}`;
}

export async function startSession(config: UltraAgentConfig, cwd: string): Promise<void> {
  const resolvedCwd = resolve(cwd);
  const sessionName = buildSessionName(config, resolvedCwd);

  if (hasActiveSession(resolvedCwd)) {
    const existing = loadState(resolvedCwd);
    if (existing && (await isSessionActive(existing.sessionName))) {
      logger.warn(`Session "${existing.sessionName}" is already running. Use 'ultraagent stop' first.`, 'session');
      await attachToSession(existing.sessionName);
      return;
    }
    clearState(resolvedCwd);
  }

  const workers = config.agents.filter((a) => a !== config.chef);
  const name = projectName(resolvedCwd);

  logger.info(`Starting UltraAgent session: ${sessionName}`, 'session');
  logger.info(`Chef: ${config.chef} | Workers: ${workers.join(', ')}`, 'session');

  // Step 1: Create tmux session
  await tmuxCreateSession({
    sessionName,
    cwd: resolvedCwd,
    layout: config.tmux.layout,
  });

  // Step 2: Inject instructions for chef
  const chefAdapter = createAdapter(config.chef);
  const chefInstructions = generateChefInstructions({
    agentName: config.chef,
    workers,
    mcpAvailable: true,
    projectName: name,
  });
  await chefAdapter.injectInstructions('chef', chefInstructions, resolvedCwd);

  // Step 3: Register MCP server for chef
  const mcpCommand = 'node';
  const mcpArgs = [resolve(import.meta.dirname, '../../bin/ultraagent-mcp.js')];
  try {
    await chefAdapter.registerMcpServer('ultraagent', mcpCommand, mcpArgs);
    logger.info('MCP server registered for chef', 'session');
  } catch (error) {
    logger.warn(`Failed to register MCP server: ${error instanceof Error ? error.message : String(error)}`, 'session');
  }

  // Step 4: Launch chef in the first pane (pane 0)
  const chefLaunchCmd = await chefAdapter.getInteractiveLaunchCommand({
    role: 'chef',
    cwd: resolvedCwd,
    permissionMode: config.permissions.chef_mode,
  });
  const panes: PaneInfo[] = [];

  // Send chef command to pane 0 (the default pane created with the session)
  const { tmuxSendKeys } = await import('../tmux/commands.js');
  const chefPaneTarget = `${sessionName}:0.0`;
  const chefCmdStr = [chefLaunchCmd.command, ...chefLaunchCmd.args].join(' ');
  await tmuxSendKeys(chefPaneTarget, chefCmdStr);
  panes.push({
    paneId: chefPaneTarget,
    agent: config.chef,
    role: 'chef',
    ready: true,
  });

  // Step 5: Inject instructions, register MCP, and launch workers interactively
  for (const workerName of workers) {
    const workerAdapter = createAdapter(workerName);
    const available = await workerAdapter.isAvailable();
    if (!available) {
      logger.warn(`Worker ${workerName} is not available, skipping`, 'session');
      continue;
    }

    const workerInstructions = generateWorkerInstructions({
      agentName: workerName,
      role: 'worker',
      chefName: config.chef,
      projectName: name,
    });
    await workerAdapter.injectInstructions('worker', workerInstructions, resolvedCwd);

    // Register MCP server with each worker so they can call ultra_report_complete
    try {
      await workerAdapter.registerMcpServer('ultraagent', mcpCommand, mcpArgs);
      logger.info(`MCP server registered for worker ${workerName}`, 'session');
    } catch (error) {
      logger.warn(
        `Failed to register MCP for ${workerName}: ${error instanceof Error ? error.message : String(error)}`,
        'session',
      );
    }

    // Create pane and launch worker's interactive CLI
    const paneInfo = await addPane(sessionName, workerName, 'worker');
    const workerLaunchCmd = await workerAdapter.getInteractiveLaunchCommand({
      role: 'worker',
      cwd: resolvedCwd,
      permissionMode: config.permissions.worker_mode,
    });
    const workerCmdStr = [workerLaunchCmd.command, ...workerLaunchCmd.args].join(' ');
    await tmuxSendKeys(paneInfo.paneId, workerCmdStr);
    panes.push(paneInfo);
  }

  // Step 6: Apply layout
  await applyLayout(sessionName, config.tmux.layout, panes.length);

  // Step 7: Save state
  const state: SessionState = {
    sessionName,
    chef: config.chef,
    workers,
    panes,
    startedAt: new Date().toISOString(),
    pid: process.pid,
  };
  saveState(resolvedCwd, state);

  logger.success(`UltraAgent session ready with ${panes.length} pane(s)`);

  // Step 8: Attach to tmux session
  await attachToSession(sessionName);
}

export async function stopSession(cwd: string): Promise<void> {
  const resolvedCwd = resolve(cwd);

  const state = loadState(resolvedCwd);
  if (!state) {
    logger.warn('No active session found', 'session');
    return;
  }

  logger.info(`Stopping session "${state.sessionName}"...`, 'session');

  if (await isSessionActive(state.sessionName)) {
    await destroySession(state.sessionName);
  }

  clearState(resolvedCwd);
  logger.success('UltraAgent session stopped');
}

export async function getSessionStatus(cwd: string): Promise<SessionState | undefined> {
  const resolvedCwd = resolve(cwd);
  const state = loadState(resolvedCwd);

  if (!state) {
    return undefined;
  }

  const active = await isSessionActive(state.sessionName);
  if (!active) {
    clearState(resolvedCwd);
    return undefined;
  }

  return state;
}
