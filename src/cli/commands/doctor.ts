import chalk from 'chalk';
import { configExists } from '../../config/index.js';
import type { AgentName } from '../../config/types.js';
import { which } from '../../utils/shell.js';

interface CheckResult {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

const CLI_BINARIES: { name: AgentName; binary: string }[] = [
  { name: 'claude', binary: 'claude' },
  { name: 'codex', binary: 'codex' },
  { name: 'gemini', binary: 'gemini' },
];

export async function doctorCommand(): Promise<void> {
  console.log(chalk.bold('\nUltraAgent Doctor\n'));

  const results: CheckResult[] = [];

  // Check tmux
  const tmuxPath = await which('tmux');
  results.push({
    name: 'tmux',
    ok: tmuxPath !== undefined,
    detail: tmuxPath ? `found at ${tmuxPath}` : 'not found - install with: brew install tmux',
  });

  // Check Node.js version
  const nodeVersion = process.version;
  const major = Number.parseInt(nodeVersion.slice(1).split('.')[0] ?? '0', 10);
  results.push({
    name: 'Node.js',
    ok: major >= 20,
    detail: `${nodeVersion}${major < 20 ? ' (need >= 20)' : ''}`,
  });

  // Check AI CLIs
  let foundClis = 0;
  for (const cli of CLI_BINARIES) {
    const path = await which(cli.binary);
    const ok = path !== undefined;
    if (ok) foundClis++;
    results.push({
      name: `${cli.name} CLI`,
      ok,
      detail: ok ? `found at ${path}` : 'not installed',
    });
  }

  // Check config
  const cwd = process.cwd();
  const hasConfig = configExists(cwd);
  results.push({
    name: 'Configuration',
    ok: hasConfig,
    detail: hasConfig ? 'found' : "not found - run 'ultraagent init'",
  });

  // Display results
  for (const result of results) {
    const icon = result.ok ? chalk.green('✓') : chalk.red('✗');
    const detail = result.ok ? chalk.gray(result.detail) : chalk.yellow(result.detail);
    console.log(`  ${icon} ${result.name}: ${detail}`);
  }

  const allOk = results.every((r) => r.ok);
  const hasClis = foundClis >= 2;

  console.log('');
  if (allOk) {
    console.log(chalk.green('  All checks passed! Ready to go.\n'));
  } else if (hasClis) {
    console.log(chalk.yellow('  Some checks failed, but you have enough CLIs to get started.\n'));
  } else {
    console.log(chalk.red('  Install at least 2 AI CLIs and tmux to use UltraAgent.\n'));
    process.exit(1);
  }
}
