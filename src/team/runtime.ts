/**
 * Team runtime — main orchestration loop.
 *
 * Adapted from OMX's 2329-line runtime.ts, simplified to ~600 lines:
 * - Only tmux interactive mode (no prompt-mode child processes)
 * - Uses `cwd` directly (single-team-per-project model)
 * - No Codex-specific hacks (trust prompts, model instructions file env)
 * - Uses existing UltraAgent modules directly
 *
 * Core operations:
 * - startTeam: init state, create tmux session, bootstrap workers
 * - monitorTeam: poll files, check health, reclaim expired claims, emit events
 * - assignTask: claim + dispatch to worker
 * - shutdownTeam: graceful shutdown with ack, force kill, cleanup
 */

import { existsSync } from "fs";
import { mkdir, rm } from "fs/promises";
import { join, resolve } from "path";
import { performance } from "perf_hooks";

import {
  teamDir,
  teamTasksDir,
  teamWorkersDir,
  teamMailboxDir,
  teamDispatchDir,
  teamInboxDir,
} from "../utils/paths.js";
import { writeAtomic } from "./state/io.js";
import {
  createTeamTask,
  claimTask,
  readTask,
  listTeamTasks,
  releaseTaskClaim,
} from "./state/tasks.js";
import {
  readWorkerStatus,
  readWorkerHeartbeat,
  listWorkers,
} from "./state/workers.js";
import { appendTeamEvent } from "./state/events.js";
import {
  readMonitorSnapshot,
  writeMonitorSnapshot,
  readTeamPhase,
  writeTeamPhase,
  type MonitorSnapshotState,
} from "./state/monitor.js";
import { writeShutdownRequest } from "./state/shutdown.js";
import { queueInboxInstruction } from "./mcp-comm.js";
import {
  generateInitialInbox,
  generateTaskAssignmentInbox,
  generateShutdownInbox,
  generateTriggerMessage,
} from "./worker-bootstrap.js";
import {
  isTmuxAvailable,
  createTeamSession,
  waitForWorkerReady,
  sendToWorker,
  isWorkerAlive,
  teardownWorkerPanes,
  resolveWorkerCli,
  type TeamSession,
} from "./tmux-session.js";
import {
  inferPhaseTargetFromTaskCounts,
  reconcilePhaseStateForMonitor,
} from "./phase-controller.js";
import { hasStructuredVerificationEvidence } from "../verification/verifier.js";
import type {
  TeamPhase,
  TeamPhaseState,
  TerminalPhase,
} from "./orchestrator.js";
import type { WorkerCli } from "./model-contract.js";
import type {
  CreateTaskInput,
  TeamTask,
  DispatchOutcome,
} from "./state/types.js";

export interface TeamSnapshot {
  phase: TeamPhase | TerminalPhase;
  workers: Array<{
    name: string;
    alive: boolean;
    state: string;
    currentTaskId: string;
    turnsWithoutProgress: number;
  }>;
  tasks: {
    total: number;
    pending: number;
    blocked: number;
    in_progress: number;
    completed: number;
    failed: number;
    items: TeamTask[];
  };
  allTasksTerminal: boolean;
  deadWorkers: string[];
  nonReportingWorkers: string[];
  recommendations: string[];
  performance?: {
    list_tasks_ms: number;
    worker_scan_ms: number;
    total_ms: number;
  };
}

export interface TeamRuntime {
  session: TeamSession;
  cwd: string;
  workerCount: number;
  agentType: string;
}

export interface TeamStartOptions {
  workerCount?: number;
  agentType?: string;
  workerLaunchArgs?: string[];
  readyTimeoutMs?: number;
}

interface ShutdownOptions {
  force?: boolean;
}

const DEFAULT_WORKER_COUNT = 2;
const DEFAULT_AGENT_TYPE = "executor";
const DEFAULT_READY_TIMEOUT_MS = 45_000;
const SHUTDOWN_WAIT_MS = 15_000;
const SHUTDOWN_POLL_MS = 2_000;
const NON_REPORTING_TURN_THRESHOLD = 5;

