#!/usr/bin/env bash
# ultra-assign: Assign a structured task to a specific AI CLI agent
# Usage: ultra-assign <agent> "<task>" [--can-code] [--files file1,file2]

set -euo pipefail

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
  echo "Usage: ultra-assign <agent> \"<task>\" [--can-code] [--files file1,file2]" >&2
  echo "Options:" >&2
  echo "  --can-code    Allow the agent to write/modify code" >&2
  echo "  --files       Comma-separated list of files the agent may touch" >&2
  exit 1
}

if [[ $# -lt 2 ]]; then
  usage
fi

agent="$1"
task="$2"
shift 2

can_code=false
files=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --can-code)
      can_code=true
      shift
      ;;
    --files)
      if [[ $# -lt 2 ]]; then
        echo "Error: --files requires a value" >&2
        exit 1
      fi
      files="$2"
      shift 2
      ;;
    *)
      echo "Error: Unknown option '$1'" >&2
      usage
      ;;
  esac
done

# Build structured prompt
structured_prompt="## Task Assignment

${task}

## Constraints"

if [[ "$can_code" == "true" ]]; then
  structured_prompt="${structured_prompt}
- You MAY create and modify code files"
else
  structured_prompt="${structured_prompt}
- Do NOT modify any files. Analysis and response only"
fi

if [[ -n "$files" ]]; then
  structured_prompt="${structured_prompt}
- Restrict file modifications to: ${files}"
fi

structured_prompt="${structured_prompt}

## Response
Provide a concise, actionable response. Use code blocks for any code."

exec "$SCRIPT_DIR/ultra-ask.sh" "$agent" "$structured_prompt"
