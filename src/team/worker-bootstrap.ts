/**
 * Worker bootstrap — overlay generation, inbox templates, and trigger messages.
 *
 * Generates the protocol instructions that workers follow when joining a team.
 * Adapted from OMX: CLI-agnostic (works with claude, codex, gemini),
 * uses `.ultraagent/` paths instead of `.omx/`, and our lock system.
 *
 * Key components:
 * - Worker overlay: protocol section injected into AGENTS.md/CLAUDE.md
 * - Initial inbox: startup instructions with task list
 * - Task assignment inbox: follow-up task format
 * - Shutdown inbox: graceful shutdown protocol
 * - Trigger messages: short notifications for tmux send-keys
 */

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { withLock } from "./state/locks.js";
import type { TeamTask } from "./state/types.js";

const OVERLAY_START = "<!-- ULTRAAGENT:TEAM:WORKER:START -->";
const OVERLAY_END = "<!-- ULTRAAGENT:TEAM:WORKER:END -->";

export function generateWorkerOverlay(): string {
  return `${OVERLAY_START}
<team_worker_protocol>
You are a team worker. Your identity and assigned tasks are in your inbox file.

## Protocol
1. Read your inbox file at the path provided in your first instruction
2. Send an ACK to the leader using \`ultraagent team api send-message\` (to_worker="leader") once initialized
3. Read your task from \`.ultraagent/team/tasks/task-<id>.json\`
4. Task ID format: APIs use \`task_id: "<id>"\` (e.g. "1"), never "task-1"
5. Claim your task via \`ultraagent team api claim-task\`
6. Do the work using your tools
7. On completion/failure, transition via \`ultraagent team api transition-task\` from "in_progress" to "completed" or "failed"
8. Write \`{"state": "idle", "updated_at": "<ISO timestamp>"}\` to \`.ultraagent/team/workers/<your-name>/status.json\`
9. Wait for new instructions from the leader
10. Check your mailbox at \`.ultraagent/team/mailbox/<your-name>.json\`

## Startup Handshake (Required)
Before any task work, send exactly one ACK:
\`ultraagent team api send-message --from <your-name> --to leader --body "ACK: <your-name> initialized"\`

## Mailbox Protocol
When notified about mailbox messages:
1. List: \`ultraagent team api mailbox-list --worker <your-name>\`
2. Mark delivered: \`ultraagent team api mailbox-mark-delivered --worker <your-name> --message-id <ID>\`

## Rules
- Do NOT edit files outside the paths listed in your task description
- If blocked, write \`{"state": "blocked", "reason": "..."}\` to your status file
- Do NOT write lifecycle fields directly in task files — use claim/transition APIs
- Do NOT spawn sub-agents. Complete work in this worker session only.
</team_worker_protocol>
${OVERLAY_END}`;
}

function stripOverlayFromContent(content: string): string {
  const startIdx = content.indexOf(OVERLAY_START);
  const endIdx = content.indexOf(OVERLAY_END);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) return content;
  const before = content.slice(0, startIdx).trimEnd();
  const after = content.slice(endIdx + OVERLAY_END.length).trimStart();
  return before + (after ? "\n\n" + after : "") + "\n";
}

function overlayLockDir(agentsMdPath: string): string {
  return join(dirname(agentsMdPath), ".ultraagent", ".lock.agents-md");
}

export async function applyWorkerOverlay(
  agentsMdPath: string,
  overlay: string,
): Promise<void> {
  await withLock(
    overlayLockDir(agentsMdPath),
    { staleMs: 30_000, timeoutMs: 5_000 },
    async () => {
      let content = "";
      try {
        content = await readFile(agentsMdPath, "utf-8");
      } catch {
        // File doesn't exist yet
      }
      content = stripOverlayFromContent(content);
      content = content.trimEnd() + "\n\n" + overlay + "\n";
      await writeFile(agentsMdPath, content);
    },
  );
}

export async function stripWorkerOverlay(agentsMdPath: string): Promise<void> {
  await withLock(
    overlayLockDir(agentsMdPath),
    { staleMs: 30_000, timeoutMs: 5_000 },
    async () => {
      try {
        const content = await readFile(agentsMdPath, "utf-8");
        const stripped = stripOverlayFromContent(content);
        if (stripped !== content) {
          await writeFile(agentsMdPath, stripped);
        }
      } catch {
        // File doesn't exist
      }
    },
  );
}

