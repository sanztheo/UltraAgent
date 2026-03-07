# Changelog

All notable changes to UltraAgent are documented here.

## [Unreleased]

### Added
- **Worker self-report via `ultra_report_complete`** — workers now call an MCP tool to report task completion instead of relying on tmux polling or done markers. Inspired by OMX's lifecycle API approach.
- **File-based task store** (`.ultraagent/tasks/*.json`) — shared state between chef and worker MCP server processes. Replaces in-memory `Map` which couldn't cross process boundaries.
- **MCP registered with workers** — each worker gets the UltraAgent MCP server, giving them access to `ultra_report_complete`.
- **Workers launched interactively** — workers now run their full interactive CLI (Claude Code, Gemini, Codex) in their tmux pane, with MCP tools available.
- **Async task system** — `ultra_assign_task` and `ultra_ask_agent` both return immediately with a `taskId`. Workers call `ultra_report_complete` when done, chef gets auto-notified.
  - `ultra_report_complete(task_id, result, exit_code)` — worker reports completion
  - `ultra_get_task_result(taskId)` — check status and get result
  - `ultra_list_tasks()` — list all tasks with status and elapsed time
  - `ultra_watch_agents()` — live snapshot of each worker's tmux pane
- **Auto-notification** — `notifyChef()` sends task results directly to the chef's tmux pane.

### Changed
- Workers run interactive CLIs instead of staying at shell prompt (reverted from pipe mode).
- MCP handlers no longer depend on `IpcCoordinator` — they use `tmuxSendKeys` + file-based task store directly.
- Worker prompts and templates updated with mandatory `ultra_report_complete` protocol.
- Chef prompt updated to describe async workflow (no polling, auto-notification).
- `tmuxSendKeys` rewritten to use `tmux load-buffer` + `paste-buffer` for reliable text delivery.
- `tmuxCapturePane` supports full scrollback capture via `fullScrollback` option.

### Fixed
- MCP handlers now wrap all calls in try/catch — errors return proper responses instead of crashing the stdio server.
- Prompts with newlines no longer cause premature Enter keypresses in tmux.

---

## [0.1.0] — 2026-03-07

### Phase 1: Foundation
- `04527e0` Project scaffold (.gitignore, package.json, tsconfig, Biome)
- `8f9b811` Core type system (`AgentName`, `AgentRole`, `ShellCommand`, `SessionState`, etc.)
- `07cf5d7` Zod validation schemas for config
- `e3eb492` Default configuration values
- `b24ac39` Config loader with global/project merge strategy
- `aac18ab` Chalk-based logger with levels (debug/info/warn/error/success)
- `fc2570c` Shell execution utilities (`execCommand`, `spawnInteractive`, `which`)
- `7215ea6` Path resolution helpers (globalConfigDir, statePath, projectName)
- `22dfe8d` Process management utilities (sleep, signals)

### Phase 2: CLI Adapters
- `a27c0bd` `CliAdapter` interface — the central contract for all agents
- `45a6172` `BaseAdapter` abstract class with shared logic (isAvailable, askNonInteractive, injectInstructions)
- `7c47734` Claude Code adapter (`claude -p`, CLAUDE.md, `claude mcp add`, `cc` alias support)
- `b36856e` Codex adapter (`codex exec`, AGENTS.md, `--dangerously-bypass-approvals-and-sandbox`)
- `7dc1863` Gemini adapter (`gemini -p`, GEMINI.md, `-y` for YOLO mode)
- `113a884` Adapter factory + auto-discovery (`createAdapter`, `discoverAdapters`)

### Phase 3: tmux Manager
- `90c5e6d` Low-level tmux wrappers (new-session, kill-session, split-window, send-keys, capture-pane, list-panes, attach)
- `3d843e9` Layout strategies (tiled, main-vertical, main-horizontal)
- `60c6470` Pane readiness detection (poll for shell prompt patterns)
- `d3d1d2f` High-level TmuxSessionManager (createSession, addPane, applyLayout, destroySession, attachToSession)

### Phase 4: IPC
- `7d26efd` Pipe-based IPC — spawn CLI non-interactively, capture stdout
- `17406ad` CLI bridge for shell scripts (ultra-ask, ultra-broadcast, ultra-assign)
- `ed65126` IPC Coordinator — routing, validation, timeout management
- `e5bfc4e` Pane-based IPC — send prompt to tmux pane, poll scrollback for response
- `2458a8d` Conversation-file IPC — read from CLI's saved conversation files (Claude JSONL, Gemini JSON, Codex SQLite+JSONL)
- `fba13b3` Streamlined conversation-file IPC with unified polling loop

### Phase 5: MCP Server
- `3205de7` MCP tool schemas (Zod): `ultra_ask_agent`, `ultra_broadcast`, `ultra_assign_task`
- `2b0b212` MCP tool call handlers with JSON response formatting
- `aee4403` MCP stdio server using `@modelcontextprotocol/sdk`

### Phase 6: Instructions
- `1dd8976` Chef prompt generator (injects available workers, MCP tools, project context)
- `ce443ea` Worker prompt generator (injects role, chef reference, constraints)
- `9f60a32` `7529328` `dada8c7` Chef templates for Claude, Codex, Gemini
- `b2ce5a9` `4a526a7` `df8cce0` Worker templates for Claude, Codex, Gemini

### Phase 7: Orchestrator + CLI
- `16c4c07` Session state persistence (`.ultraagent/state.json`)
- `14f2ef2` Session lifecycle manager (start: config → tmux → adapters → MCP → ready)
- `2a515fc` `ultraagent start` command (default)
- `9246269` `ultraagent stop` command
- `a891498` `ultraagent doctor` command (check prerequisites)
- `3ee05a4` `ultraagent init` wizard with @clack/prompts
- `26e96c3` Commander program definition
- `3eba0d7` Main CLI entry point (`bin/ultraagent.ts`)
- `8d50806` MCP server entry point (`bin/ultraagent-mcp.ts`)

### Phase 8: Shell Scripts
- `b45e49a` `ultra-ask.sh` — ask a single agent from shell
- `5199991` `ultra-broadcast.sh` — broadcast to all workers from shell
- `b61f897` `ultra-assign.sh` — assign task to a worker from shell

### Bug Fixes & Improvements
- `0bc088b` README with architecture diagram, quick start, CLI reference
- `650b1dc` Improved pane readiness detection
- `f970cc6` Fixed MCP server path resolution in session.ts
- `4bf2f5a` tmux send-keys: use literal mode (`-l`) and separate Enter key
- `fc5b61d` IPC: capture full scrollback, search for prompt to extract response
- `8e52f64` Reverted to pane-only IPC, dropped hybrid approach
- `a6ff430` Fixed Gemini parser (`type: "gemini"` not `role: "model"`), Codex rollout paths, send-keys 200ms delay, parallel broadcast with `Promise.allSettled`
- `aa51e4d` Excluded chef from broadcast targets, added rate limit/error detection in polling loop
- `63c3ec5` `1e4a4b6` `7781811` `c95f320` `ultraagent config` command — interactive menu with navigation, instant worker toggles, dirty state tracking
- `d1f3149` Fixed permission flags: Codex `--dangerously-bypass-approvals-and-sandbox`, Gemini `-y`
- `935f439` `getInteractiveLaunchCommand` returns `Promise<ShellCommand>` for async `cc` alias detection
- `cb18d02` MCP handlers: try/catch to prevent server crash; prompt newlines flattened before tmux send
