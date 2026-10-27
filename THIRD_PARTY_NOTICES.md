# Third-party notices

## Feynman (MIT)

Parts of the following files are adapted from Feynman.

- Source: https://github.com/companion-inc/feynman
- Adapted files (upstream path, upstream commit):
  - `assets/skills/deep-research/SKILL.md` — `prompts/deepresearch.md`, `.feynman/SYSTEM.md`, `.feynman/agents/researcher.md` — 87a4567 (v0.5.58, 2026-10-26)
  - `assets/skills/deep-research/references/templates.md` — `prompts/deepresearch.md`, `.feynman/agents/*.md` — 87a4567
  - `assets/skills/deep-research/references/large-sources.md` — `prompts/summarize.md` — 87a4567
  - `assets/skills/autoresearch/SKILL.md` — `prompts/autoresearch.md` — 87a4567
  - `assets/claude/agents/researcher.md` — `.feynman/agents/researcher.md` — 87a4567 (first port 4cec627)
  - `assets/claude/agents/verifier.md` — `.feynman/agents/verifier.md` — 87a4567 (first port 4cec627)
  - `assets/claude/agents/research-reviewer.md` — `.feynman/agents/reviewer.md` — 87a4567
  - `assets/skills/research-paper/SKILL.md` — `prompts/replicate.md`, `prompts/recipe.md`, `prompts/audit.md`, `prompts/draft.md` — earlier port, commit not recorded
  - `assets/skills/remote-compute/SKILL.md` — `skills/docker`, `skills/modal-compute`, `skills/runpod-compute` — earlier port, commit not recorded (modal/runpod skills were removed upstream in 83a8575)
- The installed copies carry this notice in `skills/deep-research/LICENSE-feynman.md`.

Upstream license text:

MIT License

Copyright (c) 2026 Companion, Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## super-board (MIT)

The board of `8sync ccc auto` (lanes `backlog → ready → building → qa → review → approved → done` plus
`blocked`, `bug`/`feature`/`qa` labels, one claim per card with a stale-claim reap, the rebuild cap that
blocks a card bounced back too often, the "seen again" note for a repeated card, per-lane playbooks and
the approve-the-head-SHA-then-`--match-head-commit` merge) follows the design of super-board. No code was
copied: it is rebuilt in Rust on a local JSON file instead of GitHub Projects.

- Source: https://github.com/EricTechPro/super-board
- Commit read: 7d848f7
- Files: `crates/cli/src/verbs/ccc/target.rs`, `crates/cli/src/verbs/ccc/auto.rs` (lane playbooks)

Upstream license text:

MIT License

Copyright (c) 2026 Eric Tech

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
