# ccc-hints — gợi ý realtime trong prompt của ccc (như omp), tab completion, quét omp → port native Rust

Owner (2026-10-16): "enhance prompt in ccc can auto hint real time like omp suggestion to tab completion, scan all omp
rights? move all feat strong harness to ccc native rust follow /rules /aup-audit /sec".

Đọc: (1) prompt của Claude Code trong ccc phải có gợi ý realtime như omp: ghost text (Tab để lấy), typeahead khi gõ `/…`
và dải hint trên prompt; (2) tab completion cho lệnh `8sync` ngoài shell; (3) quét hết feature mạnh của omp, cái nào
port được thì port sang ccc bằng Rust native (không copy code omp, chỉ ý tưởng), tuân /rules /aup-audit /sec.

## Đường hợp lệ (R&D, đã đọc API)
- Claude Code 2.1.301 có **function hooks / mods** chính thức (skill `plugin-authoring`, types `claude-code.d.ts`):
  `prompt.autocomplete` (hàng typeahead cho token ở con trỏ), `$.prompt.suggest` (ghost text, Tab/→ để lấy),
  `ui.render { component: 'AbovePrompt' }` (dải trên prompt), `$.process.run(argv)` (gọi lệnh host, không shell),
  `$.clock.every`. Một plugin đặt trong `~/.claude/skills/<name>` được **auto-load** (reference.md "Developing one").
  → mod `8sync-hints` chỉ là lớp vẽ mỏng; mọi tính toán nằm trong `8sync ccc hint` (Rust native, < 50 ms).
- Không reverse-engineer/copy prompt Claude Code; không proxy. omp = MIT (Zechner/Bölük/Stencil) nhưng ta **không copy
  code**, chỉ port ý tưởng (predictive text n-gram từ lịch sử prompt của chính owner, context-aware suggestion khi
  composer trống, typeahead có mô tả).

## Goal
1. **`8sync ccc hint [--complete <token>] [--json]`** (Rust, `crates/cli/src/verbs/ccc/hint.rs`), chạy trong repo hiện
   tại, không mạng, không gọi `gh`:
   - `suggest`: một câu gợi ý prompt kế (ghost text). Ưu tiên: loop `/ship-loop` đang mở trong `su-code/ship/ACTIVE`
     → "tiếp tục loop <slug> (iter k/N)"; urgent của phòng (`8sync ccc . urgent`) → nhắc; **bigram từ
     `~/.claude/history.jsonl`** (prompt owner đã gõ sau prompt giống lần trước, lọc theo project — port ý tưởng
     omp `predict ngram`, local-only); nhánh có commit chưa push → "push nhánh + mở PR"; cây bẩn → "/sec rồi commit".
   - `band`: ≤ 2 dòng ngắn cho dải trên prompt (loop · git · urgent · cảnh báo watchdog < 10 phút), tiếng Việt.
   - `complete`: token bắt đầu `/` → skill đã cài (`~/.claude/skills/*/SKILL.md` + `.claude/skills` của repo,
     frontmatter name/description, đọc ≤ 2 KB mỗi file), token bắt đầu `8sync`/`ccc` → verb của 8sync (bảng tĩnh).
     Khớp prefix trước, rồi subsequence; ≤ 8 hàng `{text,label,description}`.
2. **Mod `8sync-hints`** (`assets/claude/skills/8sync-hints/`: `.claude-plugin/plugin.json`, `hooks/hooks.json`,
   `hooks/register.ts`, `hooks/hint.ts` thuần, `hooks/hint.test.ts`, `types/index.d.ts`): `session.start` +
   `turn.complete` + `$.clock.every(20 s)` khi rảnh → `8sync ccc hint --json` → `$.prompt.suggest` + cập nhật band;
   `prompt.autocomplete` token `^/`|`^8sync`|`^ccc` → `8sync ccc hint --complete <token> --json`; `ui.render
   AbovePrompt` vẽ band dim + nút "Ẩn". Lỗi/không có `8sync` → im lặng (`next(e)`), không bao giờ chặn prompt.
   Cài qua `8sync ccc kit` (KIT_FILES) vào `~/.claude/skills/8sync-hints` → mọi phiên ccc đang dùng nhận sau restart.
