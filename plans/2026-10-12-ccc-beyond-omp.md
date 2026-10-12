# Plan top-1 — `8sync ccc` vượt omp, đúng luật Anthropic

**Ngày:** 2026-10-12 · **Base:** 8sync 0.65.0 (`d18128d`), Claude Code 2.1.296, omp 18.9.2, Feynman 0.5.35
**Phương pháp:** Claude Code đọc sâu source clone **trên máy** (không gửi code ra ngoài), 5 agent song song (omp · Feynman+ForgeCode · Claude Code native · kit ccc + đo token · luật Anthropic). SHA nguồn: `~/research/ccc-vs-omp/SOURCES.lock`. Không decompile Claude Code.
**Không phải tư vấn pháp lý** — trích dẫn điều khoản kèm nguồn để Alex tự đối chiếu.

---

## 0. TL;DR

1. **Khoảng cách token là thật nhưng phần lớn do chính kit/repo gây ra, không phải do Claude Code.** Request đầu: ccc **~58k** token (2 phiên Opus 5.5: 57,914 / 58,159) vs omp **~37k** (37,129) — đo từ `message.usage` trong transcript. Kit + repo tự nạp **~14k** trong đó (bảng §2).
2. **Cắt được ~14k ngay ở v0.66** bằng dọn dẹp (CLAUDE.md trùng, "đọc 4 skill trước tool đầu", skill description full, rules @import) — không cần feature mới.
3. **Phần còn lại thắng bằng "ít request hơn + model rẻ hơn cho việc rẻ"** (stop gate không gọi model, prewalk kiểu omp qua subagent, subagent trả envelope ngắn) — tất cả dùng **cơ chế native của Claude Code**, không hack.
4. **3 lỗ hổng compliance trong code 8sync phải vá trước khi quảng bá "beyond omp"** (§1.3).
5. Chuẩn "thắng": cùng bench, Console key, 3 run/task — **chi phí $/task và số request ≤ omp, quality = 100%, thời gian ≤ omp**. Prefix token có thể vẫn > omp vì system prompt Claude Code — không được nói quá số này.

---

## 1. Luật Anthropic — guardrail bắt buộc (đọc trước)

Nguồn: snapshot `docs/legal/anthropic/*` đã đối chiếu bản live 2026-10-12 (khớp từng chữ với trang legal-and-compliance; AUP bản mới **hiệu lực 12/11/2026** — hiện vẫn áp bản trước).

### 1.1 Từng ý tưởng của plan

| Ý tưởng | Kết luận | Căn cứ |
|---|---|---|
| Hook prompt/agent gọi Claude (gate, advisor) | Được, có điều kiện | Native feature; Pro/Max "assume ordinary, individual usage of Claude Code" (`claude-code-legal-and-compliance.md:46`) → giảm số lần gọi model là vừa rẻ vừa an toàn |
| Subagent + định tuyến model | Được | Native; "Users are responsible for ensuring that agents they build… comply" (`usage-policy.md:197`) |
| Memory dài hạn local qua MCP/hook | Được, có điều kiện | Local-first, lọc secret/PII, tách client (quy tắc 8 Sync §3) |
| Đóng gói plugin + marketplace public | Được, có điều kiện | Không dùng tên/logo "Claude Code"/"Anthropic" làm tên sản phẩm (`legal-and-compliance:30`) → tên: **"8 Sync kit for Claude Code"** (chỉ nhắc dạng chữ) |
| Bench bằng Console key | Được | "Developers… should use API key authentication through Claude Console" (`:53`) |
| Mượn ý tưởng/code | Được, có điều kiện | omp MIT, Feynman MIT (`LICENSE:1-3`), ForgeCode Apache-2.0 (giữ NOTICE, ghi thay đổi). **Repo `anthropics/claude-code`: "All rights reserved" → không copy** |
| `claude -p` chạy tự động | Được, có điều kiện | Chạy binary chính chủ + credential của chính user. Consumer Terms cấm "automated… bot, script" trừ khi "via an Anthropic API Key or where we otherwise explicitly permit" (`consumer-terms.md:28`) → **mặc định Console key cho chạy không người**; headless trên subscription là vùng **chưa verify** |

