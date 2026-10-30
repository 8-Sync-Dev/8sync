# AGENTS.md — Hướng dẫn cho AI agent làm việc với `su-code`


<!-- 8sync:skills:begin -->
## 8sync harness

**STEP 0 — code map trước (trail):** hỏi `trail` TRƯỚC grep/đọc cả file (tree-sitter local, không gọi model).
- `trail ask "<câu hỏi>"` — định vị/giải thích code · `trail grep <pattern>` — tìm kèm ngữ cảnh symbol
- `trail skeleton <file>` — khung file, không body · `trail callers <symbol>` (`--direction out` = callees) — impact trước khi sửa
- Chỉ đọc raw file khi sắp sửa nó. Map cũ → `trail build`; repo chưa nối → `8sync trail`.

**Quy tắc bất biến:**
- Sau mỗi thay đổi: cập nhật `CHANGELOG.md` (mục `[Unreleased]`) + ghi bài học vào `su-code/KNOWLEDGE.md`.
- Đọc `su-code/STATE.md` đầu phiên; rewrite nó ở mỗi phase-boundary (Goal · Checklist · Current · Next).

**Skills / agents / commands:** plugin ECC `ecc@ecc` (global) + rule của repo trong `.claude/rules/ecc/`.
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
8sync setup                      # Stage A (gh · omp · forge+zsh · configs · harness global) + hỏi y/N từng profile
# hoặc:
8sync setup --yall               # unattended: mọi profile COMMUNITY (không gồm personal), không hỏi
8sync setup --no-profile         # chỉ harness, unattended (installer chạy lệnh này): bước lỗi được ghi lại, phần còn lại vẫn cài
8sync setup --profile alexdev    # apply bundle cá nhân hóa của alexdev

# omp cài bằng installer chính thức (install.sh / install.ps1 -Binary); forge từ GitHub release
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
    ├── claude/commands/ · eccx/                             `/eccx-<category>` (Claude Code kit · omp) — SINH bởi `scripts/eccx-gen.py`, đừng sửa tay
    └── skills/                                              bundled skill → deploy vào ~/.omp/skills (global, KHÔNG vendor vào repo) + 00-force-load.md
