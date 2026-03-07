import * as p from "@clack/prompts";
import chalk from "chalk";
import { which } from "../../utils/shell.js";
import { saveConfig } from "../../config/index.js";
import { DEFAULT_CONFIG } from "../../config/defaults.js";
import type {
  AgentName,
  PermissionMode,
  TmuxLayout,
  UltraAgentConfig,
} from "../../config/types.js";

const ALL_AGENTS: AgentName[] = ["claude", "codex", "gemini"];

export async function initCommand(): Promise<void> {
  p.intro(chalk.bold("UltraAgent Setup"));

  // Step 1: Detect installed CLIs
  const detected: { name: AgentName; path: string }[] = [];
  for (const name of ALL_AGENTS) {
    const path = await which(name);
    if (path) {
      detected.push({ name, path });
    }
  }

  if (detected.length === 0) {
    p.cancel(
      "No AI CLIs found. Install at least one of: claude, codex, gemini",
    );
    process.exit(1);
  }

  p.note(
    detected
      .map((d) => `  ${chalk.green("✓")} ${d.name} (${d.path})`)
      .join("\n"),
    "Detected CLIs",
  );

  if (detected.length < 2) {
    p.log.warn("Only 1 CLI found. UltraAgent works best with 2+ CLIs.");
  }

  const detectedNames = detected.map((d) => d.name);

  // Step 2: Choose chef
  const chef = await p.select({
    message: "Which CLI should be the chef (lead orchestrator)?",
    options: detectedNames.map((name) => ({
      value: name,
      label: name,
      hint: name === "claude" ? "recommended" : undefined,
    })),
  });

  if (p.isCancel(chef)) {
    p.cancel("Setup cancelled");
    process.exit(0);
  }

  // Step 3: Choose workers
  const workerOptions = detectedNames.filter((n) => n !== chef);
  let workers: AgentName[];

  if (workerOptions.length === 0) {
    workers = [];
    p.log.warn("No other CLIs available as workers. The chef will work alone.");
  } else if (workerOptions.length === 1) {
    workers = workerOptions;
    p.log.info(`Worker: ${workers.join(", ")}`);
  } else {
    const selected = await p.multiselect({
      message: "Select worker agents:",
      options: workerOptions.map((name) => ({
        value: name,
        label: name,
      })),
      initialValues: workerOptions,
      required: false,
    });

    if (p.isCancel(selected)) {
      p.cancel("Setup cancelled");
      process.exit(0);
    }
    workers = selected;
  }

  // Step 4: tmux layout
  const layout = await p.select({
    message: "Preferred tmux layout?",
    options: [
      {
        value: "main-vertical" as TmuxLayout,
        label: "Main Vertical",
        hint: "chef left, workers right (recommended)",
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
  });

  if (p.isCancel(layout)) {
    p.cancel("Setup cancelled");
    process.exit(0);
  }

  // Step 5: Worker permission mode
  const workerMode = await p.select({
    message: "Permission mode for workers?",
    options: [
      {
        value: "auto" as PermissionMode,
        label: "Auto",
        hint: "auto-approve safe edits (recommended)",
      },
      {
        value: "default" as PermissionMode,
        label: "Default",
        hint: "ask permission for each action",
      },
      {
        value: "yolo" as PermissionMode,
        label: "YOLO",
        hint: "skip all permission checks (use with caution)",
      },
    ],
  });

  if (p.isCancel(workerMode)) {
    p.cancel("Setup cancelled");
    process.exit(0);
  }

  // Step 6: Config scope
  const scope = await p.select({
    message: "Save configuration to:",
    options: [
      {
        value: "project" as const,
        label: "This project only",
        hint: ".ultraagent.json",
      },
      {
        value: "global" as const,
        label: "Global (all projects)",
        hint: "~/.ultraagent/config.json",
      },
    ],
  });

  if (p.isCancel(scope)) {
    p.cancel("Setup cancelled");
    process.exit(0);
  }

  // Build config
  const agents: AgentName[] = [chef, ...workers];
  const config: UltraAgentConfig = {
    ...DEFAULT_CONFIG,
    chef,
    agents,
    tmux: { ...DEFAULT_CONFIG.tmux, layout },
    permissions: { ...DEFAULT_CONFIG.permissions, worker_mode: workerMode },
  };

  // Save
  const cwd = process.cwd();
  saveConfig(config, scope, cwd);

  p.outro(
    chalk.green(
      `UltraAgent configured! Run ${chalk.bold("ultraagent")} to start.`,
    ),
  );
}
