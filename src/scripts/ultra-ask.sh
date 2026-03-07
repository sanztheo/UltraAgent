#!/usr/bin/env bash
# ultra-ask: Send a prompt to a specific AI CLI agent
# Usage: ultra-ask <agent> "<prompt>"

set -euo pipefail

readonly AGENTS=("claude" "codex" "gemini")

usage() {
  echo "Usage: ultra-ask <agent> \"<prompt>\"" >&2
  echo "Agents: ${AGENTS[*]}" >&2
  exit 1
}

if [[ $# -lt 2 ]]; then
  usage
fi

agent="$1"
prompt="$2"

# Validate agent name
valid=false
for a in "${AGENTS[@]}"; do
  if [[ "$a" == "$agent" ]]; then
    valid=true
    break
  fi
done

if [[ "$valid" == "false" ]]; then
  echo "Error: Unknown agent '$agent'. Must be one of: ${AGENTS[*]}" >&2
  exit 1
fi

# Check that the CLI is installed
if ! command -v "$agent" &>/dev/null; then
  echo "Error: '$agent' CLI not found in PATH" >&2
  exit 1
fi

# Dispatch to the appropriate CLI
case "$agent" in
  claude)
    claude -p "$prompt" --output-format json
    ;;
  codex)
    codex exec "$prompt" --json
    ;;
  gemini)
    gemini -p "$prompt"
    ;;
esac