```

Mỗi repo 8sync quản (`8sync harness`): `AGENTS.md`/`CLAUDE.md`/`.cursor/rules/8sync-harness.mdc` (block tối giản trong sentinel) · `su-code/*.md` (memory) · `.claude/rules/ecc/<pack>/` (ECC rule pack theo stack). Skills/agents/commands = plugin ECC `ecc@ecc` (global).

**`/eccx-<category>`** (x = extra, không đụng lệnh của ECC): 1 lệnh mỗi category của https://ecc.tools/skills (core, workflow, ai-agent, security, research, frontend, backend, python, golang, jvm, swift, cpp, perl, industry, content, specialized) + `ads`, `game`, `full` (router liên category). Mỗi lệnh liệt kê MỌI member (skill/agent/command ECC + skill 8sync bundle), mỗi dòng 1 mục ≤12 từ; agent chọn hết cái áp dụng → đọc skill khi tới bước → plan (`--dry-run` dừng ở đây) → làm có verify → báo cáo. Claude Code: `8sync ccc kit` ghi `~/.claude/commands/eccx-*.md` (giữ bản user tự sửa, `--force` ghi đè; cũng có trong plugin `8sync-kit`). omp: `8sync harness`/`up` ghi `~/.omp/agent/commands/eccx-*.md` (tên trần, không `sx-`). Sửa: chỉnh `scripts/eccx-gen.py` rồi chạy `python scripts/eccx-gen.py` (deterministic, ≤12 KB/file); ECC đổi → `--refresh <plugin dir> [--catalog <ecc.tools json>]` cập nhật `scripts/eccx/ecc-snapshot.json`.

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
| `8sync ccc . <name>` | Claude Code (`claude`) theo tên trong repo: tên → UUID (`--session-id` lần đầu, `--resume` sau), registry dùng chung với forge (`uuid_sessions.rs`). `8sync ccc .` = session dùng gần nhất; `. ls`/`. new`/`. rm` (xoá cả transcript)/`status`; flag sau tên chuyển thẳng cho `claude`. Tự cài Claude Code bằng installer chính thức. **Mỗi lần mở** (`prepare`, không chặn launch, không mạng trên đường chính): release mới (cache probe 6h) → tự `up` rồi chạy lại lệnh trên binary mới (`SUSYNC_NO_AUTO_UPDATE=1` tắt); kit stamp khác version → refresh bundled skills + kit; hook ECC tắt thật khi `ECC_HOOKS_ENABLED=false` (mọi bản plugin `ecc`: `hooks/hooks.json` → `hooks.json.8sync-off` + `{"hooks":{}}`, `true` → trả lại; `ccc/lean.rs`); repo git → harness (AGENTS.md/CLAUDE.md block tối giản, ECC rule pack vào `.claude/rules/ecc/` từ checkout ECC đã cache — không mạng, gitignore; KHÔNG vendor skill vào repo). **Kit** (`8sync ccc kit`, setup tự chạy) vào `~/.claude`: auto-compact 80% × window 250000 = ~200K token (status line model 1M hiện `nén 20%`; cặp kit cũ 65/1000000, 60/400000 tự chuyển, cặp owner giữ nguyên), `skillListingBudgetFraction` 0.005 khi chưa có, deny `ShareOnboardingGuide`/`ReportFindings`/`ScheduleWakeup` một lần (stamp `seed:deny-unused-tools`), 5 subagent (`explore` Haiku, `reviewer`/`designer` inherit) + skill `/ship` · `/aup-audit` · `deep-research-web` + mọi bundled skill link → `~/.omp/skills/<tên>` (personal thắng project → luôn bản mới), `CLAUDE.md` import luật org `~/.claude/skills/aup-audit/8sync-anthropic-rules.md` (bản gốc `assets/skills/aup-audit/8sync-anthropic-rules.md`, luôn nạp), hook verify **async** (`asyncRewake`, edit mới nhất thắng, lỗi đánh thức Claude) + `hook verify-stop` (Stop: build hỏng → chặn 1 lần mỗi trạng thái; build ổn → Stop gate native `ccc/gate.rs`, không gọi model, bỏ qua khi còn background task hoặc tin nhắn cuối của user bảo dừng, đọc từ transcript), hook guard native cho Bash **và PowerShell** (`ccc/danger.rs`: parser shell + backstop quét text thô; deny xoá root/home/project/tổ tiên, wipe disk, `wsl --unregister`, force-push mọi kiểu, in/upload `.env`; ask xoá ngoài project/temp, target runtime, xoá trong wsl/ssh/container, `\| sh`, `git reset --hard`/`clean -f`; analyser panic → ask; cộng credential, secret thật, `git add -A` dính secret, subscription Claude sang client khác), allow build/test/lint + `git add` (bỏ classifier auto mode ~0.65 s/lệnh), Ask gate (Sonnet, full model id), connectors claude.ai tắt (`disableClaudeAiConnectors`), auto mode, deny đọc/sửa `.env`/key/`*.session`/`*.pkl` + force-push (rule path chỉ `Read(...)`/`Edit(...)`); file user sửa được giữ (`--force` đè) |

### Session mgmt — named per-project sessions (sub của `.`)
Nhiều feature song song trong 1 repo, mỗi cái 1 omp conversation cô lập. Lever = omp có sẵn (`--session-dir` + `--continue`); 8sync chỉ thêm lớp **tên → session-dir** + **git worktree** + **merge**. Registry máy-local: `~/.config/8sync/sessions/<repo>/index.json` (KHÔNG commit — trỏ path máy-local).
| Lệnh | Mô tả |
|---|---|
| `8sync . <name>` | create-or-resume session theo tên |
| `8sync . new <name> [--worktree]` | tạo session mới; `--worktree` = `git worktree` + branch `8sync/<name>` để cô lập file (2 feat sửa cùng file không đụng nhau) |
| `8sync . ls` (hoặc `--list`, `--json`) `[--sort priority\|time\|name\|status] [-r]` | liệt kê session (★ = dùng gần nhất; kèm branch + `*dirty`). Sắp xếp chung với `ccc . ls`, `ls`, `ls --all` (`session_view.rs` `SortKey`/`order`): mặc định priority = ▲ high → ⚠ dừng vì lỗi API/hết usage (bản ghi StopFailure chưa resume) → ◆ med → running/active → ▽ low → idle, cùng mức: trạng thái → mới nhất → tên; `ls --all` xếp repo theo dòng đầu của nó; `--json` cùng thứ tự; `ccc . report` giữ mới nhất trước |
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
| `8sync clean --dev [--deep] [--idle-days 14] [--image-days 30] [--root DIR] [--dry-run]` | (mọi OS; `8sync clean` trên Windows/macOS = cái này, `verbs/clean_dev.rs`) Dự án = mọi `cwd` trong `~/.claude/projects/*/*.jsonl` + `--root`, về git top level (thư mục ngoài git = repo 1–2 cấp dưới). Tự xoá: build output git-ignore (`target` cạnh Cargo.toml, `node_modules` cạnh package.json, `.next`/`.turbo`/`.nuxt`/`.svelte-kit`/`.parcel-cache`/`.angular`, cache Python) của dự án nghỉ ≥ N ngày (commit cuối + transcript cuối), `git worktree prune`, Docker khi daemon đã chạy (container dừng > 24 h, dangling, builder > 7 ngày, image không ai dùng > 30 ngày; KHÔNG volume), `uv cache prune`/`pnpm store prune`/`npm cache verify` (+ `go clean -cache`/`pip cache purge` với `--deep`), file tạm > 7 ngày, `*.incomplete` của HF > 1 ngày. Chỉ liệt kê: model (qua `hf cache ls --json` vì layout shared-blobs của huggingface_hub 1.x; Ollama, LM Studio, torch hub), kết quả train ≥ 100 MB, volume Docker không ai dùng. Không xoá theo access time (quét nào cũng làm lệch). |
| `8sync clean --forget <id>` | Xoá một mục đã liệt kê: `hf:org/name` → `hf cache rm model/org/name -y`, `ollama:…` → `ollama rm`, `lmstudio:…`/`torch:…` → xoá file/thư mục, `docker-volumes` → `docker volume prune -f` (chỉ volume ẩn danh; volume có tên như `sqldb-*` của Encore là DB dev, giữ) |
| `8sync clean --dev --timer 24h` | Lịch mỗi ngày: Windows Scheduled Task `/SC DAILY` chạy qua `conhost --headless` (không bật console; MINUTE chỉ nhận 1–1439), Linux systemd user timer, macOS launchd |
| `8sync clean --ram` | + drop pagecache (nhẹ, cosmetic) |
| `8sync clean --gpu` | NVIDIA persistence mode + GPU summary |
| `8sync clean --watch [SECS]` | Loop foreground, clean mỗi SECS (default 3600) |
| `8sync clean --timer 1h \| off` | Cài/gỡ systemd user timer (loop định kỳ đúng cách, không phải bash loop) |

**Lưu ý**: "Look & feel" (wallpaper/theme/kitty layout) đã **delegate cho HyDE** — dùng `hydectl wallpaper next` và `hydectl theme set <name>`.

### Lifecycle
| Verb | Mô tả |
|---|---|
| `8sync setup` | Stage A = **AI core thuần** (omp · trail · MCP/skills · gh · forge + zsh · Claude Code + kit · gitleaks · PATH bootstrap) + Stage B (curated y/N: dev-stack, nvidia, bluetooth, warp, **terminal**). `--profile terminal` chạy MỌI OS: helix + JetBrainsMono Nerd Font (+ font mặc định Windows Terminal nếu chưa set) + pro zsh; kitty glass chỉ Arch/Fedora |
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
| `8sync harness [init\|up\|help]` | **bare `8sync harness`** = ONE idempotent command: global layer (bundled skill → `~/.omp/skills`, trail, MCP) + block tối giản trong AGENTS.md/CLAUDE.md + seed memory + **ECC rule pack** (`.claude/rules/ecc/<pack>/` theo stack, không đè pack có sẵn) + consolidate + `trail build` — KHÔNG vendor skill vào repo (skills/agents/commands = plugin ECC `ecc@ecc`). **init**: full bootstrap (progress UI) + **managed `.gitignore`** (ignore `graft/`/`.cache/`/`.env*`, keep `su-code/`) + **gitleaks pre-commit hook**. **up**: light refresh (`--pull` re-pull skill; `--commit` git-commit memory — gitleaks scan trước, abort nếu rò secret; `--loop`/`--timer` chạy nền; tự consolidate `## Learnings` >200 dòng → `su-code/archive/`). **help**: cheatsheet |
| `8sync harness create [--sweep [DIR]]` | Same as `init` (incl. `.cursor/rules/8sync-harness.mdc`, `alwaysApply: true`, same block); `--sweep` stamps every omp project under DIR (default `~/Projects`) |
| `8sync harness global [--sweep [DIR]]` | Apply rule omp **TOÀN CỤC** (mọi project dùng omp, không cần chạy per-project): `~/.omp/skills` + `00-force-load.md` + `APPEND_SYSTEM.md` (append vào MỌI system prompt) + MCP (headroom/zai-vision) + hooks + capabilities — CWD-independent, không đụng project hiện tại. Kèm token-optimizer default cho Anthropic: compaction `thresholdPercent` 50 + `thresholdTokens` 200000 (token thắng %, nên model 1M nén ở 200K thay vì 500K; mỗi key chỉ khi chưa set), headroom compress, APPEND_SYSTEM ghi byte-stable → prompt-cache hit. `--sweep [DIR]` (default `~/Projects`): stamp per-project layer (block AGENTS.md/CLAUDE.md + seed memory + gitleaks hook + ECC rule pack + Cursor rule; gỡ layout cũ: bản copy 8sync chưa sửa trong `su-code/skills/` + link `.claude`/`.cursor`/`.zcode/skills`) vào MỌI **omp project** dưới DIR — chỉ repo có `su-code/` hoặc `AGENTS.md`/`CLAUDE.md`, repo không dùng omp skip + report (onboard: `cd <repo> && 8sync harness`); `trail build` vẫn per-project. `--pull` re-pull registered skills |
| `8sync trail [dir\|--all [ROOT]\|status\|off]` | STEP 0: cài trail-code (`npm i -g @trailhq/trail-code --ignore-scripts`), tắt telemetry, `trail init` cho repo (Claude hook, không global hook, không statusline) + thêm `graft/` vào .gitignore; `--all ROOT` quét mọi git repo (depth ≤3) với `--dry-run` |
| `8sync harness toolstats` | Đọc omp session JSONL → tỉ lệ **optimizer** (trail/headroom) vs **fallback** (grep/read/search/find/glob) + fail per tool. Phát hiện STEP-0 không được dùng. **Không DB** — mỗi lần chạy re-scan toàn bộ JSONL rồi fold in-memory (bản SQLite cũ mở đầu bằng `DELETE FROM calls` nên chưa bao giờ lưu gì; xoá `rusqlite` = −1 060 840 B) |
| `8sync skill [add <spec>\|gen \|list\|update]` | Quản lý skill: `add` clone GitHub (collection-aware) / `builtin:<name>` / **`<url>@<ref>` để pin commit/tag** (ghi `rev` vào `skills.toml` = lockfile, reproducible); `update [name]` re-pull theo `src` (git dedup theo URL, honor `rev` pin); `gen` fuse N skill |
| `8sync mcp [serve\|install\|uninstall\|tools]` | 8sync làm **MCP server stdio** (`verbs/mcp.rs`, JSON-RPC 2.0 mỗi dòng một message, protocol 2025-06-18/03-26/2024-11-05) cho **Claude Desktop (chat) / Cowork / Claude Code**: tool `machine` (RAM/CPU/GPU/W/pin, in-process) + `sessions` · `knowledge` · `report` · `kit` (đọc) + `know_add` (ghi). Mỗi tool (trừ `machine`) chạy chính binary bằng argv (không shell) trong `repo` tuyệt đối có `.git`, timeout 60 s, cắt 40k ký tự, không đọc token/secret/inbox/grant. `install` merge `mcpServers.8sync` vào `claude_desktop_config.json` (`%APPDATA%\Claude`, `~/Library/Application Support/Claude`, `~/.config/Claude`; + bản Store `Packages\Claude_*\LocalCache\Roaming\Claude` nếu có), backup `.bak-8sync`, JSON hỏng → không đụng; `--claude-code` thêm user scope; `--print` chỉ in |
| `8sync sleep work [--hours N] [--screen-off PHÚT] [--no-lock] [--force] \| off \| status` | (= `8sync ccc sleep`, `ccc/awake.rs`) Màn hình tắt + khoá máy ngay mà Claude Desktop / Claude Code vẫn làm: hold giữ thức không theo phòng (thay hold `awake on` theo phòng), chờ 1,5 s cho phím nhả, `LockWorkStation` / `loginctl lock-session` / `pmset displaysleepnow`, rồi `SC_MONITORPOWER` / `xset dpms force off`; chạm chuột/phím sáng lại, tự tắt lại sau 2 phút; giữ tới khi `sleep off` (không hạn giờ, `--hours N` để tự nhả); Modern Standby không tắt màn hình trừ `--force`; `off` = `awake off` |
| `8sync eco [status\|tick\|run\|install\|uninstall\|set …] [--json]` | (= `8sync ccc eco`, `ccc/eco.rs`) **Máy đang dùng bao nhiêu** (RAM, CPU, GPU util/VRAM/°C/W, CPU W, pin, RAM của claude/node) + giữ phiên chạy lâu nhẹ **không cần auto**: mọi tiến trình phiên Claude Code/omp sinh ra (không phải phiên, không phải app Claude Desktop, không phải 8sync) còn ở normal → below normal; chạy pin / battery saver / RAM ≥ 80% / CPU ≥ 75% → Efficiency mode (EcoQoS, Windows), hết thì chỉ trả lại cái eco đã đặt (không khi guard của auto đang chạy); RAM ≥ ngưỡng → trả working set helper ≥ 200 MB (≤ 1 lần/10 phút). Không kill, không pause. Hot có hysteresis 10 điểm. `install`: Scheduled Task `\8sync\eco` đăng ký bằng PowerShell (chạy cả khi dùng pin, không dừng khi rút sạc, không giới hạn giờ, `conhost --headless`) · systemd --user (Nice 15, CPUQuota 5%, MemoryMax 96M) · macOS chưa (chỉ status). Ngưỡng: `~/.config/8sync/eco.json` |
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

