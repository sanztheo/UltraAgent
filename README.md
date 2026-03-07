<p align="center">
  <img src="https://img.shields.io/badge/node-%3E%3D20-brightgreen" alt="Node.js">
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="License">
  <img src="https://img.shields.io/badge/version-0.1.0-orange" alt="Version">
  <img src="https://img.shields.io/badge/tmux-required-yellow" alt="tmux">
</p>

<h1 align="center">UltraAgent</h1>

<p align="center">
  <strong>Make your AI CLI tools work together.</strong><br>
  Open-source orchestrator that connects Claude Code, Codex CLI, and Gemini CLI<br>
  into a collaborative multi-agent team via tmux and MCP.
</p>

<p align="center">
  <code>ultraagent</code> turns your existing AI subscriptions into a coordinated workforce.<br>
  A <strong>chef</strong> delegates to <strong>workers</strong> &mdash; research, code, review &mdash; all in one terminal.
</p>

---

## The Problem

You pay for Claude Code, Codex CLI, and Gemini CLI. Each one is powerful alone. But they can't talk to each other.

You end up copy-pasting context between terminals, re-explaining the same codebase, and manually coordinating tasks that should be parallel.

## The Solution

```
ultraagent
```

One command. tmux opens. Your chosen **chef** (say, Claude Code) gets a panel on the left. Workers (Codex, Gemini) stack on the right. The chef knows about its workers through MCP tools and delegates automatically:

```
+──────────────────────+──────────────────────+
|                      |                      |
|  Claude Code (Chef)  |  Codex CLI (Worker)  |
|                      |                      |
|  "I'll handle the    |  > reviewing the     |
|   refactoring. Let   |    auth module...    |
|   me ask Codex to    |                      |
|   review the auth    +──────────────────────+
|   module and Gemini  |                      |
|   to research the    |  Gemini CLI (Worker)  |
|   best JWT library." |                      |
|                      |  > comparing jose    |
|  > _                 |    vs jsonwebtoken...|
|                      |                      |
+──────────────────────+──────────────────────+
```

## How It Works

```
ultraagent (CLI)
    |
    +── Config          ~/.ultraagent/config.json + .ultraagent.json
    |
    +── tmux Manager    Creates session, panes, layout
    |
    +── Adapters        Claude | Codex | Gemini
    |     |── Interactive launch (tmux pane)
    |     |── Non-interactive IPC (pipe -p / exec)
    |     +── Instruction injection (CLAUDE.md / AGENTS.md / GEMINI.md)
    |
    +── MCP Server      ultraagent-orchestrator (stdio)
    |     |── ultra_ask_agent(agent, prompt)
    |     |── ultra_broadcast(prompt)
    |     +── ultra_assign_task(agent, task, can_code, files)
    |
    +── Shell Fallback  ultra-ask | ultra-broadcast | ultra-assign
```

The chef uses **MCP tools** to talk to workers. When it calls `ultra_ask_agent("codex", "Review auth.ts for security issues")`, UltraAgent spawns `codex exec "..." --json` in the background, captures the response, and returns it to the chef through the MCP protocol.

No custom APIs. No wrapper models. Just your existing CLI tools, talking through pipes.

## Quick Start

### Prerequisites