3. **`8sync completions <bash|zsh|fish|powershell|elvish>`** (clap_complete) — tab completion cho lệnh `8sync` ở shell.
4. **`research/omp-features.md`**: quét feature omp 18.11.1 (`--help`, CHANGELOG, capabilities.md) → bảng ≥ 30 dòng
   `feature | omp | ccc hiện có | port? | ghi chú/rule`, phần "port đợt này" và "đợt sau", licence note (MIT, chỉ ý tưởng).
5. CHANGELOG, `ccc help` cập nhật, `/sec` + `/rules` + `/aup-audit` (đọc lịch sử prompt local của chính owner: dữ liệu
   ở máy owner, không gửi đi đâu).

## Non-goals
- Không sửa UI Claude Code ngoài API mod chính thức; không chạy model từ mod; không gọi mạng trong `hint`.
- Không port: account pools, auth gateway, RPC/SDK, livestream, voice/TTS, codex/openai-specific (ngoài phạm vi hoặc
  chạm điều khoản subscription).
- Không build release local; CI 3 OS.

## Acceptance criteria (exit 0 = pass; chạy trong /home/alexng/tools/su-code-hq, nhánh feat/ccc-hints)
| # | Criterion | Lệnh |
|---|---|---|
| C1 | `hint`: suggest theo loop/urgent/bigram/git, band ≤ 2 dòng, complete `/`+`8sync` từ fixture; mỗi lần tính < 50 ms trên fixture | `nice -n 19 ionice -c3 cargo test -q -j2 -p su-code hint_` |
| C2 | Mod hợp lệ theo engine: `claude plugin validate` không lỗi | `claude plugin validate assets/claude/skills/8sync-hints` |
| C3 | Test mod (`claude-code/testing`): parse JSON của `hint`, hàng autocomplete, band tree, im lặng khi lỗi | `claude plugin test assets/claude/skills/8sync-hints` |
| C4 | `8sync completions bash` sinh script có `ccc`; `zsh`/`fish`/`powershell` không panic | `nice -n 19 ionice -c3 cargo test -q -j2 -p su-code completions_` |
| C5 | Kit cài mod: KIT_FILES có 5 file của mod, `install_kit_at` ghi `skills/8sync-hints/hooks/register.ts` | `nice -n 19 ionice -c3 cargo test -q -j2 -p su-code kit_` |
| C6 | Mod load thật trong `claude -p` với `--plugin-dir` (không dòng stderr "8sync-hints … not loaded/failed") | `bash scripts/uat/hints-load.sh` |
| C7 | `research/omp-features.md` ≥ 30 dòng bảng + mục licence | `test -s research/omp-features.md && [ "$(grep -c '^| ' research/omp-features.md)" -ge 30 ] && grep -q MIT research/omp-features.md` |
| C8 | Clippy sạch trong file nhánh này chạm | `! (nice -n 19 ionice -c3 cargo clippy -q -j2 -p su-code --all-targets 2>&1 \| grep -E 'crates/cli/src/(verbs/ccc/hint.rs\|verbs/completions.rs\|verbs/ccc.rs\|main.rs)')` |
| C9 | CI nhánh `feat/ccc-hints` xanh 3 OS | `gh run watch <id> --exit-status` |

## Tasks (đợt; ≤ 2 writer song song vì watchdog báo GPU áp lực)
- Đợt 1: lead viết `hint.rs` (C1) + `completions` (C4) + nối dispatch/help; **task** (subagent) viết
  `research/omp-features.md` (C7) từ `omp --help`, CHANGELOG omp, capabilities.md — file tách bạch.
- Đợt 2: lead viết mod `8sync-hints` (C2, C3, C6) + KIT_FILES (C5); clippy (C8); push → CI (C9).
- Đợt 3: reviewer + qa UAT + `/sec` + `/rules` + `/aup-audit`; CHANGELOG; commit (không push main — không có `--release`).

## Giả định (owner không hỏi được; chọn an toàn)
- Band tiếng Việt, ≤ 2 dòng, có nút Ẩn; ghost text chỉ khi ô trống (engine tự đảm bảo).
- Bigram đọc `~/.claude/history.jsonl` (dữ liệu của chính owner, local). Không ghi file nào mới ngoài cache skill index.
- Mod đặt trong `~/.claude/skills/8sync-hints` (auto-load, không cần `--plugin-dir`); phiên đang mở cần restart.
- "scan all omp rights" = quét toàn bộ feature mạnh của omp; đợt này port: ghost-text/predict, typeahead có mô tả,
  context-aware suggestion, shell completion. Các feature còn lại ghi vào bảng "đợt sau".