## 7. Skill system — ECC-only per repo

**Per repo (Claude Code):** skills/agents/commands đến từ plugin ECC `ecc@ecc` (cài global, user scope) — 8sync **KHÔNG** vendor skill vào repo nữa. `8sync harness` (bare/init/up/create/`global --sweep`), `8sync ccc` launch và `8sync .` chỉ ghi vào repo:

- **Block tối giản** giữa sentinel `8sync:skills:begin`/`end` trong `AGENTS.md`/`CLAUDE.md` (+ `.cursor/rules/8sync-harness.mdc`, pointer ngắn trong `AGENTS.md` sub-folder): STEP 0 trail (`trail ask/grep/skeleton/callers`), luật CHANGELOG/KNOWLEDGE/STATE, 1 dòng ECC. Không liệt kê skill; idempotent; ngoài sentinel không đụng.
- **ECC rule pack** `.claude/rules/ecc/<pack>/`: phát hiện stack bằng `config/project-stack-mappings.json` của ECC (indicator `{file, contains}`, glob `*`; quét root + sub-dir cấp 1 không ẩn, bỏ `node_modules`/`target`/`dist`/`build`/`.next`/`vendor`/`.venv`), copy `rules/common` + pack của từng stack; pack đã có thì giữ nguyên. Nguồn: checkout nông ECC tag `v2.2.3` cache ở `~/.cache/8sync/ecc` (clone lại chỉ khi đổi pin; offline → warn + skip). Đường launch (`ccc`, `8sync .`) chỉ dùng cache, không mạng. Thêm `.claude/rules/ecc/` vào managed `.gitignore` CHỈ khi repo đã ignore `su-code/skills` (policy ignore bản copy sinh ra) — còn lại để owner tự track.
- **Gỡ layout cũ** (`harness/ecc.rs`): xoá `su-code/skills/<name>` chỉ khi là skill 8sync (bundled / đăng ký `skills.toml` / có trong `~/.omp/skills`) VÀ là bản copy chưa sửa (trùng byte, CRLF-insensitive, với bản bundled hoặc `~/.omp/skills/<name>`) hoặc link 8sync tạo; bản đã sửa + skill của user giữ lại và báo. Gỡ link `.claude`/`.cursor`/`.zcode/skills` → `su-code/skills`, key `skillOverrides: name-only` 8sync đã ghi, và `su-code/skills` nếu rỗng. Tree đã đăng ký làm workspace skill library (`ccc kit --skills-from`) không bị đụng.