### 1.2 Không bao giờ làm
- Chuyển/lưu/proxy OAuth token của Claude subscription sang client khác (`legal-and-compliance:53`; AUP "proxy… route requests through consumer subscriptions or misrepresent the product or client", `usage-policy.md:134`).
- Sửa binary Claude Code hay tắt phương thức auth (`:24`); decompile/reverse engineer, copy system prompt của Claude Code (`consumer-terms.md:24`, Commercial D.4(b) `commercial-terms.md:20`).
- Dùng output để train model (`usage-policy.md:133`).
- **Copy pattern của ForgeCode provider `claude_code`**: OAuth bằng client id của Claude Code + 2 beta header dành riêng cho OAuth/Claude Code + chèn câu tự xưng "Claude Code" vào system prompt (`forgecode/crates/.../anthropic.rs:64-77,138-140`) = giả client. Tương tự login "Claude Max" của Feynman (`feynman/src/model/commands.ts:843,1069`). Chỉ dùng đường API key. (Guard của 8sync đã chặn các marker này — `ccc/guard.rs:93`.)

### 1.3 Lỗ hổng trong code 8sync hiện tại (vá ở v0.66)

| Mức | Vị trí | Vấn đề | Cách vá |
|---|---|---|---|
| **High** | `harness/claude_code.rs:355-359` (test `api.apikey.fun` :571) | Cho phép trỏ Claude Code vào gateway bên thứ ba bất kỳ, chỉ cảnh báo. Gateway bán lại Claude = AUP:134; code/prompt đi tới bên thứ ba không công bố | Allowlist: Anthropic, Bedrock, Vertex, Foundry, gateway do chính user host; còn lại từ chối |
| **Medium** | `harness/claude_code.rs:337-391` | Copy `ANTHROPIC_AUTH_TOKEN` vào `~/.omp/agent/models.yml` mà không kiểm là Console key | Chỉ nhận prefix `sk-ant-api`; mọi token khác (vd OAuth `sk-ant-oat…`) → từ chối |
| Low | `harness/claude_code.rs:299,342-347` | In 8+6 ký tự đầu/cuối token; lưu plaintext YAML + Windows User env | Chỉ in 4 ký tự cuối; ghi chú rủi ro |
| Low | `verbs/forge.rs:695-734` | API key plaintext trong `~/.forge/.credentials.json` | chmod 600 + ghi chú |
| **Cần Alex quyết** | `verbs/codex_web.rs:1-60,300-301` | Tự động hoá ChatGPT Web subscription vào omp — cùng pattern 8 Sync cấm với Claude; điều khoản OpenAI **chưa verify**; cài qua `curl\|sh` từ repo bên thứ ba | Đề xuất: gỡ khỏi bản mặc định hoặc gắn opt-in + cảnh báo rõ |
| OK | `feynman.rs:150-166`, `ccc/guard.rs:93-98`, `ccc.rs:649`, `ccc.rs:271` | Feynman loại Claude; guard chặn marker OAuth; chỉ `claude auth status`; installer chính chủ | Giữ; guard thêm prefix `sk-ant-oat` |

Thêm: `docs/legal/anthropic/index.md` chưa ghi ngày snapshot → `legal-sync.py` ghi ngày.

---

## 2. Đo hiện trạng (số thật)

**Request đầu tiên** (cache_creation + cache_read + input của request đầu, dedupe theo `requestId`, script python trên `~/.claude/projects/*/*.jsonl` và `~/.omp/agent/sessions/**/*.jsonl`, chỉ đọc trường số):

| | Context request đầu | Số request/phiên |
|---|---|---|
| ccc (Opus 5.5, 2 phiên) | 57,914 / 58,159 | 42 / 48 (median 45) |
| ccc subagent (6) | 44,941–47,510 | median 14 |
| omp (Opus 5.5, 1 phiên) | 37,129 | 37 |

⚠️ Mẫu nhỏ (2 vs 1 phiên, task khác nhau) → **chỉ là chỉ báo**; số chính thức lấy từ bench Phase 1. `STATE.md:28` từng ghi "ccc 34.3k vs omp 56.2k" — nay ngược lại, nghĩa là kit đã phình ra (các file CLAUDE.md của repo không được re-inject bản gọn).

