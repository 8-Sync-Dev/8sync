# autowork-speed — phòng nào cũng có việc: R&D nghiên cứu liên tục, skill học từ repo, trending, animation đủ hành động, hook nhẹ

Owner (2026-10-15): "session, agent rảnh rất nhiều" (ảnh HQ: 8 ghế idle, Task 0 xong · 0 mở). Yêu cầu: R&D nghiên cứu
codebase + internet + học thuật rồi **giao task cho mọi phòng**; phòng trao đổi với nhau; animation đi/đứng/ngồi/giao
việc/họp sprint có asset thật; `skill learn` clone repo (xoá `.git`), chắt lọc token-lean (System Design Primer, CC BY 4.0);
tự cập nhật GitHub trending để học; giữ /rules /aup-audit /sec; Rust native, hook nhanh hơn omp.

## Goal
1. **R&D trực thật sự** (`RD_DUTY`): mỗi lượt lịch = đọc backlog (STATE/KNOWLEDGE/`research/trending`) → nghiên cứu
   codebase (`trail ask`), internet (WebSearch, primary) và học thuật (arXiv/Semantic Scholar) → **giao ≤2 task cụ thể cho
   phòng đang rảnh** qua `POST /api/tasks` hoặc SendMessage, ghi `su-code/research/<slug>.md`.
2. `8sync learn trending [--lang rust|ts] [--days 7]` (Rust): GitHub REST `search/repositories` (official API, không scrape
   trang trending) → `su-code/research/trending/<date>.md` (tên, sao, licence, mô tả một dòng, "có ích cho 8sync vì"-ô trống
   để R&D điền). Fixture JSON cho test; `--json`.
3. `8sync skill learn <owner/repo> [--name n]` (Rust): `git clone --depth 1` vào cache, **xoá `.git`**, đọc LICENSE (không có
   licence hoặc licence không cho phép tái phân phối → từ chối, in lý do), chắt lọc README thành `SKILL.md` ≤ 6 KB
   (frontmatter name/description, nguồn + licence + attribution, mục lục có 1 dòng tóm tắt mỗi mục, trỏ sang `refs/`),
   copy LICENSE + README gốc vào `refs/`; cài vào `~/.claude/skills/<name>` (local, không commit vào repo public).
4. **Animation có hành động**: clip `stand`, `sit` (đứng dậy/ngồi xuống khi state đổi), `meeting` (họp sprint khi
   `STANDUP.md` của project vừa ghi), walker **mang giấy** khi có task mới giao (POST /api/tasks). Vẽ bằng code như
   `frames.ts` (không asset ngoài), test pure (số frame, kích thước, khác nhau).
5. **Hook nhẹ, đo được**: `scripts/uat/hook-latency.sh` đo guard/wake/watchdog/resume-note ≤ 20 ms, `verify` (asyncRewake,
   không chặn model) được bench và ghi số; hệ số so với omp ghi vào STATE.

## Non-goals
- Không scrape `github.com/trending` (ToS), không clone repo không licence, không commit skill học được vào repo này.
- Không gọi model từ UI/CLI; không thêm reqwest (vẫn `curl` như `selfup`).
- Không nới `verify` để bỏ check (correctness trước); chỉ đo và tối ưu đường nóng.
- Không build nặng local: CI 3 OS cho release build.

## Acceptance criteria (lệnh kiểm; exit 0 = pass; chạy trong /home/alexng/tools/su-code-hq)
| # | Criterion | Lệnh |
|---|---|---|
| C1 | `learn trending`: parse fixture search JSON → markdown có bảng, licence, sao; `--json`; lỗi mạng → thông điệp rõ | `nice -n 19 ionice -c3 cargo test -q -j2 -p su-code learn_` |
| C2 | `skill learn`: distil README fixture ≤ 6 KB với mục lục; từ chối khi thiếu licence; `.git` bị xoá sau clone (test trên repo git local) | `nice -n 19 ionice -c3 cargo test -q -j2 -p su-code skill_learn` |
| C3 | `RD_DUTY` giao task cho phòng rảnh (codebase+internet+học thuật+trending) và `scheduledPrompt` giữ mark; test schedule | `cd apps/hq-ui && nice -n 19 pnpm exec vitest run tests/schedule.test.ts` |
| C4 | Sprite: clip stand/sit/meeting + walker carry; `floor` suy ra `meeting` khi STANDUP.md mới (< 2 phút) | `cd apps/hq-ui && nice -n 19 pnpm exec vitest run tests/sprite.test.ts tests/office.test.ts tests/floor.test.ts` |
| C5 | Hook latency bench: guard/wake/watchdog/resume-note ≤ 20 ms (median of 5), in bảng | `bash scripts/uat/hook-latency.sh` |
| C6 | Typecheck + lint hq-ui | `cd apps/hq-ui && nice -n 19 pnpm exec tsc --noEmit && nice -n 19 pnpm exec eslint` |
| C7 | Clippy (kể cả test) sạch trong file nhánh này chạm (toàn crate có 37 lint cũ, CI không chạy clippy — ngoài phạm vi) | `! (nice -n 19 ionice -c3 cargo clippy -q -j2 -p su-code --all-targets 2>&1 | grep -E 'crates/cli/src/(verbs/learn.rs|verbs/skill/learn.rs|verbs/skill/mod.rs|main.rs|verbs/mod.rs)')` |
| C8 | CI nhánh `feat/autowork-speed` xanh 3 OS | `gh run watch <id> --exit-status` |

## Tasks (đợt, ≤4 writer song song)
- Đợt 1 (song song, file tách bạch): **dev-a** `crates/cli/src/verbs/learn.rs` (C1) · **dev-b** `crates/cli/src/verbs/skill/learn.rs` (C2) · **designer** sprite clips + walker carry (C4) · lead: RD_DUTY + schedule test (C3), hook-latency.sh (C5).
- Đợt 2: wire floor `meeting` + task-walker in office-view; tsc/eslint/clippy (C6, C7); push → CI (C8).
- Đợt 3: reviewer + qa UAT + /sec + /aup-audit (fetch GitHub API = trigger) + /rules; CHANGELOG; commit (không push main — không có `--release`).

## Giả định (owner "tự làm đi")
- Trending = "repo nhiều sao tạo trong N ngày" qua API search (xấp xỉ trending; ghi rõ trong file).
- Skill học được nằm ở `~/.claude/skills`, không vào repo public; System Design Primer là ví dụ đầu tiên (CC BY 4.0, attribution trong SKILL.md).
- Animation vẽ bằng code (nhất quán với sprite hiện tại), không thêm PNG.
