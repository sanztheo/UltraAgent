import { readFile, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { AgentName, AgentResponse } from "../config/types.js";
import { tmuxSendKeys, tmuxCapturePane } from "../tmux/commands.js";
import { loadState } from "../orchestrator/state.js";
import { sleep } from "../utils/process.js";
import { logger } from "../utils/logger.js";
import { execCommand } from "../utils/shell.js";

const CTX = "ipc:conv";

// ─── Rate limit / error detection ───────────────────────────────────

const ERROR_PATTERNS = [
  /you've hit your usage limit/i,
  /usage limit exceeded/i,
  /rate limit/i,
  /quota exceeded/i,
  /too many requests/i,
  /error 429/i,
  /overloaded_error/i,
  /credit balance is too low/i,
  /billing/i,
];

async function checkPaneForErrors(paneId: string): Promise<string | undefined> {
  const content = await tmuxCapturePane(paneId);
  // Check last 15 lines for error patterns
  const lastLines = content.split("\n").slice(-15).join("\n");
  for (const pattern of ERROR_PATTERNS) {
    if (pattern.test(lastLines)) {
      // Extract the matching line for context
      const match = lastLines.split("\n").find((line) => pattern.test(line));
      return match?.trim() ?? "Rate limit or error detected";
    }
  }
  return undefined;
}

// ─── Conversation file locators ─────────────────────────────────────

function encodeCwdForClaude(cwd: string): string {
  return cwd.replace(/\//g, "-");
}

/** Read ~/.gemini/projects.json to resolve project name for a cwd */
async function resolveGeminiProjectName(cwd: string): Promise<string> {
  const projectsFile = join(homedir(), ".gemini", "projects.json");
  try {
    const raw = await readFile(projectsFile, "utf-8");
    const data = JSON.parse(raw) as { projects?: Record<string, string> };
    if (data.projects?.[cwd]) return data.projects[cwd];
  } catch {
    /* file may not exist */
  }
  // Fallback: lowercase basename
  return basename(cwd).toLowerCase().replace(/\s+/g, "-");
}

/** Query Codex SQLite for the most recent rollout_path matching cwd */
async function resolveCodexRolloutPath(
  cwd: string,
): Promise<string | undefined> {
  const dbPath = join(homedir(), ".codex", "state_5.sqlite");
  try {
    const result = await execCommand("sqlite3", [
      dbPath,
      `SELECT rollout_path FROM threads WHERE cwd='${cwd}' ORDER BY created_at DESC LIMIT 1;`,
    ]);
    const path = result.stdout.trim();
    if (path) return path;
  } catch {
    /* sqlite3 not available or db missing */
  }
  return undefined;
}

async function findMostRecentFile(
  dir: string,
  extensions: string[],
  maxDepth: number,
): Promise<string | undefined> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    let newest: { path: string; mtime: number } | undefined;

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isFile()) {
        const matchesExt = extensions.some((ext) => entry.name.endsWith(ext));
        const isSummary = entry.name.startsWith("summary-");
        if (matchesExt && !isSummary) {
          const s = await stat(fullPath);
          if (!newest || s.mtimeMs > newest.mtime) {
            newest = { path: fullPath, mtime: s.mtimeMs };
          }
        }
      } else if (entry.isDirectory() && maxDepth > 0) {
        const sub = await findMostRecentFile(
          fullPath,
          extensions,
          maxDepth - 1,
        );
        if (sub) {
          const s = await stat(sub);
          if (!newest || s.mtimeMs > newest.mtime) {
            newest = { path: sub, mtime: s.mtimeMs };
          }
        }
      }
    }

    return newest?.path;
  } catch {
    return undefined;
  }
}

async function findActiveFile(
  agent: AgentName,
  cwd: string,
): Promise<string | undefined> {
  const home = homedir();

  switch (agent) {
    case "claude": {
      const dir = join(home, ".claude", "projects", encodeCwdForClaude(cwd));
      return findMostRecentFile(dir, [".jsonl"], 1);
    }
    case "gemini": {
      const projectName = await resolveGeminiProjectName(cwd);
      const chatsDir = join(home, ".gemini", "tmp", projectName, "chats");
      return findMostRecentFile(chatsDir, [".json"], 1);
    }
    case "codex": {
      // Try SQLite first (most reliable)
      const fromDb = await resolveCodexRolloutPath(cwd);
      if (fromDb) {
        try {
          await stat(fromDb);
          return fromDb;
        } catch {
          /* file gone */
        }
      }
      // Fallback: most recent rollout in today's dir
      const now = new Date();
      const y = now.getFullYear().toString();
      const m = (now.getMonth() + 1).toString().padStart(2, "0");
      const d = now.getDate().toString().padStart(2, "0");
      const dir = join(home, ".codex", "sessions", y, m, d);
      return findMostRecentFile(dir, [".jsonl"], 1);
    }
  }
}

// ─── Parsers: extract only assistant text ────────────────────────────

function parseClaudeNewLines(lines: string[]): string[] {
  const texts: string[] = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const ev = JSON.parse(line);
      if (ev.type !== "assistant") continue;

      const content = ev.message?.content;
      if (!content) continue;

      const parts = Array.isArray(content)
        ? content
        : [{ type: "text", text: String(content) }];

      for (const part of parts) {
        if (part.type === "text" && part.text) {
          texts.push(part.text);
        }
      }
    } catch {
      /* skip malformed */
    }
  }

  return texts;
}

/**
 * Gemini session format:
 * { messages: [{ type: "gemini", content: "text..." }, ...] }
 */