export async function startTeam(
  cwd: string,
  task: string,
  tasks: CreateTaskInput[],
  options: TeamStartOptions = {},
): Promise<TeamRuntime> {
  const resolvedCwd = resolve(cwd);
  const workerCount = options.workerCount ?? DEFAULT_WORKER_COUNT;
  const agentType = options.agentType ?? DEFAULT_AGENT_TYPE;
  const readyTimeoutMs = options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
  const launchArgs = options.workerLaunchArgs ?? [];

  if (!isTmuxAvailable()) {
    throw new Error(
      "Team mode requires tmux. Install with: brew install tmux / apt install tmux",
    );
  }
  if (!process.env.TMUX) {
    throw new Error(
      "Team mode requires running inside a tmux session (leader pane)",
    );
  }

  await initTeamDirs(resolvedCwd);

  const tDir = teamDir(resolvedCwd);
  const tTasksDir = teamTasksDir(resolvedCwd);

  for (const t of tasks) {
    await createTeamTask(tDir, tTasksDir, t);
  }

  const allTasks = await listTeamTasks(tTasksDir);
  const workerCli = resolveWorkerCli(launchArgs, process.env);

  const workerStartups = buildWorkerStartups(
    workerCount,
    resolvedCwd,
    launchArgs,
    workerCli,
  );
  const session = createTeamSession(
    workerCount,
    resolvedCwd,
    launchArgs,
    workerStartups,
  );
  const createdPaneIds = [...session.workerPaneIds];

  try {
    for (let i = 0; i < workerCount; i++) {
      const workerName = `worker-${i + 1}`;
      const workerIndex = i + 1;
      const paneId = session.workerPaneIds[i];

      await writeWorkerIdentity(resolvedCwd, workerName, {
        name: workerName,
        index: workerIndex,
        role: agentType,
        worker_cli: workerCli,
        pane_id: paneId,
      });

      const workerTasks = allTasks.filter((t) => t.owner === workerName);
      const inbox = generateInitialInbox(workerName, workerTasks, {
        workerRole: agentType,
        leaderCwd: resolvedCwd,
      });
      const trigger = generateTriggerMessage(workerName);

      const ready = waitForWorkerReady(
        session.name,
        workerIndex,
        readyTimeoutMs,
        paneId,
      );
      if (!ready) {
        throw new Error(
          `Worker ${workerName} did not become ready within ${readyTimeoutMs}ms`,
        );
      }

      const outcome = await dispatchInbox({
        cwd: resolvedCwd,
        workerName,
        workerIndex,
        paneId,
        inbox,
        triggerMessage: trigger,
        sessionName: session.name,
      });
      if (!outcome.ok) {
        throw new Error(`worker_notify_failed:${workerName}`);
      }
    }

    await writeTeamConfig(resolvedCwd, {
      task,
      agentType,
      workerCount,
      workerCli,
      tmuxSession: session.name,
      leaderPaneId: session.leaderPaneId,
      workerPaneIds: session.workerPaneIds,
      startedAt: new Date().toISOString(),
    });

    return { session, cwd: resolvedCwd, workerCount, agentType };
  } catch (error) {
    for (const paneId of createdPaneIds) {
      try {
        await teardownWorkerPanes([paneId], {
          leaderPaneId: session.leaderPaneId,
        });
      } catch {
        // best effort
      }
    }
    await cleanupTeamState(resolvedCwd);
    throw error;
  }
}

