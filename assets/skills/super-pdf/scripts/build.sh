#!/usr/bin/env bash
# Render a super-pdf HTML -> PDF.
# Usage: build.sh [--engine weasy|chromium] <input.html> [output.pdf]
#   default output = <input basename without .html>.pdf, next to the HTML.
#   engine default: weasy for report-template, chromium for learner-template
#   (detected by the "super-pdf:learner" marker in the HTML). If WeasyPrint
#   cannot load its native libs (Windows without GTK), falls back to chromium.
set -euo pipefail
engine=""
if [ "${1:-}" = "--engine" ]; then engine="${2:?--engine needs weasy|chromium}"; shift 2; fi
in="${1:?usage: build.sh [--engine weasy|chromium] <input.html> [output.pdf]}"
[ -f "$in" ] || { echo "no such file: $in" >&2; exit 1; }
out="${2:-${in%.html}.pdf}"
if [ -z "$engine" ]; then
  if grep -q 'super-pdf:learner' "$in"; then engine=chromium; else engine=weasy; fi
fi

find_chromium() {
  for c in \
    "/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" \
    "/c/Program Files/Microsoft/Edge/Application/msedge.exe" \
    "/c/Program Files/Google/Chrome/Application/chrome.exe" \
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" \
    "/Applications/Chromium.app/Contents/MacOS/Chromium"; do
    [ -x "$c" ] && { echo "$c"; return 0; }
  done
  for c in chromium chromium-browser google-chrome google-chrome-stable microsoft-edge msedge chrome; do
    command -v "$c" >/dev/null 2>&1 && { command -v "$c"; return 0; }
  done
  return 1
}

# Absolute native path (C:/... under Git Bash, /... elsewhere) for Chromium.
abs() { (cd "$(dirname "$1")" && printf '%s/%s' "$(pwd -W 2>/dev/null || pwd)" "$(basename "$1")"); }

render_chromium() {
  local bin; bin="$(find_chromium)" || { echo "no Chromium/Chrome/Edge found for --engine chromium" >&2; exit 1; }
  local ain aout; ain="$(abs "$in")"; : > "$out"; aout="$(abs "$out")"
  "$bin" --headless=new --disable-gpu --no-pdf-header-footer \
    --print-to-pdf="$aout" "file:///${ain#/}" >/dev/null 2>&1
}

if [ "$engine" = chromium ]; then
  render_chromium
elif ! uv run --with weasyprint python -m weasyprint "$in" "$out"; then
  echo "weasyprint failed (missing GTK/Pango?) -> falling back to chromium" >&2
  engine=chromium
  render_chromium
fi
[ -s "$out" ] || { echo "render produced no PDF: $out" >&2; exit 1; }
echo "rendered ($engine) -> $out"
# Page count (defensive: a document should not silently balloon).
uv run --with pypdf python -c "import sys;from pypdf import PdfReader as R;print('pages:', len(R(sys.argv[1]).pages))" "$out"
