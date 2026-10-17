# Third-party notices

## Feynman (MIT)

Parts of the following files are adapted from Feynman.

- Source: https://github.com/companion-inc/feynman
- Commit: 4cec627
- Adapted files:
  - `assets/claude/agents/researcher.md` (from `.feynman/agents/researcher.md`)
  - `assets/claude/agents/verifier.md` (from `.feynman/agents/verifier.md`)
  - `assets/skills/deep-research/SKILL.md` (pipeline from `deepresearch.md`)

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