export async function monitorTeam(cwd: string): Promise<TeamSnapshot | null> {
  const monitorStartMs = performance.now();
  const resolvedCwd = resolve(cwd);
  const config = await readTeamConfig(resolvedCwd);
  if (!config) return null;

  const tTasksDir = teamTasksDir(resolvedCwd);
  const tWorkersDir = teamWorkersDir(resolvedCwd);
  const previousSnapshot = await readMonitorSnapshot(resolvedCwd);

  const listTasksStartMs = performance.now();
  const allTasks = await listTeamTasks(tTasksDir);
  const listTasksMs = performance.now() - listTasksStartMs;

  const taskCounts = countTasks(allTasks);

  const workerScanStartMs = performance.now();
  const workerNames = await listWorkers(tWorkersDir);
  const workers: TeamSnapshot["workers"] = [];
  const deadWorkers: string[] = [];
  const nonReportingWorkers: string[] = [];
  const recommendations: string[] = [];

  for (const name of workerNames) {
    const [status, heartbeat] = await Promise.all([
      readWorkerStatus(tWorkersDir, name),
      readWorkerHeartbeat(tWorkersDir, name),
    ]);
    const workerIndex = extractWorkerIndex(name);
    const paneId = config.workerPaneIds[workerIndex - 1];
    const alive = isWorkerAlive(config.tmuxSession, workerIndex, paneId);

    const previousTurns = previousSnapshot
      ? (previousSnapshot.workerTurnCountByName[name] ?? 0)
      : 0;
    const previousTaskId = previousSnapshot?.workerTaskIdByName[name] ?? "";
    const currentTaskId = status?.current_task_id ?? "";
    const currentState = status?.state ?? "unknown";

    const turnsWithoutProgress =
      heartbeat &&
      previousSnapshot &&
      currentState === "working" &&
      currentTaskId !== "" &&
      previousTaskId === currentTaskId
        ? Math.max(0, heartbeat.turn_count - previousTurns)
        : 0;

    workers.push({
      name,
      alive,
      state: currentState,
      currentTaskId,
      turnsWithoutProgress,
    });

    if (!alive) {
      deadWorkers.push(name);
      const inProgressTasks = allTasks.filter(
        (t) => t.status === "in_progress" && t.owner === name,
      );
      for (const t of inProgressTasks) {
        recommendations.push(`Reassign task-${t.id} from dead ${name}`);
      }
    }

    if (alive && turnsWithoutProgress > NON_REPORTING_TURN_THRESHOLD) {
      nonReportingWorkers.push(name);
      recommendations.push(`Send reminder to non-reporting ${name}`);
    }
  }
  const workerScanMs = performance.now() - workerScanStartMs;

  const verificationPendingTasks = allTasks.filter(
    (task) =>
      task.status === "completed" &&
      task.requires_code_change === true &&
      !hasStructuredVerificationEvidence(task.result),
  );
  if (verificationPendingTasks.length > 0) {
    for (const task of verificationPendingTasks) {
      recommendations.push(`Verification evidence missing for task-${task.id}`);
    }
  }

  const allTasksTerminal =
    taskCounts.pending === 0 &&
    taskCounts.blocked === 0 &&
    taskCounts.in_progress === 0;

  const persistedPhase = await readTeamPhase(resolvedCwd);
  const targetPhase = inferPhaseTargetFromTaskCounts(taskCounts, {
    verificationPending: verificationPendingTasks.length > 0,
  });
  const phaseState = reconcilePhaseStateForMonitor(
    persistedPhase as TeamPhaseState | null,
    targetPhase,
  );
  await writeTeamPhase(resolvedCwd, phaseState);

  await emitMonitorDerivedEvents(
    resolvedCwd,
    allTasks,
    workers,
    previousSnapshot,
  );

  const totalMs = performance.now() - monitorStartMs;
  const snapshot: MonitorSnapshotState = {
    taskStatusById: Object.fromEntries(allTasks.map((t) => [t.id, t.status])),
    workerAliveByName: Object.fromEntries(
      workers.map((w) => [w.name, w.alive]),
    ),
    workerStateByName: Object.fromEntries(
      workers.map((w) => [w.name, w.state]),
    ),
    workerTurnCountByName: {},
    workerTaskIdByName: Object.fromEntries(
      workers.map((w) => [w.name, w.currentTaskId]),
    ),
    completedEventTaskIds: previousSnapshot?.completedEventTaskIds ?? {},
  };

  for (const name of workerNames) {
    const heartbeat = await readWorkerHeartbeat(tWorkersDir, name);
    snapshot.workerTurnCountByName[name] = heartbeat?.turn_count ?? 0;
  }

  await writeMonitorSnapshot(resolvedCwd, snapshot);

  return {
    phase: phaseState.current_phase as TeamPhase | TerminalPhase,
    workers,
    tasks: {
      ...taskCounts,
      items: allTasks,
    },
    allTasksTerminal,
    deadWorkers,
    nonReportingWorkers,
    recommendations,
    performance: {
      list_tasks_ms: Number(listTasksMs.toFixed(2)),
      worker_scan_ms: Number(workerScanMs.toFixed(2)),
      total_ms: Number(totalMs.toFixed(2)),
    },
  };
}

