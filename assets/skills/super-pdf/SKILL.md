---
name: super-pdf
description: Generate beautiful A4 PDFs from an HTML design system, in two modes. REPORT mode (WeasyPrint) — boardroom-grade review/architecture PDFs (kicker cover with chips strip + meta table, §N numbered spine, navy comparison tables, callouts, pills, stat cards). LEARNER mode (Chromium) — attractive handouts for learners/customers (full-bleed navy cover, journey-map SVG, step-flow chevrons, phase banners, cards with an inline SVG illustration per item, traps + checklist + CTA). Use whenever asked for a beautiful/professional PDF, "báo cáo PDF đẹp", super pdf, review verdict PDF, architecture doc PDF, tài liệu giao sếp/khách, "PDF như bản review MR", lộ trình/roadmap/giáo trình/syllabus/handout cho học viên, or "PDF đẹp, thu hút, dễ hiểu, có flow/ảnh".
---

# super-pdf — HTML design system → PDF A4

Turn notes/markdown into a **sharp PDF**. The template IS the design system: copy it,
**keep the `<style>` block**, swap only the body. One command renders; one raster pass
verifies.

## 0. Pick the mode first

| Reader | Mode | Template | Engine |
|---|---|---|---|
| Boss, reviewer, client deciding something | **Report** | `references/report-template.html` | WeasyPrint |
| Learner, student, customer reading to *understand* | **Learner** | `references/learner-template.html` | Chromium (Edge/Chrome) |

Signals for **Learner**: "cho học viên / người học / khách xem", "thu hút", "dễ hiểu",
"có flow / ảnh / hình", lộ trình, giáo trình, syllabus, handout, onboarding guide.
Owner verdict (2026-10-29): the report-style roadmap was too internal; the learner
version (cover + journey map + per-session illustrated cards) is the "đẹp" target.

## 1. Pipeline

```
content ready ─► cp references/<mode>-template.html <scratch>/<slug>.html
             ─► swap body content (keep CSS + component classes)
             ─► scripts/build.sh <scratch>/<slug>.html [out.pdf]   (engine auto-picked)
             ─► scripts/preview.sh out.pdf <scratch>/pv  → LOOK at every page
             ─► fix → rebuild → look again → deliver (Downloads or project outdir)
```

```bash
bash ~/.omp/skills/super-pdf/scripts/build.sh report.html report.pdf
# rendered (weasy) -> report.pdf
# pages: N        ← a report is 2–10 pages; a jump means a broken page-break
bash ~/.omp/skills/super-pdf/scripts/preview.sh report.pdf ./pv     # p1.png, p2.png, ...
```

- `build.sh` picks **chromium** when the HTML contains the `super-pdf:learner` marker,
  else **weasy**; force with `--engine weasy|chromium`. WeasyPrint failing to load
  (Windows without GTK/Pango) falls back to Chromium automatically.
- WeasyPrint and the rasterizer run via `uv run --with …` — no permanent install.
- Chromium: Edge/Chrome on Windows & macOS, `chromium`/`google-chrome` on Linux.

## 2. Report mode — content rules

1. **§0 là kết luận.** Busy reader reads only §0. One bold verdict sentence (in a
   `.callout`) + 3–6 evidence bullets. Front-load everything.
2. **Numbered spine.** Every `h2` carries `<span class="n">§N</span>` — manual numbering,
   never auto. `h3` for sub-points, no span.
3. **Cover = 5 blocks, in order:** `.chips` strip (2–4 category chips, uppercase —
   omit when there is nothing to classify) → `.kicker` (loại tài liệu · phạm vi) →
   `h1` (conclusion-oriented title) → `.sub` (one line) → orange `.rule` → `.meta`
   table (Chuẩn bị cho / Người soạn / Ngày / Phạm vi) → `.tagbox` (central question,
   verbatim).
4. **Numbers trace to a source.** No invented figures; the `.cap` of a `.stat` names
   its origin. Citations by publisher + title + bare domain.
5. **Comparison = `table.cmp`**: `th.axis` left column, `.pill` per cell
   (`p-red`/`p-amber`/`p-green` = Yếu/TB/Tốt), `td.win` on the winner column.
6. **Never split a block ugly:** `class="avoid-break"` on every table and stat row.

## 3. Learner mode — content rules

