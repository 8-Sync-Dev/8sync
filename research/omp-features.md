# omp vs ccc: feature scan (2026-10-16)

Tóm tắt: quét `omp` v18.11.1 (`omp --help`, CHANGELOG, `~/.omp/capabilities.md` snapshot v18.8.7) so với ccc (`8sync ccc help`, `help.rs`, CHANGELOG 8sync 0.92.1). ccc đã có session/goal/urgent/standup/loop/report/statusline/compact/policy/idle/delegate/secret/kit và HQ UI. Khoảng trống lớn nhất nằm ở lớp nhập liệu (ghost text, typeahead, gợi ý cho composer rỗng, shell completion). Đây là phần port đợt này. Các tính năng liên quan token subscription, proxy, account pool, provider auth thì không port. Mô tả omp lấy từ help/CHANGELOG (chưa đọc source, not verified).

## Licence

- omp là MIT (Mario Zechner, Can Bölük, Stencil Labs, Inc.; nguồn: LICENSE trong package).
- ccc chỉ port ý tưởng, tự viết Rust trong `8sync`, không copy code.
- Claude Code không bị sửa hay reverse-engineer; ccc chỉ dùng extension point chính thức: settings hooks, skills, agents, MCP, statusline, và plugin API mới (function hooks / mods: prompt.autocomplete, $.prompt.suggest, ui.render AbovePrompt).

## Bảng so sánh

| Feature | omp | ccc hiện có | Port? | Ghi chú / rule |
|---|---|---|---|---|
| Predictive text / word completion | engine N-gram + SmolLM2 + macOS native, daemon, `omp predict` | không | đợt này | N-gram Rust từ prompt history local của owner; bỏ SmolLM2 (model tải về, nặng) |
| Composer predictions (ghost text tin nhắn kế) | `composer.predictions`, Tab/Right nhận; tốn thêm 1 request model | không | đợt này | ccc-hint chạy local từ history, không gọi model thêm |
| Context-aware suggestion (composer rỗng) | gợi ý theo ngữ cảnh turn | không | đợt này | `$.prompt.suggest` từ loop đang mở / urgent của session / bigram lịch sử prompt (local) / trạng thái git |
| Slash command completions + mô tả | typeahead trong TUI | skill liệt kê của Claude Code | đợt này | `prompt.autocomplete` trả hàng kèm description (skill, verb 8sync) |
| Shell completion | `omp completions` (bash/zsh/fish) | không | đợt này | `8sync completions` sinh từ clap |
| /effort, --thinking | `--thinking off..max,auto` | `claude --effort`/model của Claude Code | đã có | flag sau tên session đi thẳng vào claude (`8sync ccc . <tên> ...`) |
| Advisor (passive turn reviewer) | `--advisor` chèn note mỗi turn | hook Stop `verify-stop` + agents `reviewer`/`critic` | đã có | mức thấp hơn: không review từng turn; đợt sau: hook Stop gọi reviewer nhẹ |
| Prewalk / plan-yolo handoff | đổi sang model rẻ ở edit đầu | không | không | điều hướng model/token theo luồng; chọn model là việc của Claude Code, ngoài phạm vi |
| smol/slow/plan model roles | `--smol/--slow/--plan` | agent frontmatter `model:` trong kit | đã có | agent kit chọn model qua frontmatter chính thức |
| Goal mode | `--goal` | `8sync ccc . goal`, `/ship-loop`, `loop.json` | đã có | ccc goal ghi mục tiêu + file giữ |
| --restore (làm nốt turn dang dở) | resume + chạy lại subagent bị ngắt | `claude --resume`, `ccc .`, hook `resume-note` | đợt sau | verb `8sync ccc restore`: đọc transcript + loop.json, in lệnh resume; không tự chạy lại tool |
| Session fork/branch/pane | `/fork pane/window/tab` | `--team --panes` (tmux) | đợt sau | verb fork bọc `claude --fork-session`; HQ mở pane |
| /btw side questions | hỏi chen không phá turn | không | đợt sau | mod ui.render AbovePrompt hoặc agent `quick-task`; xem API mods |
| Background jobs view | `/jobs`, job tree, `omp ps` | HQ UI, statusline `--agents`, `ccc . ls` | đã có | HQ + `8sync ccc statusline --agents` |
| Agent lineage HUD | cây job/subagent | `8sync ccc standup`, HQ office | đã có | standup 7 role + HQ |
| Account pools / OAuth balancing | `dry-balance`, auth-broker | không | không | token subscription routing; cấm theo rule Anthropic |
| Auth gateway (HTTP forward proxy) | `omp auth-gateway` | không | không | proxy + dùng chung credential; cấm |
| RPC/SDK/ACP mode | `--mode rpc`, `omp acp` | `claude -p`, Agent SDK chính thức | không | dùng SDK chính thức của Anthropic, không dựng server riêng |
| --from-claude import | nhập session Claude Code vào omp | không | không | đẩy transcript sang client khác; ngoài phạm vi |
| worktree.onStart / `omp worktree` | hook khi tạo worktree | EnterWorktree + hook SessionStart | đợt sau | hook WorktreeCreate gọi `8sync` setup (cài deps nhẹ); verb `8sync wt` |
| Prompt-cache warming | replay request trước khi cache hết hạn | `ccc compact --at` giữ 60% | không | replay request = tốn token subscription ngoài ý định; Claude Code tự quản cache |
| Usage-limit tracking / `omp usage` | hiển thị limit mọi account | statusline (usage), `ccc report` | đã có | chỉ số Claude Code báo qua statusline; không hỏi API subscription |
| Secret obfuscation/redaction | redact secret trong transcript | hook `guard` + `/sec` + `ccc secret` | đã có | giá trị không vào transcript |
| Memory (hindsight/mnemopi) | retain/recall/reflect | `/remember`, `su-code/KNOWLEDGE.md`, digest SessionStart | đã có | file local, không server trung tâm |
| Headroom compression | MCP compress output | `ccc compact`, ví dụ `8sync` verb lọc output | đợt sau | `8sync run` rút gọn log dài; MCP headroom của omp không nằm trong kit (not verified) |
| LSP tools | `lsp` tool | LSP plugin Claude Code, `codegraph` | đã có | CLAUDE.md ưu tiên codegraph/LSP |
| Skills discovery | `--skills`, skillshare | kit skills, `8sync skill learn` | đã có | `8sync skill learn` kiểm licence trước |
| Rules discovery | `--no-rules`, context files | CLAUDE.md/AGENTS.md, `/rules` | đã có | kit nạp qua `ccc kit` |
| Hooks/extensions | `--hook`, `-e`, plugin | settings hooks + `8sync ccc hook ...` + mods | đã có | chỉ API chính thức |
| Voice, autoGraph, wait tool, keybindings | TTS/STT, find, wait, phím | Monitor, codegraph, keybindings.json | không | voice ngoài phạm vi; ba mục còn lại đã có bằng công cụ chính thức |
| /record, `omp stream`, `omp clip`, `play` | quay + phát lên live.omp.sh | không | không | đẩy màn hình/chat ra dịch vụ ngoài; rủi ro data |
| anonymize / session dump / `omp share` | bản chia sẻ đã ẩn danh | `/sec`, anonymize trong skill | đợt sau | `8sync session anon` Rust: thay path/literal bằng token; chỉ xuất file local |
| gc --compress | nén session cũ bằng FS | `ccc rm` | đợt sau | `8sync clean` thêm session cũ; không đổi định dạng transcript |
| task.structured / yield schema | kết quả subagent theo schema | agents kit trả ≤10 bullet | đợt sau | JSON schema trong brief + verifier agent |
| Subagent completion estimates | ước lượng hoàn thành | `ccc report` (cost/task) | đợt sau | HQ tính từ lịch sử `report`, không bịa số |