export async function assignTask(
  cwd: string,
  workerName: string,
  taskId: string,
): Promise<void> {
  const resolvedCwd = resolve(cwd);
  const tTasksDir = teamTasksDir(resolvedCwd);
  const config = await readTeamConfig(resolvedCwd);
  if (!config) throw new Error("Team not running");

  const task = await readTask(tTasksDir, taskId);
  if (!task) throw new Error(`Task ${taskId} not found`);

  const claim = await claimTask(tTasksDir, taskId, workerName);
  if (!claim.ok) {
    if (claim.error === "blocked_dependency") {
      throw new Error(
        `blocked_dependency:${(claim.dependencies ?? []).join(",")}`,
      );
    }
    throw new Error(claim.error);
  }

  try {
    const workerIndex = extractWorkerIndex(workerName);
    const paneId = config.workerPaneIds[workerIndex - 1];
    const inbox = generateTaskAssignmentInbox(
      workerName,
      taskId,
      task.description,
    );
    const trigger = generateTriggerMessage(workerName);

    const outcome = await dispatchInbox({
      cwd: resolvedCwd,
      workerName,
      workerIndex,
      paneId,
      inbox,
      triggerMessage: trigger,
      sessionName: config.tmuxSession,
    });

    if (!outcome.ok) {
      throw new Error("worker_notify_failed");
    }
  } catch (error) {
    await releaseTaskClaim(tTasksDir, taskId, claim.claimToken).catch(() => {});
    throw error;
  }
}

export async function shutdownTeam(
  cwd: string,
  options: ShutdownOptions = {},
): Promise<void> {
  const force = options.force === true;
  const resolvedCwd = resolve(cwd);
  const config = await readTeamConfig(resolvedCwd);

  if (!config) {
    await cleanupTeamState(resolvedCwd);
    return;
  }

  if (!force) {
    const tTasksDir = teamTasksDir(resolvedCwd);
    const allTasks = await listTeamTasks(tTasksDir);
    const counts = countTasks(allTasks);
    const allowed =
      counts.pending === 0 &&
      counts.blocked === 0 &&
      counts.in_progress === 0 &&
      counts.failed === 0;

    if (!allowed) {
      throw new Error(
        `shutdown_gate_blocked:pending=${counts.pending},blocked=${counts.blocked},in_progress=${counts.in_progress},failed=${counts.failed}`,
      );
    }
  }

  await writeShutdownRequest(resolvedCwd, force ? "force" : "graceful");

  for (let i = 0; i < config.workerCount; i++) {
    const workerName = `worker-${i + 1}`;
    const paneId = config.workerPaneIds[i];
    try {
      const inbox = generateShutdownInbox(workerName);
      const trigger = generateTriggerMessage(workerName);
      await dispatchInbox({
        cwd: resolvedCwd,
        workerName,
        workerIndex: i + 1,
        paneId,
        inbox,
        triggerMessage: trigger,
        sessionName: config.tmuxSession,
      });
    } catch {
      // best effort per worker
    }
  }

  const deadline = Date.now() + SHUTDOWN_WAIT_MS;
  while (Date.now() < deadline) {
    const anyAlive = Array.from({ length: config.workerCount }, (_, i) =>
      isWorkerAlive(config.tmuxSession, i + 1, config.workerPaneIds[i]),
    ).some(Boolean);
    if (!anyAlive) break;
    await new Promise((r) => setTimeout(r, SHUTDOWN_POLL_MS));
  }

  const validPaneIds = config.workerPaneIds.filter(
    (id): id is string => typeof id === "string" && id.startsWith("%"),
  );
  await teardownWorkerPanes(validPaneIds, {
    leaderPaneId: config.leaderPaneId,
  });

  await appendTeamEvent(resolvedCwd, {
    type: "worker_stopped",
    worker: "leader",
    reason: force ? "force_shutdown" : "graceful_shutdown",
  }).catch(() => {});

  await cleanupTeamState(resolvedCwd);
}

