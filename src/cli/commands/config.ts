import chalk from "chalk";
import { loadConfig, saveConfig, configExists } from "../../config/index.js";
import type {
  AgentName,
  PermissionMode,
  TmuxLayout,
  UltraAgentConfig,
} from "../../config/types.js";

const VALID_AGENTS: AgentName[] = ["claude", "codex", "gemini"];
const VALID_LAYOUTS: TmuxLayout[] = [
  "tiled",
  "main-vertical",
  "main-horizontal",
];
const VALID_MODES: PermissionMode[] = ["default", "auto", "yolo"];

function printConfig(config: UltraAgentConfig): void {
  console.log(chalk.bold("\n  UltraAgent Configuration\n"));
  console.log(`  ${chalk.dim("chef")}          ${chalk.cyan(config.chef)}`);
  console.log(`  ${chalk.dim("agents")}        ${config.agents.join(", ")}`);
  console.log(`  ${chalk.dim("layout")}        ${config.tmux.layout}`);
  console.log(
    `  ${chalk.dim("chef-mode")}     ${config.permissions.chef_mode}`,
  );
  console.log(
    `  ${chalk.dim("worker-mode")}   ${config.permissions.worker_mode}`,
  );
  console.log(
    `  ${chalk.dim("timeout")}       ${config.ipc.default_timeout_ms}ms`,
  );
  console.log(
    `  ${chalk.dim("max-payload")}   ${(config.ipc.max_payload_bytes / 1024).toFixed(0)}KB`,
  );
  console.log();
}

export async function configShowCommand(): Promise<void> {
  const cwd = process.cwd();
  if (!configExists(cwd)) {
    console.log(chalk.yellow("No config found. Run `ultraagent init` first."));
    return;
  }
  const config = loadConfig(cwd);
  printConfig(config);
}

export async function configSetCommand(
  key: string,
  value: string,
  options: { global?: boolean },
): Promise<void> {
  const cwd = process.cwd();
  const config = loadConfig(cwd);
  const scope = options.global ? "global" : "project";

  const updated = applyConfigChange(config, key, value);
  saveConfig(updated, scope, cwd);
  console.log(chalk.green(`✓ ${key} = ${value} (saved to ${scope})`));
}

function applyConfigChange(
  config: UltraAgentConfig,
  key: string,
  value: string,
): UltraAgentConfig {
  switch (key) {
    case "chef": {
      const chef = validateAgent(value);
      const agents = [chef, ...config.agents.filter((a) => a !== chef)];
      return { ...config, chef, agents };
    }
    case "workers": {
      const workers = value.split(",").map((s) => validateAgent(s.trim()));
      const agents: AgentName[] = [config.chef, ...workers];
      return { ...config, agents };
    }
    case "layout": {
      const layout = validateEnum(value, VALID_LAYOUTS, "layout");
      return { ...config, tmux: { ...config.tmux, layout } };
    }
    case "chef-mode": {
      const mode = validateEnum(value, VALID_MODES, "chef-mode");
      return {
        ...config,
        permissions: { ...config.permissions, chef_mode: mode },
      };
    }
    case "worker-mode": {
      const mode = validateEnum(value, VALID_MODES, "worker-mode");
      return {
        ...config,
        permissions: { ...config.permissions, worker_mode: mode },
      };
    }
    case "timeout": {
      const ms = Number(value);
      if (Number.isNaN(ms) || ms < 1000) {
        throw new Error("timeout must be a number >= 1000 (ms)");
      }
      return { ...config, ipc: { ...config.ipc, default_timeout_ms: ms } };
    }
    default:
      throw new Error(
        `Unknown key "${key}". Valid keys: chef, workers, layout, chef-mode, worker-mode, timeout`,
      );
  }
}

function validateAgent(value: string): AgentName {
  if (!VALID_AGENTS.includes(value as AgentName)) {
    throw new Error(
      `Invalid agent "${value}". Valid: ${VALID_AGENTS.join(", ")}`,
    );
  }
  return value as AgentName;
}

function validateEnum<T extends string>(
  value: string,
  valid: T[],
  label: string,
): T {
  if (!valid.includes(value as T)) {
    throw new Error(`Invalid ${label} "${value}". Valid: ${valid.join(", ")}`);
  }
  return value as T;
}