function parseGeminiNewModels(raw: string, skipCount: number): string[] {
  try {
    const data = JSON.parse(raw);
    const messages: Array<{ type?: string; content?: unknown }> =
      data.messages ?? [];

    let geminiIdx = 0;
    const texts: string[] = [];

    for (const msg of messages) {
      if (msg.type !== "gemini") continue;
      geminiIdx++;
      if (geminiIdx <= skipCount) continue;

      // content is a string in Gemini's format
      if (typeof msg.content === "string" && msg.content.length > 0) {
        texts.push(msg.content);
      }
    }

    return texts;
  } catch {
    return [];
  }
}

function countGeminiModels(raw: string): number {
  try {
    const data = JSON.parse(raw);
    const messages: Array<{ type?: string }> = data.messages ?? [];
    return messages.filter((m) => m.type === "gemini").length;
  } catch {
    return 0;
  }
}

/**
 * Codex rollout JSONL format:
 * { type: "response_item", payload: { type: "message", role: "assistant",
 *   content: [{ type: "output_text", text: "..." }] } }
 */
function parseCodexNewLines(lines: string[]): string[] {
  const texts: string[] = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const ev = JSON.parse(line);
      if (ev.type !== "response_item") continue;

      const payload = ev.payload;
      if (payload?.role !== "assistant") continue;

      const c = payload.content;
      if (typeof c === "string") {
        texts.push(c);
      } else if (Array.isArray(c)) {
        for (const part of c) {
          if (
            (part.type === "output_text" || part.type === "text") &&
            part.text
          ) {
            texts.push(part.text);
          }
        }
      }
    } catch {
      /* skip malformed */
    }
  }

  return texts;
}

// ─── Main ────────────────────────────────────────────────────────────

export async function askViaConversation(
  agentName: AgentName,
  prompt: string,
  options?: { cwd?: string; timeoutMs?: number },
): Promise<AgentResponse> {
  const cwd = options?.cwd ?? process.cwd();
  const timeout = options?.timeoutMs ?? 120_000;
  const start = Date.now();

  // 1. Find active conversation file & record baseline
  let convFile = await findActiveFile(agentName, cwd);
  let startOffset = 0;
  let startModelCount = 0;

  if (convFile) {
    try {
      if (agentName === "gemini") {
        const raw = await readFile(convFile, "utf-8");
        startModelCount = countGeminiModels(raw);
      } else {
        const s = await stat(convFile);
        startOffset = s.size;
      }
    } catch {
      /* file might vanish */
    }
  }

  logger.info(`Conv IPC → ${agentName} (file: ${convFile ?? "pending"})`, CTX);

  // 2. Send prompt via tmux send-keys (visible in pane)
  const state = loadState(cwd);
  if (!state) throw new Error("No active UltraAgent session found");

  const pane = state.panes.find((p) => p.agent === agentName);
  if (!pane) throw new Error(`No pane found for agent "${agentName}"`);

  // Flatten newlines — tmux send-keys -l treats \n as Enter keypresses
  const flatPrompt = prompt.replace(/\n+/g, " ").trim();
  await tmuxSendKeys(pane.paneId, flatPrompt);
  logger.debug(
    `Prompt sent to ${agentName} pane (${flatPrompt.length} chars)`,
    CTX,
  );

  // 3. Wait for agent to start processing
  await sleep(3_000);

  // 4. Poll conversation file for new assistant content
  let responseText = "";
  let stableChecks = 0;
  let pollCount = 0;
  const STABLE_THRESHOLD = 4; // 2s stable (4 × 500ms)
  const ERROR_CHECK_INTERVAL = 6; // Check pane for errors every ~3s

  while (Date.now() - start < timeout) {
    pollCount++;

    // Periodically check tmux pane for rate limits / errors
    if (pollCount % ERROR_CHECK_INTERVAL === 0) {
      const paneError = await checkPaneForErrors(pane.paneId);
      if (paneError) {
        logger.warn(`${agentName} error detected: ${paneError}`, CTX);
        return {
          agent: agentName,
          content: `Error: ${paneError}`,
          exitCode: 1,
          durationMs: Date.now() - start,
        };
      }
    }

    // Re-find file if it wasn't found initially (created after prompt)
    const currentFile = convFile ?? (await findActiveFile(agentName, cwd));

    if (!currentFile) {
      await sleep(1_000);
      continue;
    }
    convFile = currentFile;

    try {
      let extracted: string[] = [];

      if (agentName === "gemini") {
        const raw = await readFile(currentFile, "utf-8");
        extracted = parseGeminiNewModels(raw, startModelCount);
      } else {
        const buf = await readFile(currentFile);
        if (buf.length <= startOffset) {
          await sleep(500);
          continue;
        }
        const newContent = buf.slice(startOffset).toString("utf-8");
        const newLines = newContent.split("\n");

        extracted =
          agentName === "claude"
            ? parseClaudeNewLines(newLines)
            : parseCodexNewLines(newLines);
      }

      const candidateText = extracted.join("\n\n").trim();

      if (candidateText.length > 0 && candidateText === responseText) {
        stableChecks++;
        if (stableChecks >= STABLE_THRESHOLD) {
          logger.debug(`${agentName} response stable`, CTX);
          break;
        }
      } else if (candidateText.length > 0) {
        responseText = candidateText;
        stableChecks = 0;
      }
    } catch (error) {
      logger.debug(
        `Conv file read error: ${error instanceof Error ? error.message : String(error)}`,
        CTX,
      );
    }

    await sleep(500);
  }

  if (!responseText) {
    logger.warn(`No response from ${agentName} conversation file`, CTX);
    responseText = "[No response captured from conversation file]";
  }

  const durationMs = Date.now() - start;
  logger.info(
    `${agentName} responded (${responseText.length} chars, ${durationMs}ms)`,
    CTX,
  );

  return {
    agent: agentName,
    content: responseText,
    exitCode: 0,
    durationMs,
  };
}
