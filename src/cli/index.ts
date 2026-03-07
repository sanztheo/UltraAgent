import { Command } from "commander";
import { startCommand } from "./commands/start.js";
import { stopCommand } from "./commands/stop.js";
import { doctorCommand } from "./commands/doctor.js";
import { initCommand } from "./commands/init.js";
import { configShowCommand, configSetCommand } from "./commands/config.js";

export function createProgram(): Command {
  const program = new Command();

  program
    .name("ultraagent")
    .description(
      "Orchestrate AI CLI tools (Claude, Codex, Gemini) in collaborative tmux sessions",
    )
    .version("0.1.0");

  program
    .command("start", { isDefault: true })
    .description("Start an UltraAgent session (default command)")
    .action(startCommand);

  program
    .command("stop")
    .description("Stop the active UltraAgent session")
    .action(stopCommand);

  program
    .command("doctor")
    .description("Check prerequisites and system health")
    .action(doctorCommand);

  program
    .command("init")
    .description("Interactive setup wizard")
    .action(initCommand);

  const configCmd = program
    .command("config")
    .description("Show or modify configuration");

  configCmd
    .command("show", { isDefault: true })
    .description("Show current configuration")
    .action(configShowCommand);

  configCmd
    .command("set <key> <value>")
    .description(
      "Set a config value (chef, workers, layout, worker-mode, chef-mode, timeout)",
    )
    .option("-g, --global", "Save to global config instead of project")
    .action(configSetCommand);

  return program;
}