## Port đợt này (ccc-hints)

- `8sync ccc hint`: Rust verb; đọc prompt history local của chính owner (`~/.claude/history` qua đường dẫn chính thức, chưa verify định dạng), dựng N-gram, trả JSON `{ghost, rows[]}` cho một prefix. Dữ liệu không rời máy, không gọi model.
- Mod `8sync-hints` (plugin API chính thức): `prompt.autocomplete` hiện ghost text + hàng typeahead kèm description (skill, verb `8sync`, session). Gọi `8sync ccc hint --json`.
- Composer rỗng: `$.prompt.suggest` đề xuất tin kế từ loop đang mở, urgent của session, bigram lịch sử prompt local, trạng thái git. Gợi ý theo luật, không tốn token.
- `8sync completions <bash|zsh|fish|powershell>`: sinh từ clap, chạy trên Windows/macOS/Linux; có test snapshot. Không build nặng ở máy owner: chạy CI.

## Port đợt sau, ưu tiên

1. `8sync ccc restore`: đọc transcript + `loop.json`, in lệnh `claude --resume`; hook `resume-note` đã có sẵn.
2. Hook Stop gọi reviewer nhẹ (advisor): hook chính thức + agent `reviewer`, bật/tắt như `idle`/`delegate`.
3. `/fork` bọc `claude --fork-session`, HQ mở pane (tmux) cho fork.
4. Hook WorktreeCreate: `8sync` setup nhanh cho worktree mới (deps, env mẫu, không copy secret).
5. `8sync session anon`: ẩn danh path/literal cho bản chia sẻ nội bộ, ghi file local.
6. HQ: ước lượng thời gian/cost theo task từ lịch sử `ccc report` (chỉ số đo thật, nêu nguồn).

## Không port

- Account pools, `dry-balance`, auth-broker, `omp auth/token/login`: token subscription routing / provider auth.
- `auth-gateway`: forward proxy dùng credential chung; rule cấm.
- Prompt-cache warming, prewalk, plan-yolo, `--external-thinking`: đổi model/ép request ngoài Claude Code, provider đã gắn cờ abuse với `--external-thinking`.
- `--from-claude/--from-codex`, RPC/ACP server riêng: sao chép session, dựng client thay Claude Code; ngoài phạm vi.
- `/record`, `stream`, `clip`, `share`: đẩy màn hình/chat ra dịch vụ ngoài (rủi ro data client).
- Voice/TTS/STT, `computer`, `browser-relay`: ngoài phạm vi.
- Mọi tính năng omp cần server trung tâm giữ data người dùng: trái nguyên tắc local-first.
