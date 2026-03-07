import type { AgentName } from '../config/types.js';
import { askViaPipe } from './pipe.js';

const VALID_AGENTS: readonly AgentName[] = ['claude', 'codex', 'gemini'];
const ALL_AGENTS: readonly AgentName[] = ['claude', 'codex', 'gemini'];

function isValidAgent(value: string): value is AgentName {
  return (VALID_AGENTS as readonly string[]).includes(value);
}

async function handleAsk(args: string[]): Promise<void> {
  const agent = args[0];
  const prompt = args.slice(1).join(' ');

  if (!agent || !isValidAgent(agent)) {
    throw new Error(`Invalid agent: expected one of ${VALID_AGENTS.join(', ')}, got "${agent ?? ''}"`);
  }
  if (!prompt) {
    throw new Error('Missing prompt argument');
  }

  const response = await askViaPipe(agent, prompt);
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

async function handleBroadcast(args: string[]): Promise<void> {
  const prompt = args.join(' ');
  if (!prompt) {
    throw new Error('Missing prompt argument');
  }

  const results = await Promise.allSettled(ALL_AGENTS.map((agent) => askViaPipe(agent, prompt)));

  const responses = results.map((result, i) =>
    result.status === 'fulfilled'
      ? result.value
      : {
          agent: ALL_AGENTS[i] ?? ('claude' as AgentName),
          content: `Error: ${result.reason instanceof Error ? result.reason.message : 'Unknown error'}`,
          exitCode: 1,
          durationMs: 0,
        },
  );

  process.stdout.write(`${JSON.stringify(responses)}\n`);
}

async function handleAssign(args: string[]): Promise<void> {
  const agent = args[0];
  const task = args.slice(1).join(' ');

  if (!agent || !isValidAgent(agent)) {
    throw new Error(`Invalid agent: expected one of ${VALID_AGENTS.join(', ')}, got "${agent ?? ''}"`);
  }
  if (!task) {
    throw new Error('Missing task argument');
  }

  const taskPrompt = [
    'You have been assigned the following task by UltraAgent orchestrator.',
    'Complete it thoroughly and report your results.',
    '',
    `Task: ${task}`,
  ].join('\n');

  const response = await askViaPipe(agent, taskPrompt);
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

export async function handleCliBridge(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);

  try {
    switch (command) {
      case 'ask':
        await handleAsk(args);
        break;
      case 'broadcast':
        await handleBroadcast(args);
        break;
      case 'assign':
        await handleAssign(args);
        break;
      default:
        throw new Error(`Unknown command: expected ask|broadcast|assign, got "${command ?? ''}"`);
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown bridge error';
    process.stdout.write(`${JSON.stringify({ error: message, exitCode: 1 })}\n`);
    process.exitCode = 1;
  }
}
