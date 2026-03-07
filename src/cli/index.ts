import { Command } from 'commander';
import { configCommand } from './commands/config.js';
import { doctorCommand } from './commands/doctor.js';
import { initCommand } from './commands/init.js';
import { startCommand } from './commands/start.js';
import { stopCommand } from './commands/stop.js';

export function createProgram(): Command {
  const program = new Command();

  program
    .name('ultraagent')
    .description('Orchestrate AI CLI tools (Claude, Codex, Gemini) in collaborative tmux sessions')
    .version('0.1.0');

  program
    .command('start', { isDefault: true })
    .description('Start an UltraAgent session (default command)')
    .action(startCommand);

  program.command('stop').description('Stop the active UltraAgent session').action(stopCommand);

  program.command('doctor').description('Check prerequisites and system health').action(doctorCommand);

  program.command('init').description('Interactive setup wizard').action(initCommand);

  program.command('config').description('Interactive configuration editor').action(configCommand);

  return program;
}