**Lớp kit/repo tự nạp mỗi phiên** (phiên mở ở `~/startup/su-code`):

| Lớp | Bytes | ~Token |
|---|---|---|
| Ép đọc 4 SKILL.md "CORE trước tool đầu" (codegraph, karpathy, ponytail, 8sync-cli) | 15,380 | 3,845 |
| 30 skill description (không có `skillOverrides` vì project không có `.claude/`) | 13,310 | 3,328 |
| `~/startup/su-code/CLAUDE.md` (block cũ 8.6 KB) | 8,575 | 2,144 |
| `~/startup/CLAUDE.md` — **giống hệt byte-by-byte**, nạp 2 lần (đã `cmp` xác nhận) | 8,575 | 2,144 |
| `8sync-anthropic-rules.md` (@import) | 6,693 | 1,673 |
| `~/.claude/CLAUDE.md` | 2,264 | 566 |
| 5 agent description | 866 | 217 |
| **Tổng** | **55,663** | **~13.9k** |

**Bug/lệch phát hiện thêm:**
- CLAUDE.md repo nói codebase-memory-mcp/serena/headroom "LUÔN có trong tool list", nhưng **Claude Code có 0 MCP local** (`~/.claude.json` `mcpServers: []`, đã xác nhận). `mirror_mcp` (`ccc.rs:600-633`) không đăng ký được; serena không có trên PATH → agent tốn lượt đi tìm tool không tồn tại.
- Model ID cũ: `ASK_GATE_MODEL = "claude-sonnet-5"` (`ccc.rs:399`); `harness/claude_code.rs:395-403,545` và `model.rs:138-140` dùng `claude-haiku-4-5`, `claude-sonnet-4-6`… — chưa có ID 5.5 (`claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`, `claude-fable-5-1`).
- Bridge Feynman chỉ tìm `@mariozechner/pi-ai` (`feynman.rs:522,525`; pi-tui :455-471), Feynman 0.5.35 dùng `@earendil-works/*` → lỗi `Cannot find module` (đã tái hiện; workaround `EIGHTSYNC_FEYNMAN_AI=…/@earendil-works/pi-ai/dist/index.js` chạy OK).
- `~/startup/su-code` là thư mục memory nhưng lại bị inject CLAUDE.md/AGENTS.md riêng.

---

## 3. omp mạnh ở đâu — và ccc đáp trả bằng gì (native)

