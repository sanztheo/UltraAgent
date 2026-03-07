import type {
  AgentName,
  AgentRole,
  PaneInfo,
  ShellCommand,
  TmuxLayout,
} from "../config/types.js";
import {
  tmuxHasSession,
  tmuxNewSession,
  tmuxKillSession,
  tmuxSplitWindow,
  tmuxSendKeys,
  tmuxListPanes,
  tmuxAttach,
} from "./commands.js";
import { createLayout } from "./layout.js";
import { waitForPaneReady } from "./pane.js";
import { logger } from "../utils/logger.js";

export {
  tmuxHasSession,
  tmuxKillSession,
  tmuxCapturePane,
  tmuxSendKeys,
} from "./commands.js";
export { createLayout } from "./layout.js";
export { waitForPaneReady, isPaneReady } from "./pane.js";

const CTX = "session";

export async function createSession(config: {
  sessionName: string;
  cwd: string;
  layout: TmuxLayout;
}): Promise<void> {
  const exists = await tmuxHasSession(config.sessionName);
  if (exists) {
    logger.warn(
      `Session "${config.sessionName}" already exists, destroying first`,
      CTX,
    );
    await tmuxKillSession(config.sessionName);
  }

  await tmuxNewSession(config.sessionName, {
    cwd: config.cwd,
    detached: true,
  });
  logger.info(`Session "${config.sessionName}" created`, CTX);
}

export async function addPane(
  sessionName: string,
  agent: AgentName,
  role: AgentRole,
  command?: ShellCommand,
): Promise<PaneInfo> {
  const paneId = await tmuxSplitWindow(sessionName, { vertical: true });

  if (command) {
    const fullCommand = buildCommandString(command);
    await tmuxSendKeys(paneId, fullCommand);
  }

  const ready = await waitForPaneReady(paneId, { timeoutMs: 5_000 });

  logger.info(
    `Pane ${paneId} added for ${agent} (${role}), ready=${ready}`,
    CTX,
  );

  return { paneId, agent, role, ready };
}

export async function applyLayout(
  sessionName: string,
  layout: TmuxLayout,
  paneCount: number,
): Promise<void> {
  const strategy = createLayout(layout);
  await strategy.apply(sessionName, paneCount);
  logger.info(`Layout "${layout}" applied to "${sessionName}"`, CTX);
}

export async function destroySession(sessionName: string): Promise<void> {
  const exists = await tmuxHasSession(sessionName);
  if (!exists) {
    logger.debug(
      `Session "${sessionName}" does not exist, nothing to destroy`,
      CTX,
    );
    return;
  }
  await tmuxKillSession(sessionName);
  logger.info(`Session "${sessionName}" destroyed`, CTX);
}

export async function getSessionPanes(
  sessionName: string,
): Promise<PaneInfo[]> {
  const rawPanes = await tmuxListPanes(sessionName);
  return rawPanes.map((pane) => ({
    paneId: pane.id,
    agent: "claude" as AgentName,
    role: (pane.index === 0 ? "chef" : "worker") as AgentRole,
    ready: false,
  }));
}

export async function attachToSession(sessionName: string): Promise<void> {
  const exists = await tmuxHasSession(sessionName);
  if (!exists) {
    throw new Error(`Session "${sessionName}" does not exist`);
  }
  await tmuxAttach(sessionName);
}

export async function isSessionActive(sessionName: string): Promise<boolean> {
  return tmuxHasSession(sessionName);
}

function buildCommandString(cmd: ShellCommand): string {
  const envPrefix = cmd.env
    ? Object.entries(cmd.env)
        .map(([k, v]) => `${k}=${shellEscape(v)}`)
        .join(" ") + " "
    : "";
  const args = cmd.args.map(shellEscape).join(" ");
  return `${envPrefix}${cmd.command} ${args}`;
}

function shellEscape(value: string): string {
  if (/^[a-zA-Z0-9._\-/=:@]+$/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, "'\\''")}'`;
}