- **Node.js** >= 20
- **tmux** (`brew install tmux`)
- At least **2 AI CLI tools** installed:
  - [Claude Code](https://docs.anthropic.com/en/docs/claude-code) (`claude`)
  - [Codex CLI](https://github.com/openai/codex) (`codex`)
  - [Gemini CLI](https://github.com/google-gemini/gemini-cli) (`gemini`)

### Install

```bash
npm install -g ultraagent
```

### Setup

```bash
# Check your environment
ultraagent doctor

# Interactive setup wizard
ultraagent init
```

The wizard detects your installed CLIs, asks which one should lead, and writes the config:

```
UltraAgent Setup

  Detected CLIs
    ✓ claude (/usr/local/bin/claude)
    ✓ codex (/usr/local/bin/codex)
    ✓ gemini (/usr/local/bin/gemini)

  Which CLI should be the chef? > claude (recommended)
  Select worker agents: > codex, gemini
  Preferred tmux layout? > Main Vertical
  Permission mode for workers? > Auto
  Save configuration to: > This project only

  UltraAgent configured! Run ultraagent to start.
```

### Run

```bash
# Start a collaborative session (default command)
ultraagent

# Stop the session
ultraagent stop
```

## Configuration

UltraAgent merges configuration from two levels (project overrides global):

| File | Scope |
|------|-------|
| `~/.ultraagent/config.json` | Global (all projects) |
| `.ultraagent.json` | Project (current directory) |

```json
{
  "chef": "claude",
  "agents": ["claude", "codex", "gemini"],
  "tmux": {
    "layout": "main-vertical",
    "session_prefix": "ultraagent"
  },
  "permissions": {
    "chef_mode": "default",
    "worker_mode": "auto"
  },
  "ipc": {
    "default_timeout_ms": 60000,
    "max_payload_bytes": 1048576
  }
}
```

### Permission Modes

| Mode | Claude Code | Codex CLI | Gemini CLI |
|------|------------|-----------|------------|
| `default` | Interactive approval | Interactive approval | Interactive approval |
| `auto` | `--allowedTools` | `--auto-edit` | _(no flag)_ |
| `yolo` | `--dangerously-skip-permissions` | `--full-auto` | `--sandbox=none` |

### tmux Layouts

| Layout | Description |
|--------|-------------|
| `main-vertical` | Chef 50% left, workers stacked right **(recommended)** |
| `main-horizontal` | Chef 50% top, workers stacked bottom |
| `tiled` | Equal-sized panes |

## Inter-Agent Communication

### MCP Tools (primary)

The chef gets 3 MCP tools registered automatically:

```
ultra_ask_agent(agent, prompt)
  Ask a specific worker and get its response.

ultra_broadcast(prompt)
  Send the same prompt to all workers simultaneously.

ultra_assign_task(agent, task, can_code?, files?)
  Assign a structured task with permissions and file scope.
```

### Shell Scripts (fallback)

For CLIs without MCP support, shell scripts are available:

```bash
ultra-ask codex "Review this function for edge cases"
ultra-broadcast "What testing framework does this project use?"
ultra-assign gemini "Research WebSocket libraries" --can-code --files src/ws/
```

## Delegation Strategies

Each CLI has different strengths. UltraAgent's instruction templates optimize for this:

| Chef | Delegates research to | Delegates code review to | Keeps |
|------|----------------------|------------------------|-------|
| **Claude** | Gemini | Codex | Complex coding, architecture |
| **Codex** | Gemini | Claude | Execution, testing, quick edits |
| **Gemini** | _(keeps)_ | Claude, Codex | Research, planning, analysis |

## CLI Reference

```
ultraagent [command]

Commands:
  start     Start a collaborative session (default)
  stop      Stop the active session
  doctor    Check prerequisites and system health
  init      Interactive setup wizard
  help      Display help

Options:
  -V        Show version
  -h        Show help
```

## Project Structure

```
src/
  config/         Config system (Zod schemas, merge, defaults)
  adapters/       CLI adapters (Claude, Codex, Gemini)
  tmux/           Session, pane, layout management
  ipc/            Inter-process communication (pipe, bridge)
  mcp/            MCP server (stdio, 3 tools)
  instructions/   Chef/worker prompts + 6 templates
  scripts/        Shell script fallbacks
  orchestrator/   Session lifecycle + state
  cli/            Commander commands
```

## Requirements

| Dependency | Why |
|-----------|-----|
| `@modelcontextprotocol/sdk` | MCP server for inter-agent communication |
| `commander` | CLI framework |
| `@clack/prompts` | Beautiful init wizard |
| `zod` | Runtime config validation |
| `chalk` | Terminal colors |

## Contributing

```bash
git clone https://github.com/yourusername/ultraagent.git
cd ultraagent
npm install
npm run build
npm run dev     # watch mode
npm test        # run tests
npm run lint    # biome check
```

## License

MIT
