#!/usr/bin/env bash
# Auto-setup Claude Code settings & omp Anthropic models from JSON.
set -euo pipefail

INPUT="${1:-}"
if [ -z "$INPUT" ]; then
    if [ ! -t 0 ]; then
        INPUT=$(cat)
    else
        echo "Please paste your Claude Code settings JSON (Ctrl+D to finish):"
        INPUT=$(cat)
    fi
fi

if [ -f "$INPUT" ]; then
    INPUT=$(cat "$INPUT")
fi

if ! command -v 8sync >/dev/null 2>&1; then
    # No raw fallback: `8sync harness claude-code` enforces the endpoint allowlist
    # and the Console-key rule, and merges settings without wiping the kit.
    echo "8sync not found in PATH. Install it first, then re-run." >&2
    exit 1
fi
# JSON on stdin keeps the token out of the process list.
printf '%s' "$INPUT" | 8sync harness claude-code