**Global (omp):** khi `8sync harness init` (hoặc `8sync setup`) chạy, **33 skill bundled** được deploy vào `~/.omp/skills/` theo [Agent Skills open standard](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview). 10 skill **always-on** chia 2 tầng (progressive disclosure — giữ prefix gọn cho KV-cache): 4 **CORE** đọc body ngay đúng thứ tự (trail → karpathy-guidelines → ponytail → 8sync-cli), 6 **specialist** chỉ biết khả năng rồi đọc body khi task khớp; phần còn lại on-demand; `encore-deploy` tech-gated; `social-growth` opt-in:

| Skill | Trigger | Mô tả |
|---|---|---|
|`trail`|`always` (CORE)|code map for agents (trail ask/grep/skeleton/callers/map) — STEP 0|
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
|`senior-security` · `senior-frontend`|on-demand|security/frontend chuyên sâu (code review chung: agent `code-reviewer` + `/code-review` của ECC)|
|`full-flow`|on-demand|self-driving fix/dev/verify loop (Encore + Next)|
|`branch-sync`|on-demand|check/preview/merge/sync mọi git branch về main không conflict|
|`super-pdf`|on-demand|báo cáo/tài liệu PDF "boardroom-grade" từ HTML design system (chips strip + kicker cover, §N section spine, bảng cmp navy + pills, callout 4 màu, stat cards, footer chạy) — template + `scripts/build.sh` (WeasyPrint); cùng họ với các PDF review CloudGO|
|`last30days`|on-demand|research social recency (Reddit/X/YouTube/HN…)|
|`deep-research-web`|on-demand|chạy không cần MCP firecrawl/exa; tên `-web` để không che `deep-research` của ECC. Điều tra source-heavy → brief có citation + provenance (Feynman v0.5.58: plan 6 mục, scale 0-6 researcher, verifier rồi `research-reviewer` cho brief dẫn tới quyết định, PASS/PASS WITH NOTES/BLOCKED); `references/templates.md` (mẫu + từ vựng trạng thái), `references/large-sources.md` (đọc trọn nguồn lớn), `LICENSE-feynman.md`; cũng nằm trong kit Claude Code|
|`aup-audit`|on-demand|Usage Policy Anthropic + quy tắc 8 Sync: gitleaks cả history, file nhạy cảm, đường truy cập Claude, tính năng rủi ro (`RULES.md`); cũng nằm trong kit Claude Code|
|`research-paper`|on-demand|paper end-to-end: replicate · recipe · audit · draft|
|`autoresearch`|owner-only (`disable-model-invocation`)|vòng thử/đo/giữ-bỏ có giới hạn: Start card (target, bench, gate, scope, env, budget phút CI/USD), worktree `ar-<slug>`, patch thay commit, keep khi `delta% ≥ max(1%, 2·√((cv_best²+cv_cand²)/n))`, sát ngưỡng đo lại A/B, plateau/time/budget stop, file benchmark đóng băng, held-out A/B; state `outputs/autoresearch/<slug>/`|
|`remote-compute`|on-demand|chạy code ở Docker sandbox · Modal GPU · RunPod pod thay vì bare host|
|`encore-deploy`|tech-gated|deploy runbook — chỉ hiện khi project dùng Encore|
|`social-growth`|opt-in|social/branding/leads — bật bằng `8sync skill add builtin:social-growth`|

