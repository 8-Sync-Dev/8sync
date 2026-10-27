# 00 — Force Load Skills (managed by `8sync harness init`)

## 🔴 RULE #0 — CODE MAP FIRST, ALWAYS (trail CLI first)

Before any other tool call, answer codebase questions with the code map (`trail`) — NOT grep/find/Read. Deterministic tree-sitter, no model call, far cheaper than file-by-file exploration:

- **trail** (local code map; `8sync trail` sets a repo up once): `trail ask "<question>"` (code inlined at file:line) · `trail grep <pattern>` · `trail skeleton <file>` · `trail callers <symbol>` (`--direction out` = callees) · `trail map`. Skill: `~/.omp/skills/trail/SKILL.md`.
- **Default to trail** for "how does X work / where is X / who calls X / what depends on X", impact analysis, route→handler, architecture. After learning something durable: `trail note "<fact>"`.
- **Nén những gì BẠN phát lại:** báo cáo/prompt subagent/nội dung dài sắp re-emit → `mcp__headroom_compress` (60–95% ít token; `headroom_retrieve` giải nén theo hash). omp tự spill tool-output quá dài ra artifact — KHÔNG paste lại blob đã spill.
- Only `Read` a raw file when you're about to edit it (read-before-edit). Falling back to `rg`/`fd`/`Read` for exploration first is a **violation**.

## ⛔ READING ORDER — 2 tầng (progressive disclosure, giữ prefix gọn cho KV-cache)

### CORE — đọc body NGAY, trước tool call đầu tiên (không skip, đúng thứ tự)

Nhỏ + dùng cho MỌI task: trail → karpathy → ponytail → 8sync-cli.

1. **`~/.omp/skills/trail/SKILL.md`** — code map cho agent (senses của loop).
2. **`~/.omp/skills/karpathy-guidelines/SKILL.md`** — kỷ luật engineering (read-before-write, test-before-refactor, bước nhỏ).
3. **`~/.omp/skills/ponytail/SKILL.md`** — "laziest senior dev": YAGNI, làm ít nhất, xoá > thêm.
4. **`~/.omp/skills/8sync-cli/SKILL.md`** — đang chạy trong harness 8sync; ưu tiên verb 8sync hơn shell thô.

### SPECIALIST always-on — biết khả năng, đọc body KHI task khớp (đừng đọc mỗi phiên)

