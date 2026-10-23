# AGENTS.md — Hướng dẫn cho AI agent làm việc với `su-code`


<!-- 8sync:skills:begin -->
## 🚨 STEP 0 — CODE INTELLIGENCE FIRST (codegraph CLI trước)

Mọi câu hỏi về code → dùng code-intelligence engine TRƯỚC grep/read (tiết kiệm ~99% token). Bạn (AI) **PHẢI**:

1. **codegraph** (local index): `codegraph index .` 1 lần/session; rồi `codegraph query/explore/node/callers/callees/impact` thay cho `grep`/`rg`/`fd`/`Grep`/`Glob` và `Read` toàn file.
2. Tìm/hiểu/định vị code · impact · route→handler · dead code · architecture → codegraph CLI trước. Chỉ `Read` raw file khi sắp SỬA nó (read-before-edit).
3. **Nén những gì BẠN phát lại:** báo cáo / subagent prompt / nội dung dài sắp re-emit → `mcp__headroom_compress` (60–95% ít token). omp tự spill output quá dài ra artifact — KHÔNG paste lại blob đã spill vào context.

Lý do: 5 query cấu trúc ≈ 3.4k token vs ≈ 412k token grep từng file (−99%). Dump cả file / grep mù = đốt token = bug.

## 🚨 STEP 1 — skills 2 tầng: CORE (đọc ngay) · SPECIALIST + on-demand (đọc khi cần)

Mỗi skill = 1 directory (Agent Skills open standard): `SKILL.md` có frontmatter `name`+`description`. Skill vendored ở `su-code/skills/<name>/` (bản commit trong repo, mirror từ `~/.omp/skills/`). Mỗi skill liệt kê 1 lần.

### ⛔ CORE always-on — ĐỌC NGAY (body), trước tool call đầu tiên (không skip)

Nhỏ + dùng cho MỌI task. **Thứ tự = ưu tiên (đọc top-down).** Mở `SKILL.md` ở path dưới rồi mới gọi tool đầu tiên:

  1. `su-code/skills/codegraph/SKILL.md`
  2. `su-code/skills/karpathy-guidelines/SKILL.md`
  3. `su-code/skills/ponytail/SKILL.md`
  4. `su-code/skills/8sync-cli/SKILL.md`

### 🧩 SPECIALIST always-on — biết khả năng, đọc body KHI task khớp (progressive disclosure)