**External skill pack** (best-effort, `harness init` tự clone vào `~/.omp/skills/`): [`ponytail`](https://github.com/DietrichGebert/ponytail) (full: audit/debt/review/help). `addyosmani/agent-skills` không còn được kéo về — plugin ECC đã phủ. Offline thì skip; bundled vẫn đủ mạnh.

Master force-load file: `~/.omp/skills/00-force-load.md` — omp đọc đầu tiên mỗi session.

**`8sync skill add <https://github.com/owner/repo>`** clone vào `~/.omp/skills/<name>/` (global library của omp) — không copy vào repo. Repo chưa theo spec (không có `SKILL.md`)? 8sync tổng hợp `SKILL.md` từ README.

---

## 8. Quy ước contribute

- **Cite code**: `crates/cli/src/verbs/setup.rs:130` (single line), `crates/cli/src/models.rs:90-110` (range).
- **Không thêm dep nặng**: tránh `reqwest`; `tokio`/`axum` CHỈ cho `8sync harness web` (gated, xem `Cargo.toml` note). Phần khác dùng shell-out (`curl`, `systemctl`) thay vì re-implement.
- **Idempotent install**: mọi thao tác cài đặt trong `setup.rs`/`pkg.rs` phải an toàn khi chạy lần 2.
- **Default KHÔNG ĐÈ (invariant cho mọi verb)**: file user-owned (`su-code/*.md`, `CHANGELOG.md`, skill user tự viết trong `su-code/skills/`, `.claude/rules/ecc/<pack>` đã có, `AGENTS.md` ngoài sentinel, hooks, config key user đã set) → chỉ seed-if-missing hoặc update trong sentinel-block; đè thật CHỈ qua flag rõ ràng (`--force`). File managed (bundled `~/.omp/skills`, `00-force-load.md`, `APPEND_SYSTEM.md`, extensions) → refresh byte-compare khi binary update; user custom thì sửa bản project.
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
