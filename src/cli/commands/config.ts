import * as p from "@clack/prompts";
import chalk from "chalk";
import { loadConfig, saveConfig, configExists } from "../../config/index.js";
import { which } from "../../utils/shell.js";
import type {
  AgentName,
  PermissionMode,
  TmuxLayout,
  UltraAgentConfig,
} from "../../config/types.js";

const ALL_AGENTS: AgentName[] = ["claude", "codex", "gemini"];

type MenuAction =
  | "chef"
  | "workers"
  | "layout"
  | "worker-mode"
  | "chef-mode"
  | "save"
  | "save-global"
  | "discard";

function tag(value: string, active: boolean): string {
  if (active) return chalk.green(`● ${value}`);
  return chalk.dim(`○ ${value}`);
}

function buildMenuOptions(
  config: UltraAgentConfig,
): Array<{ value: MenuAction; label: string; hint?: string }> {
  const workers = config.agents.filter((a) => a !== config.chef);

  return [
    {
      value: "chef" as MenuAction,
      label: `Chef              ${chalk.cyan(config.chef)}`,
    },
    {
      value: "workers" as MenuAction,
      label: `Workers           ${workers.map((w) => tag(w, true)).join("  ")}${ALL_AGENTS.filter(
        (a) => a !== config.chef && !workers.includes(a),
      )
        .map((w) => tag(w, false))
        .join("  ")}`,
    },
    {
      value: "layout" as MenuAction,
      label: `Layout            ${chalk.yellow(config.tmux.layout)}`,
    },
    {
      value: "chef-mode" as MenuAction,
      label: `Chef mode         ${chalk.magenta(config.permissions.chef_mode)}`,
    },
    {
      value: "worker-mode" as MenuAction,
      label: `Worker mode       ${chalk.magenta(config.permissions.worker_mode)}`,
    },
    {
      value: "save" as MenuAction,
      label: chalk.green.bold("  Save to project"),
      hint: ".ultraagent.json",
    },
    {
      value: "save-global" as MenuAction,
      label: chalk.green("  Save globally"),
      hint: "~/.ultraagent/config.json",
    },
    {
      value: "discard" as MenuAction,
      label: chalk.dim("  Discard & exit"),
    },
  ];
}

export async function configCommand(): Promise<void> {
  const cwd = process.cwd();

  if (!configExists(cwd)) {
    console.log(chalk.yellow("No config found. Run `ultraagent init` first."));
    process.exit(1);
  }

  let config = loadConfig(cwd);

  // Detect available CLIs
  const available: AgentName[] = [];
  for (const name of ALL_AGENTS) {
    if (await which(name)) available.push(name);
  }

  p.intro(chalk.bold("UltraAgent Config"));

  let dirty = false;

  // Main menu loop
  while (true) {
    const action = await p.select<MenuAction>({
      message: dirty ? chalk.yellow("Settings (modified)") : "Settings",
      options: buildMenuOptions(config),
    });

    if (p.isCancel(action)) {
      if (dirty) {
        const confirm = await p.confirm({
          message: "Discard unsaved changes?",
        });
        if (p.isCancel(confirm) || !confirm) continue;
      }
      p.cancel("Discarded");
      return;
    }

    switch (action) {
      case "chef": {
        const chef = await p.select({
          message: "Chef",
          options: available.map((name) => ({
            value: name,
            label: name,
            hint: name === config.chef ? "current" : undefined,
          })),
          initialValue: config.chef,
        });
        if (!p.isCancel(chef) && chef !== config.chef) {
          const workers = config.agents.filter(
            (a) => a !== config.chef && a !== chef,
          );
          config = {
            ...config,
            chef,
            agents: [chef, ...workers],
          };
          dirty = true;
        }
        break;
      }

      case "workers": {
        const workerOptions = available.filter((n) => n !== config.chef);
        const currentWorkers = config.agents.filter((a) => a !== config.chef);

        if (workerOptions.length === 0) {
          p.log.warn("No other CLIs installed.");
          break;
        }

        const selected = await p.multiselect({
          message: "Toggle workers",
          options: workerOptions.map((name) => ({
            value: name,
            label: name,
          })),
          initialValues: currentWorkers.filter((w) =>
            workerOptions.includes(w),
          ),
          required: false,
        });

        if (!p.isCancel(selected)) {
          config = {
            ...config,
            agents: [config.chef, ...selected],
          };
          dirty = true;
        }
        break;
      }

      case "layout": {
        const layout = await p.select({
          message: "Layout",
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
        if (!p.isCancel(layout) && layout !== config.tmux.layout) {
          config = { ...config, tmux: { ...config.tmux, layout } };
          dirty = true;
        }
        break;
      }

      case "chef-mode": {
        const mode = await selectMode(
          "Chef permission mode",
          config.permissions.chef_mode,
        );
        if (mode) {
          config = {
            ...config,
            permissions: { ...config.permissions, chef_mode: mode },
          };
          dirty = true;
        }
        break;
      }

      case "worker-mode": {
        const mode = await selectMode(
          "Worker permission mode",
          config.permissions.worker_mode,
        );
        if (mode) {
          config = {
            ...config,
            permissions: { ...config.permissions, worker_mode: mode },
          };
          dirty = true;
        }
        break;
      }

      case "save": {
        saveConfig(config, "project", cwd);
        p.outro(chalk.green("Saved to .ultraagent.json"));
        return;
      }

      case "save-global": {
        saveConfig(config, "global", cwd);
        p.outro(chalk.green("Saved to ~/.ultraagent/config.json"));
        return;
      }

      case "discard": {
        if (dirty) {
          const confirm = await p.confirm({
            message: "Discard unsaved changes?",
          });
          if (p.isCancel(confirm) || !confirm) break;
        }
        p.outro(chalk.dim("No changes saved."));
        return;
      }
    }
  }
}

async function selectMode(
  message: string,
  current: PermissionMode,
): Promise<PermissionMode | undefined> {
  const mode = await p.select({
    message,
    options: [
      {
        value: "default" as PermissionMode,
        label: "Default",
        hint: "ask permission for each action",
      },
      {
        value: "auto" as PermissionMode,
        label: "Auto",
        hint: "auto-approve safe edits",
      },
      {
        value: "yolo" as PermissionMode,
        label: "YOLO",
        hint: "skip all permission checks",
      },
    ],
    initialValue: current,
  });
  if (p.isCancel(mode) || mode === current) return undefined;
  return mode;
}
