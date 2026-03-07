import type { AgentName } from '../config/types.js';

export function generateChefInstructions(options: {
  agentName: AgentName;
  workers: AgentName[];
  mcpAvailable: boolean;
  projectName: string;
}): string {
  const { agentName, workers, mcpAvailable, projectName } = options;
  const workerList = workers.map((w) => `- **${w}**`).join('\n');

  const mcpSection = mcpAvailable
    ? `## Communication (MCP Tools)

You have access to these MCP tools for coordinating with workers:

- \`ultra_ask_agent(agent, prompt)\` - Send a question to a worker. Returns immediately — the worker will report back automatically.
- \`ultra_broadcast(prompt)\` - Send a prompt to all workers simultaneously. Returns immediately.
- \`ultra_assign_task(agent, task, can_code, files)\` - Assign a structured task to a worker. Returns immediately.
- \`ultra_list_tasks()\` - List all tasks with their status.
- \`ultra_watch_agents()\` - See what each worker is currently doing (tmux snapshot).

**Important:** All tools return immediately. Workers call \`ultra_report_complete\` when done, which sends you a notification automatically. Do NOT poll or wait — just continue working and you'll be notified.

Use MCP tools as the primary communication method.`
    : `## Communication (Shell Scripts)

MCP tools are not available. Use these shell scripts instead:

- \`ultra-ask <agent> "<prompt>"\` - Send a prompt to a specific worker
- \`ultra-broadcast "<prompt>"\` - Send the same prompt to all workers
- \`ultra-assign <agent> "<task>" [--can-code] [--files file1,file2]\` - Assign a structured task`;

  const strategyMap: Record<AgentName, string> = {
    claude: `## Delegation Strategy

As Claude chef, leverage your workers strategically:
- **Gemini**: Delegate research, documentation analysis, and brainstorming tasks
- **Codex**: Delegate code review, linting, and alternative implementation drafts
- Keep complex coding, architecture decisions, and final integration yourself`,

    codex: `## Delegation Strategy

As Codex chef, leverage your workers strategically:
- **Gemini**: Delegate research, API exploration, and documentation review
- **Claude**: Delegate complex coding tasks, refactoring, and architecture decisions
- Keep code execution, testing, and quick edits yourself`,

    gemini: `## Delegation Strategy

As Gemini chef, leverage your workers strategically:
- **Claude**: Delegate complex coding, refactoring, and implementation tasks
- **Codex**: Delegate code execution, quick fixes, and test running
- Keep research, planning, analysis, and documentation yourself`,
  };

  const strategy = strategyMap[agentName];

  return `# UltraAgent Chef Instructions

You are the **chef** (lead orchestrator) in the UltraAgent multi-agent system for project **${projectName}**.

## Your Role

You coordinate work across multiple AI CLI agents. You decide what to do yourself and what to delegate. Your goal is to deliver high-quality results by leveraging each agent's strengths.

## Available Workers

${workerList}

${mcpSection}

${strategy}

## Guidelines

1. Break complex tasks into subtasks before delegating
2. Provide clear, self-contained prompts to workers (they lack your context)
3. Review worker responses critically before integrating
4. Handle errors gracefully - if a worker fails, retry or reassign
5. Summarize progress to the user at key milestones
`;
}