| # | Kỹ thuật omp (bằng chứng) | ccc làm tương đương bằng | Verdict |
|---|---|---|---|
| 1 | Chỉ 13 tool "essential" gửi schema; còn lại là device `xd://` lấy docs on-demand (`tools/essential-tools.ts:23-47`, `tools/xdev.ts`) | MCP tool search mặc định (2.1.7), `alwaysLoad:false` hoãn cả server (2.1.287, CHANGELOG L794), giữ ≤5 tool cbm hay dùng | **NATIVE** |
| 2 | Prewalk: model lớn lập plan, lần edit đầu chuyển sang `@smol` (`session/prewalk.ts:36-60,244,266`); plan-yolo | `/ship`: plan trên Opus 5.5 → `task` subagent `model: sonnet` + `effort` (frontmatter 2.1.74/2.1.78; Agent `effort` param 2.1.292) | **NATIVE** |
| 3 | Output tool >50 KB spill ra artifact, giữ đầu/cuối 20 KB; `read` mặc định 300 dòng (`tools/settings.ts:13-192`) | `CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS` (2.1.0), `CLAUDE_CODE_MAX_OUTPUT_TOKENS`; quy ước Bash `\| head/tail` trong agent prompt. Hook sửa output tool built-in: **chưa verify** khả thi | **NATIVE + thử** |
| 4 | Prune read bị thay thế/kết quả rỗng mà không vỡ cache (`agent/compaction/pruning.ts:20-77`) | Không sửa được history → PreToolUse `Read` hook: file không đổi (mtime+hash) kể từ lần đọc trước trong cùng epoch compact → deny "đã có trong context"; reset ở `PostCompact` | **PORT (thử, đo)** |
| 5 | Subagent trả envelope ≤5k ký tự + con trỏ `agent://` (`task/result-summary.ts:16`) | Agent prompt: trả ≤10 bullet, chi tiết ghi file (giống Feynman `researcher.md:92`) | **PORT (prompt)** |
| 6 | TTSR: rule chỉ inject khi output khớp regex (`session/ttsr-coordinator.ts`) | `.claude/rules/*.md` theo `paths:` (2.0.64) + hook PreToolUse `if:` (2.1.85) inject rule khi khớp | **NATIVE (xấp xỉ)** |
| 7 | Advisor model thứ hai, có cooldown, delta-split giữ cache (`advisor/*`) | Không làm advisor mỗi turn (tốn request). Gộp vào `reviewer` chạy 1 lần cuối `/ship` | **DROP advisor-mỗi-turn** |
| 8 | Mnemopi: recall chỉ turn 1, ≤5000 token, persist để giữ cache; retain mỗi 4 turn bằng smol (`mnemopi/state.ts:628-695`) | SessionStart hook in **bản tóm tắt STATE/KNOWLEDGE byte-ổn-định** (≤1.5k token); auto-memory + agent `memory:` (2.1.33); đánh giá mind0 sau | **NATIVE + PORT nhỏ** |
| 9 | Hashline edit (không gửi old_string) (`edit/hashline-compact.md`) | Không thay được Edit của Claude Code | **DROP** |
| 10 | Snapcompact (render history thành ảnh), cache warmer | Claude Code tự lo compact/cache; can thiệp = rủi ro | **DROP** |

## 4. Ý tưởng mượn từ Feynman (MIT) và ForgeCode (Apache-2.0)

- **Feynman deep-research pipeline** (`prompts/deepresearch.md:13-158`): plan → scale gate (câu hỏi đơn = không fan-out; so sánh 2–3 = 2 researcher; survey = 3–4) → lead tự viết draft → **verifier** gắn citation + kiểm URL → **reviewer** chấm FATAL/MAJOR/MINOR → sửa FATAL + 1 vòng review. File provenance, `Verification: BLOCKED` khi thiếu. → Nâng skill `deep-research` của kit + thêm 2 agent `verifier`, `researcher` (giữ ghi công MIT).
- **Luật integrity** (`SYSTEM.md:25-31`): cấm chữ "verified/confirmed" khi không có bằng chứng → thêm 2 dòng vào CLAUDE.md kit.
- **ForgeCode**: agent theo vai forge/muse/sage với `max_turns`, tool allowlist, `max_tool_failure_per_turn = 3` (`forge_domain/src/agent.rs:125-165`, `.forge.toml:20`) → frontmatter `maxTurns`, `disallowedTools` cho agent kit. Giới hạn output shell 100 dòng đầu + 100 dòng cuối (`.forge.toml:9-18`) → quy ước trong agent prompt.
- **Không mượn**: provider `claude_code` của ForgeCode, login Claude Max của Feynman (vi phạm §1.2).

---

## 5. Plan theo phase

Mỗi phase: một thay đổi → bench → giữ/revert (try → measure → keep). Conventional commits, `CHANGELOG.md`, `su-code/KNOWLEDGE.md`, `STATE.md` mỗi phase. `cargo test` + CI 3 OS + size gate + install-smoke trước release.

### Phase 1 — v0.66.0 "Dọn & vá" (1–2 ngày) — lợi lớn nhất, rủi ro thấp nhất
1. **Compliance §1.3**: allowlist gateway; kiểm prefix `sk-ant-api` trước khi ghi token cho omp/Forge/Feynman/bench; mask token; guard thêm prefix OAuth; ghi ngày snapshot legal.
2. **Token cuts** (theo thứ tự bytes tiết kiệm):
   - Re-inject block gọn (0.7k, `inject.rs:282`) cho mọi CLAUDE.md repo; không inject vào thư mục memory `su-code/`; phát hiện + gộp CLAUDE.md cha/con trùng → −16.4k B.
   - Bỏ luật "đọc 4 CORE skill trước tool đầu" → skill tự trigger theo description → −15.4k B.
   - `skillOverrides` `name-only` ở **user scope** cho skill on-demand (CHANGELOG 2.1.129) → ~−12k B.
   - Rules: thay `@import` 6.7 KB bằng tóm tắt 5 dòng + link; bản đầy đủ nạp trong `/aup-audit` → −6k B.
   - Xoá đoạn nói MCP "luôn có" khi chưa đăng ký; khử lặp `~/.claude/CLAUDE.md` vs org rules → −3.3k B.