Write *to* the learner ("Bạn làm được…"), never about the document. **Drop every
internal artifact**: người soạn, phạm vi, verdict/§0, "so với bản cũ", Giữ/Tách/Mới
pills, § numbering. Page order:

1. **Cover** (`.cover`, full-bleed navy, `@page :first { margin:0 }`): brand mark →
   decorative SVG top-right (must not overlap the title) → `.eyebrow` → `h1` with
   1–2 `<em>` orange keywords → `.lead` → orange `.bar` → `.phases` (one tile per
   part: big number + label) → `.foot` (domain · motto).
2. **Journey page**: `svg.journey` snake road with one numbered node per item,
   colored by phase, short label under each node, BẮT ĐẦU / ĐÍCH markers + `.legend`;
   then `.flow` (4 chevrons = how every lesson runs) and `.tiles` (what to prepare).
3. **Per part**: `.banner.<phase>` (part name, one-line promise, count) then one
   `.card.<phase>` per item = `.vis` (inline SVG 140×100 that *shows* the concept:
   call stack, linked nodes, tree, graph, curves, bars, table, Venn, ERD, flow…) +
   `.bd` (`.num` badge, `h3`, italic `.ld` why-it-matters, ≤3 bullets, `.goal`
   "Bạn làm được: …").
4. **Closing page**: `.traps` (6 red tiles: mistake + one-line why) → `ul.check`
   (grid checklist) → short reading list → `.cta` (brand · motto · URL).

Phase colors: blue `#10618f` (`.dsa`), green `#1c7c54` (`.sql`), orange `#d47a1e`
(`.fin`) — rename the classes for other domains, keep 2–3 phases max.

## 4. Design tokens

| Token | Value | Use |
|---|---|---|
| Navy | `#0f2b46` | headings, table head, cover bg, CTA |
| Orange | `#d47a1e` | rules, kicker, `h2 .n`, accents, final phase |
| Body (report) | `#1f2733`, Liberation Sans 9.7pt, justified | prose |
| Body (learner) | `#1f2733`, Segoe UI → Be Vietnam Pro → Arial 9.8pt | prose |
| Page | A4; report `20mm 18mm 18mm 18mm`, learner `14mm 14mm 16mm` | footer brand left · `N/M` right; cover blank |
| `.callout` | amber default; `.blue` · `.green` · `.red` + `.lbl` | verdict / context / pass / risk |
| SVG helpers (learner) | `.ln .gl .bx .sd .t .ts .tw .mid`, `url(#ar)` arrow | draw with the card's `--c`/`--cl` phase vars |

## 5. Gotchas — each already paid for once

- `WARNING: Deprecated -weasy-hyphens: none` is **harmless** (disables Vietnamese hyphenation).
- WeasyPrint fonts come from **fontconfig aliases** (Liberation Sans↔Arial) — keep the fallback chain.
- **Emoji glyphs render as empty boxes** in WeasyPrint — use text (`BẪY`, `PASS`) or a tiny SVG.
- **Vietnamese + `pdftotext` grep**: text is often NFD; grep ASCII-safe substrings or NFC-normalize.
- **Long tables + `page-break-inside: avoid`**: a no-break table taller than a page overflows — split it.
- **Orphaned headings**: wrap each `h2`/banner together with its first block in one
  `avoid-break` div; for an overview table use `page-break-before: always` on the wrapper.
- **Chromium margin boxes** don't inherit `body` font — set `font-family` inside each
  `@bottom-*` rule or the footer prints in a serif fallback.
- **`<!DOCTYPE html>` must be the first line** — a comment before it drops Chromium into quirks mode.
- **Text inside SVG boxes**: size boxes for the longest label at 8px (≈4.5px/char);
  shorten the label rather than let it overflow.
- **Left accent on rounded cards**: use `box-shadow: inset 5px 0 0 var(--c)`, not `border-left`.
- **`pdftoppm` is often missing on Windows** — `scripts/preview.sh` uses PyMuPDF instead.

## 6. Verify before "done" (mandatory)

```bash
bash ~/.omp/skills/super-pdf/scripts/preview.sh out.pdf <scratch>/pv
```

Read **every** PNG (route through zai-vision if the model cannot see): colors and
pills render, nothing overlaps (cover art vs title, labels vs markers), text stays
inside SVG boxes and margins, footer page numbers present (not on cover), no heading
stranded at a page bottom, checklist columns balanced. Fix and re-render until clean.
