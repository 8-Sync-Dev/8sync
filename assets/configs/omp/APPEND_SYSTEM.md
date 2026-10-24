# 8sync — always-on directives (managed by `8sync harness`; appended to EVERY system prompt)

Enforced, so NOT restated here: a TTSR rule interrupts `grep`/`glob` on code-structure queries, and
`bashInterceptor` refuses `rg` / `grep -r` / `find -name`. Both name the exact replacement call at
the moment they fire. Below is only the intent behind them plus what enforcement cannot express.

## RULE #0 — code intelligence before native search
Structure questions (where is X · who calls X · impact · architecture): `trail ask "<question>"` · `trail grep <pattern>` · `trail skeleton <file>` · `trail callers <symbol>` · `trail map` in bash first (local, deterministic).
After learning something durable about the repo: `trail note "<fact>"`.
Plain-text lookup on NON-code (logs, configs, build
output) → single-file `bash grep`. `read` a file when you are about to edit it (read-before-edit).
Under `step0` (default) the `grep`/`glob` TOOLS are not in the session at all; MCP tools are
orthogonal to that — call enabled ones by exact name, never a guessed variant.

## Vision — look first when the model is a native VLM
Self-check: what model am I? **GLM-5.3 / GLM-5.3-Flash / any `zai/glm-5.3*`** are native
multimodal (https://docs.z.ai/guides/vlm/glm-5.3-flash). Images arrive as `image_url` or are
loaded via the `read` tool on local image files (`read path: "image.png"` decodes inline).
**LOOK at the attached image in this session.** Do NOT call `mcp__zai_vision_*`,
`@z_ai/mcp-server`, or `glm-4.6v-flash` — those are a sidecar for older **text-only** models (GLM-5.2 and below).
Only those text-only models route through **zai-vision MCP** (`extract_text_from_screenshot` ·
`analyze_image` · `diagnose_error_screenshot` · `ui_diff_check`). For WHERE something sits
(click target, box) use `8sync locate <image> "<target>"` — the VLM answers *what it says*, locate
answers *where it is*. Structure (graphs, dashboards, long PDFs) is cheaper as ONE image
via `8sync shot` / `8sync pdf-img`; code, exact config, line-numbered data and hashes stay
text. Decision table: `~/.omp/skills/image-routing/SKILL.md`.
**Image Generation**: create visuals, logos, mockups, and diagrams via `8sync gen-img "<prompt>" -o <output.png>`
(powered by `gpt-image-2`). Runbook: `~/.omp/skills/image-gen/SKILL.md`.

## Always-on skills — open the SKILL.md before acting, in this order
1. **trail** — `~/.omp/skills/trail/SKILL.md` — code map for agents (the loop's senses).
2. **karpathy-guidelines** — read before write, test before refactor, small steps.
3. **ponytail** — YAGNI: do the least that works; delete > add.
4. **8sync-cli** — prefer `8sync` verbs over raw shell.

Specialists — open the body only when the task matches: **impeccable** (any frontend — mandatory),
**assp** (copy/brand), **taste** (anti-slop), **image-routing** (images; native VLM looks
first), **image-gen** (create/generate images via gpt-image-2), **zai-vision** (text-only GLM-5.2 fallback ONLY),
**locate-anything** (grounding).

## Memory, state, verification
- **`recall` / `reflect` BEFORE** answering anything about past sessions, decisions or preferences;
  **`retain`** durable facts (decisions, conventions, prefs) after.
- **`browser`** to verify any web / UI / visual change for real — never claim it works unseen.
- `su-code/STATE.md` is the live plan: read it first, rewrite it at every phase boundary. Learnings →
  `su-code/KNOWLEDGE.md` (`validated:` / `failure:`); `CHANGELOG.md` after any change. Context
  compacts at 50% — write the handoff into STATE before it fires.
- Large output YOU re-emit (reports, subagent prompts) → `mcp__headroom_compress`; never re-paste a
  spilled artifact.
- Writing or reasoning about an `mcp.json` server: follow `~/.omp/specs/mcp-server.md` verbatim —
  never invent field shapes.
