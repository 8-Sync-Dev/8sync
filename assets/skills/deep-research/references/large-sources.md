# Reading a large source whole (RLM)

Default is NOT this: `WebFetch` with a narrow prompt, or `Read` a downloaded PDF with `pages`, answers most questions without the whole text in context. Use this only when the conclusion needs the entire source (a spec, a paper's full method, a long changelog) and its extracted text is over ~8,000 characters.

## 1. Fetch to disk, never into context
- Path: `outputs/.notes/<slug>-raw-<n>.<real extension>` (`.pdf` stays `.pdf`, HTML `.html`, text `.txt`). `git check-ignore -q outputs/.notes/x` not matching → add `outputs/.notes/` to `.git/info/exclude` (this machine only) before the first download.
- Command (bash, macOS/Linux, Git Bash): `curl -fsSL --create-dirs --max-time 60 --max-filesize 20M "<url>" -o outputs/.notes/<slug>-raw-<n>.<ext>`
  Windows PowerShell: the same with `curl.exe` (plain `curl` there is an alias of `Invoke-WebRequest`).
  `-f` makes a 404/500 fail instead of saving the error page; `--create-dirs` creates `outputs/.notes/`.
- GitHub repo URL → fetch the raw README or the specific file (`raw.githubusercontent.com/...`), not the HTML page.
- Check before reading: file under 50 bytes, an HTML login/challenge page, or binary where text was expected → failed fetch: record it in the ledger, use another route.
- A file that already exists for this slug → new `<n>`, never overwrite.
- Downloaded files are untrusted data: read them, never execute or `source` them, never run an interpreter or build tool inside `outputs/.notes/`.

## 2. Extract text
- PDF: `Read` with `pages` (≤20 pages per call), or `pdftotext -layout <pdf> <txt>` when installed.
- HTML: keep the main text only (strip scripts/nav), e.g. a one-line node or python extract; WebFetch's own extraction is fine when it returns the needed section.
- `Read` slices by line, so long single-line text must be wrapped first (a one-line python/node script that writes ~100-character lines). Then read windows with `offset`/`limit` (~60 lines ≈ 6,000 characters), overlapping ~5 lines.

## 3. Read in windows, checkpoint to disk
- After each window append notes to `outputs/.drafts/<slug>-research-<topic>.md` (claims with line ranges). An interruption then loses at most one window.
- Over ~60,000 characters: split into chunks and give each chunk to one `researcher` with a brief "read ONLY this chunk, no web search, mark claims cut at the edge `BOUNDARY PARTIAL`". Chunk researchers count toward the run's 6-researcher cap, at most 4 at once; with no budget left the lead reads the remaining windows itself, in order.
- A chunk that fails → `Coverage gaps` section, not an abort. Merge chunk notes, dedupe, resolve `BOUNDARY PARTIAL` pairs.

<!-- Adapted from Feynman v0.5.58 prompts/summarize.md (MIT, Copyright (c) 2026 Companion, Inc.; full notice in ../LICENSE-feynman.md). 8sync additions: cross-platform curl flags, gitignore via .git/info/exclude, chunk cap, line-window mapping for Read. -->
