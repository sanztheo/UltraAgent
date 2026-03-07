import type { UltraAgentConfig } from './types.js';

export const DEFAULT_CONFIG: UltraAgentConfig = {
  chef: 'claude',
  agents: ['claude', 'codex', 'gemini'],
  tmux: {
    layout: 'main-vertical',
    session_prefix: 'ultraagent',
  },
  permissions: {
    chef_mode: 'default',
    worker_mode: 'auto',
  },
  ipc: {
    default_timeout_ms: 60_000,
    max_payload_bytes: 1_048_576,
  },
};

export const GLOBAL_CONFIG_DIR = '~/.ultraagent';
export const GLOBAL_CONFIG_FILE = '~/.ultraagent/config.json';
export const PROJECT_CONFIG_FILE = '.ultraagent.json';
export const STATE_DIR = '.ultraagent';
export const STATE_FILE = '.ultraagent/state.json';
