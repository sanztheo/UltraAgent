import { readFile, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentName, AgentResponse } from "../config/types.js";
import { tmuxSendKeys } from "../tmux/commands.js";
import { loadState } from "../orchestrator/state.js";
import { sleep } from "../utils/process.js";
import { logger } from "../utils/logger.js";

const CTX = "ipc:conv";

// ─── Conversation file locators ─────────────────────────────────────

function encodeCwdForClaude(cwd: string): string {
  return cwd.replace(/\//g, "-");
}

function getSearchRoots(agent: AgentName, cwd: string): string[] {
  const home = homedir();
  switch (agent) {
    case "claude":
      return [join(home, ".claude", "projects", encodeCwdForClaude(cwd))];
    case "gemini":
      return [join(home, ".gemini", "tmp")];
    case "codex": {
      const now = new Date();
      const y = now.getFullYear().toString();
      const m = (now.getMonth() + 1).toString().padStart(2, "0");
      const d = now.getDate().toString().padStart(2, "0");
      return [
        join(home, ".codex", "sessions", y, m, d),
        join(home, ".codex", "sessions"),
      ];
    }
  }
}

function matchesAgent(agent: AgentName, fileName: string): boolean {
  switch (agent) {
    case "claude":
      return fileName.endsWith(".jsonl") && !fileName.startsWith("summary-");
    case "gemini":
      return fileName.endsWith(".json");
    case "codex":
      return fileName.endsWith(".jsonl");
  }
}

async function findMostRecentFile(
  dir: string,
  agent: AgentName,
  maxDepth: number,
): Promise<string | undefined> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    let newest: { path: string; mtime: number } | undefined;

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isFile() && matchesAgent(agent, entry.name)) {
        const s = await stat(fullPath);
        if (!newest || s.mtimeMs > newest.mtime) {
          newest = { path: fullPath, mtime: s.mtimeMs };
        }
      } else if (entry.isDirectory() && maxDepth > 0) {
        const sub = await findMostRecentFile(fullPath, agent, maxDepth - 1);
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
  const roots = getSearchRoots(agent, cwd);
  const depth = agent === "gemini" ? 4 : 1;

  for (const root of roots) {
    const file = await findMostRecentFile(root, agent, depth);
    if (file) return file;
  }
  return undefined;
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

function parseGeminiNewModels(content: string, skipCount: number): string[] {
  try {
    const data = JSON.parse(content);
    const messages: Array<{ role: string; parts?: Array<{ text?: string }> }> =
      Array.isArray(data) ? data : (data.messages ?? data.history ?? []);

    let modelIdx = 0;
    const texts: string[] = [];

    for (const msg of messages) {
      if (msg.role !== "model") continue;
      modelIdx++;
      if (modelIdx <= skipCount) continue;

      const t = (msg.parts ?? [])
        .filter((p) => p.text)
        .map((p) => p.text as string);

      if (t.length > 0) texts.push(t.join("\n"));
    }

    return texts;
  } catch {
    return [];
  }
}

function parseCodexNewLines(lines: string[]): string[] {
  const texts: string[] = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const ev = JSON.parse(line);
      const payload = ev.payload ?? ev;

      const isResponse =
        ev.type === "response_item" ||
        ev.type === "message" ||
        payload.role === "assistant";

      if (!isResponse) continue;

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

// ─── Count existing model messages (Gemini only) ─────────────────────

function countGeminiModels(content: string): number {
  try {
    const data = JSON.parse(content);
    const msgs: Array<{ role: string }> = Array.isArray(data)
      ? data
      : (data.messages ?? data.history ?? []);
    return msgs.filter((m) => m.role === "model").length;
  } catch {
    return 0;
  }
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

  await tmuxSendKeys(pane.paneId, prompt);
  logger.debug(`Prompt sent to ${agentName} pane`, CTX);

  // 3. Wait for agent to start processing
  await sleep(3_000);

  // 4. Poll conversation file for new assistant content
  let responseText = "";
  let stableChecks = 0;
  const STABLE_THRESHOLD = 4; // 2s stable (4 × 500ms)

  while (Date.now() - start < timeout) {
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