KHÔNG đọc body mỗi phiên (giữ prefix gọn, tiết kiệm KV-cache). Khi task khớp → mở `SKILL.md` tương ứng NGAY. **`impeccable` = design system CHUẨN, BẮT BUỘC mở body ngay khi có việc UI/design/redesign/audit** (kèm `references/house/*`); `assp` cho copy/offer; `taste` chống slop; `image-routing` khi xử lý ảnh/diff/PDF. **GLM-5.3 / GLM-5.3-Flash = native VLM** (https://docs.z.ai/guides/vlm/glm-5.3-flash): nhìn ảnh trực tiếp trong session — **CẤM** `mcp__zai_vision_*` / `@z_ai/mcp-server`. zai-vision chỉ cho GLM-5.2 text-only.

- `assp-skill` — `su-code/skills/assp-skill/SKILL.md`
- `impeccable` — `su-code/skills/impeccable/SKILL.md`
- `design-taste-frontend` — `su-code/skills/taste-skill/SKILL.md`
- `image-routing` — `su-code/skills/image-routing/SKILL.md`
- `locate-anything` — `su-code/skills/locate-anything/SKILL.md`

### 🔎 On-demand — tên = trigger; mở `SKILL.md` của skill khi task khớp (mô tả ở frontmatter, KHÔNG nhồi ở đây)

- `academic-paper` — `su-code/skills/academic-paper/SKILL.md`
- `accessibility` — `su-code/skills/accessibility/SKILL.md`
- `agent-browser` — `su-code/skills/agent-browser/SKILL.md`
- `ai-microservice-design` — `su-code/skills/ai-microservice-design/SKILL.md`
- `alpha-research` — `su-code/skills/alpha-research/SKILL.md`
- `anthropic-compliance` — `su-code/skills/anthropic-compliance/SKILL.md`
- `api-and-interface-design` — `su-code/skills/api-and-interface-design/SKILL.md`
- `ask-matt` — `su-code/skills/ask-matt/SKILL.md`
- `aup-audit` — `su-code/skills/aup-audit/SKILL.md`
- `autoresearch` — `su-code/skills/autoresearch/SKILL.md`
- `best-practices` — `su-code/skills/best-practices/SKILL.md`
- `branch-sync` — `su-code/skills/branch-sync/SKILL.md`
- `brand-logo-kit` — `su-code/skills/brand-logo-kit/SKILL.md`
- `browser-profile-control` — `su-code/skills/browser-profile-control/SKILL.md`
- `browser-testing-with-devtools` — `su-code/skills/browser-testing-with-devtools/SKILL.md`
- `business-brief` — `su-code/skills/business-brief/SKILL.md`
- `campaign-plan` — `su-code/skills/campaign-plan/SKILL.md`
- `chief-of-staff` — `su-code/skills/chief-of-staff/SKILL.md`
- `ci-cd-and-automation` — `su-code/skills/ci-cd-and-automation/SKILL.md`
- `claude-handoff` — `su-code/skills/claude-handoff/SKILL.md`
- `clean-code-javascript` — `su-code/skills/clean-code-javascript/SKILL.md`
- `clouds-f` — `su-code/skills/clouds-f/SKILL.md`
- `clouds-rust` — `su-code/skills/clouds-rust/SKILL.md`
- `clouds-tauri` — `su-code/skills/clouds-tauri/SKILL.md`
- `code-optimizer` — `su-code/skills/code-optimizer/SKILL.md`
- `code-review` — `su-code/skills/code-review/SKILL.md`
- `code-review-and-quality` — `su-code/skills/code-review-and-quality/SKILL.md`
- `code-simplification` — `su-code/skills/code-simplification/SKILL.md`
- `codebase-design` — `su-code/skills/codebase-design/SKILL.md`
- `coding-standards` — `su-code/skills/coding-standards/SKILL.md`
- `competitive-brief` — `su-code/skills/competitive-brief/SKILL.md`
- `competitor-video-analysis` — `su-code/skills/competitor-video-analysis/SKILL.md`
- `vercel-composition-patterns` — `su-code/skills/composition-patterns/SKILL.md`
- `computer-architecture-researcher` — `su-code/skills/computer-architecture-researcher/SKILL.md`
- `constant-time-analysis` — `su-code/skills/constant-time-analysis/SKILL.md`
- `context-engineering` — `su-code/skills/context-engineering/SKILL.md`
- `contributing` — `su-code/skills/contributing/SKILL.md`
- `core-web-vitals` — `su-code/skills/core-web-vitals/SKILL.md`
- `cryptographer` — `su-code/skills/cryptographer/SKILL.md`
- `debug-like-expert` — `su-code/skills/debug-like-expert/SKILL.md`
- `debug-verify` — `su-code/skills/debug-verify/SKILL.md`
- `debugging-and-error-recovery` — `su-code/skills/debugging-and-error-recovery/SKILL.md`
- `deep-research` — `su-code/skills/deep-research/SKILL.md`
- `defensible-cv` — `su-code/skills/defensible-cv/SKILL.md`
- `deprecation-and-migration` — `su-code/skills/deprecation-and-migration/SKILL.md`
- `diagnosing-bugs` — `su-code/skills/diagnosing-bugs/SKILL.md`
- `discord-ops` — `su-code/skills/discord-ops/SKILL.md`
- `docker` — `su-code/skills/docker/SKILL.md`
- `documentation-and-adrs` — `su-code/skills/documentation-and-adrs/SKILL.md`
- `domain-modeling` — `su-code/skills/domain-modeling/SKILL.md`
- `doubt-driven-development` — `su-code/skills/doubt-driven-development/SKILL.md`
- `draft-content` — `su-code/skills/draft-content/SKILL.md`
- `eino-examples` — `su-code/skills/eino-examples/SKILL.md`
- `eino-first` — `su-code/skills/eino-first/SKILL.md`
- `eli5` — `su-code/skills/eli5/SKILL.md`
- `encore-eino-go` — `su-code/skills/encore-eino-go/SKILL.md`
- `encore-go-api` — `su-code/skills/encore-go-api/SKILL.md`
- `encore-go-auth` — `su-code/skills/encore-go-auth/SKILL.md`
- `encore-go-code-review` — `su-code/skills/encore-go-code-review/SKILL.md`
- `encore-go-cron` — `su-code/skills/encore-go-cron/SKILL.md`
- `encore-go-database` — `su-code/skills/encore-go-database/SKILL.md`
- `encore-go-pubsub` — `su-code/skills/encore-go-pubsub/SKILL.md`
- `encore-go-secret` — `su-code/skills/encore-go-secret/SKILL.md`
- `encore-go-service` — `su-code/skills/encore-go-service/SKILL.md`
- `encore-go-testing` — `su-code/skills/encore-go-testing/SKILL.md`
- `encore-go-webhook` — `su-code/skills/encore-go-webhook/SKILL.md`
- `encore-migrations` — `su-code/skills/encore-migrations/SKILL.md`
- `exercise-forge` — `su-code/skills/exercise-forge/SKILL.md`
- `Explore Codebase` — `su-code/skills/explore-codebase/SKILL.md`
- `fb-group-growth` — `su-code/skills/fb-group-growth/SKILL.md`
- `feature` — `su-code/skills/feature/SKILL.md`
- `feature-ship` — `su-code/skills/feature-ship/SKILL.md`
- `frontend-design` — `su-code/skills/frontend-design/SKILL.md`
- `frontend-patterns` — `su-code/skills/frontend-patterns/SKILL.md`
- `frontend-ui-engineering` — `su-code/skills/frontend-ui-engineering/SKILL.md`
- `full-flow` — `su-code/skills/full-flow/SKILL.md`
- `git-guardrails-claude-code` — `su-code/skills/git-guardrails-claude-code/SKILL.md`
- `git-workflow-and-versioning` — `su-code/skills/git-workflow-and-versioning/SKILL.md`
- `grill-me` — `su-code/skills/grill-me/SKILL.md`
- `grill-with-docs` — `su-code/skills/grill-with-docs/SKILL.md`
- `grilling` — `su-code/skills/grilling/SKILL.md`
- `gsap-core` — `su-code/skills/gsap-core/SKILL.md`
- `gsap-react` — `su-code/skills/gsap-react/SKILL.md`
- `gsap-scrolltrigger` — `su-code/skills/gsap-scrolltrigger/SKILL.md`
- `handoff` — `su-code/skills/handoff/SKILL.md`
- `idea-refine` — `su-code/skills/idea-refine/SKILL.md`
- `image-gen` — `su-code/skills/image-gen/SKILL.md`
- `immersive-3d-web` — `su-code/skills/immersive-3d-web/SKILL.md`
- `implement` — `su-code/skills/implement/SKILL.md`
- `implement-spec` — `su-code/skills/implement-spec/SKILL.md`
- `improve-codebase-architecture` — `su-code/skills/improve-codebase-architecture/SKILL.md`
- `incremental-implementation` — `su-code/skills/incremental-implementation/SKILL.md`
- `interview-me` — `su-code/skills/interview-me/SKILL.md`
- `issue-history` — `su-code/skills/issue-history/SKILL.md`
- `issue-master-flow` — `su-code/skills/issue-master-flow/SKILL.md`
- `javascript-cheatsheet` — `su-code/skills/javascript-cheatsheet/SKILL.md`
- `javascript-refactoring` — `su-code/skills/javascript-refactoring/SKILL.md`
- `jobs` — `su-code/skills/jobs/SKILL.md`
- `lark-base-ops` — `su-code/skills/lark-base-ops/SKILL.md`
- `lark-review-digest` — `su-code/skills/lark-review-digest/SKILL.md`
- `last30days` — `su-code/skills/last30days/SKILL.md`
- `lib-docs-fetch` — `su-code/skills/lib-docs-fetch/SKILL.md`
- `linkedin-cv-sync` — `su-code/skills/linkedin-cv-sync/SKILL.md`
- `lint` — `su-code/skills/lint/SKILL.md`
- `literature-review` — `su-code/skills/literature-review/SKILL.md`
- `live-verify` — `su-code/skills/live-verify/SKILL.md`
- `loop-me` — `su-code/skills/loop-me/SKILL.md`
- `migrate-to-shoehorn` — `su-code/skills/migrate-to-shoehorn/SKILL.md`
- `mining-hashrate-lab` — `su-code/skills/mining-hashrate-lab/SKILL.md`
- `ml-training-recipe` — `su-code/skills/ml-training-recipe/SKILL.md`
- `modal-compute` — `su-code/skills/modal-compute/SKILL.md`
- `modern-javascript-patterns` — `su-code/skills/modern-javascript-patterns/SKILL.md`
- `modern-javascript-tutorial` — `su-code/skills/modern-javascript-tutorial/SKILL.md`
- `ncu-report-skill` — `su-code/skills/ncu-report-skill/SKILL.md`
- `nextjs-app` — `su-code/skills/nextjs-app/SKILL.md`
- `observability-and-instrumentation` — `su-code/skills/observability-and-instrumentation/SKILL.md`
- `org-social-ops` — `su-code/skills/org-social-ops/SKILL.md`
- `paper-code-audit` — `su-code/skills/paper-code-audit/SKILL.md`
- `paper-writing` — `su-code/skills/paper-writing/SKILL.md`
- `peer-review` — `su-code/skills/peer-review/SKILL.md`
- `perf-nsight-compute-analysis` — `su-code/skills/perf-nsight-compute-analysis/SKILL.md`
- `performance-optimization` — `su-code/skills/performance-optimization/SKILL.md`
- `performance-patterns` — `su-code/skills/performance-patterns/SKILL.md`
- `performance-report` — `su-code/skills/performance-report/SKILL.md`
- `planning-and-task-breakdown` — `su-code/skills/planning-and-task-breakdown/SKILL.md`
- `ponytail-audit` — `su-code/skills/ponytail-audit/SKILL.md`
- `ponytail-debt` — `su-code/skills/ponytail-debt/SKILL.md`
- `ponytail-gain` — `su-code/skills/ponytail-gain/SKILL.md`
- `ponytail-help` — `su-code/skills/ponytail-help/SKILL.md`
- `ponytail-review` — `su-code/skills/ponytail-review/SKILL.md`
- `post-all` — `su-code/skills/post-all/SKILL.md`
- `pr` — `su-code/skills/pr/SKILL.md`
- `preview` — `su-code/skills/preview/SKILL.md`
- `product-handoff` — `su-code/skills/product-handoff/SKILL.md`
- `prompt-context-harness-loop` — `su-code/skills/prompt-context-harness-loop/SKILL.md`
- `prompt-optimizer` — `su-code/skills/prompt-optimizer/SKILL.md`
- `prototype` — `su-code/skills/prototype/SKILL.md`
- `react` — `su-code/skills/react/SKILL.md`
- `vercel-react-best-practices` — `su-code/skills/react-best-practices/SKILL.md`
- `vercel-react-native-skills` — `su-code/skills/react-native-skills/SKILL.md`
- `react-state-management` — `su-code/skills/react-state-management/SKILL.md`
- `react-three-fiber` — `su-code/skills/react-three-fiber/SKILL.md`
- `vercel-react-view-transitions` — `su-code/skills/react-view-transitions/SKILL.md`
- `redesign-existing-projects` — `su-code/skills/redesign-skill/SKILL.md`
- `Refactor Safely` — `su-code/skills/refactor-safely/SKILL.md`
- `remote-compute` — `su-code/skills/remote-compute/SKILL.md`
- `remote-job-scan` — `su-code/skills/remote-job-scan/SKILL.md`
- `replication` — `su-code/skills/replication/SKILL.md`
- `research` — `su-code/skills/research/SKILL.md`
- `research-paper` — `su-code/skills/research-paper/SKILL.md`
- `research-review` — `su-code/skills/research-review/SKILL.md`
- `responsive-design` — `su-code/skills/responsive-design/SKILL.md`
- `responsive-web-design` — `su-code/skills/responsive-web-design/SKILL.md`
- `retro` — `su-code/skills/retro/SKILL.md`
- `review-mr` — `su-code/skills/review-mr/SKILL.md`
- `review-status` — `su-code/skills/review-status/SKILL.md`
- `runpod-compute` — `su-code/skills/runpod-compute/SKILL.md`
- `scaffold-exercises` — `su-code/skills/scaffold-exercises/SKILL.md`
- `scroll-driven-3d` — `su-code/skills/scroll-driven-3d/SKILL.md`
- `security-and-hardening` — `su-code/skills/security-and-hardening/SKILL.md`
- `security-audit` — `su-code/skills/security-audit/SKILL.md`
- `senior-frontend` — `su-code/skills/senior-frontend/SKILL.md`
- `senior-security` — `su-code/skills/senior-security/SKILL.md`
- `seo` — `su-code/skills/seo/SKILL.md`
- `seo-audit` — `su-code/skills/seo-audit/SKILL.md`
- `session-log` — `su-code/skills/session-log/SKILL.md`
- `session-search` — `su-code/skills/session-search/SKILL.md`
- `setup-matt-pocock-skills` — `su-code/skills/setup-matt-pocock-skills/SKILL.md`
- `setup-pre-commit` — `su-code/skills/setup-pre-commit/SKILL.md`
- `setup-ts-deep-modules` — `su-code/skills/setup-ts-deep-modules/SKILL.md`
- `shadcn` — `su-code/skills/shadcn/SKILL.md`
- `shipping-and-launch` — `su-code/skills/shipping-and-launch/SKILL.md`
- `site-ux-audit` — `su-code/skills/site-ux-audit/SKILL.md`
- `social-growth` — `su-code/skills/social-growth/SKILL.md`
- `source-comparison` — `su-code/skills/source-comparison/SKILL.md`
- `source-driven-development` — `su-code/skills/source-driven-development/SKILL.md`
- `spec-driven-development` — `su-code/skills/spec-driven-development/SKILL.md`
- `spline-interactive` — `su-code/skills/spline-interactive/SKILL.md`
- `super-pdf` — `su-code/skills/super-pdf/SKILL.md`
- `tailwind-design-system` — `su-code/skills/tailwind-design-system/SKILL.md`
- `tanstack-query` — `su-code/skills/tanstack-query/SKILL.md`
- `tanstack-table` — `su-code/skills/tanstack-table/SKILL.md`
- `tanstack-virtual` — `su-code/skills/tanstack-virtual/SKILL.md`
- `taste-brutalist` — `su-code/skills/taste-brutalist/SKILL.md`
- `taste-minimalist` — `su-code/skills/taste-minimalist/SKILL.md`
- `taste-output` — `su-code/skills/taste-output/SKILL.md`
- `taste-redesign` — `su-code/skills/taste-redesign/SKILL.md`
- `taste-soft` — `su-code/skills/taste-soft/SKILL.md`
- `tauri-ui-test` — `su-code/skills/tauri-ui-test/SKILL.md`
- `tauri-v2` — `su-code/skills/tauri-v2/SKILL.md`
- `tdd` — `su-code/skills/tdd/SKILL.md`
- `teach` — `su-code/skills/teach/SKILL.md`
- `test-driven-development` — `su-code/skills/test-driven-development/SKILL.md`
- `threejs-addons-api` — `su-code/skills/threejs-addons-api/SKILL.md`
- `threejs-agents-model-optimizer` — `su-code/skills/threejs-agents-model-optimizer/SKILL.md`
- `threejs-bloom` — `su-code/skills/threejs-bloom/SKILL.md`
- `threejs-core-renderer` — `su-code/skills/threejs-core-renderer/SKILL.md`
- `threejs-errors-performance` — `su-code/skills/threejs-errors-performance/SKILL.md`
- `threejs-impl-drei` — `su-code/skills/threejs-impl-drei/SKILL.md`
- `threejs-impl-post-processing` — `su-code/skills/threejs-impl-post-processing/SKILL.md`
- `threejs-impl-webgpu` — `su-code/skills/threejs-impl-webgpu/SKILL.md`
- `threejs-procedural-vfx` — `su-code/skills/threejs-procedural-vfx/SKILL.md`
- `threejs-syntax-shaders` — `su-code/skills/threejs-syntax-shaders/SKILL.md`
- `to-questionnaire` — `su-code/skills/to-questionnaire/SKILL.md`
- `to-spec` — `su-code/skills/to-spec/SKILL.md`
- `to-tickets` — `su-code/skills/to-tickets/SKILL.md`
- `token-bench` — `su-code/skills/token-bench/SKILL.md`
- `triage` — `su-code/skills/triage/SKILL.md`
- `ts-pattern` — `su-code/skills/ts-pattern/SKILL.md`
- `typescript-advanced-types` — `su-code/skills/typescript-advanced-types/SKILL.md`
- `using-agent-skills` — `su-code/skills/using-agent-skills/SKILL.md`
- `vn-contract-docs` — `su-code/skills/vn-contract-docs/SKILL.md`
- `vn-crm-pronoun` — `su-code/skills/vn-crm-pronoun/SKILL.md`
- `vue` — `su-code/skills/vue/SKILL.md`
- `wait-what` — `su-code/skills/wait-what/SKILL.md`
- `watch` — `su-code/skills/watch/SKILL.md`
- `wayfinder` — `su-code/skills/wayfinder/SKILL.md`
- `web-component-design` — `su-code/skills/web-component-design/SKILL.md`
- `web-design-guidelines` — `su-code/skills/web-design-guidelines/SKILL.md`
- `web-quality-audit` — `su-code/skills/web-quality-audit/SKILL.md`
- `wizard` — `su-code/skills/wizard/SKILL.md`
- `workspace-surface-audit` — `su-code/skills/workspace-surface-audit/SKILL.md`
- `write-docs` — `su-code/skills/write-docs/SKILL.md`
- `write-paper` — `su-code/skills/write-paper/SKILL.md`
- `writing-beats` — `su-code/skills/writing-beats/SKILL.md`
- `writing-for-agents` — `su-code/skills/writing-for-agents/SKILL.md`
- `writing-fragments` — `su-code/skills/writing-fragments/SKILL.md`
- `writing-shape` — `su-code/skills/writing-shape/SKILL.md`
- `writing-skill` — `su-code/skills/writing-skill/SKILL.md`
- `zai-vision` — `su-code/skills/zai-vision/SKILL.md`
- `zus-release` — `su-code/skills/zus-release/SKILL.md`

### Quy tắc bất biến

- **Code-intelligence FIRST** (codegraph CLI trước) cho mọi câu hỏi explore code (Step 0). Bypass = bug.
- **Output > ~50 dòng → BẮT BUỘC `headroom_compress`** trước khi vào context — không dump thô.
- Đọc body **CORE** (codegraph → karpathy → ponytail → 8sync-cli) TRƯỚC tool call đầu tiên. **SPECIALIST** (assp · impeccable · taste · image-routing) đọc body KHI task khớp — `impeccable` bắt buộc ngay khi có việc UI/design.
- Skill **on-demand**: chỉ mở khi description khớp task hiện tại — đừng đọc thừa.
- Nếu skill có `scripts/` → ưu tiên invoke script đó thay vì viết lại logic.
- Khi áp dụng skill, **cite** rõ: ví dụ `su-code/skills/<name>/SKILL.md:line`.
- **Sau mỗi thay đổi:** cập nhật `CHANGELOG.md` (mục Unreleased) + ghi học được vào `su-code/KNOWLEDGE.md`.
- **Doc-hygiene**: chạy `8sync harness audit` khi đụng vùng có docs — path lệch→fix, doc rác/superseded→xóa (thêm doc phải kèm xóa cái cũ), oversized→trim.
- **Loop / STATE spine**: đọc `su-code/STATE.md` đầu phiên; rewrite ở mỗi phase-boundary (Goal·Checklist·Current·Next). Context gần đầy → handoff vào STATE + bài học vào KNOWLEDGE rồi reinit. Đo loop: `8sync harness bench`.
- **Loop discipline (C/D/E)**: implementer↔verifier qua `task` (verifier chạy build/test ĐỘC LẬP, verify-gate TRƯỚC commit); FAIL → ghi `failure:` vào KNOWLEDGE, đọc đầu phiên để khỏi lặp; quy trình `validated:` → distill vào `su-code/PLAYBOOKS.md` (index theo `When:`); autonomy L1 report · L2 assisted · L3 unattended — không tự `push`/PR ở L3 mặc định.
<!-- 8sync:skills:end -->

> File này dành cho AI tool (omp, claude-code, cursor, opencode, aider, …)
> Đây là **install + usage guide** dạng deterministic — đọc xong là biết phải làm gì.

---

## 1. Repo này là gì

`su-code` = source của binary **`8sync`** — coding harness CLI cho:
- **CachyOS / Arch Linux** (target chính, hỗ trợ Manjaro/EndeavourOS)
- **Kitty terminal** (cần `allow_remote_control yes`)
- **Helix editor** (`hx` hoặc `helix`)
- **omp** (oh-my-pi.sh) — AI engine, `~/.bun/bin/omp`

Stack: **Rust** (single workspace, 1 binary `8sync` ≈ **4.9 MB stripped**, hoặc **3.1 MB** với `--no-default-features` — feature `web` gánh dashboard FE + axum/tokio/scraper; 23 bundled skill luôn có, nặng nhất là `impeccable` ~2 MB scripts/reference). Đo: `bash scripts/size-report.sh`.

---

## 2. Cài đặt cho user

```bash
# Khuyến nghị — one-liner: binary prebuilt + tự chạy `8sync setup --no-profile` (không cần git/rust/cargo):
curl -fsSL https://get.8syncdev.com/install | sh          # Linux / macOS
irm https://get.8syncdev.com/install.ps1 | iex            # Windows PowerShell
# Chỉ binary, bỏ qua setup: SUSYNC_NO_SETUP=1

# Hoặc build từ source (contributor / arch chưa có prebuilt):
git clone https://github.com/8-Sync-Dev/8sync.git
cd 8sync
bash scripts/bootstrap.sh        # cài rustup (nếu thiếu) + build + install vào ~/.local/bin
```

Sau đó:
```bash
8sync setup                      # Stage A (gh · omp · codegraph · forge+zsh · configs · harness global) + hỏi y/N từng profile
# hoặc:
8sync setup --yall               # unattended: mọi profile COMMUNITY (không gồm personal), không hỏi
8sync setup --no-profile         # chỉ harness, unattended (installer chạy lệnh này): bước lỗi được ghi lại, phần còn lại vẫn cài
8sync setup --profile alexdev    # apply bundle cá nhân hóa của alexdev

# omp/codegraph cài bằng installer chính thức (install.sh / install.ps1 -Binary); forge từ GitHub release
8sync doctor                     # verify
```

**Quy tắc an toàn**:
- `8sync setup --dry-run` xem trước không thay đổi gì.
- Mọi `pacman -S` / AUR install đều **transactional**: snapshot pkg mới trước khi install, nếu fail sẽ `pacman -Rns` rủi ro những pkg đã cài được trong batch đó (xem `pkg::pacman_install_safe` / `aur_install_safe`).
- Re-run setup là idempotent: đã cài → skip.

---

## 3. Build từ source (cho dev đóng góp)

```bash
cargo build --release            # cần Rust >= 1.85 (workspace lock 1.95 stable)
./target/release/8sync --version
# binary ở target/release/8sync
```

Phụ thuộc Rust crates: `clap`, `anyhow`, `owo-colors`, `dirs`, `serde`, `toml`, `semver`, `which`, `indoc`, `rust-embed`, `serde_json`, `urlencoding`. **Không có `reqwest`** — HTTP qua `curl` shell-out để giữ binary nhỏ.

---

## 4. Cấu trúc dự án

```
su-code/
├── Cargo.toml · rust-toolchain.toml · .cargo/config.toml    workspace + LTO=fat
├── README.md · AGENTS.md (file này) · LICENSE
├── scripts/bootstrap.sh                                     installer (rustup → cargo build → install)
├── crates/ccc-core/                                         lib `ccc_core`: registry · transcript view · mask · JSON rows (ZUS pins by git tag)
├── crates/cli/                                              binary `8sync`
│   ├── Cargo.toml
│   └── src/
│       ├── main.rs                                          clap subcommand router
│       ├── ui.rs                                            colored print helpers
│       ├── env_detect.rs                                    OS/terminal/tool detection
│       ├── pkg.rs                                           pacman/paru idempotent install
│       ├── assets.rs                                        embedded asset reader (rust-embed)
│       └── verbs/                                           1 module mỗi verb
│           ├── root.rs · flow.rs · setup.rs · doctor.rs · up.rs
│           ├── here.rs (`8sync .` + sub: ls/to/new/rm/mv/wipe/kick)
│           ├── ai.rs · end.rs · ship.rs · run.rs
│           ├── profile.rs   (load/resolve/apply assets/profiles/*.toml + state)
│           ├── sec.rs       (WARP VPN + ufw firewall toggle: on/off/status/toggle)
│           ├── find.rs (rg+fzf+$EDITOR) · note.rs (su-code/NOTES.md)
│           └── skill.rs · shot.rs · diff_img.rs · pdf_img.rs
└── assets/                                                  bundled vào binary qua rust-embed
    ├── configs/                                             helix config + theme + kitty/8sync.session + 8sync/{global,skills}.toml
    ├── profiles/                                            7 personal profile TOML (vietnamese, hw-cooling, hw-lianli, displaylink, apps-personal, warp, alexdev-bundle)
    └── skills/                                              8 bundled (codegraph, karpathy, assp-skill, impeccable, taste-skill, 8sync-cli, image-routing, last30days) + 00-force-load.md
```

---

## 5. Toàn bộ verb

### Vibe loop (daily, dùng liên tục)
| Verb | Mô tả |
|---|---|
| `8sync .` | Resume session **mới nhất** trong repo (seed `su-code/*` context, exec omp). Named sessions cho nhiều feat song song → xem "Session mgmt" |
| `8sync ai [prompt]` | AI session (resume hoặc one-shot, wrap omp) |
| `8sync find <kw>` | rg/fd + fzf preview → mở bằng `$EDITOR` (fallback hx/helix/vi) tại `file:line` |
| `8sync note "msg" [-t tag]` | Append `su-code/NOTES.md` |
| `8sync run [dev\|build\|test\|fmt\|lint]` | Project command theo recipe |
| `8sync ship "msg"` | `git add -A && commit && push && gh pr create` |
| `8sync forge <name> [--tui]` | Session ForgeCode theo tên (alias `forgecode`): mặc định zsh có plugin Forge gắn đúng conversation (`: <prompt>` hỏi Forge, `:<Tab>` liệt kê lệnh, `@<Tab>` file); `--tui` mở TUI; `-p` one-shot. Prompt 2 dòng dùng chung `assets/configs/zsh/8sync.zsh` (repo-relative path · branch đọc thẳng `.git/HEAD` · segment Forge async · duration · `❯` theo exit) + autosuggestions/syntax-highlighting pin commit. Tự cài Forge; zsh: Windows MSYS2 trong `%LOCALAPPDATA%\8sync\zsh`, Linux/macOS không sudo → zsh-bin static. Sub: `ls`/`new`/`rm`/`key`/`status` |
| `8sync ccc . <name>` | Claude Code (`claude`) theo tên trong repo: tên → UUID (`--session-id` lần đầu, `--resume` sau), registry dùng chung với forge (`uuid_sessions.rs`). `8sync ccc .` = session dùng gần nhất; `. ls`/`. new`/`. rm` (xoá cả transcript)/`status`; flag sau tên chuyển thẳng cho `claude`. Tự cài Claude Code bằng installer chính thức. **Mỗi lần mở** (`prepare`, không chặn launch, không mạng trên đường chính): release mới (cache probe 6h) → tự `up` rồi chạy lại lệnh trên binary mới (`SUSYNC_NO_AUTO_UPDATE=1` tắt); kit stamp khác version → refresh bundled skills + kit; repo git → harness (vendor skill thiếu vào `su-code/skills`, AGENTS.md/CLAUDE.md block, `.claude/skills` → `su-code/skills`, `.claude/settings.local.json` `skillOverrides` on-demand = `name-only`, gitignore). **Kit** (`8sync ccc kit`, setup tự chạy) vào `~/.claude`: 5 subagent (`explore` Haiku, `reviewer`/`designer` inherit) + skill `/ship` · `/aup-audit` · `deep-research` + mọi bundled skill link → `~/.omp/skills/<tên>` (personal thắng project → luôn bản mới), `CLAUDE.md` import luật org `~/.claude/skills/aup-audit/8sync-anthropic-rules.md` (bản gốc `assets/skills/aup-audit/8sync-anthropic-rules.md`, luôn nạp), hook verify **async** (`asyncRewake`, edit mới nhất thắng, lỗi đánh thức Claude) + `hook verify-stop` (Stop: build hỏng → chặn 1 lần mỗi trạng thái; build ổn → Stop gate native `ccc/gate.rs`, không gọi model, bỏ qua khi còn background task hoặc tin nhắn cuối của user bảo dừng, đọc từ transcript), hook guard native cho Bash **và PowerShell** (`ccc/danger.rs`: parser shell + backstop quét text thô; deny xoá root/home/project/tổ tiên, wipe disk, `wsl --unregister`, force-push mọi kiểu, in/upload `.env`; ask xoá ngoài project/temp, target runtime, xoá trong wsl/ssh/container, `\| sh`, `git reset --hard`/`clean -f`; analyser panic → ask; cộng credential, secret thật, `git add -A` dính secret, subscription Claude sang client khác), allow build/test/lint + `git add` (bỏ classifier auto mode ~0.65 s/lệnh), Ask gate (Sonnet, full model id), connectors claude.ai tắt (`disableClaudeAiConnectors`), auto mode, deny đọc/sửa `.env`/key/`*.session`/`*.pkl` + force-push (rule path chỉ `Read(...)`/`Edit(...)`), MCP cbm + serena; file user sửa được giữ (`--force` đè) |

### Session mgmt — named per-project sessions (sub của `.`)
Nhiều feature song song trong 1 repo, mỗi cái 1 omp conversation cô lập. Lever = omp có sẵn (`--session-dir` + `--continue`); 8sync chỉ thêm lớp **tên → session-dir** + **git worktree** + **merge**. Registry máy-local: `~/.config/8sync/sessions/<repo>/index.json` (KHÔNG commit — trỏ path máy-local).
| Lệnh | Mô tả |
|---|---|
| `8sync . <name>` | create-or-resume session theo tên |
| `8sync . new <name> [--worktree]` | tạo session mới; `--worktree` = `git worktree` + branch `8sync/<name>` để cô lập file (2 feat sửa cùng file không đụng nhau) |
| `8sync . ls` (hoặc `--list`, `--json`) | liệt kê session (★ = mới nhất; kèm branch + `*dirty`) |
| `8sync . mv <old> <new>` | đổi tên (kèm `git worktree move` + rename branch) |
| `8sync . rm <name> [--force]` | xoá session; guard worktree dirty/unmerged; `--force` xoá cả transcript + worktree |
| `8sync . merge <name>... [--keep-worktree]` | land branch session vào nhánh hiện tại: `git merge-tree` preflight → `git merge --no-edit` → rebase-to-unblock → cleanup. **Local-only, không push** |

### Security (VPN + Firewall)
| Verb | Mô tả |
|---|---|
| `8sync sec` | Status WARP + ufw |
| `8sync sec on \| off \| toggle` | Bật/tắt/flip cả 2 |
| `8sync sec warp [on\|off\|status]` | Chỉ điều khiển WARP |
| `8sync sec ufw [on\|off\|status]` | Chỉ điều khiển ufw |

### Bluetooth (bluez)
| Verb | Mô tả |
|---|---|
| `8sync bt` | Status: rfkill / service / controller power / paired |
| `8sync bt on \| off` | Unblock + enable + power on / power off + stop |
| `8sync bt fix` | Troubleshoot adapter chết (rfkill, reload btusb, restart, power on, AutoEnable) |
| `8sync bt restart` | Restart bluetooth.service + power on |

### Display (refresh rate)
| Verb | Mô tả |
|---|---|
| `8sync hz` | Report mỗi output: rate hiện tại vs rate cao nhất có sẵn. Panel khai (EDID) cao hơn driver expose → **chẩn đoán** (tên driver + cách fix), không im lặng chấp nhận |
| `8sync hz max` | Nâng mọi output lên refresh cao nhất — **giữ nguyên resolution** (mode nhanh nhất thường là mode NHỎ hơn) |
| `8sync hz <Hz>` | Set đúng 1 rate (vd `8sync hz 144`); không có thì liệt kê rate khả dụng |
| `8sync hz … --output DP-4 --dry-run` | Giới hạn 1 connector / in lệnh backend mà không đổi gì |

Backend: GNOME/Mutter (`busctl`, Wayland + X11) · Hyprland (`hyprctl`) · KDE (`kscreen-doctor`) · X11 (`xrandr`). Mutter apply luôn `VERIFY` trước rồi mới persistent, và echo lại NGUYÊN layout (vị trí/scale/xoay/primary) vì `ApplyMonitorsConfig` thay **toàn bộ** layout — bỏ sót field nào là reset field đó.

### Lian Li screens (`lianli-daemon`)
| Verb | Mô tả |
|---|---|
| `8sync lcd` | Status daemon + liệt kê mọi màn hình fan/AIO (index + id + độ phân giải) |
| `8sync lcd <file>` | Hiện ảnh/GIF/mp4 lên MỌI màn (`--device N` để chỉ 1 màn, `--fps`, `--orientation`) |
| `8sync lcd '#ff0055'` \| `8sync lcd off` | Màu đơn / tắt (frame đen) |
| `8sync lcd bright 0..100` | Độ sáng — gửi `SetLcdBrightness` (ăn ngay) **và** patch config đã lưu (sống qua reboot) |
| `8sync lcd gui` | Mở GUI upstream kèm `WEBKIT_DISABLE_DMABUF_RENDERER=1` |

Không tự nói chuyện USB: đi qua IPC của `lian-li-linux` daemon (`$XDG_RUNTIME_DIR/lianli-daemon.sock`, JSON theo dòng, `{"method":…,"params":…}`). `SetLcdMedia.device_id` **phải** là `serial:<device_id>` vì upstream so với `LcdConfig::device_id()` — sai format là append entry trùng thay vì replace. GUI Tauri/WebKitGTK chết trên Wayland (`Error 71 Protocol error`) khi GPU path hỏng (vd nouveau) → `lcd gui` luôn set biến tắt DMA-BUF renderer.

### Clean / Optimize
| Verb | Mô tả |
|---|---|
| `8sync clean` | Reclaim disk (paccache/paru/journal/tmpfiles/thumbnails) + report CPU/GPU/RAM |
| `8sync clean --deep` | + gỡ orphan pkgs + build cache thuần (go-build/tsc/node-gyp). **KHÔNG** đụng model (huggingface/torch), Playwright/Puppeteer/Electron binary, hay cache tải gói (uv/pip/yarn/pnpm/deno) — chỉ report + gợi ý lệnh xoá tay |
| `8sync clean --ram` | + drop pagecache (nhẹ, cosmetic) |
| `8sync clean --gpu` | NVIDIA persistence mode + GPU summary |
| `8sync clean --watch [SECS]` | Loop foreground, clean mỗi SECS (default 3600) |
| `8sync clean --timer 1h \| off` | Cài/gỡ systemd user timer (loop định kỳ đúng cách, không phải bash loop) |

**Lưu ý**: "Look & feel" (wallpaper/theme/kitty layout) đã **delegate cho HyDE** — dùng `hydectl wallpaper next` và `hydectl theme set <name>`.

### Lifecycle
| Verb | Mô tả |
|---|---|
| `8sync setup` | Stage A = **AI core thuần** (omp · codegraph · MCP/skills · gh · forge + zsh · Claude Code + kit · gitleaks · PATH bootstrap) + Stage B (curated y/N: dev-stack, nvidia, bluetooth, warp, **terminal**). `--profile terminal` chạy MỌI OS: helix + JetBrainsMono Nerd Font (+ font mặc định Windows Terminal nếu chưa set) + pro zsh; kitty glass chỉ Arch/Fedora |
| `8sync setup --community` | Auto-yes — Stage A + dev-stack + bluetooth (KHÔNG include warp) |
| `8sync setup --no-profile` | Chỉ harness, không hỏi profile |
| `8sync setup --profile <name>` | Apply 1 profile cụ thể non-interactive (cả community + personal) |
| `8sync setup --dry-run` | Preview, không thay đổi gì |
| `8sync setup profile list\|show\|apply <name>` | Quản lý profile sau khi setup (tag community/personal) |
| `8sync up` | Self-update binary + omp (KHÔNG chạy `pacman -Syu` — user tự lo) |
| `8sync doctor` | Health check (HyDE detect, kitty remote, gh hard-check, sec status, profiles applied) |
| `8sync flow` | Workflow help theo thứ tự dùng |
| `8sync help` | Cheatsheet |

### AI tooling
| Verb | Mô tả |
|---|---|
| `8sync harness [init\|up\|help]` | **bare `8sync harness`** = ONE idempotent command: deploy/update skill + mirror (additive, KHÔNG đè skill đã sửa) + inject + seed memory + consolidate + codegraph index. **init**: full bootstrap (progress UI) + **managed `.gitignore`** (ignore `.codegraph/`/`.cache/`/`.env*`, keep `su-code/`+`su-code/skills/`) + **gitleaks pre-commit hook**; `--force` re-mirror đè hết. **up**: light refresh (`--pull` re-pull skill; `--commit` git-commit memory — gitleaks scan trước, abort nếu rò secret; `--loop`/`--timer` chạy nền; tự consolidate `## Learnings` >200 dòng → `su-code/archive/`). **help**: cheatsheet |
| `8sync harness create [--sweep [DIR]]` | **Full host bootstrap** for Cursor + Z.ai Code + Claude Code + omp: same as `init`, then fan `su-code/skills/` → `.cursor/skills` + `.zcode/skills` + `.claude/skills` (symlink/junction; a repo's own `.claude/skills/` is never replaced) and write `.cursor/rules/8sync-harness.mdc` (`alwaysApply: true`) + `.claude/settings.local.json` (`skillOverrides`: on-demand → `name-only`). Ignore lines have no trailing slash (git sees a link as a file). `--sweep` stamps every omp project under DIR (default `~/Projects`) |
| `8sync harness global [--sweep [DIR]]` | Apply rule omp **TOÀN CỤC** (mọi project dùng omp, không cần chạy per-project): `~/.omp/skills` + `00-force-load.md` + `APPEND_SYSTEM.md` (append vào MỌI system prompt) + MCP (cbm/headroom/serena/zai-vision) + hooks + capabilities — CWD-independent, không đụng project hiện tại. Kèm token-optimizer default cho Anthropic: compaction 50% (chỉ khi chưa set), headroom compress, APPEND_SYSTEM ghi byte-stable → prompt-cache hit. `--sweep [DIR]` (default `~/Projects`): stamp per-project layer (mirror skills + inject AGENTS.md + seed memory + gitleaks hook + `.cursor`/`.zcode` hosts) vào MỌI **omp project** dưới DIR — chỉ repo có `su-code/` hoặc `AGENTS.md`/`CLAUDE.md`, repo không dùng omp skip + report (onboard: `cd <repo> && 8sync harness`); codegraph index vẫn per-project. `--pull` re-pull registered skills |
| `8sync harness toolstats` | Đọc omp session JSONL → tỉ lệ **optimizer** (codegraph/cbm/serena/headroom) vs **fallback** (grep/read/search/find/glob) + fail per tool. Phát hiện STEP-0 không được dùng. **Không DB** — mỗi lần chạy re-scan toàn bộ JSONL rồi fold in-memory (bản SQLite cũ mở đầu bằng `DELETE FROM calls` nên chưa bao giờ lưu gì; xoá `rusqlite` = −1 060 840 B) |
| `8sync skill [add <spec>\|gen \|list\|update]` | Quản lý skill: `add` clone GitHub (collection-aware) / `builtin:<name>` / **`<url>@<ref>` để pin commit/tag** (ghi `rev` vào `skills.toml` = lockfile, reproducible); `update [name]` re-pull theo `src` (git dedup theo URL, honor `rev` pin); `gen` fuse N skill |
| `8sync shot <url\|file>` | Render web/file → PNG (cho image-routing) |
| `8sync gen-img <prompt>` | Tạo ảnh AI từ prompt qua `gpt-image-2` (`-o <file.png>`, `--size 1024x1024`) |
| `8sync diff-img [ref]` | Git diff → PNG |
| `8sync pdf-img <file>` | PDF page → PNG |
| `8sync codex-web [up\|status\|wire\|off]` | Cầu nối ChatGPT Web (kể cả Pro) vào omp: mở launcher [miuuyy/codex-chatgpt-web] cho bạn login, poll server loopback `:17841`, auto-detect `/v1/models` rồi wire provider **cô lập** `chatgpt-web` (`api: openai-responses`) vào `models.yml` — KHÔNG đụng anthropic/openai native, không set env toàn cục. `up`=mở+đợi login+auto-wire; bare/`status`=probe+wire nếu sẵn sàng; `wire`=detect lại; `off`=gỡ. Dir auto `<home>/Projects/tools/codex-chatgpt-web` (hoặc `--dir`/`CODEX_WEB_DIR`). Loopback-only; automation ChatGPT có rủi ro ban account (bản chất upstream) |

---

## 5b. Profile system (Stage B của setup)

7 built-in profile trong `assets/profiles/*.toml`:

| Profile | Nội dung | Cần AUR helper |
|---|---|---|
| `vietnamese` | fcitx5 + Unikey | no |
| `hardware-cooling` | coolercontrol + openrgb + liquidctl | no |
| `hardware-lianli` | `lianli-linux-git` (yay/paru auto-pulls deps) | **yes** |
| `displaylink` | evdi-dkms | no |
| `apps-personal` | bitwarden | no |
| `warp` | `cloudflare-warp-bin` + enable warp-svc + config DoH/MASQUE/malware DNS | **yes** |
| `alexdev` | bundle: extends cả 6 profile trên | yes (qua warp/lianli) |

User có thể thay/thêm profile trong `~/.config/8sync/profiles/*.toml` (override built-in).

State luư ở `~/.config/8sync/profile.toml`:
```toml
applied = ["vietnamese", "hardware-cooling", ...]
last_setup = "epoch:..."
```

---

## 6. Session memory (project-level)

Khi user gõ `8sync .` trong project, `here.rs` seed:

```
<repo>/
├── AGENTS.md              ← do here.rs sinh, link tới su-code/*
└── su-code/                ← AI memory shared giữa các tool (omp/claude/cursor/aider/opencode)
    ├── PROJECT.md         facts (stack, entrypoint)
    ├── KNOWLEDGE.md       append-only: AI học được gì
    ├── DECISIONS.md       append-only: quyết định kiến trúc
    ├── PREFERENCES.md     append-only: user style
    ├── STATE.md           việc đang dở
    └── NOTES.md           `8sync note` append vào đây
```

**`su-code/`** (visible folder, không phải `.gsd/` hidden) — cố ý đặt tên này để mọi AI tool đọc được qua `AGENTS.md` anchor.

Session memory được `omp` tự quản (retain/recall/auto-compact). 8sync chỉ seed file khung — không capture nhân tạo. Quick notes vẫn ghi qua `8sync note`.

---

## 7. Skill system (force-load)

Khi `8sync harness init` (hoặc `8sync setup`) chạy, **29 skill bundled** được deploy vào `~/.omp/skills/` theo [Agent Skills open standard](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview). 10 skill **always-on** chia 2 tầng (progressive disclosure — giữ prefix gọn cho KV-cache): 4 **CORE** đọc body ngay đúng thứ tự (codegraph → karpathy-guidelines → ponytail → 8sync-cli), 6 **specialist** chỉ biết khả năng rồi đọc body khi task khớp; phần còn lại on-demand; `encore-deploy` tech-gated; `social-growth` opt-in:

| Skill | Trigger | Mô tả |
|---|---|---|
|`codegraph`|`always` (CORE)|semantic code intelligence (binary + SKILL.md) — STEP 0, mọi explore code|
|`karpathy-guidelines`|`always` (CORE)|kỷ luật engineering Karpathy-style|
|`ponytail`|`always` (CORE)|"laziest senior dev" — YAGNI, làm ít nhất, xoá > thêm|
|`8sync-cli`|`always` (CORE)|dạy AI ưu tiên verb 8sync hơn shell thô|
|`assp-skill`|`always` (specialist)|brand DNA 8 Sync Dev + ASSP validate-before-build (UI copy, landing/pricing, feature mới)|
|`impeccable`|`always` (specialist)|**design system CHUẨN — BẮT BUỘC cho mọi UI/design/redesign/audit**; có `scripts/` + `references/house/*` (frontend-agent-workflow + clouds-f orchestration + keyword routers)|
|`taste-skill`|`always` (specialist)|anti-slop frontend taste cho landing/portfolio/redesign|
|`image-routing`|`always` (specialist)|chọn image vs text reads để tiết kiệm token|
|`zai-vision`|`always` (specialist)|FALLBACK only — SKIP khi session là GLM-5.3 / 5.3-Flash (native VLM, nhìn ảnh trực tiếp). Chỉ dùng cho GLM-5.2 text-only → MCP `zai-vision`|
|`locate-anything`|`always` (specialist)|visual grounding (NVIDIA LocateAnything-3B qua `8sync locate`) — box + click-center coords cho GUI/OCR/detection; non-commercial license|
|`image-gen`|`always` (specialist)|tạo ảnh AI (logos, icons, diagrams, UI mockups) qua `gpt-image-2` (`8sync gen-img`)|
|`feature`|on-demand|feature LỚN nhiều phase/nhiều session (>10 file) theo GSD; state ở `su-code/planning/<slug>/`|
|`code-review-and-quality` · `senior-security` · `senior-frontend`|on-demand|review/quality/security/frontend chuyên sâu|
|`full-flow`|on-demand|self-driving fix/dev/verify loop (Encore + Next)|
|`branch-sync`|on-demand|check/preview/merge/sync mọi git branch về main không conflict|
|`super-pdf`|on-demand|báo cáo/tài liệu PDF "boardroom-grade" từ HTML design system (chips strip + kicker cover, §N section spine, bảng cmp navy + pills, callout 4 màu, stat cards, footer chạy) — template + `scripts/build.sh` (WeasyPrint); cùng họ với các PDF review CloudGO|
|`token-bench`|on-demand|đo token thật mà codegraph/codebase-memory-mcp tiết kiệm vs grep+read (kèm correctness check)|
|`last30days`|on-demand|research social recency (Reddit/X/YouTube/HN…)|
|`deep-research`|on-demand|điều tra source-heavy → 1 brief có citation; token-lean (snippet trước page, worker trả gọn); cũng nằm trong kit Claude Code|
|`aup-audit`|on-demand|Usage Policy Anthropic + quy tắc 8 Sync: gitleaks cả history, file nhạy cảm, đường truy cập Claude, tính năng rủi ro (`RULES.md`); cũng nằm trong kit Claude Code|
|`research-paper`|on-demand|paper end-to-end: replicate · recipe · audit · draft · autoresearch loop|
|`remote-compute`|on-demand|chạy code ở Docker sandbox · Modal GPU · RunPod pod thay vì bare host|
|`encore-deploy`|tech-gated|deploy runbook — chỉ hiện khi project dùng Encore|
|`social-growth`|opt-in|social/branding/leads — bật bằng `8sync skill add builtin:social-growth`|

**External skill packs** (best-effort, `harness init` tự clone vào `~/.omp/skills/`): [`ponytail`](https://github.com/DietrichGebert/ponytail) (full: audit/debt/review/help) + [`addyosmani/agent-skills`](https://github.com/addyosmani/agent-skills) (24 production-grade eng skills). Offline thì skip; bundled vẫn đủ mạnh.

Master force-load file: `~/.omp/skills/00-force-load.md` — omp đọc đầu tiên mỗi session.

**Project-local skills**: `8sync skill add <https://github.com/owner/repo>` clone vào **cả** `~/.omp/skills/<name>/` (global) **và** `<repo>/su-code/skills/<name>/` (per-project). Sau đó rewrite block giữa các sentinel `8sync:skills:begin` / `8sync:skills:end` trong `AGENTS.md` với mandatory language + description từ frontmatter — AI bắt buộc đọc trước khi sửa code.

Repo chưa theo spec (không có `SKILL.md`)? 8sync fallback: phát hiện `CLAUDE.md` / `README.md` / `AGENTS.md` và liệt kê file đó làm entrypoint kèm warning.

---

## 8. Quy ước contribute

- **Cite code**: `crates/cli/src/verbs/setup.rs:130` (single line), `crates/cli/src/models.rs:90-110` (range).
- **Không thêm dep nặng**: tránh `reqwest`; `tokio`/`axum` CHỈ cho `8sync harness web` (gated, xem `Cargo.toml` note). Phần khác dùng shell-out (`curl`, `systemctl`) thay vì re-implement.
- **Idempotent install**: mọi thao tác cài đặt trong `setup.rs`/`pkg.rs` phải an toàn khi chạy lần 2.
- **Default KHÔNG ĐÈ (invariant cho mọi verb)**: file user-owned (`su-code/*.md`, `CHANGELOG.md`, `su-code/skills/`, `AGENTS.md` ngoài sentinel, hooks, config key user đã set) → chỉ seed-if-missing hoặc update trong sentinel-block; đè thật CHỈ qua flag rõ ràng (`--force`). File managed (bundled `~/.omp/skills`, `00-force-load.md`, `APPEND_SYSTEM.md`, extensions) → refresh byte-compare khi binary update; user custom thì sửa bản project.
- **Smart-parse args**: 1 verb nhận nhiều dạng input (vd `8sync ai "..."` = prompt · `8sync ai --model glm "..."` = model override · `8sync find -f x` = filename mode · `8sync harness compaction 50` = set). Tránh subcommand sâu.
- **Verb count target**: giữ ≤ 30 verb flat (hiện 30 gồm cả `help`/`flow` — đã chạm trần, verb mới phải thay verb cũ; look&feel delegate cho HyDE, kitty glass deploy qua `setup`).
- **Binary size — ceiling 5 760 KiB / 5 898 240 B (ENFORCED), goal 4 MiB**: `scripts/size-gate.sh` chạy trong `release.yml` cho MỌI asset → build **FAIL** nếu vượt `5 898 240 B`; vượt goal `4 194 304 B` chỉ warn. Ceiling đặt TRÊN size hiện tại có chủ ý — gate đỏ sẵn thì ai cũng phớt lờ; hạ dần mỗi khi có headroom (ratchet). Nâng ceiling CHỈ sau khi attribute bằng `bash scripts/size-report.sh` (lần gần nhất 2026-10-11, v0.65.0: async verify + `ccc` launch prepare + skill links/overrides + luật org nhúng = +8 192 B Windows, minimal 3 169 280 B; `web` gate +1 159 168 B (MSVC) vẫn là voi). Hiện tại: **linux-x86_64 v0.66.0 5 747 632 B** (CI musl); thay đổi guard + gate native sau v0.66.0 đo +114 448 B (musl local, zig cc) → ước ~5 862 080 B, còn ~35 KiB tới trần — feature kế tiếp phải attribute bằng size-report trước khi nâng · **minimal (`--no-default-features`) 3 169 280 B** (MSVC local) · số cũ trong CHANGELOG-ARCHIVE chỉ mang tính lịch sử. Mỗi build 1 `--target-dir` riêng + `--target` tường minh (trên Windows chạy size-report bằng Git Bash + `TARGET=x86_64-pc-windows-msvc`; `bash` mặc định là WSL). Số của `cargo bloat` CHỈ để xếp hạng nghi phạm — nó hụt SQLite ~26× (xem `su-code/KNOWLEDGE.md`).
- **Help format**: mọi verb có `-h`/`--help` với `EXAMPLES` block (xem `setup.rs:7-15`).

---

## 9. Test nhanh khi PR

```bash
cargo build --release
./target/release/8sync --version
./target/release/8sync help
./target/release/8sync flow
./target/release/8sync doctor
./target/release/8sync harness compaction           # view omp auto-compaction threshold
./target/release/8sync ai --model glm -h            # adaptive model flag present
./target/release/8sync . -h                         # sub-action help
./target/release/8sync find --no-open --type rs "fn run"
bash scripts/size-gate.sh target/release/8sync   # size ceiling (same gate CI runs)
```

`cargo test` (unit tests, ~145) + smoke test trên. CI miễn phí (repo public): `.github/workflows/ci.yml` (`cargo test` Linux/macOS/Windows + build `--no-default-features` mỗi push/PR) · `release.yml` (5 asset + size gate) · `install-smoke.yml` (one-liner `install`/`install.ps1` thật trên ubuntu x64/arm64, macOS arm64/Intel, Windows sau mỗi release + hàng tuần; fail nếu version ≠ latest hoặc setup không "all steps succeeded") · `legal-sync.yml` (hàng tuần snapshot văn bản pháp lý Anthropic → `docs/legal/anthropic/`, đổi → commit + issue; có secret `ANTHROPIC_API_KEY` → Claude Code soạn PR cập nhật `8sync-anthropic-rules.md`).

---

## 10. Khi AI agent đụng repo này lần đầu

1. Đọc file này (`AGENTS.md`) đầu tiên.
2. Đọc `README.md` cho overview ngắn cho human.
3. Xem `crates/cli/src/main.rs` (subcommand map) → biết được verb nào dispatch về module nào.
4. Mỗi verb 1 file `crates/cli/src/verbs/<verb>.rs`. Mở file đúng tên là thấy logic.
5. Asset (configs, skills, presets, wallpaper URL) trong `assets/`. Embed qua `rust-embed` (xem `assets.rs:5`).
6. Khi muốn thêm verb mới: làm theo 3 bước
   - Tạo `crates/cli/src/verbs/<new>.rs` với `pub fn run(a: Args) -> Result<()>`.
   - Thêm `pub mod <new>;` trong `crates/cli/src/verbs/mod.rs`.
   - Thêm variant `<New>` trong enum `Cmd` của `main.rs` + match arm.

---

**Maintained by**: 8-Sync-Dev org · https://github.com/8-Sync-Dev/8sync