3. **Sửa bug**: `mirror_mcp` đăng ký được cbm (báo lỗi rõ nếu thiếu binary), serena chỉ khi có trên PATH, `alwaysLoad` chỉ cho cbm; model ID 5.5 ở `ccc.rs:399`, `harness/claude_code.rs:395-403,545`, `model.rs:138-140` (một bảng hằng số chung); Feynman bridge thử cả `@earendil-works/*` và `@mariozechner/*`.
4. **Bench harness chuẩn hoá**: 3 cấu hình (Claude Code `--bare` làm baseline, ccc, omp) × task suite hiện có × 3 run, Console key, cùng model. Đo: context request đầu, tổng input (tách cache read/write), $/task, số request, thời gian, test ẩn pass. Script dùng python (jq hỏng với thư mục bắt đầu bằng `-`).
- **Done khi:** context request đầu ccc ≤ 45k (từ ~58k), quality 100%, có test mới cho merge CLAUDE.md/settings + guard prefix.

### Phase 2 — v0.67.0 "Ít request hơn" (2–3 ngày)
1. Stop gate: prompt hook (1 lần gọi model mỗi lượt kết thúc) → **command hook** dựa trên bằng chứng (`verify-stop` đã có + kiểm task chưa xong trong task list); chỉ giữ gate prompt cho ca mơ hồ. Bài học phiên này: gate prompt chặn 4 lần chỉ vì đang chờ subagent chạy nền → gate phải nhận biết "đang chờ background task".
2. Guard: thêm `if:` (2.1.85) để chỉ spawn khi lệnh/đường dẫn rủi ro.
3. Read-dedupe hook (§3 #4) — bật sau flag, đo; revert nếu quality giảm.
4. Agent kit trả envelope ngắn (≤10 bullet + file) — §3 #5.
- **Done khi:** request/task ≤ omp trên bench, $/task ≤ omp.

### Phase 3 — v0.68.0 "Định tuyến model + chất lượng" (2–3 ngày)
1. Model theo vai: `explore` haiku + `effort: low`; `task` sonnet; `reviewer` sonnet; plan trên model chính. `/ship` = prewalk: plan (Opus) → task (Sonnet) → reviewer → verify-gate.
2. Frontmatter `maxTurns`, `disallowedTools` (reviewer/explore read-only) — kiểu ForgeCode.
3. `deep-research` v2 theo pipeline Feynman + agent `verifier`/`researcher`; scale gate chống fan-out thừa.
4. LSP plugin chính chủ (`claude-plugins-official/plugins/{rust-analyzer,typescript,gopls,pyright}-lsp`) thay phần lớn serena — không tốn schema MCP.
- **Done khi:** thời gian ≤ 0.85× omp, quality 100%, 3 run.

### Phase 4 — v0.69.0 "Memory + plugin" (3–5 ngày)
1. SessionStart hook: tóm tắt STATE/KNOWLEDGE byte-ổn-định (≤1.5k token, giữ prompt cache), agent `memory:`; đánh giá mind0 như MCP local (`alwaysLoad:false`).
2. Đóng gói kit thành **plugin "8 Sync kit for Claude Code"** + marketplace git `8-Sync-Dev` (agents, skills, hooks, lspServers, settings mặc định); `8sync ccc kit` cài offline bằng `--plugin-dir` khi không có mạng; giữ file user đã sửa; `LICENSE`/`NOTICE` ghi công MIT/Apache.
3. `/aup-audit` trước release (memory + hook gọi model + marketplace public).

---

## 6. Rủi ro & chưa verify
- Claude Code đổi nhanh → ghi version tối thiểu cho mỗi feature (đã có trong §3), `ccc status` cảnh báo khi thấp hơn.
- Mẫu đo token hiện tại nhỏ → số chính thức chỉ từ bench Phase 1.
- **Chưa verify:** ID Haiku hiện hành; `claude-sonnet-5` còn hợp lệ không; hook có sửa được output tool built-in không; headless `claude -p` trên subscription có thuộc "explicitly permit"; điều khoản OpenAI cho `codex-web`; license ForgeCode lệch (`LICENSE` Apache-2.0 vs `package.json` ISC — coi là Apache-2.0); số request/turn của omp.
- Bench nhiễu → chênh <10% coi là hoà.

## 7. Cần Alex quyết
1. **Console key cho bench** (tốn tiền; Alex tự set `ANTHROPIC_API_KEY`, không dán vào chat).
2. **`codex-web`**: gỡ khỏi mặc định / opt-in + cảnh báo / giữ nguyên.
3. **Gateway allowlist** có thể làm hỏng setup của user đang dùng gateway bên thứ ba — chấp nhận breaking change?
4. Marketplace plugin **public** hay private.

## 8. Tiến độ Phase 0 (xong 2026-10-12)
- 7 nguồn clone + `codegraph init` ở `~/research/ccc-vs-omp/src/` (su-code, oh-my-pi, feynman, forgecode, claude-code, claude-plugins-official, everything-claude-code).
- Feynman 0.5.35 cài qua `feynman.is/install` (đã đọc script, sha256, `~/.local`, không sudo); `8sync feynman auth-omp` OK (Claude excluded). Chạy Feynman headless: model mặc định `gemini-2.5-flash` lỗi `MALFORMED_FUNCTION_CALL`; chạy lại bị classifier chặn vì gửi source 8 Sync cho bên thứ ba → research thực hiện bằng Claude Code subagent trên máy.
- Clone `~/tools/su-code` có thay đổi chưa commit (`pkg.rs`, `CHANGELOG.md`, `CLAUDE.md`, `KNOWLEDGE.md`, …) → **không pull**, giữ nguyên.

## Nguồn
1. `~/research/ccc-vs-omp/src/su-code` @ `d18128d` — `crates/cli/src/verbs/{ccc.rs,ccc/guard.rs,ccc/verify.rs,harness/claude_code.rs,feynman.rs,codex_web.rs,forge.rs,model.rs}`, `su-code/STATE.md`, `docs/legal/anthropic/*`
2. `~/research/ccc-vs-omp/src/oh-my-pi` @ `b83200e` — `packages/coding-agent/src/{tools,session,advisor,mnemopi,edit,task,config}/…`, `packages/agent/src/compaction/*`
3. `~/research/ccc-vs-omp/src/feynman` @ `4cec627` — `prompts/deepresearch.md`, `.feynman/agents/*.md`, `SYSTEM.md`, `LICENSE`
4. `~/research/ccc-vs-omp/src/forgecode` (antinomyhq/forge) — `crates/forge_repo/src/agents/*.md`, `crates/forge_domain/src/agent.rs`, `crates/forge_config/.forge.toml`, provider/anthropic code, `LICENSE`
5. `~/research/ccc-vs-omp/src/claude-code` @ `3deb873` — `CHANGELOG.md` (dòng trích ở §3); docs https://code.claude.com/docs/en/hooks
6. `~/research/ccc-vs-omp/src/claude-plugins-official` @ `f359d43`, `everything-claude-code` @ `d4a44de`
7. Anthropic: https://www.anthropic.com/legal/aup · https://www.anthropic.com/legal/commercial-terms · https://www.anthropic.com/legal/consumer-terms · https://code.claude.com/docs/en/legal-and-compliance
8. Transcript usage (chỉ trường số): `~/.claude/projects/*/*.jsonl`, `~/.omp/agent/sessions/**/*.jsonl`

_Footer: 1 vòng research, 5 agent + tự kiểm lại 3 claim then chốt (CLAUDE.md trùng, 0 MCP local, omp essential/discoverable). Đo: context request đầu từ transcript. Chưa verify: xem §6._
