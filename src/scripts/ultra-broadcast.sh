#!/usr/bin/env bash
# ultra-broadcast: Send a prompt to all available AI CLI agents
# Usage: ultra-broadcast "<prompt>"

set -euo pipefail

readonly AGENTS=("claude" "codex" "gemini")
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
  echo "Usage: ultra-broadcast \"<prompt>\"" >&2
  exit 1
}

if [[ $# -lt 1 ]]; then
  usage
fi

prompt="$1"
found_any=false

for agent in "${AGENTS[@]}"; do
  if ! command -v "$agent" &>/dev/null; then
    echo "[$agent] SKIPPED (not installed)" >&2
    continue
  fi

  found_any=true
  echo "--- [$agent] ---"

  if ! output=$("$SCRIPT_DIR/ultra-ask.sh" "$agent" "$prompt" 2>&1); then
    echo "[$agent] ERROR: $output" >&2
  else
    echo "$output"
  fi

  echo ""
done

if [[ "$found_any" == "false" ]]; then
  echo "Error: No agent CLIs found in PATH" >&2
  exit 1
fi
