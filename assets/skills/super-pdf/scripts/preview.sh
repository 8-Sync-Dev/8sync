#!/usr/bin/env bash
# Rasterize every PDF page to PNG for the visual check (no poppler needed).
# Usage: preview.sh <file.pdf> [outdir] [dpi]   -> <outdir>/p1.png, p2.png, ...
set -euo pipefail
pdf="${1:?usage: preview.sh <file.pdf> [outdir] [dpi]}"
dir="${2:-$(dirname "$pdf")}"
dpi="${3:-80}"
mkdir -p "$dir"
uv run --with pymupdf python -c "
import sys, pymupdf
d = pymupdf.open(sys.argv[1])
for i, p in enumerate(d):
    p.get_pixmap(dpi=int(sys.argv[3])).save(f'{sys.argv[2]}/p{i+1}.png')
print('pages:', len(d), '->', sys.argv[2])
" "$pdf" "$dir" "$dpi"
