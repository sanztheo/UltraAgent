import { execCommand, spawnInteractive } from "../utils/shell.js";
import { logger } from "../utils/logger.js";

const CTX = "tmux";

export async function tmuxHasSession(name: string): Promise<boolean> {
  const result = await execCommand("tmux", ["has-session", "-t", name]);
  return result.exitCode === 0;
}

export async function tmuxNewSession(
  name: string,
  options?: { cwd?: string; detached?: boolean },
): Promise<void> {
  const args = ["new-session", "-s", name];
  if (options?.detached !== false) {
    args.push("-d");
  }
  if (options?.cwd) {
    args.push("-c", options.cwd);
  }

  const result = await execCommand("tmux", args);
  if (result.exitCode !== 0) {
    logger.error(`Failed to create session "${name}": ${result.stderr}`, CTX);
    throw new Error(`tmux new-session failed: ${result.stderr}`);
  }
  logger.debug(`Created session "${name}"`, CTX);
}

export async function tmuxKillSession(name: string): Promise<void> {
  const result = await execCommand("tmux", ["kill-session", "-t", name]);
  if (result.exitCode !== 0) {
    logger.warn(`Failed to kill session "${name}": ${result.stderr}`, CTX);
  } else {
    logger.debug(`Killed session "${name}"`, CTX);
  }
}

export async function tmuxSplitWindow(
  sessionName: string,
  options?: { vertical?: boolean; cwd?: string },
): Promise<string> {
  const args = ["split-window", "-t", sessionName, "-P", "-F", "#{pane_id}"];
  if (options?.vertical) {
    args.push("-h");
  }
  if (options?.cwd) {
    args.push("-c", options.cwd);
  }

  const result = await execCommand("tmux", args);
  if (result.exitCode !== 0) {
    logger.error(
      `Failed to split window in "${sessionName}": ${result.stderr}`,
      CTX,
    );
    throw new Error(`tmux split-window failed: ${result.stderr}`);
  }

  const paneId = result.stdout.trim();
  logger.debug(`Created pane ${paneId} in "${sessionName}"`, CTX);
  return paneId;
}

export async function tmuxSendKeys(
  paneTarget: string,
  keys: string,
): Promise<void> {
  // Send text literally (-l flag prevents tmux from interpreting special keys)
  const textResult = await execCommand("tmux", [
    "send-keys",
    "-t",
    paneTarget,
    "-l",
    keys,
  ]);
  if (textResult.exitCode !== 0) {
    logger.error(
      `Failed to send keys to ${paneTarget}: ${textResult.stderr}`,
      CTX,
    );
    throw new Error(`tmux send-keys failed: ${textResult.stderr}`);
  }

  // Then press Enter separately
  const enterResult = await execCommand("tmux", [
    "send-keys",
    "-t",
    paneTarget,
    "Enter",
  ]);
  if (enterResult.exitCode !== 0) {
    logger.error(
      `Failed to send Enter to ${paneTarget}: ${enterResult.stderr}`,
      CTX,
    );
    throw new Error(`tmux send-keys Enter failed: ${enterResult.stderr}`);
  }
}

export async function tmuxSelectLayout(
  sessionName: string,
  layout: string,
): Promise<void> {
  const result = await execCommand("tmux", [
    "select-layout",
    "-t",
    sessionName,
    layout,
  ]);
  if (result.exitCode !== 0) {
    logger.error(
      `Failed to set layout "${layout}" on "${sessionName}": ${result.stderr}`,
      CTX,
    );
    throw new Error(`tmux select-layout failed: ${result.stderr}`);
  }
  logger.debug(`Applied layout "${layout}" to "${sessionName}"`, CTX);
}

export async function tmuxCapturePane(paneTarget: string): Promise<string> {
  const result = await execCommand("tmux", [
    "capture-pane",
    "-t",
    paneTarget,
    "-p",
    "-J",
  ]);
  if (result.exitCode !== 0) {
    logger.error(`Failed to capture pane ${paneTarget}: ${result.stderr}`, CTX);
    return "";
  }
  return result.stdout;
}

export async function tmuxListPanes(
  sessionName: string,
): Promise<{ id: string; index: number; active: boolean }[]> {
  const result = await execCommand("tmux", [
    "list-panes",
    "-t",
    sessionName,
    "-F",
    "#{pane_id}:#{pane_index}:#{pane_active}",
  ]);
  if (result.exitCode !== 0) {
    logger.error(
      `Failed to list panes for "${sessionName}": ${result.stderr}`,
      CTX,
    );
    return [];
  }

  return result.stdout
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      const parts = line.split(":");
      return {
        id: parts[0] ?? "",
        index: Number(parts[1]),
        active: parts[2] === "1",
      };
    });
}

export async function tmuxSelectPane(paneTarget: string): Promise<void> {
  const result = await execCommand("tmux", ["select-pane", "-t", paneTarget]);
  if (result.exitCode !== 0) {
    logger.error(`Failed to select pane ${paneTarget}: ${result.stderr}`, CTX);
  }
}

export async function tmuxAttach(sessionName: string): Promise<void> {
  const child = spawnInteractive("tmux", ["attach-session", "-t", sessionName]);
  return new Promise((resolve, reject) => {
    child.on("close", (code) => {
      if (code === 0 || code === null) {
        resolve();
      } else {
        reject(new Error(`tmux attach exited with code ${code}`));
      }
    });
    child.on("error", reject);
  });
}