export async function resumeTeam(cwd: string): Promise<TeamRuntime | null> {
  const resolvedCwd = resolve(cwd);
  const config = await readTeamConfig(resolvedCwd);
  if (!config) return null;

  const anyAlive = Array.from({ length: config.workerCount }, (_, i) =>
    isWorkerAlive(config.tmuxSession, i + 1, config.workerPaneIds[i]),
  ).some(Boolean);
  if (!anyAlive) return null;

  return {
    session: {
      name: config.tmuxSession,
      workerCount: config.workerCount,
      cwd: resolvedCwd,
      workerPaneIds: config.workerPaneIds,
      leaderPaneId: config.leaderPaneId,
      hudPaneId: null,
    },
    cwd: resolvedCwd,
    workerCount: config.workerCount,
    agentType: config.agentType,
  };
}

interface TeamRuntimeConfig {
  task: string;
  agentType: string;
  workerCount: number;
  workerCli: WorkerCli;
  tmuxSession: string;
  leaderPaneId: string;
  workerPaneIds: string[];
  startedAt: string;
}

function teamConfigPath(cwd: string): string {
  return join(teamDir(cwd), "runtime-config.json");
}

async function writeTeamConfig(
  cwd: string,
  config: TeamRuntimeConfig,
): Promise<void> {
  await writeAtomic(teamConfigPath(cwd), JSON.stringify(config, null, 2));
}

async function readTeamConfig(cwd: string): Promise<TeamRuntimeConfig | null> {
  const path = teamConfigPath(cwd);
  if (!existsSync(path)) return null;
  try {
    const { readFile } = await import("fs/promises");
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw) as TeamRuntimeConfig;
  } catch {
    return null;
  }
}

async function initTeamDirs(cwd: string): Promise<void> {
  await Promise.all([
    mkdir(teamTasksDir(cwd), { recursive: true }),
    mkdir(teamWorkersDir(cwd), { recursive: true }),
    mkdir(teamMailboxDir(cwd), { recursive: true }),
    mkdir(teamDispatchDir(cwd), { recursive: true }),
    mkdir(teamInboxDir(cwd), { recursive: true }),
  ]);
}