- **`assp-skill`** — brand DNA 8 Sync Dev + ASSP validate-before-build. Mở khi: UI copy, landing/pricing, email/error, greenlight feature mới.
- **`impeccable`** — **design system CHUẨN; BẮT BUỘC mở body NGAY khi có việc UI/design/redesign/audit** (chạy `scripts/context.mjs`, kèm `references/house/*`).
- **`taste-skill`** — anti-slop frontend taste. Mở khi: landing/portfolio/redesign.
- **`image-routing`** — image-vs-text routing. Mở khi: xử lý ảnh/diff/PDF.
- **`zai-vision`** — FALLBACK only. SKIP khi session là **GLM-5.3 / GLM-5.3-Flash** (native VLM — nhìn ảnh trực tiếp, https://docs.z.ai/guides/vlm/glm-5.3-flash). Chỉ mở khi model **text-only (GLM-5.2 trở xuống)** và `image-routing` chọn "image": OCR / chẩn đoán lỗi / diagram / UI→code qua MCP `zai-vision`. **Cấm** gọi `mcp__zai_vision_*` từ session GLM-5.3.
- **`locate-anything`** — visual grounding (NVIDIA LocateAnything-3B via `8sync locate`). Mở khi: cần TỌA ĐỘ chính xác của UI element (để click), box vị trí object/text trong ảnh — grounding chứ không phải caption. Bổ trợ `browser` + `8sync shot`. Non-commercial license.
- **`image-gen`** — tạo ảnh AI (logos, icons, diagrams, UI mockups, illustrations) via `gpt-image-2` (`8sync gen-img`). Mở khi: người dùng yêu cầu tạo/vẽ/sinh ảnh hoặc asset trực quan.

On-demand (đọc khi task khớp description): `code-review-and-quality`, `senior-security`, `senior-frontend`, `full-flow`, `last30days`, `feature`, `branch-sync`; `encore-deploy` (chỉ khi project dùng Encore); `social-growth` (opt-in — `8sync skill add builtin:social-growth`). **Research** (ported từ `companion-inc/feynman` sang omp-native tools — xem `assets/skills/<name>/SKILL.md`): `deep-research` (điều tra + brief có provenance, verifier trước reviewer), `autoresearch` (owner gõ `/autoresearch`: vòng thử/đo/giữ-bỏ có ngưỡng nhiễu), `research-paper` (replicate · recipe · audit · draft), `remote-compute` (Docker sandbox · Modal · RunPod).

If inside a project (cwd có `.git` / `Cargo.toml` / `package.json` / …) — đọc thêm:

- **`<repo>/AGENTS.md`** — guidance riêng dự án. Block `<!-- 8sync:skills:begin -->`…`end` liệt kê skill project-local; đọc cái khớp task.
- **`<repo>/su-code/{PROJECT,KNOWLEDGE,DECISIONS,PREFERENCES,STATE}.md`** — memory tích luỹ. Đọc STATE đầu phiên.

## Fast lookup table

| Task type | Order to read |
|---|---|
| ANY code exploration (how does X work? where is X?) | **trail → karpathy → 8sync-cli → project-local** |
| Refactor / impact analysis | **trail (callers) → karpathy → project-local** |
| User-facing copy / UI text / landing / pricing / new product feature | **karpathy → assp → impeccable + taste** |
| Frontend design / redesign / UI build / audit | **karpathy → impeccable → taste** (+ assp for any copy) |
| Review UI / PDF / diff | karpathy → **image-routing** → look yourself if GLM-5.3; **zai-vision** ONLY if text-only |
| Generate image / icon / logo / diagram | **image-gen** → `8sync gen-img "<prompt>" -o <path>` |
| Inside an 8sync repo | CORE always-on (đọc ngay) + specialist/on-demand khi khớp + `su-code/*.md` (STATE đầu phiên) |
| Simple one-liner question | trail if codebase-related, else karpathy |

## Invariants (no exceptions)

- **NEVER skip the code map (trail CLI) for code exploration.** Grep / Read-all wastes 10–100× tokens.
- **NEVER skip karpathy or ponytail.** Engineering discipline + YAGNI (do the least that works, delete > add) is non-negotiable.
- **Building UI / redesign / any frontend?** `impeccable` is THE house design system — mandatory, with `references/house/*` (workflow + clouds-f). Pair with `assp` (brand voice/offer) for copy and `taste` (anti-slop). Shipping UI without impeccable is a violation.
- **NEVER skip 8sync-cli** when AGENTS.md mentions 8sync — using raw shell instead of `8sync` verbs misses memory + skill auto-load.
- **Project-local skill in `su-code/skills/<name>/` matches the task description?** Read it BEFORE touching code.
- **Cite code as `path:line` or `path:start-end`.** Never natural language ("around line 50").
- **Output > ~50 dòng → BẮT BUỘC `headroom_compress`** trước khi vào context; không dump thô. Giữ artifact ID để retrieve.
- **After every change:** update `CHANGELOG.md` (Unreleased) + record what you learned in `su-code/KNOWLEDGE.md`.

## 🔁 Loop engineering — operate as a designed loop, not one-off prompts

Inspired by Addy Osmani / Boris Cherny "loop engineering" (github.com/cobusgreyling/loop-engineering). The 8sync harness IS the loop; operate accordingly:

- **STATE spine + recitation** — `su-code/STATE.md` (kế hoạch sống: Goal · DoD · Checklist · Current · Next · Open-questions) + `su-code/KNOWLEDGE.md` (validated learnings) là spine bền ngoài chat. **Đọc STATE đầu phiên; rewrite STATE ở MỖI phase-boundary** (gạch việc xong, ghi bước kế) — đẩy kế hoạch xuống cuối context để bias attention, chống lost-in-the-middle.
- **Compaction (context gần đầy)** — đừng để bị cắt cụt: chủ động ghi handoff có cấu trúc vào STATE.md (Done · In-flight · Next · Open-questions) + bài học `validated:`/`failure:` vào KNOWLEDGE (dùng `headroom_compress` để tóm), rồi reinit phiên mới chỉ đọc spine + STATE.
- **Budget awareness** — ước lượng context còn lại; compact/handoff CHỦ ĐỘNG trước khi tràn, đừng đợi mất việc.
- **Maker / checker (C)** — tách bằng `task` sub-agents: *implementer* (own context) làm, *verifier* (own context) chạy build/test/benchmark ĐỘC LẬP, trả `validated|failed` + log đã `headroom_compress`. Orchestrator giao mỗi subagent **objective + boundaries + output-format** rõ (chống trùng việc/sót). Việc phụ thuộc → share full trace; chỉ parallel khi subtask độc lập. Never self-approve việc rủi ro/không đảo ngược.
- **Verify-gate + Reflexion (C)** — learning là `validated:` chỉ khi test/build/benchmark xác nhận; chưa thì `hypothesis:`. **FAIL → ghi `failure:`** vào KNOWLEDGE (triệu chứng + nguyên nhân + cách sửa); đầu phiên đọc các `failure:` gần nhất trước để KHÔNG lặp lỗi.
- **Procedural memory / playbooks (D)** — quy trình đa bước đã `validated:` → distill thành runbook tái dùng trong `su-code/PLAYBOOKS.md`, index theo dòng **When:** (mô tả tình huống). Lần sau gặp tương tự → retrieve + adapt thay vì suy luận lại (Voyager skill-library). Tầng memory: KNOWLEDGE = bài học lời · PLAYBOOKS = quy trình đã verify · DECISIONS = ADR.
- **Phased autonomy + guardrails (E)** — **L1** report-only · **L2** assisted (đưa diff, chờ duyệt) · **L3** unattended (chỉ khi bật tường minh). Mọi level: **verify-gate TRƯỚC commit**, gitleaks chặn secret, scope commit chỉ `su-code/`+docs trừ khi cho phép, **KHÔNG tự `push`/PR ở L3 mặc định**. `8sync harness up --timer <dur>` chạy loop nền; mỗi tick: đọc STATE → chọn `Next` → (L2+) làm → verify → cập nhật STATE/KNOWLEDGE → (`--commit`) commit. **Đo loop: `8sync harness bench`** trước/sau mỗi thay đổi.
- **`/sx-auto` — THE autonomous engine (one command, gsd-pi-style, on omp core)** — `/sx-auto <goal>` plans (with integrated research) then runs to DONE via code-enforced `engine_*` tools (durable slice/task state · verify-with-retry gate · gitleaks-gated commit · run-to-done loop enforced by omp's `session_stop` continuation, capped at 8), backed by the `8sync-engine` omp extension. Isolate a risky slice with omp's `task.isolation` (branch mode `omp/task/<id>`). `/sx-auto status|resume`. The single automation entry — no competing command.
- **Senses + hands** — the code map (trail) is the loop's senses; STATE/KNOWLEDGE its memory; `task` sub-agents its hands; `harness` keeps them current.
