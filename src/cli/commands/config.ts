import * as p from "@clack/prompts";
import chalk from "chalk";
import { loadConfig, saveConfig, configExists } from "../../config/index.js";
import { which } from "../../utils/shell.js";
import type {
  AgentName,
  PermissionMode,
  TmuxLayout,
} from "../../config/types.js";

const ALL_AGENTS: AgentName[] = ["claude", "codex", "gemini"];

export async function configCommand(): Promise<void> {
  const cwd = process.cwd();

  if (!configExists(cwd)) {
    console.log(chalk.yellow("No config found. Run `ultraagent init` first."));
    process.exit(1);
  }

  const config = loadConfig(cwd);

  p.intro(chalk.bold("UltraAgent Config"));

  // Show current config
  p.note(
    [
      `  chef          ${chalk.cyan(config.chef)}`,
      `  workers       ${config.agents.filter((a) => a !== config.chef).join(", ") || chalk.dim("none")}`,
      `  layout        ${config.tmux.layout}`,
      `  chef-mode     ${config.permissions.chef_mode}`,
      `  worker-mode   ${config.permissions.worker_mode}`,
    ].join("\n"),
    "Current configuration",
  );

  // Detect available CLIs
  const available: AgentName[] = [];
  for (const name of ALL_AGENTS) {
    if (await which(name)) available.push(name);
  }

  // Chef
  const chef = await p.select({
    message: "Chef (lead orchestrator)",
    options: available.map((name) => ({
      value: name,
      label: name,
      hint: name === config.chef ? "current" : undefined,
    })),
    initialValue: config.chef,
  });
  if (p.isCancel(chef)) {
    p.cancel("Cancelled");
    return;
  }

  // Workers
  const workerOptions = available.filter((n) => n !== chef);
  const currentWorkers = config.agents.filter((a) => a !== config.chef);
  let workers: AgentName[];

  if (workerOptions.length === 0) {
    workers = [];
    p.log.warn("No other CLIs available as workers.");
  } else if (workerOptions.length === 1) {
    workers = workerOptions;
    p.log.info(`Worker: ${workers.join(", ")}`);
  } else {
    const selected = await p.multiselect({
      message: "Workers",
      options: workerOptions.map((name) => ({
        value: name,
        label: name,
      })),
      initialValues: currentWorkers.filter((w) => workerOptions.includes(w)),
      required: false,
    });
    if (p.isCancel(selected)) {
      p.cancel("Cancelled");
      return;
    }
    workers = selected;
  }

  // Layout
  const layout = await p.select({
    message: "tmux layout",
    options: [
      {
        value: "main-vertical" as TmuxLayout,
        label: "Main Vertical",
        hint: "chef left, workers right",
      },
      {
        value: "main-horizontal" as TmuxLayout,
        label: "Main Horizontal",
        hint: "chef top, workers bottom",
      },
      {
        value: "tiled" as TmuxLayout,
        label: "Tiled",
        hint: "equal-sized panes",
      },
    ],
    initialValue: config.tmux.layout,
  });
  if (p.isCancel(layout)) {
    p.cancel("Cancelled");
    return;
  }

  // Worker permission mode
  const workerMode = await p.select({
    message: "Worker permission mode",
    options: [
      {
        value: "auto" as PermissionMode,
        label: "Auto",
        hint: "auto-approve safe edits",
      },
      {
        value: "default" as PermissionMode,
        label: "Default",
        hint: "ask permission for each action",
      },
      {
        value: "yolo" as PermissionMode,
        label: "YOLO",
        hint: "skip all permission checks",
      },
    ],
    initialValue: config.permissions.worker_mode,
  });
  if (p.isCancel(workerMode)) {
    p.cancel("Cancelled");
    return;
  }

  // Scope
  const scope = await p.select({
    message: "Save to",
    options: [
      {
        value: "project" as const,
        label: "This project",
        hint: ".ultraagent.json",
      },
      {
        value: "global" as const,
        label: "Global",
        hint: "~/.ultraagent/config.json",
      },
    ],
  });
  if (p.isCancel(scope)) {
    p.cancel("Cancelled");
    return;
  }

  // Build & save
  const updated = {
    ...config,
    chef,
    agents: [chef, ...workers] as AgentName[],
    tmux: { ...config.tmux, layout },
    permissions: { ...config.permissions, worker_mode: workerMode },
  };

  saveConfig(updated, scope, cwd);

  p.outro(chalk.green("Configuration saved!"));
}