async function cleanupTeamState(cwd: string): Promise<void> {
  const dir = teamDir(cwd);
  if (existsSync(dir)) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function writeWorkerIdentity(
  cwd: string,
  workerName: string,
  identity: Record<string, unknown>,
): Promise<void> {
  const dir = join(teamWorkersDir(cwd), workerName);
  await mkdir(dir, { recursive: true });
  await writeAtomic(
    join(dir, "identity.json"),
    JSON.stringify(identity, null, 2),
  );
}

function buildWorkerStartups(
  workerCount: number,
  cwd: string,
  launchArgs: string[],
  workerCli: WorkerCli,
): Array<{
  cwd: string;
  env: Record<string, string>;
  launchArgs: string[];
  workerCli: WorkerCli;
}> {
  return Array.from({ length: workerCount }, (_, i) => ({
    cwd,
    env: {
      ULTRA_TEAM_WORKER_INDEX: String(i + 1),
    },
    launchArgs,
    workerCli,
  }));
}

function extractWorkerIndex(workerName: string): number {
  const match = /^worker-(\d+)$/.exec(workerName);
  if (!match) throw new Error(`Invalid worker name format: ${workerName}`);
  return Number(match[1]);
}

function countTasks(tasks: TeamTask[]): {
  total: number;
  pending: number;
  blocked: number;
  in_progress: number;
  completed: number;
  failed: number;
} {
  return {
    total: tasks.length,
    pending: tasks.filter((t) => t.status === "pending").length,
    blocked: tasks.filter((t) => t.status === "blocked").length,
    in_progress: tasks.filter((t) => t.status === "in_progress").length,
    completed: tasks.filter((t) => t.status === "completed").length,
    failed: tasks.filter((t) => t.status === "failed").length,
  };
}

interface DispatchInboxParams {
  cwd: string;
  workerName: string;
  workerIndex: number;
  paneId?: string;
  inbox: string;
  triggerMessage: string;
  sessionName: string;
}

async function dispatchInbox(
  params: DispatchInboxParams,
): Promise<DispatchOutcome> {
  const dispatchDir = teamDispatchDir(params.cwd);
  const inboxDir = teamInboxDir(params.cwd);

  return queueInboxInstruction({
    dispatchDir,
    inboxDir,
    workerName: params.workerName,
    workerIndex: params.workerIndex,
    paneId: params.paneId,
    inbox: params.inbox,
    triggerMessage: params.triggerMessage,
    transportPreference: "transport_direct",
    fallbackAllowed: false,
    inboxCorrelationKey: `dispatch:${params.workerName}:${Date.now()}`,
    notify: async (_target, message) => {
      try {
        await sendToWorker(
          params.sessionName,
          params.workerIndex,
          message,
          params.paneId,
        );
        return {
          ok: true,
          transport: "tmux_send_keys",
          reason: "tmux_send_keys_sent",
        };
      } catch (error) {
        return {
          ok: false,
          transport: "tmux_send_keys",
          reason: `tmux_send_keys_failed:${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  });
}

async function emitMonitorDerivedEvents(
  cwd: string,
  tasks: TeamTask[],
  workers: TeamSnapshot["workers"],
  previous: MonitorSnapshotState | null,
): Promise<void> {
  if (!previous) return;

  for (const task of tasks) {
    const prevStatus = previous.taskStatusById[task.id];
    if (
      prevStatus &&
      prevStatus !== "completed" &&
      task.status === "completed"
    ) {
      if (previous.completedEventTaskIds?.[task.id]) continue;
      await appendTeamEvent(cwd, {
        type: "task_completed",
        worker: task.owner || "unknown",
        task_id: task.id,
      }).catch(() => {});
    }
  }

  for (const worker of workers) {
    const prevAlive = previous.workerAliveByName[worker.name];
    if (prevAlive === true && !worker.alive) {
      await appendTeamEvent(cwd, {
        type: "worker_stopped",
        worker: worker.name,
        task_id: worker.currentTaskId || undefined,
      }).catch(() => {});
    }

    const prevState = previous.workerStateByName[worker.name];
    if (prevState && prevState !== worker.state) {
      await appendTeamEvent(cwd, {
        type: "worker_state_changed",
        worker: worker.name,
        state: worker.state as
          | "idle"
          | "working"
          | "blocked"
          | "done"
          | "failed"
          | "draining"
          | "unknown",
        prev_state: prevState as
          | "idle"
          | "working"
          | "blocked"
          | "done"
          | "failed"
          | "draining"
          | "unknown",
      }).catch(() => {});
    }
  }
}