export interface InboxOptions {
  workerRole?: string;
  rolePromptContent?: string;
  leaderCwd?: string;
}

export function generateInitialInbox(
  workerName: string,
  tasks: TeamTask[],
  options: InboxOptions = {},
): string {
  const taskList = tasks
    .map((t) => {
      let entry = `- **Task ${t.id}**: ${t.subject}\n  Description: ${t.description}\n  Status: ${t.status}`;
      if (t.depends_on && t.depends_on.length > 0) {
        entry += `\n  Depends on: ${t.depends_on.join(", ")}`;
      }
      if (t.role) {
        entry += `\n  Role: ${t.role}`;
      }
      return entry;
    })
    .join("\n");

  const displayRole = options.workerRole ?? "worker";
  const specializationSection = options.rolePromptContent
    ? `\n## Your Specialization\n\nYou are operating as a **${displayRole}** agent:\n\n${options.rolePromptContent}\n`
    : "";

  return `# Worker Assignment: ${workerName}

**Role:** ${displayRole}
**Worker Name:** ${workerName}

## Your Assigned Tasks

${taskList}

## Instructions

1. Send startup ACK to the leader BEFORE any task work:
   \`ultraagent team api send-message --from ${workerName} --to leader --body "ACK: ${workerName} initialized"\`
2. Start with the first non-blocked task
3. Read the task file at \`.ultraagent/team/tasks/task-<id>.json\`
4. Claim it via \`ultraagent team api claim-task --task <id> --worker ${workerName}\`
5. Complete the work described in the task
6. Transition via \`ultraagent team api transition-task --task <id> --from in_progress --to completed\`
7. Write \`{"state": "idle", "updated_at": "<ISO>"}\` to \`.ultraagent/team/workers/${workerName}/status.json\`
8. Wait for the next instruction from the leader

## Mailbox Protocol
When notified about messages:
1. List: \`ultraagent team api mailbox-list --worker ${workerName}\`
2. Mark delivered: \`ultraagent team api mailbox-mark-delivered --worker ${workerName} --message-id <ID>\`

## Rules
- Only edit files described in your task descriptions
- If blocked, write \`{"state": "blocked", "reason": "..."}\` to your status file
- Do NOT spawn sub-agents
${specializationSection}`;
}

export function generateTaskAssignmentInbox(
  workerName: string,
  taskId: string,
  taskDescription: string,
): string {
  return `# New Task Assignment

**Worker:** ${workerName}
**Task ID:** ${taskId}

## Task Description

${taskDescription}

## Instructions

1. Read the task file at \`.ultraagent/team/tasks/task-${taskId}.json\`
2. Claim via \`ultraagent team api claim-task --task ${taskId} --worker ${workerName}\`
3. Complete the work
4. Transition via \`ultraagent team api transition-task --task ${taskId} --from in_progress --to completed\`
5. Write \`{"state": "idle", "updated_at": "<ISO>"}\` to your status file
`;
}

export function generateShutdownInbox(workerName: string): string {
  return `# Shutdown Request

All tasks are complete. Please wrap up any remaining work and respond with a shutdown acknowledgement.

## Shutdown Protocol
1. Write your decision to \`.ultraagent/team/workers/${workerName}/shutdown-ack.json\`
2. Format:
   - Accept: \`{"status":"accept","reason":"ok","updated_at":"<iso>"}\`
   - Reject: \`{"status":"reject","reason":"still working","updated_at":"<iso>"}\`
3. Exit your session.
`;
}

export function generateTriggerMessage(workerName: string): string {
  return `Read and follow the instructions in .ultraagent/team/inbox/${workerName}.md`;
}

export function generateMailboxTriggerMessage(
  workerName: string,
  count: number,
): string {
  const n = Number.isFinite(count) ? Math.max(1, Math.floor(count)) : 1;
  return `You have ${n} new message(s). Check .ultraagent/team/mailbox/${workerName}.json`;
}
