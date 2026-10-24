---
name: image-routing
description: Use this skill on EVERY read request AND before dumping large context, to decide between text and image representation. Apply whenever the AI is about to open a PDF, screenshot a URL, review a UI, inspect a long git diff, process diagrams, OR dump a big graph / call-tree / dependency map as text. First self-check your own modality (can you see images?), then consult the decision table. Picking wrong wastes tokens — but image is NOT always cheaper (see the honest economics below).
---

# image-routing — image vs text, by content type AND your modality

Two directions, one rule: **pick the modality that fits the content.**
- **Incoming** (you must read a PDF/UI/diagram/graph) — decision table below.
- **Outgoing** (about to emit a big dump — a call graph, dep-tree, dashboard) — if you can
  see images, render the STRUCTURE to one image instead of dumping its text form.

## STEP 0 — self-check your modality

**Can I see pixels?**
- **Native VLM (GLM-5.3 / GLM-5.3-Flash / any `zai/glm-5.3*` — the 8sync default): YES.**
  Docs: https://docs.z.ai/guides/vlm/glm-5.3-flash. Images arrive as `image_url` or via the
  `read` tool on local image files (`read path: "image.png"` decodes inline).
  **Look at the image directly in this session.** Do NOT call `mcp__zai_vision_*` / `@z_ai/mcp-server`.
- **Vision model (Opus-class): yes.** Use images for STRUCTURE/overview (below). Same rule:
  look yourself; do not bounce to a sidecar vision API.
- **Text-only (GLM-5.2 and older): no.** You cannot read PNGs. Only then route an incoming
  image through the **`zai-vision` MCP** (`~/.omp/skills/zai-vision/SKILL.md`) to get TEXT
  back, then act.

## Honest token economics (read before assuming image is cheaper)

- Claude bills images as **28×28-px patches**: `⌈W/28⌉ × ⌈H/28⌉` tokens — roughly **pay-per-pixel**.
  Opus 4.7+ removed the old cheap ~1.15 MP downscale cap and charges for pixels sent (~3× more at
  max res). So a big screenshot is NOT automatically cheap.
- Rendering **dense text as an image is only ~1.3-2× cheaper** than the text, and risks
  illegibility (resize/JPEG artifacts merge characters). Grounding: "Text or Pixels?" arXiv 2510.18279.
- The famous **10× / 90% reduction (DeepSeek-OCR, arXiv 2510.18234) needs a DEDICATED optical
  encoder** (~100 vision-tokens/page) — you do NOT get that by sending a PNG to Opus or GLM. Do not
  promise 90% for screenshots.
- **Where image genuinely wins: STRUCTURE.** A 12k-edge call graph, an architecture diagram, a
  dashboard, a rendered UI — the *text* equivalent (adjacency lists, DOM) is far larger AND loses
  layout. Here image is a real, large win because you read structure, not OCR'd characters.
- **Image reading is LOSSY** — exact code, line numbers, config, hashes MUST stay text.

## Decision table

| Content type                          | Use       | Why                                            |
|---------------------------------------|-----------|------------------------------------------------|
| Source code (`.rs`, `.ts`, `.py`, …)  | **text**  | exact lines; OCR'd code costs MORE + loses nums|
| Exact config / hashes / line data     | **text**  | precise + lossless                             |
| Plain text doc < ~50 KB               | text      | already cheap + exact                          |
| Call graph / call- or dep-graph / tree | **image** | structure ≪ its adjacency-list text (vision)   |
| Architecture / diagram / mermaid      | **image** | layout is the information                       |
| Rendered UI / dashboard review        | **image** | one shot ≪ DOM + styles                        |
| Long PDF (> 5 pages, figures/scans)   | **image** | `8sync pdf-img <file>`                          |
| Git diff > 500 lines                  | image     | `8sync diff-img <ref>` (phase 2 stub)          |
| Terminal output                       | text      | already text                                   |

## Tools

- **`8sync shot <url|file>`** — real (bundled/system Chromium → PNG; prints the vision-token
  estimate). Renders any URL incl. `8sync harness web` pages, or local HTML.
- **`8sync pdf-img <file>`** — PDF pages → PNGs (poppler).
- **`8sync gen-img "<prompt>" -o <output.png>`** — AI image generation via `gpt-image-2`
  (OpenAI / api.apikey.fun). Generates logos, icons, diagrams, UI mockups, and illustrations.
  Detailed runbook in the **`image-gen`** skill (`~/.omp/skills/image-gen/SKILL.md`).
- **Memory the OCR-Memory way** (arXiv 2604.26622): use an image to LOCATE a segment (the graph /
  an indexed page), then fetch the CONTENT as exact text from `trail ask` or the file.
  Image to find, text to read — never OCR precise content back out of a picture.

## Examples

Review a UI: `8sync shot http://localhost:3000/login` → one PNG instead of `LoginScreen.tsx` +
styles (~8k tok). GLM-5.3 / 5.3-Flash: look at the PNG yourself. GLM-5.2 only: zai-vision → text.

