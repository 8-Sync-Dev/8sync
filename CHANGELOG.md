# Changelog

Mọi thay đổi đáng kể của `8sync` ghi vào đây. Format theo [Keep a Changelog](https://keepachangelog.com),
versioning theo [SemVer](https://semver.org). **8sync rule:** mỗi PR cập nhật mục `Unreleased`.

## [Unreleased]

## [0.110.86] — 2026-10-27

### Added
- **`8sync ccc kit` bật plugin ECC trên mọi máy** (github.com/affaan-m/ECC, MIT: 71 agent, 311 skill, 97 command dưới namespace `ecc:*`). Owner (2026-10-27): "auto cài … vào harness liên tục", "sài mạnh cho claude code all máy tôi".
  - **Cập nhật liên tục:** kit ghi marketplace `ecc` với `autoUpdate: true` vào `extraKnownMarketplaces` và bật `ecc@ecc`. Mặc định Claude Code không tự cập nhật marketplace bên thứ ba; khi bật, nó tự kéo bản mới sau tin nhắn đầu và bản mới có hiệu lực từ lần mở sau. Máy mới cài plugin trong nền ngay phiên đầu.
  - **Hook ECC tắt** (`ECC_HOOKS_ENABLED=false` trong `env`): hook của ECC ghi mọi lệnh Bash ra `~/.claude/bash-commands.log`, chặn lần Edit đầu (làm kẹt `/ship-loop` và `/autopilot`), chạy formatter qua `npx` và `claude -p` để tóm tắt, và chạy code mới nhất của main chưa ai review trên mỗi tool call. Skill, agent và command của ECC vẫn dùng đủ.
  - **Giá trị của owner được giữ** (chỉ thêm, không ghi đè): đặt `"ecc@ecc": false`, `autoUpdate: false` hoặc `ECC_HOOKS_ENABLED=true` thì kit giữ nguyên.
  - Policy org (`strictKnownMarketplaces`) cho phép thêm `affaan-m/ECC`.

## [0.110.85] — 2026-10-27

### Added
- **`8sync harness browser ego [install|status]` cài trình duyệt ego lite chính thức** (citrolabs, https://lite.ego.app). Với ego lite, agent điều khiển chính trình duyệt đã đăng nhập của owner qua lệnh `ego-browser`, thay vì đi qua một Chromium riêng. Owner (2026-10-27): "harness nên cho ego-lite cài về window … làm control browser chuẩn hơn".
  - **Windows x64:** lấy link bộ cài từ README chính thức của citrolabs/ego-lite; nếu không đọc được README thì dùng link đã ghim. Chỉ nhận URL `cdn.ego.app/setup/windows/x64/`. Bộ cài được tải vào thư mục tạm riêng, và chỉ chạy khi chữ ký Authenticode là `Valid` và người ký là `CITRO LABS PTE. LIMITED`. Bản không ký chỉ chạy khi đặt `EIGHTSYNC_EGO_ALLOW_UNSIGNED=1`. Ký bởi bên khác hoặc chữ ký hỏng thì không bao giờ chạy.
  - **macOS:** in link `.dmg` chính thức. **Linux:** ego lite chưa có bản, nên vẫn dùng `8sync harness browser` (Chromium hệ thống).
  - **Skill không bị chép đôi:** lệnh `ego-browser` và skill `ego-browser` đều do app cài lúc onboarding, nên 8sync không ghi bản skill riêng. `status` cho biết hai thứ này đang nằm đâu, kể cả PATH mà terminal cũ chưa thấy.
- **`/autoresearch` thành skill riêng.** Trước đây nó chỉ là một mode của `research-paper`, và bản ở `~/.omp/skills/autoresearch` là cài tay với `references/` rỗng. Owner (2026-10-27): "enhance skills deep-research và auto research tham khảo feynman … phải mạnh nhất".
  - **Chỉ owner khởi động** (`disable-model-invocation`), vì đây là vòng lặp sửa code nhiều giờ.
  - **Start card trước baseline:** một `AskUserQuestion` gồm target, lệnh bench, correctness gate, scope + file đóng băng, environment và budget (phút CI/USD). Card này gộp gather, environment và confirm gate của Feynman v0.5.58.
  - **Không đụng checkout của owner:** chạy trong worktree riêng `ar-<slug>`, không commit trong vòng lặp. Mỗi iteration là một `iter-N.patch` + `best.patch`, revert bằng `git restore` trên đúng scope.
  - **Keep rule tính bằng %:** keep khi `delta% ≥ max(1%, 2·√((cv_best²+cv_cand²)/n))`. Kết quả sát ngưỡng được đo lại xen kẽ A/B. Vòng dừng khi plateau (5 lần không keep) hoặc hết giờ, iteration, phút CI hay USD. Trước khi nhận thắng phải qua held-out A/B.
  - **Ghi nhận đầy đủ:** ledger ghi mọi lần đo; báo cáo liệt kê mọi cấu hình; kết quả đưa vào code bằng một commit `perf(...)` qua `/ship`.
  - **Phân phối:** nằm trong `BUNDLED_SKILLS` và `su-code/skills.toml`, được deploy vào `~/.omp/skills/autoresearch` khi `8sync setup`, `harness init` hoặc mở `8sync ccc .` refresh bundled skills. `8sync ccc kit` link nó vào `~/.claude/skills` khi ở đó chưa có. Bản cài tay cũ ở `~/.omp/skills/autoresearch` (port Feynman, 2026-08) bị thay; nội dung gốc vẫn có ở repo Feynman.
- **Agent `research-reviewer`.** Đây là verification pass cho research brief: mở nguồn sau mỗi claim quyết định `(D)`, chấm FATAL/MAJOR/MINOR, tự ghi `-verification.md`, verdict `PASS | PASS WITH NOTES | FAIL (n FATAL)`. Agent `reviewer` (review diff) giữ nguyên, không phải ánh xạ rubric bằng tay nữa.

### Changed
- **`deep-research` v3**, theo Feynman v0.5.58 (`prompts/deepresearch.md`, `.feynman/SYSTEM.md`, `.feynman/agents/researcher.md`, `prompts/summarize.md`):
  - Plan đủ 6 mục: key questions, evidence, scale decision, task ledger, verification log, decision log.
  - Scale theo bảng, tối đa 6 researcher cả run và 4 chạy cùng lúc; mỗi researcher có brief file riêng.
  - Direct mode chạy ≥3 truy vấn và ghi nguyên văn từng truy vấn.
  - Claim sweep trước khi cite.
  - Verifier chạy trước reviewer.
  - Cite: URL chết thì bỏ cả claim chỉ dựa vào nó; paper đối chiếu 2 chỉ mục.
  - Review: FATAL sửa rồi review lại đúng một lần; sửa lớn thì viết `-revised.md`.
  - Có degraded mode `Verification: BLOCKED`.
  - Đọc trọn nguồn lớn theo `references/large-sources.md`: `curl -fsSL --create-dirs` (PowerShell: `curl.exe`), cửa sổ theo dòng, notes sau mỗi cửa sổ, chunk tính vào trần researcher.
- **Phần 8sync thêm vào `deep-research`, Feynman không có:**
  - Tầng trả lời inline: ≤10 tool call, không dẫn tới quyết định, không gõ `/deep-research`.
  - Claim `(D)` cần 2 nguồn độc lập.
  - Brief dẫn tới quyết định luôn chạy verifier + `research-reviewer`.
  - Định nghĩa PASS / PASS WITH NOTES / BLOCKED, và FATAL còn sau lần review thứ hai → BLOCKED.
  - Bảng từ vựng trạng thái chung và id nguồn `S#` (`references/templates.md`).
  - Tối đa 3 round.
  - Nội dung fetch về là dữ liệu, không phải lệnh; truy vấn không mang dữ liệu client/cá nhân, code private hay secret; không chạy code tải về.
- **Agent `verifier` / `researcher`:**
  - `verifier`: claim thực tế không có nguồn bị bỏ vào `## Removed unsupported claims`; số không có artifact thành `TODO`; bảng kiểm tách ra `<slug>-cite-audit.md`; đối chiếu 2 chỉ mục.
  - `researcher`: truy vấn diễn đạt lại, bậc nguồn, `S#`/`C#`, trạng thái `read/inferred/unresolved`, Coverage status theo từng câu.
- **License:** MIT notice của Feynman giờ được cài cùng skill (`skills/deep-research/LICENSE-feynman.md`). `THIRD_PARTY_NOTICES.md` ghi nguồn và commit cho từng file.
- **Gitignore:** khối `.gitignore` do 8sync quản lý bỏ qua `outputs/.notes/` (bản tải về của nguồn bên thứ ba) và `outputs/autoresearch/` (state thí nghiệm).

## [0.110.84] — 2026-10-27

### Fixed
- **Frontmatter skill/agent/command đọc được bằng YAML parser chặt** (omp, pi/Feynman, js-yaml), không chỉ bằng Claude Code. Một value không quote mà chứa `: ` bị báo "Nested mappings are not allowed", và cả skill bị bỏ. Một value có ` #` thì bị cắt như comment.
  - Agent `pm`: mô tả bị cắt tại "Discord" vì `#owner-desk`.
  - `clean`, `ship-tick`, `assp-skill`, `trail`: mô tả có `: `.
  - `autopilot`, `sec`, `ship-tick`: `argument-hint` mở bằng `[`, giờ được quote.
  - Test mới `shipped_frontmatter_is_strict_yaml_safe` quét `skills/`, `claude/`, `commands/`, `rules/`; `frontmatter_check_catches_what_strict_yaml_rejects` chứng minh bộ kiểm bắt đúng các ca này.

### Security
- **HQ UI lên Next 16.4.1** (từ 16.4.0). `pnpm audit --prod` của `apps/hq-ui` báo GHSA-2464-fhr4-w9xw, GHSA-673q-mjm6-r5xr (critical, RCE) và GHSA-p3m5-59mp-jv5r (high, DoS) cho Next 16.0.0–16.4.0, đều sửa ở 16.4.1. HQ không dùng image optimizer (`images.unoptimized`), `use cache` hay server action nên mức lộ thấp, nhưng `8sync hq ui --public` có thể đưa HQ ra internet và bản release đóng gói đúng Next đang khoá. `eslint-config-next` lên cùng bản; lockfile chỉ đổi các gói `next`, `@next/*`, `eslint-config-next`.

## [0.110.83] — 2026-10-27

### Added
- **Sắp xếp danh sách session: `--sort priority|time|name|status` và `-r`** trên `8sync ccc . ls`, `8sync . ls`, `8sync ls` và `8sync ls --all`. Owner (2026-10-27): "8sync . ls, 8sync ccc . ls chưa có sắp xếp theo time, priority".
  - **Thứ tự cũ:** `ccc . ls` mới nhất trước; `. ls` và `ls` theo thứ tự registry; `ls --all` xếp repo theo hoạt động mới nhất, còn session trong repo theo registry.
  - **Mặc định giờ là ưu tiên**, một thứ tự dùng chung (`session_view.rs` `SortKey` / `order`):
    1. ▲ high;
    2. ⚠ dừng vì lỗi API / hết usage;
    3. ◆ med;
    4. đang chạy;
    5. ▽ low;
    6. nghỉ.

    Cùng mức thì xếp theo trạng thái, rồi mới nhất, rồi tên, nên kết quả không còn phụ thuộc thứ tự registry.
  - **`ls --all`** xếp repo theo dòng đầu của nó (`--sort name` thì theo tên repo), và dạng compact có thêm một cột đánh dấu ▲ ◆ ▽ ⚠.
  - **`--json`** theo cùng thứ tự với bản in. Không nơi dùng nào phụ thuộc thứ tự dòng: HQ floor tự `sortFloor`, room-end tìm theo `id`. `ccc . report` giữ mới nhất trước.
  - **`Row` có thêm `urgency`**, lấy từ registry, nên `ls` / `ls --all` / HQ core cũng xếp được phòng cắm cờ lên đầu. JSON của `ls` không thêm trường mới; `ccc . ls --json` vẫn trả `urgency` như trước.
  - Phòng đang dừng vì lỗi có thêm dòng `⚠ stopped rate_limit · auto-resume in 12m` (hoặc `· needs you`).
  - Đo trên máy owner bằng bản 0.110.82 (trước thay đổi, best of 3): `ccc . ls` 71 ms, `ls --all` 215 ms với 120 session. Sắp theo ưu tiên chỉ đọc thêm bản ghi StopFailure nhỏ của mỗi phòng Claude Code.
  - `scripts/uat/ls-urgency.sh` kiểm thứ tự mới và kiểm `id`/`urgency` đi đúng với dòng của nó sau khi sắp. Script báo rõ "chỉ chạy trên Linux": registry đọc qua `dirs::config_dir()`, hàm này bỏ qua `XDG_CONFIG_HOME` trên Windows và macOS, nên bản cũ vốn đã fail ở hai nền tảng đó.

### Fixed
- **`stalled_error` không bao giờ hiện cho phòng Claude Code.** `stalled_error_in` chỉ nhận engine `"claude"`, nhưng mọi phòng Claude Code có tên đều là row `"ccc"` (`uuid_rows`). Vì vậy `ls --json` luôn trả `stalled_error: null`, và HQ không thấy phòng nào dừng vì lỗi API / hết usage. Giờ nhận cả `"ccc"`, có test. Một bản ghi cũ hơn hoạt động của chính phòng hơn 120 giây thì bỏ qua: phòng đã chạy tiếp bằng đường khác, nên không báo "stalled" sai.

## [0.110.82] — 2026-10-25

### Added
- **`8sync clean --dev` + skill `/clean`: dọn rác dev cho mọi dự án trên máy, trên cả ba OS.** Owner (2026-10-25): "auto clear rác sau ci local, train, finetune, pull image old rác không sài, model ai local không sài … all deep", "apply liền cho all dự án trong máy". Trước đây `8sync clean` chỉ chạy trên Linux. Giờ trên Windows/macOS `8sync clean` chính là bản dev, còn trên Linux thì thêm `--dev`.
  - **Dự án** = mọi `cwd` trong transcript Claude Code (`~/.claude/projects`) cộng các `--root`. Dry-run trên máy owner thấy 27 dự án.
  - **Tự xoá** (build hoặc tải lại được):
    - build output được git ignore của dự án nghỉ ≥ 14 ngày, tính theo commit cuối và transcript cuối;
    - `git worktree prune`;
    - Docker khi daemon đã chạy: container dừng > 24 giờ, image dangling, build cache > 7 ngày, image không container nào dùng > 30 ngày. Không đụng volume;
    - `uv cache prune`, `pnpm store prune`, `npm cache verify`; thêm `go clean -cache` và `pip cache purge` với `--deep`;
    - file tạm > 7 ngày;
    - bản tải dở của Hugging Face.
  - **Chỉ liệt kê cho owner chọn:**
    - model: Hugging Face qua `hf cache ls`, vì huggingface_hub 1.x để blob dùng chung trong `hub/blobs` (35 GB ở đó trên máy owner, trong khi thư mục từng repo trông như trống). Thêm Ollama, LM Studio, torch hub;
    - kết quả train ≥ 100 MB;
    - volume Docker ẩn danh không container nào dùng. `--forget docker-volumes` chạy `docker volume prune` không có `-a`: volume có tên, như DB dev `sqldb-*` của Encore, được giữ.

    Xoá một mục bằng `8sync clean --forget <id>` (`hf cache rm` / `ollama rm`).
  - **Không** xoá model theo "lần đọc cuối": một lần `hf cache ls` đã đặt mọi model về "28 seconds ago". Cũng không chạy `hf cache prune` tự động, vì nó xoá cả repo không có ref (như `bge-reranker-v2-m3` 2.3 GB).
  - Dry-run trên máy owner: 4.9 GB tự dọn được; 22.1 GB FLUX.2, 9.4 GB checkpoint và 95 volume Docker chờ owner chọn.
  - Skill `/clean` (kit, mọi dự án) và một dòng trong khối CLAUDE.md của kit: dọn ngay sau CI/build/train/pull, gom phần cần quyết vào một `AskUserQuestion`.

### Changed
- **Giữ thức tới khi tắt:** `8sync awake on`, công tắc "Giữ máy thức" của HQ và `8sync sleep work` giữ máy thức không hạn giờ, cho tới khi bấm tắt (`awake off` / `sleep off`). Owner (2026-10-25): "tắt mãi cho tới khi tôi bấm … tắt màn máy vẫn làm việc chứ không phải chỉ 8h".
  - Trước đây mặc định 8 giờ, tối đa 24 giờ, và `awake on` tự nhả khi hết phòng.
  - `--hours N` (bỏ trần 24 giờ) và `--while-rooms` vẫn dùng được nếu muốn tự nhả.
  - `ours.until = 0` nghĩa là không hạn; HQ hiện "Đang giữ tới khi anh tắt".

### Fixed
- **Scheduled Task trên Windows:**
  - Lịch ≥ 24 giờ giờ tạo bằng `/SC DAILY` (hoặc `HOURLY` khi chẵn giờ). `/SC MINUTE` chỉ nhận 1–1439 nên `--timer 24h` trước đây thất bại.
  - Task chạy qua `conhost --headless`, không bật cửa sổ console mỗi lần chạy.

## [0.110.81] — 2026-10-24

### Changed
- **STEP 0 đổi từ codegraph / codebase-memory-mcp / serena sang Trail-code (`trail`)** (owner: xem video Graft, nay là Trail-code, MIT: "xoá hẳn 3 tool cũ khỏi harness, thay bằng trail"). `trail ask|grep|skeleton|callers|map` là bản đồ code tree-sitter chạy local, không gọi model; `trail note` ghi bài học bền vào `.trail/learnings/`. Mọi chỗ sinh luật (khối `8sync:skills` trong AGENTS.md/CLAUDE.md/`.cursor`, `APPEND_SYSTEM.md`, `00-force-load.md`, rule TTSR `code-intel-first`, `bashInterceptor` trong `models.toml`, help, README, docs) giờ nói "trail trước, `Read` chỉ khi sắp sửa". Skill CORE `codegraph` → skill bundled mới `trail` (bundled 29 → 28 skill: bỏ `codegraph` và `token-bench`).
- `8sync harness` / `up` / `init` / `global` / `setup` / `doctor` / `toolstats` / `eval` / dashboard: bỏ hẳn cài đặt, đăng ký MCP, index và kiểm tra của codegraph, cbm, serena (`harness cbm|serena on|off`, `EIGHTSYNC_CBM`, `EIGHTSYNC_SERENA`, `ensure_serena_mcp`, `index_codebase_memory`, `mirror_mcp` của kit Claude Code, trang Codegraph của dashboard, route `/api/codegraph/*`). Cờ bật tắt chung của ccc (idle/delegate/fence/skill_libraries) tách ra `harness/features.rs`. `harness up` chạy `trail build`; `ccc policy --lock-mcp` không còn allowlist mặc định; phòng "lean" của ccc chỉ còn tắt plugin LSP; watchdog và pressure guard không còn tên riêng của 3 tool. Xoá submodule `reference/codebase-memory-mcp` và `.serena/`.
- **Cutover một lần khỏi codegraph / cbm / serena** (`harness/legacy.rs`, chạy trong `harness global` và cài kit Claude Code; idempotent, im lặng khi xong, backup `*.bak-trail` một lần): chỉ gỡ entry MCP `codebase-memory-mcp` / `serena` đúng launcher 8sync từng ghi (`~/.omp/agent/mcp.json`, user scope của `~/.claude.json` qua `claude mcp remove`) và rule allow `mcp__codebase_memory_mcp*` / `mcp__serena*` trong `~/.claude/settings.json`; gỡ skill `codegraph` + `token-bench` (global, link/copy ở `~/.claude/skills`, mirror `su-code/skills`) chỉ khi byte-giống bản bundled, và mục `[codegraph]`/`[token-bench]` trong `skills.toml`; chuyển 3 message mặc định của `bashInterceptor` trong `models.toml` sang lời trail (message chủ sửa thì giữ). Lean room, pressure guard và watchdog vẫn giữ tên 2 MCP cũ thêm một bản để chặn/dọn phần sót. Khối `.gitignore` do 8sync quản vẫn có `.codegraph/` cạnh `graft/`.
- `env_detect::cmd_version` tìm binary qua PATH/PATHEXT trước nên đọc được version của shim `.cmd` trên Windows (`trail`, `headroom`).

### Added
- **`8sync trail [dir|--all [ROOT]|status|off]`** (`verbs/harness/trail.rs`): tìm `trail` trên PATH, thiếu thì `npm install -g @trailhq/trail-code --ignore-scripts` (in lý do: grammar tree-sitter-kotlin không biên dịch được bằng node-gyp trên Node 26), chạy `trail telemetry disable` một lần và đặt `DO_NOT_TRACK=1` cho mọi lệnh `trail` con; nối repo bằng `trail init --agents claude --no-global --no-statusline --plain --yes` chỉ khi chưa có `.trail/hook.cjs` và `.claude/settings.json` không có thay đổi chưa commit, rồi thêm `graft/` vào `.gitignore` nếu thiếu (chỉ append). `--all ROOT` quét repo git sâu ≤ 3 (bỏ worktree, `node_modules`, `target`), in bảng trạng thái, `--dry-run` chỉ hỏi `trail init --dry-run` và không ghi gì. `harness`, `init`, `up`, `setup` dùng cùng module (cài + nối repo + `trail build`).

## [0.110.79] — 2026-10-24
### Added
- **`8sync mcp install --pc`: Claude Desktop điều khiển cả máy, có guard cứng** (owner: "claude desktop control all máy … an toàn sec cứng chỉ claude desktop được all quyền"). Thêm server MCP thứ hai `8sync-pc` (`8sync mcp serve --pc`, chỉ stdio, từ chối chạy khi stdin là terminal) với 4 tool: `pc_run` (PowerShell), `pc_read`, `pc_write`, `pc_list`. `pc_run` đi qua đúng guard lệnh phá dữ liệu của Claude Code (`ccc::guard_command`): xoá root/home/project, format đĩa, force-push bị từ chối; lệnh chỉ đáng ngờ trả `NEED_CONFIRM` và chỉ chạy khi gọi lại với `confirmed=true` sau khi owner đồng ý trong chat. Credential không tool nào chạm được: `.env*`, `.ssh`/`.aws`/`.gnupg`/`.kube`, khoá riêng, `Login Data`/`Cookies` của trình duyệt, file credential git/npm/omp/Claude, `*.pem|pfx|key|kdbx`. Mọi lệnh ghi vào `pc-audit.jsonl`; công tắc `8sync mcp pc on|off|status` tắt hết mà không sửa config của Claude Desktop; `8sync mcp uninstall` gỡ cả hai entry. Đăng nhập, mật khẩu, đổi cài đặt hệ thống/bảo mật vẫn là việc của owner.

## [0.110.78] — 2026-10-24
### Added
- **`8sync sleep work`** (= `8sync ccc sleep work`; owner: "màn hình tắt mà claude desktop vẫn làm việc an toàn … chỉ tỉnh khi tôi click chuột hoặc bấm phím, giống lock sleep"): giữ máy thức (hold không theo phòng, vì việc của Claude Desktop không hiện trong `claude agents`; hold `awake on` đang theo phòng được thay), đợi 1,5 s cho phím Enter nhả, khoá phiên (Windows `LockWorkStation` như Win+L; Linux `loginctl lock-session`; macOS `pmset displaysleepnow`) rồi tắt màn hình. Chạm chuột/phím là sáng lại (nhập mật khẩu), màn hình tự tắt lại sau 2 phút không ai đụng; mặc định 8 giờ (`--hours`, tối đa 24), `--no-lock`, máy Modern Standby không tự tắt màn hình trừ `--force`. `8sync sleep off` nhả, `8sync sleep status` xem. Gập nắp laptop thì máy vẫn ngủ. Test +1.
- **`8sync eco`** (= `8sync ccc eco`; owner: "đảm bảo harness giữ ram, cpu, điện, gpu luôn ổn định nhẹ làm việc lâu dài, in ra tôi xem hiện tại máy tôi dùng bao nhiêu"): `8sync eco` in máy đang dùng bao nhiêu (RAM, CPU, GPU util/VRAM/nhiệt/W, CPU W, pin, RAM của Claude Code và node); `--json` cho máy đọc. Guard của auto chỉ chạy khi auto lái dự án, nên phiên mở tay (`claude`, `8sync ccc . core`, tab Code của Claude Desktop) không được giữ nhẹ. Giờ một nhịp eco: mọi tiến trình phiên sinh ra (build, dev server, LSP, MCP) còn ở normal xuống below normal; chạy pin, bật tiết kiệm pin, hoặc RAM ≥ 80% / CPU ≥ 75% → Efficiency mode (Windows EcoQoS), hết thì trả lại đúng những tiến trình eco đã đặt; RAM chạm ngưỡng → trả working set của helper ≥ 200 MB (tối đa 10 phút một lần). Không kill, không pause (vẫn là việc của `auto guard`). Hot chỉ hết khi RAM và CPU đều xuống dưới ngưỡng 10 điểm (không bật/tắt liên tục khi build). `8sync eco install` chạy nền khi đăng nhập: Windows Scheduled Task đăng ký bằng PowerShell để chạy cả khi dùng pin, không bị dừng khi rút sạc, không giới hạn 72 giờ, ẩn cửa sổ; Linux systemd --user (Nice 15, CPUQuota 5%, MemoryMax 96M); macOS chỉ có xem (`8sync eco`), chưa chạy nền; `eco set ram|cpu <%>`, `eco set battery on|off`. Test +7.
- **`8sync mcp`: 8sync cho Claude Desktop, Cowork và Claude Code qua MCP.** `8sync mcp install` ghi `mcpServers.8sync` vào `claude_desktop_config.json` (giữ mọi server khác, backup `.bak-8sync`, file hỏng thì không đụng; `--claude-code` thêm user scope của Claude Code). Server stdio có tool `machine`, `sessions`, `board`, `queue`, `knowledge`, `report`, `kit` (đọc) và `queue_add`, `know_add` (ghi); chạy chính binary bằng argv trong repo có `.git`, timeout 60 s (kill cả cây tiến trình, không treo server), không đọc token hay secret; việc model thêm qua `queue_add` không được tính là lời của owner (`EIGHTSYNC_MCP`), nên không tự nhảy lên đầu hàng. Test +6.
### Changed
- Size gate ceiling 8000 → 8192 KiB (8,388,608 B): sleep/eco/mcp verbs took the CI musl asset to 8,251,728 B.
- **Plugin `8sync-kit` có hook an toàn** (`assets/claude/hooks/hooks.json`): người cài bằng `/plugin install` có guard (secret, lệnh phá huỷ), verify sau khi sửa, Stop gate, digest đầu phiên, resume note, cảnh báo watchdog. Mỗi hook gọi `8sync ccc hook plugin <tên>` (tìm binary trên PATH hoặc chỗ installer cài): không có `8sync` → thoát 0 ngay; guard có `onFailure: block` như bản của kit; `8sync ccc kit` đã đăng ký hook đó trong `settings.json` → im lặng, không chạy hai lần. Test +1.

## [0.110.77] — 2026-10-23
### Added
- **`8sync stop all`** (= `8sync ccc stop all`; owner: "nên có lệnh 8sync stop all để dừng all gồm cả ccc auto"): tắt auto + đội omp trước (không revive nào mở lại phòng), `auto down` ở mọi dự án auto biết (phòng Claude Code + omp, vòng loop, sprint), rồi dừng mọi phòng nền Claude Code còn sót. Phiên mở trong terminal của owner không bị đóng.

## [0.110.76] — 2026-10-23
### Fixed
- **Guard chỉ đúng app ăn RAM, không đổ cho WmiPrvSE nữa**: dòng "RAM: … app khác (Wmiprvse 12.5 GB …)" sai, WmiPrvSE thật chỉ giữ 98 MB. Claude Code mở daemon chạy session nền qua WMI nên mọi claude, node, trình duyệt dưới daemon bị tính cho WmiPrvSE. Giờ dừng ở WmiPrvSE như các tiến trình hệ thống khác, bộ nhớ ghi đúng tên app (Claude, Node…). Test +1.

## [0.110.75] — 2026-10-23
### Fixed
- **Phòng không còn chụp game 3D bằng CPU** (owner: "Fix cpu quá cao chưa", CPU 88–95% trong khi GPU RTX 3%): các phòng 3d-game tự viết `shot.sh` mở Edge headless với `--use-angle=swiftshader --enable-unsafe-swiftshader`, ép WebGL vẽ bằng CPU, nhiều phòng chụp cùng lúc. Mỗi trình duyệt chỉ sống vài chục giây nên luật dọn theo nhịp guard không bắt kịp. Giờ guard hook trên Windows chặn ngay lệnh và script có cờ swiftshader, chỉ cách dùng `8sync shot` hoặc `--use-angle=d3d11` (đo trên máy owner: 5,1 so với 9,0 giây CPU mỗi ảnh); file CI trong `.github/` giữ nguyên vì máy CI không có GPU. Test +1.
- **Card con của ý P0 cũng là P0** (owner: "Khẩn cấp không thấy ưu tiên làm gấp"): #163 là P0 nhưng 9 card con là P1/P2, builder làm việc khác trước. Giờ card tách từ ý gốc (`[#N] …`) nhận mức ưu tiên của ý gốc, và nâng ý gốc lên mức gấp hơn thì các card con đang mở lên theo (không bao giờ hạ). Test +1.

## [0.110.74] — 2026-10-23
### Fixed
- **Nút "Mở team" không còn báo "thư mục này không có trong HQ" với dự án ghim** (owner, HQ trên VPS: "Không mở được team 3d-game"): Rust ghi đường dẫn Windows dạng `\\?\C:\…` và trang gửi lại đúng dạng đó; `/api/team` chỉ bỏ tiền tố này ở danh sách dự án đã biết, không bỏ ở đường dẫn trang gửi, nên hai bên không khớp. Giờ bỏ ở cả hai phía. Test +1.

## [0.110.73] — 2026-10-23
### Changed
- **Đội mặc định trở lại Claude Code** (owner: "mặc định giờ claude … ccc chính chủ làm mặc định như cũ"), giữ số phòng mới: Thường 3 (lead, dev, qa), ⚡ Sấm Sét 5 (+ dev2, review). Dự án nhớ engine lần trước; `--omp` thêm đội omp, `--omp-only` chỉ đội omp; về lại Claude Code thì phòng omp của dự án đó dừng (mỗi phòng ~1,3 GB RAM). HQ nói đội mặc định là Claude Code.
- **Ship tốc độ cao chọn được thời gian, mặc định 30 phút** (trước: cố định 2 giờ): HQ hỏi 30 phút / 1 giờ / 2 giờ / 4 giờ, API chỉ nhận 4 giá trị đó; `auto ship-fast on` không `--hours` = 30 phút; Sấm Sét bật kèm sprint 30 phút (lease phòng vẫn 2 giờ). Test +3.
### Fixed
- **Phiên Claude mở tay "không xem được" trên HQ** (owner: "ccc mở không xem được"): phiên `core` mở trong cửa sổ terminal của anh (`kind: interactive`) bị HQ nối bằng `claude attach` → "No job matching" → báo đỏ "Phiên đã tắt hẳn" và đánh dấu kết thúc một phiên đang sống. Giờ HQ nhận ra phiên mở tay: nút ghi "Trả lời trong cửa sổ của anh", terminal/one-tap trả 409 kèm lời dặn, không bao giờ đánh dấu phiên đó kết thúc; chỉ phòng nền mới bị coi là chết khi attach báo không có job. Test +1.

## [0.110.72] — 2026-10-23
### Fixed
- **HQ: nút "Mở team" nằm ngay trong khung dự án trống** (owner: "không có nút mở team"; bản .71 vẽ nút ở khối thứ hai, dưới khung soạn tin nên không thấy): "Mở team (3 phòng: lead, dev, qa)" xanh, rồi "⚡ Sấm Sét (5 phòng)", rồi "Mở một session lẻ". Chế độ công ty nói đúng team chung đang chạy ở dự án nào (từ `team_roots`, trước đây liệt kê cả scope: "đang chạy ở 8sync-startup, agentic-cloudgo-v1, ide, su-code" trong khi chỉ ide có phòng).
- `auto status` nói đúng cách đội omp nhận việc (theo cột board, ≤ 1 lần/phút).

## [0.110.71] — 2026-10-23
### Changed
- **Đội mặc định là omp, 3 phòng; Sấm Sét 5 phòng** (owner: "1 team có 3, team sấm sét mới là 5 … all mặc định là omp"; máy lên CPU 94% với 7–13 phòng Claude Code mỗi team): `8sync ccc auto up` (HQ "Chạy") mở đội omp `omp-lead`, `omp-dev`, `omp-qa` trên model không phải Anthropic (`auto omp on --model zai/glm-5.3`), không mở phòng Claude Code; `--roles boost` (⚡ Sấm Sét) = lead, dev, dev2, qa, review (trước là 13); `--ccc` = đội Claude Code, `--omp` = cả hai. Chưa có model omp dùng được thì mở đội Claude Code và in rõ lý do. `auto revive` không hồi sinh phòng Claude Code cũ của đội omp, và tin lead/rd của revive (ship loop, ready cạn, hỏi Ship) vào inbox phòng omp. Đo trên máy owner: phòng omp lúc chờ 0% CPU nhưng mỗi phòng ~1,3 GB RAM (omp nạp ~8 MCP server mỗi phiên).
- **qa kiêm review khi không ai nhận**: đội 3 phòng không có phòng review, nên `auto claim` của phòng qa hết card qa thì nhận card review chưa ai giữ ≥ 10 phút và phòng đó chưa từng đụng (QA và review vẫn là hai phòng), kèm playbook review trong `hint`. Đội 5 phòng có reviewer nhận trước. Test +1.
- **Engine theo từng dự án** (`engines` trong auto.json + `auto status --json`): `auto up` không cờ giữ engine dự án đã chạy (đội `--ccc` mở lại vẫn là Claude Code), dự án mới thì omp; đổi một dự án sang omp dừng phòng Claude Code của chính nó trước, không đụng dự án khác; HQ quyết phòng `sweep` theo engine từng dự án. `auto omp off` trên máy chỉ có đội omp không bật lại đội Claude Code. "Tắt Sấm Sét" (`down --only dev2,review`) dừng cả `omp-dev2`/`omp-review` và trả card. Đội omp có card approved mà chưa có quyền tự merge: owner nhận một alert HQ (đội omp không hỏi được câu Ship). `auto up -h` in hướng dẫn thay vì tạo card "-h". Test +1.
- **HQ theo đội omp**: thẻ phòng omp hiện model đang chạy (`zai/glm-5.3` → `GLM-5.3`, chưa đặt → "omp mặc định"); badge "Đội omp" chỉ cho phòng `omp-<vai>` (phiên omp riêng như `core`, `team`, `vps` không còn bị gắn); số phòng Thường 3 / Sấm Sét 5 / đầy đủ 6 lấy từ một chỗ (`lib/team-size.ts`), "Tắt Sấm Sét" chỉ dừng dev2 + review; đội chỉ-omp không bị HQ tự thêm phòng Claude `sweep`.
- **HQ: nút "Mở team" có thật**: Văn phòng của dự án chưa có phòng giờ có "Mở team (3 phòng: lead, dev, qa)" và "⚡ Sấm Sét (5 phòng)" (trước đây chữ bảo bấm "Mở team" mà không có nút); chế độ công ty nói đúng team chung đang chạy ở dự án nào. Tab Sessions: vai đội còn thiếu được tô màu "nên mở", vai đã có mờ đi; có phiên trống đúng vai (vd `omp-lead` đang chờ) thì nút "Dùng phiên trống" lên trước "Start session" — `core`/tên tự đặt không bao giờ bị coi là đúng vai.
### Fixed
- **Phòng omp trong team board ngồi "Chờ card" mãi** (ide: 4 phòng omp chờ 15+ phút cạnh 17 card, chưa nhận prompt nào): `auto nudge` trước đây trả rỗng cho mọi team board (chỉ nhắc theo hàng đích). Giờ phòng omp có cột (lead/backlog, dev/ready, qa/qa, review/review) được nhắc khi cột có card cho nó: `auto claim --json --as omp-<vai>` rồi làm card theo playbook cột; nhắc lại sau 1 phút (≤ 30 lần/giờ) thay vì 10 phút, vì chỉ nhắc khi có việc. Test +1.
- **Card đã duyệt không còn nằm chờ khi hết lease**: merge nền (`auto revive`) trước đây chỉ chạy khi không có gate lease/usage, nên owner vắng quá 4 giờ thì card approved đứng yên dù quyền tự merge còn hạn. Merge chỉ là lệnh `gh`, không tốn token Claude: giờ nó chạy khi auto bật và dự án trong scope, vẫn cần quyền tự merge của owner + đúng SHA đã review.
- **Worktree card không còn chất đống** (platform: 102 thư mục cho 31 worktree, 73 thư mục mất `.git`, mỗi cái một `node_modules`): đóng card `done` mà worktree chỉ bẩn vì build (lockfile `pnpm install` viết lại, con trỏ submodule (sửa dở bên trong submodule thì giữ), `su-code/`, `qa/evidence/`, ảnh/log) thì gỡ `--force` (git còn từ chối worktree có submodule nếu thiếu cờ này); sửa dở file nguồn thì vẫn giữ. Mỗi lần đóng card xoá thêm tối đa 3 thư mục `card-*` mồ côi rồi `git worktree prune`. Test +1.
- **Đội omp không gọi PowerShell + WMI nữa** khi `up`/`down` (`Get-CimInstance Win32_Process` → danh sách tiến trình native như guard): bớt WmiPrvSE, và bỏ thêm một chuỗi PowerShell nhúng trong binary.
### Added
- **Ship: "Chỉ merge, tự merge 24h"**: lựa chọn thứ 4 trong câu hỏi Ship. Owner chọn thì merge các card đó và cho team tự merge card đủ cổng trong 24 giờ (mặc định vẫn 8 giờ). Thời hạn đọc từ chính nhãn owner chọn trong transcript, không từ file store. Test +1.
- **`8sync ccc auto omp on --hours 0.5..24`**: giờ riêng cho đội omp (model không phải Anthropic). Hết lease Claude vì owner vắng thì đội omp vẫn được nhắc việc tới hết số giờ owner đặt. Test +2 nhánh.

## [0.110.70] — 2026-10-22
### Fixed
- **Cột ready trống thì tự có người tách việc** (owner: "tăng tốc ship tốc độ cao mạnh hơn còn kém quá"; 3d-game: ready 0, building 0, 8 phòng build ngồi không gần một giờ): trước đây chỉ khi lead tự nhận card backlog mới có việc tách, mà lead đang trong lượt dài hoặc chờ cron 30 phút. Giờ `auto revive` (HQ gọi mỗi phút) thấy ready trống mà backlog còn card thì gửi ngay cho rd, ba và lead một dòng: tách card đầu hàng thành card con có AC + lệnh check và đưa vào ready lượt này. Mỗi dự án tối đa 15 phút một lần. Test +1.

## [0.110.69] — 2026-10-22
### Fixed
- **Guard tắt ngay trình duyệt của phòng ăn CPU khi máy quá ngưỡng** (owner: "cpu chạm 45% phải kill … fix triệt để"): một Edge headless của phòng QA vẽ WebGL bằng CPU, ăn 40% máy, CPU lên 94% dù ngưỡng 45%, mà guard chỉ hạ ưu tiên. Giờ khi CPU ≥ ngưỡng, trình duyệt nào do phòng mở ăn ≥ 15% máy bị tắt cả cây (phòng vẫn sống, lần chụp sau thử lại); trình duyệt của anh không bao giờ bị đụng. Test +1.
- **Dọn Chromium của `8sync shot` không qua WMI nữa**: luật mồ côi của v0.110.67/68 (#216, #217: wmic + taskkill) giờ đọc danh sách tiến trình native (8sync chủ đã chết mới dọn) thay cho WMI (`Get-CimInstance`/`wmic` liệt kê mọi tiến trình mỗi lần chụp); HQ không còn chạy PowerShell/WMI mỗi phút, việc dọn nằm trong `8sync ccc auto revive`. Đã chạy thật trên Windows: hai lần chụp cách 0,1 s đều ra ảnh, Chromium mồ côi bị dọn. Test +1.
- **"⚡ Làm ngay" trên card backlog có người nhận ngay** (owner 2026-10-22, 3d-game: "bấm khẩn cấp gấp đợi lâu kinh khủng không ai làm"): card backlog/blocked chỉ gọi lead/ba; lead đang trong một goal dài, không có ba, `rd` ngồi rảnh, card P0 nằm im. Giờ nút gọi thêm `rd` (R&D) làm thay lead: viết AC + lệnh check, tách card con, `auto move <id> ready` ngay lượt này; lead vẫn nhận tin. Card ở cột khác không đổi. Test +1.
- **Máy bớt nặng tận gốc: guard không còn gọi WMI** (owner: "fix tận gốc … ram, cpu"): mỗi nhịp guard của mỗi dự án chạy `Get-CimInstance Win32_Process` kèm command line qua PowerShell; trên máy owner WmiPrvSE phình tới 12,7 GB RAM và 22% CPU. Giờ 8sync liệt kê process bằng Win32 API trực tiếp (ToolHelp, GetProcessTimes, bộ nhớ, NtQueryInformationProcess cho command line): khoảng 0,1 giây, không qua WMI. WMI chỉ còn là đường dự phòng khi cách mới trả rỗng. Test Windows thật +1.
- **Terminal phòng qua web VPS không còn bỏ cuộc sau 3 giây** (owner: "Fail connect terminal rất nhiều"): trang hiện "đang nối" và thử lại giãn dần (0,6 → 5 giây) suốt một phút; lỗi từ chối vẫn báo ngay.
- **Câu hỏi 5 lựa chọn trong terminal không còn bị cắt còn 3**: terminal xin ít nhất 22 dòng và không thu nhỏ khi bàn phím điện thoại mở. Test +2.
- **Dự án ghim hoặc trong scope mà 0 phòng vẫn có nút "Mở team"** (owner, ide: "mất nút mở lại team"): Văn phòng của dự án đang chọn hiện nút mở team dù dự án chỉ được ghim; `POST /api/team` nhận cả dự án ghim và dự án trong scope/team của auto. Test +1.
### Changed
- **Văn phòng 3D đẹp và dễ đọc hơn** (owner: "qúa xấu fix gấp đi"): phòng có tường, cửa sổ, sàn gỗ, bàn sáng màu, bóng mềm dưới bàn ghế; áo theo vai trò (lead xanh dương, dev xanh ngọc, qa cam, review đỏ, rd ô liu, ui tím); trạng thái hiện ở vòng sáng dưới ghế, màn hình và chấm trên bảng tên; bảng tên nhỏ gọn, đọc rõ ở cả nền sáng và tối, không che người. Test +1.
- **Nút tăng tốc ngay ở Tổng quan từng dự án**: "Ship card approved" và "Thao tác team" (Ship tốc độ cao, Sấm Sét, mở lại, dọn…) ở đầu mỗi khối dự án, đúng dự án đó.

## [0.110.68] — 2026-10-22
### Fixed
- **v0.110.67 bị Windows Defender đỏ mừ trực tiếp** (chuỗi `powershell -Command … Stop-Process` nhúng trong binary → heuristic dropper: mọi máy Windows `8sync up` lên .67 bị quarantine mất exe — máy owner chết lệnh `8sync` hoàn toàn tối 22/10). Sweep zombie giờ dùng WMIC CSV + `taskkill` theo pid mồ côi (cha đã chết) — binary mới qua Defender (hash + chạy OK), logic tách hàm thuần `orphan_pids` + unit test: shot sống không bị đụng, mồ côi chết.
## [0.110.67] — 2026-10-22
### Fixed
- **Sweep zombie của `shot` giết nhầm shot chạy song song** (v0.110.64/.65 khớp mọi chromium `8sync-shot-*` → 2 phòng shot cùng lúc giết nhau, card #184/#185 "8sync shot fails on all WebGL pages" thiếu bằng chứng QA): giờ chỉ kill chromium mồ côi THẬT — pid cha đã chết (8sync chết giữa render). Shot sống (bất kỳ tuổi, kể cả song song) không bao giờ bị đụng. HQ auto-tick dùng cùng luật mồ côi.
## [0.110.66] — 2026-10-22
### Fixed
- **Critic sweep đụng phòng của dự án KHÔNG chạy auto** (owner: "không gửi nhầm inbox các dự án không phải chế độ 8sync ccc auto"): `sweepStuckAsks` quét mọi phòng trên máy rồi nhắn tin + đóng dialog hỏi — giờ lọc đúng `inAutoScope` + bỏ dự án bị ghim nghỉ, cùng luật với auto-tick. Rust (`ccc msg`, ship-fast/loop, relay_stuck) đã root-scope sẵn, không đổi.
## [0.110.65] — 2026-10-22
### Fixed
- **Sweep zombie của `8sync shot` match 0 tiến trình** (v0.110.64): PowerShell parse `-not $_.CommandLine -like '*x*'` thành `(-not $x) -like` → luôn false; thêm ngoesi `( ... -like ... )` để lọc đúng.
## [0.110.64] — 2026-10-22
### Fixed
- **`8sync shot` để lại Chromium zombie ăn GPU hàng giờ** (máy anh 2026-10-22: 47% GPU / ~85 W chỉ vì 1 renderer headless kẹt — guard siết RAM giết phòng giữa lúc shot, chromium con sống sót): mỗi lần `shot` chạy nó quét và kill mọi chromium `8sync-shot-*` mồ côi (của lần chạy trước), và HQ auto-tick mỗi phút quét chromium `8sync-shot-*` già hơn 10 phút (shot sống không bao giờ già thế). Điện máy về ~100 W khi không render.
## [0.110.63] — 2026-10-22
### Changed
- **Preview ưu tiên kết quả xem được** (owner 2026-10-22: "Tab preview rất quan trọng việc xem ảnh, xem video demo nếu có, link demo thật mà các task không có ảnh không có gì xem được không nên hiển thị"): Preview về lại thanh tab chính (cạnh Board). Card không có ảnh, video hay link demo không hiện nữa. Video demo (`.mp4`, `.webm`, tới 60 MB) trong các thư mục evidence hiện cạnh ảnh và mở ra là phát được. Link demo thật trong ghi chú card (http/https, trừ GitHub vì PR đã có chip riêng) thành nút "Mở demo · <host>". Test +2.

## [0.110.62] — 2026-10-22
### Changed
- **Văn phòng 3D giống văn phòng thật** (owner 2026-10-22: "3d phòng chưa đẹp quá xấu chưa realistic"): trước mỗi phòng là một hộp và một khối viên nang. Giờ mỗi phòng là một chỗ làm: bàn mặt mỏng bốn chân, màn hình sáng theo trạng thái (xanh khi làm, cam khi chờ anh), bàn phím, cốc, ghế xoay, thảm; người ngồi ghế với đầu, tóc, tay, chân, áo mang màu trạng thái. Ánh sáng filmic (ACES) và bóng mềm, cây xanh ở góc mỗi khu dự án, camera gần hơn. Chuyển động một ngày làm việc: phòng đang làm gõ phím, phòng chờ anh giơ tay vẫy, phòng kẹt ôm đầu, phòng rảnh ngả lưng; tắt khi `prefers-reduced-motion`. Không thêm asset hay thư viện. Kiểm bằng ảnh chụp WebGL headless của chính component, cả nền tối và sáng.

## [0.110.61] — 2026-10-22
### Fixed
- **Terminal của phòng chết nói đúng sự thật** (owner: phòng su-code "đang mở mà không mở được" — `claude attach` in "No job matching" rồi tắt, HQ vẫn ghi "Đã rời phòng (phòng vẫn chạy nền)" và khoá ô gõ): server giờ nhận biết dấu hiệu đó, khung terminal hiện "Phiên đã tắt hẳn trên máy — phòng không còn chạy nền" (chấm đỏ) thay vì câu an ủi sai, và phòng ma đó được ghi `ended` ngay khỏi danh sách đang chạy — sidebar không còn card "Đang làm" của session đã chết.
- **Dọn rác idle đóng góp "83 trạng thái team cũ"**: file status `8sync ccc hook idle` cũ quá 6 giờ bị xoá khi HQ đọc (room còn sống sẽ tự ghi lại); record `noTick` (cron/events) sống qua 7 ngày rồi mới xoá. Trên máy anh: 85/91 file là rác vài ngày tuổi — sẽ biến sau lần mở HQ đầu tiên.
## [0.110.59] — 2026-10-22
### Added
- **Nút "+ Dự án": tạo dự án mới và giao spec ngay** (owner 2026-10-22: "không có nút tạo dự án … tạo xong giao spec mới để làm"): ô đường dẫn cuối sidebar thay bằng một nút mở hộp thoại gồm thư mục và việc đầu tiên. Thư mục có sẵn thì HQ thêm vào; chưa có thì HQ tạo (kèm `git init`; chỉ dưới thư mục cha có thật, không ở gốc ổ đĩa, không đè thư mục đã có file). Có spec thì team mở luôn với spec làm card đầu tiên (`auto up "<spec>"`, card vào board trước khi phòng nào chạy). Thư mục Claude Code chưa tin thì HQ nói rõ bước còn lại (chạy `claude` ở đó một lần, chọn Yes, rồi "Mở team"); spec vẫn nằm trên Board. API: `POST /api/projects {path, create: true}`, `POST /api/team {…, task}`. Test +2.
### Changed
- **Thanh tab còn 4** (owner: "nhiều chữ nhiều tab đang bị rối"): Tổng quan, Văn phòng, Board, Chat; "Chat phòng" chỉ hiện khi đang mở một phòng; Tri thức vào menu "Thêm". Không tab nào mất.

## [0.110.58] — 2026-10-22
### Fixed
- **Mở session Claude từ HQ trên Windows** (owner 2026-10-22: "terminal claude không mở được ở dự án su-code"): HQ mở session bằng tmux, mà Windows không có tmux nên lần nào cũng lỗi. Giờ máy không có tmux thì HQ mở session nền của Claude Code như một phòng của team (`claude --bg --name <tên> --permission-mode auto`); `claude agents` thấy nó và terminal của HQ attach được. Thư mục Claude Code chưa tin thì HQ báo đúng câu của Claude ("Workspace not trusted…"). Đã thử thật: mở session nền trong su-code, `claude agents` liệt kê, rồi dừng và xoá. Test +1.
- **"Dự án trên máy" đủ dự án** (owner: "thiếu dự án quá nhiều"): trước chỉ có repo 8sync từng thấy. Giờ thêm thư mục Claude Code đã tin (chỉ đọc đường dẫn trong `~/.claude.json`) và quét repo dưới thư mục cha của các repo đã biết (sâu 4 cấp, có repo lồng nhau, bỏ node_modules/target/thư mục ẩn, không quét cả ổ hay cả thư mục home; cache 5 phút). Trên máy owner: từ 8 lên khoảng 30 repo. Danh sách dài thì tự gập. Test +2.
- **Bấm "Mở" một dự án là mở đúng dự án đó** (owner: "mở cũng không được"): trước HQ chỉ chuyển sang Văn phòng với mọi dự án nên trông như không có gì xảy ra. Giờ Văn phòng lọc đúng dự án vừa mở, với nút "Mở team" của nó.
### Changed
- **Tri thức gom một chỗ** (owner: "Tri thức là gom all mà sao ui phân chia"): bỏ ba khối Công ty / Dự án này / Dự án khác. Giờ là một danh sách bài học của mọi dự án, mới nhất trước, mỗi dòng có nhãn dự án (Công ty nổi màu riêng); chip lọc theo dự án và ô tìm theo chữ, phòng, dự án. Test +2.
### Added
- **Nút "Xoá session rác" ở tab Sessions** (owner: "tab session nên có nút xoá session rác"): xoá khỏi danh sách mọi session đã dừng (không còn trong tmux hay `claude agents`); session đang chạy và tin nhắn cũ giữ nguyên. Không xoá gì khi `claude agents` không trả lời. API `DELETE /api/sessions`. Test +2.

## [0.110.57] — 2026-10-22
### Changed
- **Văn phòng gọn hơn: mỗi dự án còn 2 nút** (owner 2026-10-22: "ui ux khó hiểu"): đầu mỗi khối dự án từng có 7 nút (Ship tốc độ cao, Ship card approved, Sấm Sét, Mở lại team, Dọn & mở lại, Team đầy đủ, Dừng team). Giờ chỉ còn "Ship card approved" và "Thao tác team"; bấm "Thao tác team" thì hiện đủ các nút kia, hộp xác nhận như cũ. Sấm Sét đang chạy (13 phòng, tốn quota gấp ~13 lần) luôn hiện, không bị gập. Kiểm bằng ảnh chụp headless của Văn phòng thật.

## [0.110.56] — 2026-10-22
### Fixed
- **Terminal phòng trên web VPS không còn chết giữa chừng** (owner 2026-10-22: "terminal hq ui ovh web không mở được"): qua tunnel ssh, stream của terminal bị cắt sau vài byte thì trang báo "Không nối được" và đứng luôn. Giờ trang ở máy khác (không phải loopback) chuyển sang poll, có thử lại khi tunnel chập chờn; lỗi từ chối (không có phòng, sai token) vẫn báo ngay. Logic thuần `afterStream` có test.
- **Mở dự án ở chế độ công ty** (owner: "mở dự án lên tiếp tục làm ở hq ui không được"): "Mở team" ở repo thứ hai chỉ đưa repo vào công ty, không mở phòng, mà HQ vẫn để repo ở "Dự án chưa có team" với nút "Mở team" như chưa làm gì. Giờ khi công ty bật: nút là "Đưa vào công ty" và giải thích không mở thêm phòng; repo đã thuộc công ty rời khỏi danh sách đó và hiện trong mục "Công ty · N dự án" của sidebar ngay cả khi chưa có board; mở một dự án chưa ai làm thì Tổng quan nói rõ "thêm card ở Board, phòng rảnh của công ty sẽ nhận" kèm nút mở Board; Văn phòng trống nói đúng chế độ công ty. HQ đọc scope công ty từ `auto status` (`repos` trừ `out`). Test +2.
- **Tab Sessions bớt rác** (owner: "chưa xoá session cũ rác dư thừa quá nhiều"): session đã dừng gập lại sau nút "Hiện session đã dừng (N)", phòng đang chạy ở trên. HQ xoá dòng journal của session đã mất và không động tới hơn 3 ngày (tin nhắn giữ nguyên); không xoá gì khi `claude agents` không trả lời. Test +2.
- **Ingest trên Windows**: file id NTFS lớn hơn 2^53 làm node:sqlite ném RangeError và HQ ngừng đọc journal (test ingest đỏ ngẫu nhiên trên Windows). HQ giờ lưu 48 bit thấp của inode (bigint stat) dưới khoá mới, không so với giá trị cũ. Test +1.
### Changed
- Docs cho cộng đồng: README, `docs/huong-dan.md`, `docs/hq.md`, `docs/known-issues.md`, `COMMERCIAL.md`, `scripts/uat/README.md` viết lại câu chữ gọn kiểu engineer (bỏ bold trang trí, emoji ở heading, gạch dài trong câu). Sửa số liệu cho khớp code: team mặc định là `lead,dev,qa,review,rd`, `--roles` tối đa 14 phòng, `--roles boost` mở 13 phòng (quota khoảng 13 lần một phiên), danh sách Stage A/B của `8sync setup` khớp `8sync setup -h`. Bản hướng dẫn tiếng Việt gọi người đọc là "bạn"; nhãn UI giữ nguyên.

## [0.110.55] — 2026-10-22
### Fixed
- **Sidebar công ty: phòng rảnh không còn gắn tên dự án**: phòng chưa giữ card (lead, ba, dev đang "Chờ card") trước hiện tên repo nó chạy, như thể đang làm dự án đó. Giờ chỉ phòng đang giữ card mới có tên dự án bên cạnh; phòng rảnh là của cả công ty. Thấy khi chụp sidebar thật bằng Edge headless.
- **Sidebar công ty: danh sách dự án lên trên danh sách phòng**: với 18 phòng, mục dự án bị đẩy khỏi màn hình điện thoại. Giờ vài dòng dự án (số người, số card, chờ anh) đứng đầu, phòng ở dưới.

## [0.110.54] — 2026-10-22
### Changed
- **Văn phòng và Tổng quan theo chế độ công ty** (owner 2026-10-22: một công ty nhiều dự án): khi `auto company on`, phòng đang giữ card của dự án khác hiện ở khối của dự án đó (không còn nằm ở thư mục nó chạy), và roster thấy đúng card nó đang làm thay vì "Chờ card". Phòng chưa có card ở nguyên dự án nhà. Tắt chế độ công ty thì như cũ. Logic thuần `companyRooms` có test.

## [0.110.53] — 2026-10-22
### Changed
- **HQ sidebar ở chế độ công ty: một team, nhiều dự án** (owner 2026-10-22: "1 cty cân all dự án tiết kiệm session claude chứ không phải mỗi dự án là mở full rooms"): khi `auto company on`, sidebar không còn xếp phòng dưới từng thư mục dự án. Mục "Phòng của công ty" liệt kê mỗi phòng một lần, chữ nhỏ bên cạnh là dự án phòng đang làm (theo card nó giữ, kể cả card ở repo khác). Mục "Công ty · N dự án" liệt kê từng dự án với số người đang làm ("1 người", "chưa ai"), số card mở và số phòng chờ anh; dự án ghim lên đầu. Ô thêm repo đổi thành "Thêm dự án cho công ty": công ty nhận card ở đó bằng phòng sẵn có, không mở thêm phòng. Tắt chế độ công ty thì sidebar như cũ. Logic thuần `companySidebar` có test 2.

## [0.110.52] — 2026-10-22
### Added
- **Văn phòng 3D: card bay giữa các bàn khi đổi tay** (owner: "ui ux strong realistic working day"): card một phòng vừa giao (dev → qa → review) bay theo đường vòng cung từ bàn cũ sang bàn mới trong 1,2 giây rồi biến mất; card mới nhận từ board hay trả về board không bay. Tắt khi `prefers-reduced-motion`. Logic thuần (`handoffs`, `flightPoint`) có test 2.

## [0.110.51] — 2026-10-22
### Changed
- **HQ: thanh tab gọn còn 6 + "Thêm"** (owner 2026-10-22: "ui ux loạn quá"): 14 tab không vừa một hàng, trên điện thoại phải cuộn ngang. Thanh tab giữ 6 tab dùng hằng ngày (Tổng quan, Văn phòng, Board, Chat tổng, Chat phòng, Tri thức); 8 tab còn lại (Văn phòng 3D, Preview, Flow, Báo cáo, Hạn mức, Máy, Sessions, Activity) nằm trong menu "Thêm", nút đổi tên thành tab đang mở và có gạch chân như tab thường; chấm "cần anh" của Sessions hiện trên nút. Test tabs 2.

## [0.110.50] — 2026-10-22
### Added
- **`8sync ccc auto board --all`: lead của công ty nhìn board mọi dự án** (owner 2026-10-22: một công ty nhiều dự án): in board từng dự án trong scope của auto, dự án hiện tại trước, mỗi board có tiêu đề root; `--json` trả `boards[]` (mỗi phần tử có `root`); `lint` theo từng dự án. Không `--all` thì như cũ. Test auto +1.
### Changed
- Size gate: trần binary linux musl 7936 → 7968 KiB, có ghi nguồn tăng trong `scripts/size-gate.sh` (company/board --all, company_host, know, infer_pr, pressure floor: asset CI 8.128.816 B, vượt 2.352 B); không thêm dependency.

## [0.110.49] — 2026-10-22
### Added
- **Sổ tri thức công ty: `8sync ccc know add --shared "<bài học>"`** (owner 2026-10-22: "cây tri thức liên tục all in 1, hiểu biết rộng, tận dụng kinh nghiệm lẫn nhau, không nhầm lẫn"): một sổ `Công ty` cho bài học đúng với MỌI dự án, mọi phòng đọc đầu tiên ở SessionStart (5 dòng cuối), rồi mới tới sổ dự án mình và 3 dòng cuối của từng dự án khác dưới root của nó; `know ls` in sổ công ty trước, `--json` thêm `shared`; tab Tri thức trên HQ có khối "Công ty" trên cùng. `--shared` và `--repo` không đi cùng. `/remember` ghi rõ khi nào dùng `--shared`. Test know (cả hai bên).

## [0.110.48] — 2026-10-22
### Changed
- **Một công ty, nhiều dự án: `auto up` không mở đội thứ hai nữa** (owner 2026-10-22: "ý tôi là 1 công ty là rooms roles làm nhiều dự án… chứ ui ux vẫn mỗi folder dự án 1 công ty"). Khi `company` đang bật (`auto company on` hoặc `auto up --company`) và đội đã chạy ở repo khác, `auto up` (kể cả nút "Mở team" trên HQ) ở repo này chỉ đưa repo vào scope của auto, ghi `.claude/loop.md`, thêm card đầu nếu có, và báo "đội chung ở <host> nhận card tại đây"; không mở phòng, không ghi team-root (revive không mở phòng ở đó). Đội chung lấy card qua `claim`/`wait` liên dự án (bản .40). Muốn đội riêng cho một repo: `auto company off` rồi `auto up`. `--add` không đổi. Test team +1 (30).

## [0.110.47] — 2026-10-22
### Added
- **Sidebar HQ: mục "Dự án trên máy"** (owner 2026-10-22: "nên có chỗ hiển thị all dự án trong máy để bấm mở"): mọi repo 8sync từng thấy trên máy (scope auto, team roots, dự án đã đóng, ghim, thư mục của các phiên HQ ghi nhận) mà chưa thêm vào HQ và chưa có phòng, mỗi dòng một nút Mở: thêm vào HQ rồi mở Văn phòng để bấm "Mở team"; không còn phải gõ đường dẫn. `/api/projects` thêm `known` (chỉ thư mục còn tồn tại). Test known-projects 1.

## [0.110.46] — 2026-10-22
### Added
- **Tab 3D: biển tên trên mỗi bàn** (tiếp .43; owner: "ui ux strong realistic working day"): sprite 2 dòng trên bàn ghi tên phòng và card đang giữ (`#12 · qa`), không có card thì "đang làm / chờ anh / kẹt / rảnh" (dòng hai màu cam khi chờ anh); tooltip rê chuột thêm tiêu đề card. Canvas texture 256×96, không tải font, không thêm dependency. Test office-3d +1.

## [0.110.45] — 2026-10-22
### Changed
- **Sidebar HQ: nhóm "Công ty"** (tiếp .40/.44): khi `auto company on`, tiêu đề danh sách dự án ở sidebar đổi từ "Dự án" thành "Công ty · N dự án" (tooltip giải thích một team làm mọi dự án); `/api/office` thêm `company` từ lần đọc `auto status` gần nhất. Test sidebar +1.
- **hq-ui: `shadcn` (CLI thêm component, không import lúc chạy) chuyển sang devDependencies và lên 4.22.1**: `pnpm audit --prod` hết advisory `braces` (GHSA-vfj7-8cjw-p6xm, không có bản vá upstream) vì CLI không còn nằm trong cây production.

## [0.110.44] — 2026-10-22
### Added
- **Công tắc "Công ty" trên HQ + `8sync ccc auto company on|off`** (tiếp bản .40, owner 2026-10-22: "1 cty rooms/roles agent nhận nhiều dự án"): nút cạnh "Critic trả lời ngay" ở Văn phòng bật/tắt chế độ một team làm mọi dự án trong scope; dòng trạng thái auto ghi "Công ty: một team, mọi dự án"; `auto status --json` có `company` (8sync cũ hơn không hiện nút). Test auto-ui +1.

## [0.110.43] — 2026-10-22
### Added
- **HQ tab "3D": văn phòng WebGL** (owner 2026-10-22: "ui ux … 3d nhanh nhẹ đẹp"; quyết định 2026-10-22: WebGL/three trong HQ hiện tại trước, Rust/Tauri native để sau). Mỗi dự án một sàn, mỗi phòng một bàn + một nhân vật tô màu theo trạng thái (Chờ anh = cam và thở nhẹ, đang làm = xanh và gật nhẹ, rảnh = xám); rê chuột hiện tên/dự án/trạng thái, bấm mở phòng; chọn dự án ở sidebar thì chỉ sàn đó. Nhẹ: three.js nạp động khi mở tab (đo trên bundle phát hành 0.110.45: chunk riêng 737 KB raw / 184 KB gzip, chunk app chính không chứa thư viện), không bóng, không post-processing, `powerPreference: low-power`, vòng vẽ chỉ chạy khi tab mở, `prefers-reduced-motion` tắt cử động; chân tab in số đo thật (số phòng, draw call, ms/khung). Layout thuần (`lib/office-3d.ts`) có test 2.

## [0.110.42] — 2026-10-22
### Added
- **Cây tri thức chung của máy: `8sync ccc know add "<bài học>" [--repo <root>]` · `know ls [--all] [--json]`** (owner 2026-10-22: "agent tự biết dự án nào, ghi lại vào cây tri thức chung không bị nhầm lẫn tri thức nhưng vẫn đọc của nhau được để học hỏi"; mô hình theo omp `memory.scoping: per-project-tagged`). Mỗi repo một file `~/.local/state/8sync/ccc/know/<repo>-<hash>.md` (dòng đầu `# <root>`, rồi `- <ngày> [<phòng>] <bài học>`); SessionStart nạp bài học của dự án này trước (10 dòng cuối) rồi 3 dòng cuối của từng dự án khác dưới tiêu đề root của nó (≤ 1.500 ký tự, "đọc để học, không áp dụng mù"), nên phòng không lẫn tri thức của repo khác. `su-code/KNOWLEDGE.md` vẫn là memory commit của repo; skill `/remember` thêm bước ghi `know add` cho bài học dùng được ở mọi dự án. Test know 1, help 6, session-start 29.
- **HQ tab "Tri thức"**: cây tri thức của máy theo dự án đang chọn (bài học của dự án này trước, rồi từng dự án khác dưới root của nó, mới nhất trên cùng), nút Tải lại; `/api/know?root=` chạy `8sync ccc know ls --json --all` trong dự án có phòng đang chạy; 8sync cũ → báo thiếu `ccc know`. Test know (hq-ui) 2.

## [0.110.41] — 2026-10-22
### Fixed
- **`auto merge` không kẹt cả board vì một card chờ Ship** (owner: "bị kẹt hoài vậy auto ship chứ"; live zus/ide: 19/27 card approved có PR đã merge từ hôm trước nhưng card ngồi yên vì 8 card không merge được làm cả lệnh dừng): chưa có quyền tự merge, `auto merge` vẫn land những việc không cần quyền — PR đã merge → card done, conflict/base sai → về ready/review — rồi MỚI hỏi owner MỘT câu Ship cho đúng những card cần `gh pr merge` thật (hoặc chưa có PR). Không bao giờ tự merge khi chưa có quyền.

## [0.110.40] — 2026-10-22
### Added
- **Một team cho nhiều dự án: `8sync ccc auto up --company` / `auto on --company`** (owner 2026-10-22: "1 cty rooms/roles agent nhận nhiều dự án … chứ hiện tại mỗi dự án 1 hạm đội riêng"; đo 2026-10-22: 17 phòng rảnh giữ 9,4 GB cho hai dự án). Cờ `company` trong auto.json (giữ qua on/off/pause như `teams`): phòng hết card ở dự án mình thì `auto claim` lấy card gấp nhất (P0 trước, rồi thứ tự scope) ở dự án khác trong scope của auto, `auto wait` thức dậy khi dự án khác có card; card về kèm `root` và hướng dẫn `env -C <root> 8sync ccc auto … --as <phòng>` (board, inbox, grant vẫn theo từng repo; dự án bị pin bằng lease vẫn bị bỏ qua). `auto status --json` thêm `company`. Test auto +1 (round trip, chọn theo prio, bỏ qua dự án pin/không board), wait +2 (card dự án khác, dự án mình ưu tiên). HQ nhóm "Công ty" sẽ ở bản sau.
- **Nút "Ship tất cả" / "Duyệt tất cả" trên cột Approved của Board** (owner 2026-10-22: "kẹt suốt vậy auto ship mà nên có thêm nút ở ví dụ ship all": 21 card approved nằm sau một câu Ship chưa ai bấm). Có câu Ship của lead đang chờ → nút ghi "Duyệt tất cả", một chạm trả lời đúng option đó (như khung Anh cần trả lời; màn hình đổi thì báo mở khung đó); chưa có câu nào → "Ship tất cả" nhắc lead hỏi Ship ngay lượt này (`auto ship-fast ship-ask`) và nút đổi thành "Duyệt tất cả" khi câu hỏi hiện. Test ship-all 2.

## [0.110.39] — 2026-10-22
### Changed
- **Tổng quan gọn lại** (owner 2026-10-22: "ui ux loạn quá"): câu hỏi dài trong khung "Anh cần trả lời" (danh sách 19 card merge của lead) gập còn 3 dòng, bấm vào mở đủ; bỏ dòng "Màn hình phòng đang hiện đúng câu này" và dòng nhắc Ship khi đã có nút đáp án; cột Preview ẩn khi chưa có ảnh (tab Preview vẫn chỉ chỗ lưu ảnh).
### Fixed
- **HQ quét câu hỏi kẹt theo đúng độ trễ của 8sync.** Bản .38 cho critic trả lời ngay (`after_s` 0) nhưng HQ vẫn đợi 60 giây mới đóng hộp hỏi cho phòng không có hook: giờ ngưỡng quét = `after_s` của `auto status` (sàn 5 giây để anh kịp đọc; 8sync cũ không báo thì vẫn 60 giây). Hướng dẫn trong HQ nói đúng "critic chọn ngay (mặc định bật)". Test stuck-asks +1.

## [0.110.38] — 2026-10-22
### Changed
- **Critic trả lời ngay, không chờ 60 giây** (owner: "tôi nghĩ bây giờ không cần sau 1p auto trả lời"): `auto on` đặt delegate `--after 0` (trả lời ngay trong phòng, ghi DECISIONS.md); `--after <s>` vẫn đưa lại chế độ chờ owner nếu anh muốn. Rails không đổi: Ship, secret/tiền, xoá/không hoàn tác, deploy prod, high-risk vẫn chờ anh.
### Added
- **Nút "Critic trả lời ngay" ở Văn phòng** (owner: "luôn có nút bật auto mặc định luôn bật"): công tắc bật/tắt critic (`8sync ccc delegate on|off`), mặc định BẬT từ bản này; 8sync cũ hơn không hiện nút.
- **Lead kẹt câu hỏi → báo thẳng anh** (owner: "lỡ mà lead bị dính câu hỏi phải tìm agent trả lời… không thể nào mà không có agent nào"): revive phát hiện phòng LEAD dừng chờ câu hỏi (thường là rails: Ship/secret — không agent nào được trả lời thay anh) → banner HQ cho anh MỘT câu, giãn 10 phút. Phòng thường kẹt → lead trả lời ngay (bản .36).
## [0.110.37] — 2026-10-22

### Fixed
- **`auto merge` land được card chưa có trường PR nếu ghi chú review nêu PR.** Owner 2026-10-22 (ide): 8 card Approved nằm 9 giờ dù Ship đã duyệt ("Duyệt tất cả", grant còn hiệu lực): PR của chúng ở zus-backend, review trước 0.110.30 chỉ ghi `[review] OK zus-backend#19 @b6d1e81` vào note, card không có `pr`/`pr_repo`, nên merge nền báo "card không có PR" mãi. Giờ `merge.rs` `infer_pr` đọc `repo#N @sha` / `owner/repo#N` / `#N` từ ghi chú (mới nhất trước; có SHA đã duyệt thì SHA trong note phải khớp; repo khác org bị bỏ qua, cùng org qua `pr_repo_for`) rồi land như card có `--pr`. Dòng chờ ghi rõ cách đặt tay khi note cũng không có.

## [0.110.36] — 2026-10-22

### Added
- **Phòng hỏi → lead trả lời ngay** (owner: "khi biết ccc đang code bị dính hỏi, ccc auto phải gọi agent lead trả lời ngay làm tiếp"): mỗi nhịp revive đọc cuối transcript mọi phòng lane đang idle; phòng nào dừng chờ một câu AskUserQuestion chưa ai trả lời (critic không bắt được: câu rails Ship/secret/tiền/xoá, hỏi lúc chưa có kit) → lead nhận MỘT tin liệt kê từng phòng + câu hỏi, được đánh thức NGAY, và trả lời từng phòng qua `8sync ccc msg` (câu sản phẩm/kỹ thuật tự quyết theo DECISIONS.md, không cần owner; câu rails gom một câu AskUserQuestion cho owner). Giãn 10 phút mỗi phòng để không spam. Phòng lead không nằm trong danh sách (câu Ship của lead đã có nhắc 30 phút của ship-ask).
### Changed
- Live check 2026-10-22 sau bản này: 8sync/platform và zus/ide đều không có phòng kẹt câu hỏi.

## [0.110.35] — 2026-10-21

### Added
- **Board: card Done có sheet chi tiết.** Owner 2026-10-21 ("cũng có sheet để xem chi tiết … public rồi release thì sheet tổng hợp hiển thị có ở đó"): bấm một card ở cột Done mở sheet như card đang mở: trạng thái (Xong/Bỏ, từ cột nào), toàn văn, lúc đóng và ai đóng, PR (cả repo khác: `zus-backend#8`) và SHA đã duyệt, **bằng chứng** của `auto done --evidence` với phần merge / tag release / link GitHub tách ra thành dòng riêng (`merged zus-backend#8 @sha`, `v1.7.3`, link PR / release / run), lệnh check, và toàn bộ lịch sử ghi chú. Dòng card trong cột Done ghi thêm số PR. `auto board --json` trả 30 card đã đóng gần nhất thay vì 10.

## [0.110.34] — 2026-10-21

### Fixed
- **Câu Ship của lead không còn bị từ chối sau 60 s.** Owner 2026-10-21 ("kẹt hoài vậy lead không auto check ship done hả"): lead-ide đã hỏi Ship 5 lần cho 8 card approved; mỗi lần hook permit chờ owner bấm trên HQ 60 giây rồi *từ chối* AskUserQuestion ("tool 8sync không tự duyệt") và dặn "đừng hỏi lại", nên owner không bao giờ thấy câu hỏi và card nằm Approved 9 giờ. Giờ AskUserQuestion có header `Ship` đi thẳng qua hook (không chờ, không từ chối): câu hỏi đứng trên màn hình phòng như prompt thường, HQ (ask panel) hiện cho owner trả lời lúc nào cũng được, critic không bao giờ trả lời thay (delegate), grant đọc từ transcript như cũ. Test permit 8.

### Added
- **Máy: đồ thị tải 30 phút.** Owner 2026-10-21 ("chưa có đồ thị"): mục Tải máy có đường RAM và CPU (một thang 0–100 %), nét đứt là ngưỡng RAM của guard, chú thích khoảng RAM / CPU / W; server lấy mẫu 30 giây một lần từ lúc HQ chạy (`lib/server/history.ts`, 60 mẫu) nên đồ thị đầy dù không mở tab; `/api/machine` thêm `history`. Test history 4.

## [0.110.33] — 2026-10-21

### Fixed
- **"Dừng team" giờ dừng thật.** Owner: "lệnh dừng chương trình ở HQ không work khi có task bị chờ". Ba lỗi chồng nhau: `auto down` dừng ở phòng đầu tiên lỗi rồi BỎ qua bước rời auto → HQ revive mở lại phòng mỗi phút; `claude stop` thoát 0 ngay cả khi không dừng được (id sai in usage, exit 0; phòng đang chờ prompt có thể từ chối lặng lẽ) nên HQ báo "đã dừng"; không phòng nào được kiểm tra lại. Giờ: rời auto + tắt loop/ship-fast TRƯỚC, stop từng phòng, **đối chiếu danh sách session lại** (chỉ tính dừng khi phòng biến mất, theo id), phòng còn sống stop lần 2 rồi báo rõ tên + `8sync ccc term <id>` để xem tay; card của phòng đã dừng trả về board.
- **A permission prompt after an auto-compact no longer waits on the owner forever.** The permit hook counted Claude Code's post-compaction summary (`isCompactSummary`) as the owner typing. Within 60 s of a compact, every prompt therefore stayed with the owner. Summaries and transcript-only lines no longer count.
- **A room may move to another card's worktree of its own repo by itself.** `EnterWorktree` into `<repo>/.claude/worktrees/<name>` was refused because it lies outside the room's current worktree (seen live: dev in card-31 entering card-58). It is now allowed for one plain folder name directly under the repo's `.claude/worktrees/`. Anything else still waits for the owner.
- `8sync up`: when the GitHub API has no digest, the release's `.sha256` file is tried up to 3 times (2 s apart) before "checksum NOT VERIFIED"; a missing digest still never blocks the install, a wrong one still does.

## [0.110.32] — 2026-10-21

### Fixed
- **Tick của HQ chỉ đánh thức phòng của dự án đang auto.** Owner 2026-10-21 ("chạy dự nào mà dự khác dính inbox tin nhắn theo luôn"): `auto on --here` ở một dự án, nhưng vòng tick server 60 s (0.110.29) vẫn xếp lời nhắc tick vào inbox mọi phòng rảnh của *mọi* dự án. Giờ tick đọc `repos`/`out` của `auto status` như sweep (`inAutoScope`): phòng ngoài phạm vi (kể cả dự án `auto close` đã bỏ) không nhận gì; `repos` rỗng = mọi dự án như trước. Test auto-tick 17.

## [0.110.31] — 2026-10-21

### Fixed
- **Guard: app của owner không còn làm cả team đứng.** Owner 2026-10-21 ("treo 1 ngày", "sao toàn bị vượt"): app của owner chiếm 52% RAM (32 GB/61,6 GB) so với ngưỡng 60%, phòng chỉ 6 GB; mỗi lần RAM vượt (gitleaks của gate /sec, xem 0.110.30), L3 tạm dừng thêm vài phòng (platform: 11/15 phòng dừng, trả card #113 #114 #115 #49) và phòng chỉ được mở lại khi *máy* xuống dưới ngưỡng — không bao giờ, vì app của owner đã trên ngưỡng. Giờ cả team luôn được giữ **10% máy** (RAM và CPU, `ROOMS_FLOOR_PCT`) chừng nào máy dưới **92%** (`HARD_PCT`): `keep_count` chỉ dừng phần phòng dùng *trên* sàn (app owner là phần vượt thì không dừng ai), `room_fits` mở lại phòng khi team + 1 phòng còn trong sàn và máy dưới 92%; chờ yên **3 phút** thay vì 10 (11 phòng về trong ~35 phút thay vì ~2 giờ; chống rung đã có L3 cần ngưỡng + 15). Dòng L3/mở lại ghi rõ luật mới. Test: 24 pressure.

## [0.110.30] — 2026-10-21

### Fixed
- **`/sec` và `/aup-audit` không quét cả git history nữa.** Owner 2026-10-21 ("sao toàn bị vượt"): RAM 85% khi ngưỡng guard là 60%, nhưng các phòng chỉ dùng ~6 GB; 4 tiến trình `gitleaks.exe` chiếm 3,2–4,1 GB mỗi cái (~14 GB, 28% CPU) — là `gitleaks detect` quét toàn bộ history mà gate `/sec`/`/aup-audit` của mỗi phòng chạy trước commit trên repo lớn, guard đếm vào "app khác" nên không trim được. Hai skill giờ chỉ quét commit của nhánh (`--log-opts=origin/main..HEAD`, 194 ms trên repo này) cộng phần staged (`gitleaks protect --staged`), có `--max-target-megabytes 5`; quét cả history chỉ khi `repo` / sắp public repo, chạy một mình. Cập nhật kit: `8sync ccc kit`.

### Added
- **HQ tự xoá worktree card đã xong.** Owner 2026-10-21: tab Máy báo `.claude/worktrees` *Cao* (platform 74, ide 21) nhưng chỉ gửi phòng, không ai dọn. Sau mỗi lần đo (ngay sau khi dọn build rảnh), HQ xoá worktree `<repo>/.claude/worktrees/<tên>` khi đủ cả: không phòng/tiến trình nào dùng; không ai sửa ≥ 60 phút; việc đã lên nhánh mặc định (HEAD là tổ tiên của `origin/main`, **hoặc** một commit trên đó ghi `(card N)` — platform squash-merge nên 0/72 worktree là tổ tiên, board chỉ giữ 10 card đóng gần nhất) hoặc card đã đóng trên board; `git status` sạch (riêng `su-code/standup/` do `8sync ccc meet` ghi thì bỏ qua và xoá trước — 50/72 worktree platform chỉ bẩn vì nó). Dùng `git worktree remove` (không `--force`), `branch -d` (không `-D`), `worktree prune` cho worktree mất thư mục; git chạy tuần tự, 20 s/lệnh (xoá: 120 s). Tab Máy thêm dòng "HQ xoá N worktree rảnh đã merge/đóng: …" và mục ≥ 10 worktree ghi rõ HQ giữ bao nhiêu, vì sao (đang dùng / mới sửa / chưa merge-đóng / chưa commit). Chạy thử khô 2026-10-21: platform 71 worktree → 50 xoá được, giữ 1 đang dùng · 9 mới sửa · 7 chưa merge · 4 chưa commit; ide 12 → 4 xoá được (9 thư mục còn lại là worktree của submodule `backend`, không phải của ide: để nguyên).
- **Card có PR ở repo khác cùng org: `--pr owner/repo#N`.** zus/ide 2026-10-21: 8 card nằm Approved 9 giờ dù owner đã "Duyệt tất cả" — PR của chúng ở zus-backend (#8, #9, #10, #17, #19, #22…) nên `--pr` chưa đặt được và `auto merge` chỉ merge PR của repo dự án. Giờ `auto move … --pr` nhận `N`, `owner/repo#N` hay URL PR; repo phải cùng owner/org với `origin` của dự án (`gh repo view --json nameWithOwner`, cache 1 ngày như nhánh mặc định), khác org bị từ chối. Card lưu `pr: N` + `pr_repo` (JSON thêm trường, board in `PR zus-backend#8`). `auto merge` và merge nền chạy `gh pr view/edit/merge … --repo owner/repo`, base phải là nhánh mặc định của repo đó (cache theo repo), vẫn `--match-head-commit <sha đã review>`; evidence `merged zus-backend#8 @<sha>`. Guard cho `gh pr merge N --repo owner/repo --match-head-commit SHA` qua khi khớp đúng card approved (repo + số + SHA) dưới quyền tự merge của dự án; sai SHA, sai repo, hết hạn hay không có quyền thì vẫn hỏi.

## [0.110.29] — 2026-10-21

### Fixed
- **HQ tự đánh thức / hồi sinh phòng kể cả khi không mở tab.** Owner 2026-10-21: "tự lên task chậm". Vòng tick (`runAutoTick`: nhắc phòng rảnh ≥ 60 s, `auto revive`, đóng câu hỏi kẹt, "Tự soi ảnh") trước chỉ chạy khi tab Office poll `/api/auto` mỗi 60 s, và `STALE_MS` quên "phòng rảnh từ lúc nào" 3 phút sau poll cuối — đóng HQ là không ai đánh thức phòng. Giờ server chạy vòng này mỗi phút từ lúc khởi động (`instrumentation.ts`), một lượt một lúc (tab poll trùng lượt thì chờ, báo không có gì mới).
- **Báo cáo: dòng +/− cho mọi phòng Claude Code.** Đếm từ `Write`/`Edit`/`MultiEdit`/`NotebookEdit` trong transcript, đọc tiếp từ byte đã đọc (file chỉ nối thêm): lần đầu 1,1 s cho 23 phòng (transcript 135 MB: 368 ms), lần sau 25 ms. Snapshot status line vẫn thắng khi có. Phòng omp vẫn "chưa đo".
- **Dọn đĩa: phòng đang giữ card giữ thư mục.** v0.110.28 chỉ giữ phòng `running`; phòng giữ card giữa hai nhịp mất cache build và build lại từ đầu. Giờ giữ khi phòng đang chạy, đang chờ owner, hoặc đang giữ card trên board; phòng "Chờ card" vẫn được dọn.
- **Guard: lời dặn khi chặn `sleep`** nói rõ: đang có lệnh nền thì kết thúc lượt ngay, không `auto wait` (cũng giữ tin báo lại).

## [0.110.28] — 2026-10-21

### Fixed
- **Phòng không còn ngủ chờ lệnh.** Owner 2026-10-21: "1 room quá yếu kém". dev2 trên zus/ide mất 2 giờ 45 phút cho card #12 (một việc verify): `encore test` treo vì daemon Encore chết, Claude Code đẩy lệnh ra nền, rồi phòng `sleep 1200`, `sleep 900`… ngủ 15–20 phút mỗi lượt để chờ. Guard (`8sync ccc hook guard`) giờ chặn lệnh ngủ tổng ≥ 120 giây (`sleep 900`, `sleep 15m`, `Start-Sleep -Seconds 600`, `timeout /t 300`) kèm lời dặn: lệnh nền Claude Code tự báo khi xong — kết thúc lượt; chờ card/tin nhắn dùng `8sync ccc auto wait`. Lời dặn không vào `/goal` được (lead đã 3.999/4.000 ký tự).
- **Dọn đĩa: phòng chờ card không giữ thư mục nữa.** dev-ide đứng "Chờ card" 13 giờ trong worktree card-15 và giữ `target` 44 GB khỏi mọi lượt dọn ("đang có phòng hoặc tiến trình dùng"). Thư mục của phòng chỉ tính là đang dùng khi phòng đang trong một lượt (`running`); build phòng khởi chạy sau đó hiện ra là tiến trình.
- **Báo cáo đo thật cho mọi phòng.** 22/23 phòng hiện "chưa đo": số liệu chỉ đọc từ snapshot status line (`~/.local/state/8sync/hq/usage/<sid>.json`) mà chỉ dev-ide ghi; task đếm từ journal TaskCreate mà phòng team không dùng. Giờ model + thời gian đọc từ transcript (đầu 64 KB một lần, đuôi ≤ 256 KB khi file đổi, cache theo size/mtime; lần 2 28 ms), task xong/mở lấy từ board (thẻ phòng đã chuyển sang QA/Review/Approved, thẻ đang giữ); board đọc 1 lần/3 giây cho cả office và /api/board. Chi phí vẫn "chưa đo" khi không có snapshot (repo không có bảng giá).
- Test `lease-pin` (v0.110.27) đỏ từ 17:00 21/10 trên mọi nhánh: mốc `lease_until` cố định 10:00Z so với giờ thật. `autoText` nhận `now` (mặc định `Date.now()`), test truyền mốc.

## [0.110.27] — 2026-10-21
### Added
- **Ghim dự án** (owner: "nút ghim dự án quan trọng cần lease tập trung vào đó; nút thêm vào sidebar"): nút ghim trên mọi dự án ở sidebar, kể cả thư mục chưa có phòng (`8sync ccc auto pin|unpin|pins`); dự án ghim nằm đầu sidebar dưới "Ghim". Usage chặt (5 giờ ≥ 70% hoặc 7 ngày ≥ 80%): chỉ dự án ghim chạy và nhận card; usage thoáng: mọi dự án chạy, dự án ghim mở trước.
- **Lease liên tục** (owner: "có nút auto lease liên tục biết usage có là chạy đi không đợi"): công tắc ở Văn phòng (`8sync ccc auto lease auto on|off`). API key: tự gia hạn khi còn < 30 phút, dừng khi chạm ngân sách $/giờ. Gói subscription: gia hạn (tối đa 4 giờ) mỗi lần anh dùng HQ hoặc gõ prompt trong 30 phút qua (luật Anthropic: gói subscription cần người có mặt). Cửa sổ usage đầy thì phòng nghỉ và tự chạy lại khi reset.
### Changed
- Size gate ceiling 7840 → 7872 KiB, attributed in `scripts/size-gate.sh` (lease module; no new dependency).
- **Sấm Sét = tăng nhân lực + Ship tốc độ cao** (owner: "nút sấm sét có hợp nhất nút ship không… tự apply hướng tốt nhất"): bấm Sấm Sét mở 13 phòng VÀ bật sprint ship 2 giờ — thêm người mà không ai land thì card chỉ dồn ở qa/review. Nút Ship tốc độ cao riêng vẫn giữ cho lúc quota chặt (không thêm phòng).
- **Phòng rảnh có việc swarm lại sau 1 phút** (owner: "thời gian nghỉ quá rảnh quá lâu, sau 1p phải swarm lại"): phòng idle có card chờ ở cột mình được đánh thức lại sau 60 s (trước 10 phút); HQ chạy revive mỗi 60 s (trước 120 s). Phòng không có việc vẫn nghỉ lâu để không tốn lượt.

## [0.110.26] — 2026-10-21
### Added
- **Ship tốc độ cao** (owner 2026-10-21: "nút mà all members in room đẩy nhanh tốc độ push, merge, build, check test, release sản phẩm nhanh nhất ít lỗi; Sấm Sét chỉ là mở rộng nhân lực"): nút 🚀 cạnh Sấm Sét (`8sync ccc auto ship-fast on [--hours 0.5..4] | off | status`, chỉ owner). Bật: brief tới MỌI phòng + đánh thức như ⚡ — card gần xong trước (approved → review → qa → building), review/qa dọn cột mình trước, builder không lấy card tính năng mới khi ≥ 3 card đang chờ qa/review (card approved chờ anh bấm nên không đếm), PR nhỏ, chạy lệnh kiểm + test trước khi push, CI xanh mới merge. Hết card/hết giờ: 8sync tự báo anh một phát. Chip "Ship nhanh · còn N′" đọc từ status (sống qua reload), có nút Tắt. Không bỏ cổng nào: chỉ đổi thứ tự và bỏ chỗ đứng chết.
- **Ship card approved một chạm** (owner 2026-10-21: "bảng approve bị kẹt nhiều quá… nên có nút để tiện bấm ship"): nút "Ship card approved" nhắc lead hỏi anh câu Ship (Duyệt tất cả / Chỉ merge / Dừng) ngay lượt đó — anh bấm một phát là `auto merge` land hết; board bị kẹt approved (≥ 1 card, chưa có quyền merge) thì mỗi 30 phút 8sync tự nhắc lead hỏi Ship.
### Changed
- Size gate ceiling 7808 → 7840 KiB, attributed in `scripts/size-gate.sh` (ship_fast module; no new dependency).
- Sấm Sét ghi rõ vai trò: tooltip/guide nói "tăng nhân lực (13 phòng)", muốn đẩy nhanh land/release dùng Ship tốc độ cao.

## [0.110.25] — 2026-10-21
### Changed
- **Auto-ship tự lên việc liên tục** (owner 2026-10-21: "phải lên task backlog ready nhiều lên… R&D và lead phải làm việc tự lên task liên tục"): vòng mới chạy khi **backlog/ready < 2 card** — building/qa/review/approved đang chạy không bao giờ chặn R&D; brief mỗi vòng yêu cầu 3–6 card nhỏ, giữ ready ≥ 3 card để team không chờ việc; lead đang idle được đánh thức như ⚡ Làm ngay (không đợi owner nhắn mới đọc brief).

## [0.110.24] — 2026-10-21
### Added
- **Lệnh `/` trong ô chat HQ** (owner 2026-10-21: "nên nghĩ thêm command cho input chat to all phòng hoặc 1 phòng nên có command \"/\"… ví hq-* auto-ship là auto rnd, optimize, nâng cấp, cải tiến, check sec, check thiếu, loop làm liên tục"). Gõ `/` mở menu lệnh (giống menu @: ↑↓/chạm): `/all <tin>` và `/<phòng> <tin>` chọn đích chỉ cho lần gửi đó; `/hq-auto-ship`, `/hq-rnd`, `/hq-optimize`, `/hq-upgrade`, `/hq-improve`, `/hq-sec`, `/hq-gaps`, `/hq-stop` mở rộng thành brief `[HQ /hq-…]` gửi lead (không có lead thì gửi message tới từng phòng, không thành card); không bao giờ gửi dấu `/` đầu dòng vào terminal Claude Code.
  - **Vòng auto-ship liên tục** (`8sync ccc auto loop on [trọng tâm] | off | wake | status`, HQ `/hq-auto-ship`): board cạn ≥ 20 phút là 8sync tự gửi lead brief vòng kế (R&D → optimize → nâng cấp → cải tiến → check sec → check thiếu, mỗi phát hiện một card `auto add --check`), không giới hạn vòng, không chờ owner; đang nghỉ usage/lease/guard hay card chưa xong thì chờ, xong tự chạy tiếp (chip "Auto-ship: vòng N" + nút dừng). Card approved/blocked cũng counts as đang làm; lead chưa đọc brief vòng trước thì chưa gửi vòng kế; 2 vòng liền không ra card → loop nghỉ tới khi owner nhắn dự án hay `/hq-auto-ship`; `auto down`/`auto close` tắt vòng. Bật/tắt chỉ owner.
- **Ô gõ terminal HQ giống khung chat phòng** (owner 2026-10-21: "input của terminal mở omp xấu quá không đẹp như bên chat rooms"): khung bo tròn tự giãn tới 6 dòng, Shift+Enter xuống dòng, nhiều dòng gửi dạng bracketed paste (không có thì từng dòng một Enter như paste thật), hàng phím Esc/Tab/mũi tên/^C thành chip cuộn ngang một dòng trên điện thoại, nút Ảnh + Gửi cùng kiểu composer.

## [0.110.23] — 2026-10-21
### Added
- **Strict CPU cap for rooms.** Owner 2026-10-21: "never cpu go to 60% check kĩ nghiêm khắc". Every guard pass, and right after `auto up`/revive open rooms, every room process tree is pinned to the top N logical CPUs (`8sync ccc auto guard cap <10..90>|off`, default 37 % → 12 of 32), leaving the low CPUs (the V-Cache CCD on X3D parts) to the owner. Kernel-enforced and inherited by the rooms' children (Windows `SetProcessAffinityMask`; Linux `taskset` only when a mask changes; macOS no-op). Only room trees are pinned — never the Claude Code daemon, the owner's sessions, omp, HQ or 8sync. What was pinned is recorded (pid, start, project, original mask) and restored exactly on `cap off`, `guard off`, auto off/pause or when a project leaves scope.
  - While the rooms are the load (all projects' rooms ≥ 15 % of the machine), two readings at or over the CPU threshold tighten the cap one step (12 → 6 → 3 → 2 CPUs); it loosens one step only when the predicted CPU stays under the threshold, at most one decision per 20 s machine-wide, so it never cycles over the line.
- **Separate CPU and RAM thresholds.** `8sync ccc auto guard cpu <30..95>` (default 55) next to `guard <pct>` (RAM, default 60). A CPU breach tightens the cap, idles room builds and can pause rooms on CPU timing; a RAM breach takes the RAM path (clean, lean restart, pause). An old single threshold keeps meaning CPU (RAM then at least 60) until either one is set. HQ Máy › Bảo vệ máy: RAM row, CPU row, cap row ("đang siết" while tightened); the 5 s trigger compares each to its own threshold. `auto status --json` adds `cpu_pct`, `cap`, `cap_n`, `cpus`, `cap_tight`.
### Fixed
- The guard's CPU figures used a fixed 5 s window although two listings plus the sleep span ~7–8 s (dry run printed machine "CPU 5 s 1 %" while one rustc showed 9 %). Each listing is now stamped with the machine's CPU times (`GetSystemTimes`, `/proc/stat` first 8 fields) and shares are divided by the measured interval.
### Changed
- Size gate ceiling 7744 → 7808 KiB, attributed in `scripts/size-gate.sh` (+40,960 B musl for the CPU cap and the split thresholds; no new dependency).

## [0.110.22] — 2026-10-21
### Fixed
- **HQ through the VPS link recovers by itself when the login lapses.** Owner 2026-10-21: "check gấp ovh web chưa vô được hq ui". The VPS gate (oauth2-proxy, 12 h cookie) answers a lapsed session with a redirect to GitHub that fetch cannot follow, so an open HQ tab failed every poll until a manual reload: the owner's previous login lapsed at 05:38 UTC, when he reported it. HQ's API never redirects, so the client now asks for redirects by hand and reloads into the sign-in when it gets one (at most once per 30 s).
- **HQ auto-clean reaches nested build output and no longer mails what it kept.** `src-tauri/target` and `apps/web/.next` in a card worktree count (they need a Cargo.toml or CACHEDIR.TAG, or a package.json, beside or inside, so a source folder named `target` never goes). The in-use check covers the whole worktree. A build dir HQ keeps because a room or process uses it, or a build wrote to it within the hour, is left out of the cleanup mail, so a room is never told to delete it. Process command lines are read as UTF-8.
- **▶ Chơi thử builds run below normal priority.** HQ itself runs at normal priority since v0.110.17; its play builds (`npm ci`, `npm run build`) do not, so they do not compete with the owner's foreground work.

## [0.110.21] — 2026-10-21
### Fixed
- **HQ "⚡ Đang Sấm Sét" no longer sticks, and "Running N" counts only live rooms.** Owner 2026-10-21: "bật sao không tắt được" (same screenshot four times). When `claude agents` failed or timed out (the machine was crawling), HQ fell back to its journal and every stopped room (3d-game's dev6, review2, qa2…) came back as running, so the stopped 13-room team still read as boosted. A journal-only session is now always ended; only tmux or `claude agents` (its last good answer for 120 s) prove a room alive. Boards and ⚡ buttons stay available for auto's team roots during such an outage instead of answering 409.
- **⚡ Làm ngay acts at once.** Owner: "bấm làm ngay không ăn". It only set P0: zus/ide #20/#21 sat at P0 in Ready for 3 h while `dev` idled. Now the owner's `auto prio <id> P0` (no room env, the same owner check as `auto add`) also mails the lead `[⚡ owner] Làm ngay #N …` (once per card per 10 min) and calls the rooms that can take the card (its lane, not holding another card); an idle room whose goal ended is re-armed by a background revive (at most one a minute) — only with an empty inbox and two idle looks ≥ 5 s apart. The toast says who was called or who holds the card.

## [0.110.20] — 2026-10-21
### Added
- **HQ Terminal sends images.** Owner 2026-10-21: "Terminal thiếu gửi ảnh". A room terminal has an "Ảnh" button (phone photo picker) and takes a pasted image. The image goes into the room's repo like a chat attachment (`.claude/hq-uploads`), and its path lands in the input line, so the owner adds a question and sends. `POST /api/sessions/<id>/term {files}` places the uploads; the room is resolved server side.
### Changed
- **HQ cleans idle build output by itself, right after each scan.** Owner 2026-10-21: "tình trạng cao chú ý là phải auto xử lý gấp luôn không đợi gửi". The 11:50 cleanup mail sat with a lead waiting on the owner while 78 GB of card worktree builds stayed on disk. Every scan now removes `target` / `.next` over 1 GB in `.claude/worktrees/<card>`. A dir is kept when a live room's folder is in that worktree, a build wrote to it within the hour, or Windows refuses to move it (a file in it is open). It is moved to `.claude/hq-trash`, then deleted by a below-normal-priority child process. The Máy tab shows what went. The loop runs hourly (was every 6 h) and measures the projects that have card worktrees plus the switched-on ones; what needs judgment still goes to a room of a switched-on project.

## [0.110.19] — 2026-10-21
### Added
- **`sweep` room ("Dọn máy"): each running project's own machine and disk cleaner, kept by HQ.** Owner 2026-10-21: "khi hq ui bật lên mỗi dự án đang chạy đều nên có 1 super agent chuyên quét phân tích sâu để clean dọn rác ram, cpu, gpu chống ăn điện cao và dung lượng rác cao cực strictly giao tiếp all rooms/roles".
  - Sonnet, always lean (no LSP plugins, no serena/codebase-memory), never paused by the guard, no lane, not in any preset team. Event-driven: it sleeps in `auto wait --mail` and spends nothing until a `[máy]` alert, an HQ disk message or the owner writes; a timeout or the usage cap just ends the turn.
  - `[máy]` → reads processes once (`guard --dry-run`) and messages the room causing the load with the exact PID/port/path; disk → handles only the items HQ listed. It removes a worktree only when `git status --porcelain --ignored` shows nothing outside build dirs, the branch has its own commits equal to a merged PR head and no room uses it; build dirs only by tool commands; kills only leftovers re-checked (pid, image, command line, cwd, start) right before; never commits, moves or releases cards, never deletes %TEMP% copies (reported only), never touches other projects. The lead hears only what was actually freed, once per item.
  - HQ: Máy › Bảo vệ máy has "Dọn máy tự động" per running team (on by default). While HQ runs it keeps one `sweep` in every running team in auto's scope (checked every 60 s, one at a time, back-off on failure); switching off stops the room first and is remembered only if that worked. The guard trigger mails `[máy] …` only to projects whose own rooms are among the top CPU users (≤ 1 per 5 min), and "Dung lượng dự án" cleanups go to the sweep before the lead.
  - `auto status --json` adds `team_roots`.
### Fixed
- HQ "Dung lượng dự án" no longer flags pnpm/bun `node_modules` that deleting would not free: under `node_modules` a file with more than one hard link counts 0 (its other name is the package store), elsewhere a file counts size ÷ links. su-code's root `node_modules` showed 1.6 GB; ~0.3 GB is reclaimable.

## [0.110.18] — 2026-10-21
### Fixed
- **HQ "Gửi cho mọi phòng" sends to the project you are looking at.** Owner 2026-10-21: "Dự án platform mà tại sao lead của ide". A repo picked in the sidebar that is not a registered HQ folder set only the page's repo, so the box under Tổng quan / Văn phòng / Chat tổng defaulted to the busiest project (ide) and suggested its lead. It now follows the repo in view, and project roots compare the same however they are written (slashes, case, trailing slash, `\\?\\`).

## [0.110.17] — 2026-10-21
### Fixed
- **HQ no longer lags or shows rooms as ids under load (local and through the VPS link).** Owner 2026-10-21: "ui ux lỗi không hiện tên", "web ovh bị lag quá", "Đang Sấm Sét" that would not turn off. Busy rooms rewrite their Claude session and job files every second, so the native core re-ran `claude agents` for every poll, one at a time behind a lock; polls from every client queued, timed out in node after 5 s and each fell back to its own `claude agents` (15 at once), which made claude slower still. When the listing failed, rooms showed as their 8-hex id with the last journal status — stopped rooms stayed "Đang làm" and a stopped Sấm Sét team still counted as 13 rooms. Now:
  - the core serves one listing to every poll for 3 s even when files moved, and a failed run keeps the last good listing for up to 2 min;
  - node runs one probe at a time for the whole server and keeps the last good listing on a failed probe.
- **HQ runs at normal priority.** Task Scheduler starts tasks at priority 7 — below-normal CPU, low memory and low I/O priority — and every child inherits it; HQ's node server, its core and the VPS `ssh -R` tunnel were at I/O priority Low while rooms built. `8sync hq ui` now raises itself (and so everything it starts) to normal CPU, memory and I/O priority on Windows.

## [0.110.16] — 2026-10-21
### Added
- **Resource guard: overload is handled within seconds, by itself.** Owner 2026-10-21: "tối ưu hóa hơn ăn điện ít, ram, cpu, gpu ít ổn định có ngưỡng tự chặn cleanup và auto chạy lại", "bị cao là auto xử lý liền luôn không có để lâu". Threshold 60% by default (`8sync ccc auto guard <30..95>|off`, `guard eco on|off`, `guard --dry-run`, `guard now [--json]`; HQ Máy → "Bảo vệ máy").
  - **Trigger:** HQ samples the machine every 5 s server-side and runs `8sync ccc auto guard now` when CPU stays ≥ threshold for 3 samples, RAM for 2, or VRAM ≥ 90% for 2 while a room holds GPU memory; one run at a time, ≥ 20 s apart, backing off to 300 s while passes change nothing. Without HQ, `auto revive` runs the same pass every 2 min.
  - **Every pass:** room process trees run below normal priority and in Efficiency mode (EcoQoS); on a breach the rooms' build/test processes (node, esbuild, cargo, rustc, browsers…) drop to idle priority (never the room's claude, 8sync, `auto wait` or MCP servers) and go back when calm.
  - **L1 (at once):** kills what rooms left behind in this project only — detached servers older than 5 min, test watchers, language servers of closed cards, headless browsers and orphaned MCP servers that belong to the project — and room `<room>-scratch` entries idle for 60 min; each room holding ≥ 1 GB gets one note naming its top items.
  - **L2:** RAM ≥ threshold+15, or over it for 30 s: up to 2 idle heavy rooms restart in the same conversation without LSP plugins and indexing MCP servers (serena, codebase-memory) — re-checked busy and inbox right before the stop; at most once per room per 30 min.
  - **L3:** CPU ≥ 90% for 45 s, or RAM ≥ threshold+15 for 60 s: rooms that don't fit pause in a fixed order (review2, dev6, dev5, qa2, ba, …; never lead, dev, qa), their cards go back to the board, and they come back one per tick once another room fits for 10 min. `auto up` clears pauses; `guard off` brings every paused room back.
  - Rooms start staggered (`up` ≤ 90 s, revive ≤ 50 s) and one revive has a 90 s deadline across all projects. Planning, QA and review rooms start lean while the guard is on. The lead is told about restarts and pauses.
  - QA/review lane text: never copy the repo or node_modules to %TEMP%; test in the room's gate worktree, scratch only under `.claude/worktrees/<room>-scratch/`. HQ shows the size of old `%TEMP%\qa-card-*` copies and Defender's CPU share with the exclusion command to copy (never run by 8sync).

## [0.110.15] — 2026-10-21
### Added
- **HQ "Đóng dự án" stops the project for real (`8sync ccc auto close [--dry-run] [--json]`).** Owner 2026-10-21: "kill hẳn luôn không phải ẩn". The project "⋯" item opens a confirm dialog listing what will stop (from `auto close --dry-run --json`): team rooms, other Claude Code sessions, omp sessions (warning when one is probably the owner's own open terminal) and leftover processes, under the repo root it resolved. "Dừng hẳn & đóng" runs the close in that root through `POST /api/projects/sidebar {root, hidden: true, kill: true}` (token + Origin gate, fixed argv), then hides the project; a close that fails, or that resolves to another root, hides nothing and offers "Chỉ ẩn". The CLI:
  - runs only in a repo root (a subfolder, a folder grouping repos or a card worktree is refused, naming the repo);
  - stops the team rooms (releasing nothing it can't stop), every other Claude Code session in the repo or its worktrees (`claude stop` for background ones, the process tree for interactive ones), the project's omp sessions PID by PID (never omp's shared `__omp_worker_daemon*` broker), and leftover node/python/uv processes naming the repo plus browsers with `--user-data-dir` inside it;
  - never touches a nested repo's processes (paths with spaces included), HQ, or the session running it and everything under that session;
  - takes the revive lock (≤ 45 s) and fails before stopping anything if a revive still holds it;
  - takes only this project out of auto: in every-project mode it goes on a new `out` list in `auto.json` (kept by plain `on`/`pause`, cleared by `on --here`/`up` there, `on --all`, `off`), never pausing auto for other projects. `auto status` names the closed projects.
### Fixed
- The Windows process listing (leftover-server sweep) returned nothing whenever a command line held Vietnamese text (console code page); it is read as UTF-8.

## [0.110.14] — 2026-10-21
### Added
- **omp rooms open in HQ's terminal ("Mở terminal").** Owner: "vẫn chưa vô xem được omp đang làm gì". `8sync ccc term <omp-room-id>` runs the room's omp in a detached host (ConPTY, resumes its transcript, keeps 256 KB of screen, 127.0.0.1 + random token, record in `~/.local/state/8sync/ccc/term/`). Closing the drawer only disconnects; omp keeps running and reopening replays the screen. A client sends the token only to a host whose recorded omp is still its own child.
- **Session already open in another terminal on the PC:** the drawer shows a live read-only view (its Nhật ký, every 2 s, secrets masked) with "Chuyển sang HQ". That button ends only the omp holding that session (root first, then its descendants, never omp's shared `__omp_worker_daemon*` broker; every PID re-checked right before its kill) and reopens it in the host with `omp --restore`. The kill-and-start runs inside the detached host, so closing the drawer mid-way never leaves the room without omp. Inbox chat keeps working meanwhile.
### Fixed
- HQ expands `~\…` repos from `8sync ls` on Windows (an omp room's folder was a literal `~\…`, so its terminal failed with ENOENT).

## [0.110.13] — 2026-10-21
### Fixed
- **HQ "⚡ Sấm Sét" can be turned off.** Owner 2026-10-21: "bật sao không tắt được" — while it ran, a click only renewed the lease. Now it asks: **Tắt Sấm Sét** (back to the 6-room full team: stops ba, dev3–dev6, qa2, review2; the cards they held go back to the board) or **Gia hạn 2 giờ** (renews the lease, as before).
- `8sync ccc auto down --only <a,b,c>` takes a comma list under one revive lock (same ≤ 45 s wait). A typo is refused before anything stops. The stopped rooms' card claims are released at once instead of after 2 h: `building` → `ready`, qa/review cards stay in their lane unclaimed, each with a `↩ <room> tắt (down --only): trả về <lane>` note.

## [0.110.12] — 2026-10-21
### Added
- **Auto image review ("Tự soi ảnh", per project, off by default).** HQ Preview gets a switch; on, it adds an `eye` room (Soi ảnh, sonnet, no lane) to the running team and sends it each open card's new evidence images (one `[ảnh mới] card #N (lane X): "…" · ảnh: …` message per card, ~90 s after its last new image, ≤ 6 images, never re-sent — survives HQ restarts; closed cards and images older than the switch never go). The room reads the card's CURRENT text, AC/check and notes on the board (owner notes win), looks at every image and writes one objective note `[soi ảnh] Đạt · Lệch AC · Đề xuất` (only what is visible, file names cited, "không đủ để kết luận" when an image can't show it); a clear AC miss or visual bug also goes to the lead. The lightbox shows the card's latest `[soi ảnh]` note under the image. Sends run from the Preview poll and from the auto poll every HQ tab makes, so any open tab drives it; nothing runs while no project has the switch on.
- `8sync ccc auto up --add <room>` / `auto down --only <room>`: add or stop ONE room of a running team without touching the lease, the cap or the other rooms. `auto wait --mail`: a lane-less room waits for a message only.
- `auto up --add` never stops a nested team and refuses before anything else when no team runs; `auto down --only` takes the revive lock. Tự soi ảnh: only the ≤ 6 images sent are marked; the board is read only when a card is due; a closed card or a failed send waits 10 min.

## [0.110.11] — 2026-10-21
### Fixed
- **`auto up` no longer fails for 10 min on a dead revive's lock.** The revive lock was held until it aged out (600 s) even when the process that took it was gone (a run killed by HQ's timeout), so the owner's `8sync ccc auto up --roles full --clear-ss` said "đang có `auto revive` / `auto up` khác mở phòng". A lock whose process no longer runs is now free at once, and `auto up` waits up to 150 s for a live revive to finish instead of failing.
- **A folder that only groups repos is refused, not resolved to the parent.** `auto up` / `auto add` / `auto on --here` in `8sync-startup/zus` (a folder of the parent repo holding the submodules admin, ide, models, web) started the PARENT repo's team — and, with one team per folder tree, would have stopped the 3d-game team nested in it. It now stops with the list of repos inside and `cd` into the one to work on; the check runs before an untracked folder is `git init`ed, and a folder holding repos (8sync-startup/game holds 3d-game) is never made a repo itself.

## [0.110.10] — 2026-10-21
### Fixed
- **One team per folder tree: auto in a repo no longer drags the team of the repo it sits in.** Auto's projects (`auto.json` `repos`) and `team-roots.json` accumulated: once the parent repo (8sync-startup) had been on, every plain `auto on` — HQ "Chạy liên tục" and the new per-project "Gỡ kẹt ngay" — resumed it, and revive brought its 6 old rooms back beside 3d-game's 13 (2026-10-20 16:09 UTC; the PC hit 100% RAM). Now `auto up` / `auto on --here` in a repo stops the team of any repo nested with it (parent or child; unrelated projects keep running) and takes it out of auto and revive; old state holding both keeps only the deepest repo (status, scope check, plain `on`).
- **HQ "Gỡ kẹt ngay" acts on its project only** (`auto on --here` in that root, then revive) instead of a plain `on` for every remembered project; the route accepts `root` only with `on` and only for a project with a live room.
- `auto down` no longer prints "auto: TẠM DỪNG" while auto still runs for another project; it names those projects.

## [0.110.9] — 2026-10-20
### Fixed
- **Approved cards land without waiting on GitHub's `mergeable`.** After each merge to main GitHub recomputes the other PRs lazily (UNKNOWN for ~1 min), so 6 approved 3d-game cards waited on one merge per 2-min tick. On UNKNOWN the merge itself is tried at the reviewed head (`--match-head-commit`; a conflict is refused by GitHub and the card waits for the verdict); a background pass keeps starting cards for up to 20 s.
- **The reaper now catches servers rooms leave behind.** 0.110.7 took only a server whose own parent was gone, but a room's server sits under `cmd < npx < bash < bash` and only the top bash loses its parent when the turn ends: 37 vite servers (3.3 GB) on 3d-game were all "owned". A server in a room worktree (`<root>/.claude/worktrees/<dir>`) now goes when walking up through node and shell parents ends at a process whose parent is gone; a chain that reaches any other live image (a terminal, an editor, claude/omp) stays, and a server in the repo itself is never taken (the owner's `start cmd /k npm run dev` window, pm2/systemd). A worker under another picked server is left to that server's tree kill. Live dry run on 3d-game: 9 room servers ≥ 30 min picked, nothing else.

## [0.110.8] — 2026-10-20
### Fixed
- **omp sessions show in HQ while in use.** On Windows `8sync ls` saw no processes (`agent_cmdlines` read only `/proc`), so an omp session counted as live only while its transcript changed in the last 2 min and dropped out of HQ whenever the owner paused to read or type (8sync-startup `core` was missing). `ls` now reads running `omp.exe` command lines in-process (Toolhelp + `NtQueryInformationProcess`, no PowerShell, ~30–90 ms), matches Windows paths in any case/slash and a session resumed by its transcript file (`omp --resume <dir>\<file>.jsonl`); the live rule is unchanged, so old sessions do not flood the sidebar.
- **omp rows without an inbox id** (registries written before they stored their root) recover the root from the transcript's working directory.
- **Nhật ký for omp rooms:** reads the omp transcript (path kept server-side, keyed by room id) into the same events as Claude rooms — prompts, replies, tools by intent only (code tools never show the command), subagents; secrets masked. Omp rooms also show their model.

## [0.110.7] — 2026-10-20
### Added
- **HQ force buttons.** Board: "⚡ Làm ngay" on Backlog/Ready cards (P0; an owner P0 on a card still waiting for its AC tells the lead at once) and "⚡ Gỡ block ngay" on Blocked cards (back to Backlog as P0, lead told now); Tổng quan: "N card blocked · Gỡ hết ngay" and "Gỡ kẹt ngay" (opens the questions, runs auto on + revive).
- **One-tap answers from the phone.** "Anh cần trả lời" answers a background room's permission prompt ("Cho phép"/"Từ chối") or single-choice question (one button per option) through the room's terminal bridge: one allowlisted key (Enter only on a permission dialog with Yes highlighted, Esc, or the option's digit alone), and only while the room's screen still shows the exact dialog text the owner saw (else 409 "Màn hình đã đổi, mở terminal"); the command or question is shown before the buttons enable.
- **`auto revive` cleans the machine** (HQ calls it every 2 min): every 10 min per project, and at once when RAM ≥ 85% (then servers ≥ 10 min old), while auto runs for the project, it kills the project's ORPHANED dev/preview servers (parent gone; the owner's own `npm run dev` under a live terminal is kept) (vite, next dev/start, webpack serve, http-server, serve, live-server ≥ 30 min) and language servers of deleted worktrees or ≥ 6 h, each node pid of the tree by `/PID x /F` (no `/T`: stale parent links are not followed), never by image name, never HQ; one status row "RAM x% · CPU y% · GPU z%". 3d-game: 73 leftover vite servers held 6 GB and 10 tsservers 5.6 GB (RAM 43 → 34 GB after cleanup).
- **HQ merges approved cards in the background** while the owner's self-merge grant holds (revive tick, one card per pass, native, no tokens): the lead looped `auto merge; sleep 70` up to 16 times on "mergeable UNKNOWN" and split no card meanwhile; its playbook now says merge once, never sleep-wait.
### Changed
- **Every owner card on a board team is looked at now:** `auto add` from the owner (no room identified and not inside a Claude Code session) goes to the head of the queue and tells the backlog rooms at once (like `--now`); a room's card keeps its place.
- **⚡ Sấm Sét = 13 rooms:** lead + BA (two planners split backlog in parallel), 7 builders (dev…dev6, ui), 2 QA, 2 review (~13× quota; room cap 14). 9 rooms used 4% of the 5-hour window in 30 min with RAM 63% / CPU 57% / GPU 3%, builders waiting on one lead. `READY_CAP` 6 → 8, `READY_LOW` 4 → 6.
### Fixed
- **No false "Kẹt":** a running room is "Đang làm" even when the card it last claimed sits in Blocked (the lead's claim on blocked #46 was only the retry timer, and HQ painted the busy lead red).

## [0.110.6] — 2026-10-20
### Fixed
- **QA rooms no longer stall on a guard prompt before every gate.** A QA room rebuilds its gate checkout (`.claude/worktrees/qa`, `qa2`, …) from each PR head, and the guard asked "discards uncommitted changes" on its `git checkout -- .` / `git clean -fdq` every time: on 3d-game qa2 sat waiting on it twice in 30 min while cards queued. `git checkout` (detached or paths; not `-b/-B/--orphan/--ignore-other-worktrees`), `git restore` and `git clean` now pass when git works in such a checkout (cwd after `cd`, or `git -C`) and nothing in the command points git elsewhere (`GIT_DIR`, `GIT_WORK_TREE`, `core.worktree`, `--work-tree`, … in any form or segment). `reset` and `switch` still ask there (they move branches every worktree shares); everywhere else nothing changed. Residual: a `core.worktree` saved into the qa checkout's config by an earlier, separately approved command is not seen.

## [0.110.5] — 2026-10-20
### Changed
- **HQ Preview shows where the project really is, newest truth first.** Owner (2026-10-20): "Game cứ hiện card cũ lên preview khó nắm tình hình". Root cause: images were ranked by file mtime across the repo root and every `.claude/worktrees/*`, and each checkout rewrites mtimes, so a 7-hour-old shot of card #6 showed as "1 phút trước" in every new worktree.
  - True time: an image's time is the commit that last touched it when git tracks it unmodified in that checkout (one bounded `git log -n 400 --name-only` + one `git status --porcelain -z --ignored=matching` per checkout, fixed argv, at most 6 git at once, cached until HEAD/ref/index or the files change); the file mtime only when it is untracked or modified. Touching or re-checking-out a tracked file never moves it.
  - Ownership: `card-<n>`/`card<n>`/folder `card-<n>` in the image path. A card worktree (its branch's `card-<n>`, else its folder name; folders get reused) contributes only card n's images plus its new untracked ones. The same image across checkouts (same path + size) is listed once, a commit time beating a copy's mtime.
  - The newest `origin/main`/`main` tip is read too: images only main has (merged cards whose worktree is gone) are listed and served from the git blob by id; the header shows `main <sha> · <n> card đang chạy · <m> xong 24h`.
  - Layout: **Đang làm** (open cards in Building/QA/Review/Approved, lane by lane, most recent activity first: lane, room, PR, last note, newest 3 shots or "chưa có ảnh"), **Xong gần đây** (done cards by close time with their evidence, 6 then "Xem thêm"), **Khác** (unassigned images and cards in neither list, collapsed). Lazy thumbs in fixed 16:10 boxes; the lightbox walks one card's images (buttons, ← →, swipe; swipe down or Esc closes) and shows file, card, true time ("commit …" / "tệp chưa commit, …") and source checkout.
### Fixed
- **HQ no longer dies when it restarts onto a new version while `8sync up` installs that version's UI.** The restart found `.install.lock` held by `8sync up` and exited with "retry in a minute"; on 2026-10-20 the owner's HQ (and the VPS link) stayed down until started by hand. An install now waits up to 3 min for the other one, and when that one put the same version in place it uses it instead of extracting again; a lock older than 10 min is still taken over.

## [0.110.4] — 2026-10-20

### Added
- **HQ "▶ Chơi thử": play a project's current origin/main build inside HQ, on desktop and phone.** Owner (2026-10-20): "nên có sẵn chỗ link để preview chơi thử game ra sao … hoặc nên là có chỗ play game in app được luôn". The button sits on each project block in Tổng quan and in the Preview header, shown only when origin/main's package.json has a `build` script.
  - Build (`POST /api/play {root}`, roots HQ already knows only): one detached worktree per project OUTSIDE the repo at `<data dir>/8sync/hq-play/<slug>-<hash>` (%APPDATA% on Windows, ~/.local/share on Linux), so Preview never scans it and the repo stays clean. `git fetch origin main`, then `worktree add --detach` the first time or `checkout --detach --force <sha>`. `npm ci` runs only when package-lock.json changed since the last good install, then `npm run build -- --base ./`. One build per project at a time, 10 minutes total, the last 200 lines of output kept for the UI. A folder in the way that is not a worktree of that repo is refused, never deleted. Fixed argv only, no shell; npm runs as `node npm-cli.js`.
  - Status (`GET /api/play?root=&fresh=1`): `none | building | ready | failed`, the built sha, its age, origin/main's sha (`stale` once main moves), the current step and the log tail.
  - Serve (`GET`/`HEAD /api/play/<key>/<exp>.<hmac>/<file>`): files of `dist/` only. The path is parsed segment by segment (encoded `..`, `%2F`/`%5C`, `:`, control characters and trailing dots are refused) and the real path must stay inside `dist/`, so a link out is refused too. Content types cover html/js/css/wasm/images/glb/gltf/json/svg/audio. index.html is `no-store`, other files revalidate by ETag.
  - The game runs in an opaque origin, so its code can never reach HQ. Every play response (errors too) sends `Content-Security-Policy: sandbox allow-scripts allow-pointer-lock allow-popups allow-forms; frame-ancestors 'self'`, with no allow-same-origin. It also sends `X-Frame-Options: SAMEORIGIN`, `Access-Control-Allow-Origin: *` (the game's module scripts are CORS requests from `null`), `Cross-Origin-Resource-Policy: cross-origin` and `nosniff`. The viewer's iframe carries the same sandbox. Proven in the browser: the game sees `origin "null"`, and `window.parent.document`, `fetch("/")` and `fetch("/api/office")` are all blocked. Every other route stays DENY.
  - Auth: the signature in the path is the only lock: no cookie, no token, no Host or Origin check. That is why the link works for anyone the proxy lets through to `/api/play/*`. It is HMAC-SHA256(key + expiry) under its own random secret, `~/.config/8sync/hq/play-secret` (0600, created with `wx`, shared across route bundles, re-read when it changes; not the UI token). It lasts at most 12 h and is compared in constant time. A forged or expired signature, one more than 12 h ahead, or project A's signature on project B gets 401. Relative asset URLs carry the signature, because the build uses `--base ./`.
  - Viewer: full screen (100dvh on phones), header with sha and build age, plus "Build lại", "Copy link demo", "Mở tab mới" and close. A project that was never built starts building on open and shows its steps and log; a failed build shows its error and log tail.
  - "Copy link demo" copies that same signed URL on the page's own origin: the https://vps.8syncdev.com… link when HQ is opened there, 127.0.0.1 locally. It stays valid 11 to 12 h, for this one project. The URL stays the same for a whole hour, so status polls never reload the iframe.
- **HQ "⚡ Sấm Sét": one click turns a project's team into the 9-room boost team.** The button sits in each project's header in Tổng quan and first in the Văn phòng team controls. It asks once (9 rooms: lead, 5 builders, 2 QA, review; about 9× the quota of one session; 2-hour lease), then runs exactly `8sync ccc auto up --roles boost --hours 2` in that project's root through `/api/team` (same token/Origin checks and known-root rule as the other team buttons, refused over the day's electricity budget like "Chạy liên tục", 420 s timeout for nine sequential starts) and `auto revive` after it. The toast shows the CLI's summary line, or its error. A project whose live team already has 9+ rooms including qa2 and dev4 shows "Đang Sấm Sét", and a click there renews the lease with the same command, no dialog.
- **Demo links never serve source maps.** A `▶ Chơi thử` link is public for 12 h (the VPS lets `/api/play/*` through without GitHub login; the path signature is the only lock), so `.map` files, which carry the private repo's source, answer 404. Everything else in `dist/` (including `VITE_*` values baked into the bundle) is visible to whoever has the link.
### Changed
- **HQ wears the official 8 Sync mark and the ZUS IDE neon look.** Owner, 2026-10-20: "icon app xấu quá", colours "chưa neon".
  - Sidebar logo, favicon (16/32/48 px `.ico`, SVG that follows the OS theme) and the iOS home-screen icon are the brand kit 2026-09 "Cut" mark (lime on dark, leaf `#417a00` on light) instead of the old rainbow interlock.
  - Colours: ZUS IDE Pro Dark surfaces (canvas → panel → raised) and an off-white light theme, neutrals tinted toward the brand hue 134. The lime marks only the primary button and the active tab underline (soft glow), the current sidebar room (wash + hairline), focus rings and the Live dot. Text contrast stays AA in both themes (body ≥ 16.7:1, muted text ≥ 5.9:1, "Đang làm" on the current room 4.56:1 light / ≥ 6.4:1 dark).
  - First-load JS 2.48 MB → 1.74 MB (gzip 720 → 529 KB): the role badge imported all of lucide (`import * as Icons` + lookup by name); it now imports its 8 icons. The session list stops polling while the tab is hidden.

## [0.110.3] — 2026-10-20
### Added
- **`8sync ccc auto up --roles boost`: 9 rooms — lead, five builders (dev, dev2, dev3, dev4, ui) and two QA rooms (qa, qa2) plus review.** Owner: the team felt sequential. On 3d-game qa was the busiest room (90% busy, five cards queued for it) while a builder waited at "Chờ card". About 9× a single session's quota; the room cap is now 9. Each QA room keeps its own worktree `.claude/worktrees/<room>` (it was one shared `.claude/worktrees/qa`, so a second QA room would have checked another PR out under the first one's tests).
### Fixed
- **The lead refills `ready` before builders run dry.** An idea split into open cards was never handed back to the lead until all its pieces closed, so on 3d-game ready hit 0 with ideas #10 and #1 in backlog and dev at "Chờ card". Below 4 cards in ready (`READY_LOW`) `auto claim`/`auto wait` hand the lead such an idea again (at most every 15 min per idea), with the hint: split the next batch now, 2–4 small cards that can run in parallel (different files), each with AC + check, not repeating the open pieces; when the idea is used up, propose a new direction. With no idea left in backlog and ready low, the lead's (only the lead's) empty `claim` says: R&D now, add 1–2 concrete ideas to backlog, then split them.
- **HQ Board: an idea in Backlog shows "13 card con đang mở · 4 đang build/QA" instead of a list of ids.** The owner read "đang làm qua #64 #65 … #46" as a card stuck after leaving Blocked; the ids stay in the tooltip.

## [0.110.2] — 2026-10-20
### Fixed
- **A renewed lease brings the team back to work, not to a 30-minute cron.** A lane room's `/goal` ends when the lease gate shows, and nothing gave it back: on 3d-game after the owner pressed "Chạy liên tục" the rooms took a turn only when their backup cron fired (the lead sat idle 28 min, then three approved cards waited for it). `auto revive` (HQ calls it every 2 min while a tab is open, and on "Chạy liên tục") now stops a lane room that was idle in the background at two of its runs at least 60 s apart, and is still idle right before the stop, then resumes the same conversation with its goal (no sleep inside revive: HQ kills it after 120 s). It skips a room with messages waiting in its inbox (the inbox mod wakes it; a resume forks a new id that would never read them) and a room it resumed in the last 10 min. `auto up` re-goals idle lane rooms the same way instead of sending a one-turn loop prompt. Busy rooms, rooms waiting on a prompt, interactive sessions and rooms without a transcript are left alone. A resumed room starts at the project root, not its card worktree.
- **HQ Chat phòng: the room's title row stays pinned.** Name, state, project · branch · model and "Mở terminal" stay at the top while the log and the chat scroll (owner: switching model/effort or opening the terminal meant scrolling back up). It sits above the scroller (opaque, nothing shows through), and only the current day's separator stays pinned (older ones no longer pile up).

## [0.110.1] — 2026-10-20
### Fixed
- **Guard: a room may clean its own Claude Code scratch dir `~/.claude/jobs/<id>/tmp/<…>` without asking.** 3d-game, 18:55–19:31: the qa room exported each PR head there with `rm -rf … && mkdir -p … && git archive …`, the guard asked ("deletes outside the project"), and a background room cannot answer: qa sat 35 min on the prompt while five cards waited in qa. The `tmp` dir itself, the job dir and `~/.claude/jobs` still ask.
- **HQ on a phone (`hq ui --public`): every tab fits and every lane is reachable.** Owner report from a 360 px phone: tabs cut off on both sides with the Máy chip crowding them, Board showing only Backlog.
  - Tab row: the edge that still hides tabs fades out, tabs snap; on phones the Máy chip is a compact `41% / 103 W` set apart by a rule. Header buttons are 44 px targets and the title still fits at 360 px.
  - Board (Card dự án and Task của session): one 88vw lane per screen with the next one peeking, snapping, and a strip naming every lane with its count that jumps to it and marks the one in view. The project picker and reload share one line.
  - The page no longer scrolls sideways: an `sr-only` count inside a horizontal scroller escaped it (Board pushed the page to 2116 px at 360, Sessions to 482). Tablets (768 px): the Running/usage/Needs-you strip shows from 1280 px up, it pushed the page to 925 px.
  - Flow and Báo cáo keep the card / room names pinned while the lanes and numbers scroll sideways. Composer: shorter send label, 2-line hints on phones. Inputs are 16 px on phones (no iOS zoom); `viewport-fit=cover` with safe-area insets on the app frame, sheets and bottom sheets.

## [0.110.0] — 2026-10-20
### Added
- **CI/CD on the release machine, GitHub only stores the code: `8sync ccc auto ci local`.** It turns GitHub Actions off for the repo (`gh api -X PUT repos/{owner}/{repo}/actions/permissions -F enabled=false`); `auto ci github` turns it back on. A repo with Actions off reads `ci: local` in `auto status` before any old run is looked at, so rooms take the local gate per head SHA as CI and never wait on GitHub. Owner ask after the billing hold on 3d-game and ai-game-studio (every run failed in seconds).
  - HQ shows `CI: máy release (GitHub chỉ lưu code)`. `/ship` and `/ship-auto` take the local test + build as CI in such a repo (other OSes "not verified") instead of waiting on `gh pr checks`.
  - A background CI refresh that started before `auto ci local` no longer overwrites the newer `local` reading or sends a billing alert; the reading is stored where `auto status` reads it, also for a repo nested in a scoped one.
### Changed
- **Team cards write their changelog entry to `changelog.d/card-<id>.md`, not `CHANGELOG.md`.** 3d-game, 12:30–17:37: 20 bounces back to `ready` over 22 cards, most of them a `CHANGELOG.md` conflict after another PR merged; each bounce costs a builder turn, a qa gate and a review. The entries are folded into `CHANGELOG.md` at release (`/ship` and `/ship-auto` release steps); the review lane, the reviewer agent and the conflict hints of `auto merge`/`auto move` know the rule, so a card is not sent back for a missing `CHANGELOG.md` line.
### Fixed
- **`8sync ccc auto add -h` prints the usage instead of queueing a card titled "-h".** (`--help` already errored; any text starting with a dash still goes after `--`.)

## [0.109.1] — 2026-10-20
### Fixed
- **`auto wait` hands a room its messages instead of asking it to end the turn.** UAT of 0.109.0 on 3d-game: rooms that were idle got the owner's message in 16–18 s (was 30 min – 5 h), but dev2 and review woke with `"wake":"msg"` and carried on in the same turn (status, claim, wait again), so their Stop hook never ran and the message never arrived. On a `msg` wake, `auto wait` now takes the deliverable lines from the room's inbox exactly as the Stop hook does and returns them in `messages` (and in the text output).

## [0.109.0] — 2026-10-20
Measured on the live 3d-game team (6 rooms, 07:24–15:33): 1,893 API calls, 206 M context tokens (~$109), 35 PRs of which 14 closed unmerged, 98 tool errors. The fixes below target the biggest measured losses.
### Fixed
- **Owner messages reach a waiting room within seconds.** A room gets HQ messages only when its turn ends, and `auto wait` keeps a turn open for up to 30 minutes. On 3d-game the owner's messages took 30 min, 1 h 46 min and 5 h 4 min to arrive. `auto wait` now also wakes with `"wake":"msg"` when the room's inbox holds a message the Stop hook would deliver now, the room ends its turn, and the hook hands it over. A message from another room counts only while auto may act in the project (otherwise the hook holds it back), and each new message wakes the room once, so an inbox no hook takes cannot loop it.
- **Branches catch up by merge, never by rebase.** Rebasing needs a force-push, which the guard blocks, so builders opened a new PR for every conflict: 10 replacement PRs for 18 merges, most conflicts in CHANGELOG.md. The board's refusals, `auto merge` and the blocked-card hint now say `git merge origin/main`, push normally (the PR keeps its number), keep both CHANGELOG entries; a stacked PR is retargeted with `gh pr edit <n> --base main`.
- **`auto merge` lands draft PRs.** GitHub refuses to merge a draft, and 4 merges failed that way. An approved draft is marked ready (`gh pr ready`) right before its merge.
- **Builders no longer build the owner's whole idea next to its pieces.** `auto status` gave the first open card as `target`, which in a team is usually the idea the lead is splitting; a builder with no card took it and built it in full (PR 25). In a project where `auto up` runs a team (a worktree inside counts), `target` is now `null` and rooms work only through `claim`; omp rooms in such a team are no longer nudged onto the idea either.
- **In a team, only lead or BA closes an owner idea.** dev2 closed the owner's cards #7 and #8 with the work half done. In a board team, `auto done`/`drop` of a card the owner added is refused for builder, QA and review rooms; they note their result and the lead accepts it. `auto merge` refuses to run from those rooms (landing is the lead's). Without a team nothing changes.
### Changed
- **`auto add --now` in a team goes to the lead and BA.** Before, every room dropped its card for it (214 calls, 21.6 M tokens on 3d-game). The backlog rooms split it and hand out P0 cards. A project without a team still sends it to every room.
- **Room playbooks:** builders edit files in a worktree with Edit/Write and run one plain command per Bash call (36 commands were refused for heredoc, `sed -i`, `python -`, `git -C` or PowerShell); QA reuses one worktree (`git checkout --detach <sha>`, `npm ci` only when the lockfile changed; it had made 22), runs `8sync shot` in the foreground, and never kills processes by image name (`taskkill /IM node.exe` also kills HQ).

## [0.108.5] — 2026-10-20
### Fixed
- **`8sync shot` no longer pins the CPU on a 3D page.** QA screenshots of the 3d-game WebGL scene kept 14 of the machine's 32 threads busy for minutes per shot (HQ "Máy 80%"). The cause was `--disable-gpu`, which forced WebGL onto a software renderer (WARP). Shots now render on the GPU: the same game frame took 2.8 s and 4.1 CPU-seconds, at 94 FPS. In addition:
  - Chromium runs below normal priority.
  - A run that does not finish within `--wait` plus 60 s is killed together with its helper processes.
  - Each shot uses its own temporary profile and calls the real Chromium behind scoop's shim. Before, a second shot taken while another one ran exited with code 21 ("profile in use") and wrote no PNG.
- **QA and UI rooms stop the preview servers they start.** Each UAT left a `vite preview` running, and over 6 hours 16 of them held 2.7 GB of RAM on the owner's machine. The `qa` playbook and the `ui` role now say to stop the server right after the screenshot.

## [0.108.4] — 2026-10-20
### Fixed
- **The owner's ideas no longer sit in Blocked; the lead clears blocked cards.** On 3d-game the lead split the owner's ideas into `[#10] …` cards, then parked the ideas themselves in Blocked as "epic". Another card waited on a PR that was already closed. A third waited for the owner to send images. Meanwhile the lead slept in `auto wait`. The board now handles these cases:
  - **A split idea stays in Backlog.** An idea with an open card split off it (its first `[#N]` tag) stays in Backlog. No room claims it, and `move <id> blocked` is refused while those cards are open. An idea already parked in Blocked goes back to Backlog on the next claim. Once every split-off card has closed, `claim` gives the idea back to the lead with a hint: accept it with `auto done`, or split the next round.
  - **The backlog lane takes blocked cards first.** `auto claim` and `auto wait` for that lane return the card blocked longest before any new backlog work, together with a `hint`: if the reason is gone (the PR merged or closed, or the branch is stacked), rebase and move the card to ready; if a decision or a resource is missing, decide from `DECISIONS.md` and the project's goal, or find a substitute. Only Ship, secrets and money wait on the owner.
  - **A card the lead cannot clear does not hold it up.** The lead's next claim gives it other work, and the card comes back after an hour.
- **HQ shows who clears Blocked.** The Blocked column now says "lead gỡ ngay" instead of "lead hoặc anh gỡ". An idea card lists the cards being built for it ("đang làm qua #14 #17").

## [0.108.3] — 2026-10-20
### Fixed
- **HQ "Chạy liên tục" no longer widens auto to every project.** HQ's button runs a plain `8sync ccc auto on`, which used to drop the `--here` projects. Live, it turned "ai-game-studio + 3d-game" into "mọi dự án", so auto's lease, critic and nudges covered sessions in every folder on the machine. A plain `on` now resumes the projects auto last held, also after `pause`; the first `on` ever still covers every project. `auto on --all` widens on purpose, and `off` forgets the list.

## [0.108.2] — 2026-10-20
Owner (2026-10-20): "sao nó cứ mở nhầm folder cần làm không vậy 3d-game mà sao vô sai". He ran `mkdir 3d-game; cd 3d-game; 8sync ccc auto up "…"` inside the cluster repo `8sync-startup`. The folder had no `.git`, so the project root resolved to `8sync-startup`: the card went onto 8sync-startup's board, the rooms opened there, and the `lead` name resumed an older ai-game-studio conversation in which the owner then typed messages meant for 3d-game.

### Fixed
- **New folder inside a repo = its own project.** `ccc auto up`, `auto add` and session opens (`8sync ccc . <name>`, `new`, bare `.`) in a folder the enclosing repo does not track (no tracked file, no submodule entry under it) now run `git init -b main` there plus an empty first commit, and say so. Board, rooms and sessions then belong to that folder. Subfolders the parent tracks (`apps/x`), uninitialised submodules, Claude Code worktrees and read-only verbs are untouched.
- **`auto status` names every running project.** With two teams on (`auto on --here` in two repos), the line said "chỉ dự án <first>" only. It now lists all of them.

## [0.108.1] — 2026-10-20
Live UAT of 0.108.0 on ai-game-studio (6 rooms relaunched 01:23 VN, 33 min): 156 calls/h and 15.6M context tokens/h (0.105 window: 1,062/h and 114M/h), wrong-role returns 1 (was 10), conflict returns 0 (was 10), 4 tool errors (was 58). Fixes for what the UAT still showed:

### Fixed
- **Unknown role tags.** A card tagged `[art-director]` counted as untagged, so a dev room took it (#134). A role tag the team has no room for is now a role with no room: never handed out, listed by `auto lint`/`board`. `[hot-fix]`, `[follow-up]`, `[wip]`, `[bug]`, `[feature]`, `[chore]` and `[p0]`–`[p3]` are not roles.
- **"Conflict" right after a push.** GitHub reports `mergeable: UNKNOWN` for a few seconds after a push, and the board refused the move as a conflict (#147 passed 45 s later). The board re-reads UNKNOWN up to 3 times, then says GitHub is still computing it (no bounce). Only CONFLICTING is a conflict.
- **Ship question at once.** The lead went into `auto wait` after `auto merge` refused for missing permission and asked the Ship question 8.7 min later. The refusal now prints the exact question (header Ship, options, every approved card and PR), and the lead asks it in the same turn.
- **Wait length from the room's own Bash limit.** dev rooms still ran `auto wait --timeout 540`. `auto wait` now defaults to 1800 s when `BASH_MAX_TIMEOUT_MS` allows it (rooms started by `auto up`/`revive`), else 540 s; room texts run plain `auto wait --json`.
- **`ccc risk` on a stale base.** With an unfetched `origin/main`, PR 116 (84 files) was read as 177 files including `ci.yml`, so every gate skill ran. `ccc risk` fetches the base (20 s limit) and diffs against the merge-base; when the fetch fails it says the base may be stale.

## [0.108.0] — 2026-10-20
Owner (2026-10-20): "quay lại nâng cấp ccc đi uat đi sao mà nó dở quá luôn á auto kém chất lượng kết quả đạt chậm". Measured on ai-game-studio, 71 min after the 0.105.0 relaunch (9 rooms, 1,264 API calls):
- 14 cards were approved and 2 PRs merged; 15 approved cards waited 3.4–4.8 h.
- 25 of 59 open PRs conflicted and 14 sat on a branch other than main.
- 10 of 33 returns were a room getting another role's card.
- The team ran at 1,068 calls/h, 3.8× the day before. The Claude session limit had stopped every room 3 times in the 36 h before, 191 min in all.
- GitHub Actions on that repo had failed on billing for 12 h, and nothing told the owner.

### Added
- **`8sync ccc auto merge`.** It merges approved cards in code, with no model turn. Each card's PR must target the repo's default branch (`gh repo view`, cached a day; when it can't be read, nothing moves), be MERGEABLE, and have the card's SHA as head. It merges with `--squash --delete-branch --match-head-commit` and closes the card with `merged <sha>`. A stacked card runs after its root. A PR whose base branch was already merged is retargeted and sent back to `review`, so its new diff is reviewed before it merges. A conflict, a moved head, or another base sends the card back to `ready` with the reason. The lead runs it first on every turn, and its `auto wait` wakes on a new approved card.
- **Merge permission per project.** It used to be stored per session, so the 19:40 relaunch dropped it and the merge guard then refused lead's `gh pr merge`. The owner's answer is now stored per project root for at most 8 h in `~/.local/state/8sync/ccc/grants/self-merge.projects.json`, and `auto status --json` shows it as `self_merge`.
  - **What grants it:** only an option label the owner picked, read back from Claude Code's own transcript under `~/.claude/projects/` every time the permission is used. The label must be "Tự merge…" / "Self-merge…" / "Auto-merge…" on any question, or "Duyệt tất cả" / "Chỉ merge" on a `Ship` question. Free text and labels with a negation (không, chưa, tắt, no, not, off, later, sau) grant nothing.
  - **Revoking:** any other `Ship` answer revokes it.
  - **Forgery:** a hand-written store entry grants nothing. The guard also denies writes to the store, including through `..` paths.
  - **The guard allows exactly** `gh pr merge <number> [--squash|--merge|--rebase] [--delete-branch] --match-head-commit <card sha>`, only for a PR of an approved card whose base is the default branch.
- **`8sync ccc auto reopen <id> [--note]`.** A card closed by mistake goes back to the lane it came from, keeping its notes, SHA and PR.
- **`8sync ccc auto ci [--json]` and `ci` in `auto status`:** `ok`, `failing`, `billing` or `unknown`, from the last 5 `gh run` results plus the annotations of the newest failed run. The reading is cached 10 min, and status never runs `gh` itself. `billing` (payments failed or spending limit) shows in HQ's Office header and in status text, sends one owner alert a day, and tells rooms not to wait on CI.
- `8sync ccc risk` lists the skills to call (`skills`; docs-only diff → `/sec`).

### Changed
- **The board checks the PR, not just the text.**
  - Moving a card into `qa` or `approved` reads its PR with `gh pr view` (20 s limit). It refuses a base other than the default branch, a conflicting PR, an already-merged PR, a head different from `--sha`, or a `gh` error.
  - `done` needs evidence with a SHA or the `<lệnh>: <kết quả>` shape. "chưa" no longer closes a card.
  - Leaving `blocked` keeps the bounce count. `blocked → review` needs a `gate <sha>` note matching the current head.
- **Cards go to the right role.** A card's role comes from the tag at the start of its title (`[ui]`, `[dev]`, `[rd]`, …) or `--role` on `add`/`move`.
  - In `ready`, dev rooms (dev, dev2, backend, core, …) get only `[dev]` or untagged cards, and ui rooms only `[ui]` or untagged.
  - Cards for a role no building room takes (`[game-designer]`, `[art-director]`, or `[rd]`/`[arch]` sitting in `ready`) are never handed out; `auto lint` and `auto board` list them for the lead. The team is the registered rooms plus the live Claude Code rooms of the project, so rooms HQ reopened count.
  - Adding or relabelling an `[arch]` card wakes the arch room once, and so does an arch card moving into `review`.
- **Fewer turns spent polling:**
  - Rooms started by `auto up`/`revive` wait in `auto wait --timeout 1800` (their settings raise `BASH_MAX_TIMEOUT_MS`). Other rooms keep the 540 s default under Claude Code's 10-min Bash limit. A wake with a card claims it and works on it in the same turn, and a lead woken by `merge` runs `auto merge`.
  - The cron backup runs every 30 min (was 10), and `--loop` refuses less than 30 min. Rooms without a lane (arch, rd, ops, docs, sec) get no cron and no HQ auto-tick; they work on cards and messages only.
  - HQ's auto-tick skips a session that has its own cron for 35 min after its last turn, and skips lane-less rooms entirely. `auto on`/`pause`/`off` clears those marks.
- **Gates run once:**
  - `/ship` and the lead's merge call `8sync ccc risk` and run only the skills it lists, instead of `/sec` + `/rules` + `/aup-audit` on every PR.
  - QA runs the test gate once per PR head SHA and records `gate <sha>: <lệnh>: <kết quả>` on the card; review and lead reuse it until the head changes.
- The QA room runs on Sonnet (was Haiku): it gates visual UAT, and it had bounced cards that review then judged differently.

### Removed
- **OmniRoute.** Owner (2026-10-20): "xóa sạch omniroute, ảnh github,… all liên quan omniroute cho lành nhé sài ccc chính chủ được rồi". The free providers it could route (LLM7, Gemini Free) never carried one omp turn, and both train on prompts. Gone:
  - `scripts/vps/omniroute/` and `.github/workflows/omniroute-image.yml`;
  - on the VPS: the container and its data volume, `/srv/apps/omniroute`, the `/router-ai` Caddy routes and their `import`, the `omniroute-update` and `vps-clean` timers;
  - on GitHub: the `omniroute-router-ai` GHCR package and its workflow runs; the org's "public packages" setting is back off;
  - locally: the `omniroute` provider in omp's `models.yml`, the guide and PDF; the LLM7 and Gemini keys made for it were deleted.
  - `--model` examples in `ccc auto omp` help and errors now read `<provider>/<model>`. The `ccc auto omp on --model` feature itself stays: it works with any non-Claude omp provider.

## [0.107.0] — 2026-10-19
### Added
- **HQ native core.** `8sync hq ui` now also serves a loopback JSON core (random port + token, handed to the web server as `HQ_CORE` / `HQ_CORE_TOKEN`, never passed on to rooms): the `claude agents` listing behind a fingerprint cache (re-run only when a session/job file changes or a room's pid dies, ≤ 30 s), `8sync ls --all` rows from warm transcript digests (only appended lines are read), boards and the awake probe in process, a 5 s machine sampler (GetSystemTimes, GlobalMemoryStatusEx, Toolhelp working sets, NVML, PDH RAPL energy; Linux /proc + powercap) instead of `tasklist` / `nvidia-smi` / `typeperf` per request, the Hạn mức transcript scan, and the project size walk. Without the core (a `next dev` server) every route keeps its own probe. One client, 60 s: HQ node 5.5 → 4.0 s CPU, RSS 181 → 132 MB (plus ~1.3 s in the core), and no `claude agents` / `tasklist` / `8sync ls` process per poll; office 349 → 87 ms, board 386 → 108 ms, machine 1405 → 546 ms.
- **HQ sidebar: Đóng phòng / Xóa phòng.** Each room row has a "⋯" menu (always shown on phones, 44 px). Đóng phòng runs `claude stop` (conversation kept, "Mở team" resumes it; tmux kill for hq-* rooms); Xóa phòng looks up the registry entry bound to that session first, then runs `claude stop`, `claude rm` (drops its own worktree unless it holds unpushed commits) and `8sync ccc . rm <name>` from the folder whose registry holds it, which deletes the transcript, and the confirm says so. An entry it cannot remove (none found, its folder went with the worktree, `rm` failed) comes back as a warning toast, not a success. Both confirm with the room's state (waiting on the owner, working, stuck). `POST /api/sessions/[name]/end {action}`; omp rooms and terminals the owner opened are refused.
- **HQ sidebar: Đóng dự án.** The project "⋯" hides a project (HQ state, `hidden_projects`, carried on `/api/office`); it comes back by itself when a room waits on the owner, is stuck, or does anything after the close. "Hiện dự án đã đóng (N)" lists them with "Hiện lại", and the toast has an undo.
- **HQ sidebar: Xóa worktree.** For a project folder that is a git worktree (like `card-113-dev` under `.claude/worktrees`): the confirm reads git first and refuses with the reasons when a room still runs inside, it is locked, another worktree sits inside, files are uncommitted, or commits are not merged into the main branch or not pushed; never the main repo. Then `git worktree remove <path>` from the main worktree, never `--force`; the branch stays. "Đóng N phòng" in the dialog clears the live-room guard. Roots come from HQ's own project list, never from the request (`GET|POST /api/projects/worktree`).
- **OmniRoute on the VPS at `https://vps.8syncdev.com/router-ai`, no port in any URL** (`scripts/vps/omniroute/`, `.github/workflows/omniroute-image.yml`). Owner (2026-10-19): "cài OmniRoute lên ovh vps có trang /router-ai … auto update … auto clean rác", then "url web ovh không được lộ port".
  - **Image.** The workflow builds each upstream release with `OMNIROUTE_BASE_PATH=/router-ai`, using upstream's own publish settings (webpack, 12 GB build heap). It pushes `ghcr.io/8-sync-dev/omniroute-router-ai:<tag>` and `:latest`, daily at 01:00 VN.
  - **Why a custom build.** Next.js fixes basePath at build time. The upstream images' start-up patch (v3.8.51) leaves client-side links and lazy chunks at the root, so the dashboard broke under a subpath. Serving the dashboard on its own port was rejected by the owner, and DNS for a subdomain was blocked by Vercel's fair-use limit.
  - **`install.sh`.** Runs from the PC with Git Bash: it copies the files, runs `setup.sh` on the VPS, then runs live checks. These cover the gate on the dashboard, a 401 on the API without a key, the HQ link unchanged, and port 8444 closed.
  - **`setup.sh`.** Idempotent:
    - generates the secrets once (`.env`, 600);
    - starts the container: 2 GB memory, 1 GB heap, no host port;
    - adds `import /sites/*.routes` to the main site once and installs `router-ai.routes`, where `/router-ai/v1/*` is open (OmniRoute API keys are the lock) and the dashboard sits behind the same GitHub gate as HQ plus OmniRoute's own password;
    - validates Caddy with every real site file in a throwaway container, and restores the previous files if the reload fails;
    - retires the first install's `:8444` site from the edge compose, the oauth2-proxy allowlist and ufw.
  - **`omniroute-update.timer`** (daily 04:00 VN) pulls the compose image. It tags the running image `omniroute:rollback` before pulling, then recreates the container. It rolls back when creation fails or the container is not healthy within 3 minutes, and it records that image id and skips it afterwards. The compose tag always ends on an image that runs.
  - **`vps-clean.timer`** (daily 04:40 VN) removes stopped containers older than 3 days, unused images and build cache older than 7 days, journald beyond 300 MB / 14 days, and the apt cache. It never touches volumes, `/srv`, `/home` or the CI caches.
  - **Combo for omp.** OmniRoute combo `omp-manh` (GLM-5.3-Flash → DeepSeek-V4-Flash → MiniMax-M2.7 → gpt-oss-20b, priority) is wired into omp as `omniroute/omp-manh`. All four steps share one LLM7 free key, so its daily token quota stops the whole combo. One omp turn with tools used it up in UAT (429 "Daily token quota exceeded"), so another provider is needed before agents can rely on it.
  - **Referer rule.** The `/router-ai` build still sends `fetch('/api/…')` and `<img src="/providers/…">` without the basePath. `router-ai.routes` redirects page loads and rewrites fetches and images whose Referer is a `/router-ai` page, and leaves `/sw.js` alone so the PWA worker never takes scope `/` over HQ. A fresh login lands on `/router-ai/home` with 67 requests and none failing.
  - **Shared lock.** The update and cleanup scripts share `/run/lock/8sync-docker.lock`.
  - **Claude.** Claude models resold by others (LLM7 `claude-*`) are hidden. omp's OmniRoute key is limited to the free LLM7 models and combos; any other model returns 403.
  - **Owner guide:** `Downloads/OmniRoute-huong-dan.pdf`.

### Changed
- **Lead merges stacked PRs in order.** The lead's approved-card step (`BACKLOG_FIRST`) never merges into a base other than main. Once the root PR is on main, it runs `gh pr edit <pr> --base main` and merges; otherwise it merges the root first. UAT on ai-game-studio found 13 open PRs based on other branches, and PR 103 merged into `card-125-ui-palette` instead of main. That repo also gets `delete_branch_on_merge`, so GitHub retargets dependent PRs when a base merges.
- **omp team on any non-Claude model:** `8sync ccc auto omp on --model <provider/model>` (also `--omp-model` on `auto on --omp` / `auto up --omp`) stores the team model in auto.json; the team is blocked only when that model (else omp's default) is `anthropic/…`, so an `omniroute/<combo>` team runs while the owner's omp default stays a Claude login. Rooms open with `8sync . omp-<role> --model <m>` (new `--model` on `8sync . <name>`); `auto status --json` adds `omp_model`. The omp extension sends its live model to `auto nudge --model`; a room on `anthropic/…` gets no nudge, and a nudge without `--model` is still judged by omp's global default.
  - **The whole session runs on that model.** A session started with `--model` gets the same model for `--smol`, `--slow` and `--plan`, and no `--advisor`. Before this, the launch added 8sync's role flags (`--plan opus --slow opus`) and the advisor, which runs on omp's `modelRoles.advisor` (`anthropic/claude-opus-5-5:max`). A room "on" OmniRoute would have sent part of its calls to the Claude login. Checked on the real `omp` command line.


## [0.106.0] — 2026-10-19
### Added
- **HQ Chat tổng: one room or every room.** The composer under Văn phòng / Chat tổng picks "Mọi phòng" (a project or all projects, as before, with Gửi ngay and Lệnh kiểm) or one specific room, and suggests the project's lead room: one room reads the task instead of N (with the rough context tokens saved), and the lead hands parts out with `8sync ccc msg <phòng>` / `msg --all`. One tap applies it. Ctrl+Enter sends.
- **HQ Preview: "Hỏi về ảnh này".** In the image viewer (or the small button on each thumbnail) the owner taps the image to drop numbered pins, each with an optional note (keyboard: add a pin in the middle, arrows move it, Delete removes it), then sends with the same composer. The pins are drawn onto a full-size PNG copy that goes as an attachment; the text carries the image path, each pin as `#n (x%, y%; x px, y px): note` and the question. The default room is the one that saved the shot (card holder, worktree, lane), else the lead. On phones it is a bottom sheet.
- `POST /api/messages` takes `files` (upload ids, at most 5): they are copied into the room's repo (`.claude/hq-uploads/<id>/`, found from HQ's live session list, never a client path) and their paths appended, for terminal and inbox rooms.
- **HQ tab Máy.** The header chip (busiest of RAM/CPU/GPU, watts) now opens a full tab instead of a popover: Tải máy, Điện, Thức & màn hình, Cấu hình máy (CPU model, cores/threads, RAM, GPU and VRAM, OS; read once), Dung lượng dự án, Tiến trình. One shared `/api/machine` poll for the chip and the tab.
- **Awake switch.** `8sync ccc awake on [--hours N] [--screen-off N]` starts `8sync awake --while-rooms` detached (null stdio, no console, own process group, out of the caller's job when allowed: it outlives the shell and HQ restarts) and returns once the hold has written `~/.local/state/8sync/ccc/awake.json`; `off` stops only the pid in that file after checking it is that very process (image + creation time), idempotent. `status --json` gains `ours` (`{pid, until, while_rooms}` or null). The hold's minute `claude agents --json` runs without a console window. HQ: `POST /api/machine/awake {on}` and a switch in Thức & màn hình that reads `ours`, never `held` (on Windows `held` is everyone's, omp.exe included).
- **Dung lượng dự án.** For every sidebar project: top-level sizes, `.git`, `.claude/worktrees` (count, size), evidence folders, node_modules, build output, `.claude/hq-uploads`, and git-tracked files over 5 MB (`git ls-tree -r -l HEAD`). Bounded walk (400k entries / 45 s per project, symlinks and junctions skipped, never into another repo), cached ≤ 6 h in memory and `disk.json`, "Đo lại" on demand. Named thresholds flag tracked file > 5 MB (high > 50 MB), evidence > 20 MB, worktrees > 10 or > 2 GB, any folder > 1 GB (high > 10 GB), upload leftovers older than a day.
- **One-tap cleanup send.** Each project, and each flagged item, has a button that sends the findings plus the rules (no deleting uncommitted/unpushed work, AskUserQuestion before deleting owner-only assets or evidence, `git rm` in a commit through a PR) straight to the project's lead room (else dev; a picker changes it), toasting the delivery as the other composers do.
- **Dọn định kỳ.** A per-project switch: every 6 h HQ re-measures the projects that have it on and sends the cleanup message when it finds abnormal items it has not sent in the last 24 h. Started from `instrumentation.ts`; settings and last sends in `~/.local/state/8sync/hq/cleanup.json` (`/api/machine/cleanup`); the tab shows the last run, the next run and the last send.
- **HQ tab Hạn mức** registered (plan windows and tokens per room, `UsageView`). On phones every tab is a 44 px target and the active one scrolls into view.

### Fixed
- The 0.105.0 notes below said planning and checking rooms used ~75% of ai-game-studio's tokens and the dev room 3%. That came from guessing each transcript's room from its text. With the room names Claude Code records (`claude agents --all --json`): ui 23%, rd 14%, dev 11%, qa 10%, arch 7%, review 6%, lead 6%, ba 4%, older forks of rooms 19%. Two of the eight rooms were building; the board still held 23 cards in ready and 1 in building.

## [0.105.0] — 2026-10-19
Owner (2026-10-19): ai-game-studio "treo hơn 1 ngày liên tục mà chả ra gì … nghi bị chạy ngắn quá đứt gãy do loop". Measured over the last 36 h of that project (31 transcripts, 565 turns, 15K API calls, board, GitHub). Turns were long, not fragmented (rooms were busy about 220 room-hours); the losses were elsewhere:
- 64% of input tokens went to calls that re-read over 300K tokens of context (median call 305K, p90 553K): the kit compacts at 65% of a 1M window.
- Two of eight rooms were building (ui, dev); the board held 23 cards in ready and 1 in building. (Corrected per-room shares: see Unreleased.)
- 51 PRs open, merges held up by stacked branch chains (PR 108 on 103 on 99; one PR carrying 5 cards); an owner ask ("nút skill xấu") split into R&D, ADR notes and a UI card that waits on the R&D one.
- 742 Bash calls were blocked on 18/10 12:00–14:00 because the guard hook itself failed (a few with ENOENT on the `8sync` binary; rooms retried `auto status` hundreds of times), and 178 calls used `meet --as`, which did not exist.

### Changed
- **Team rooms compact at ~195K, not 650K.** `auto up` and `auto revive` start every room with `--settings <state>/ccc/room-settings.json` (`CLAUDE_CODE_AUTO_COMPACT_WINDOW=300000`; launch-level settings beat the user env, checked live on a `--bg` session). The owner's own sessions keep the kit's window.
- **`--roles full` (HQ "Team đầy đủ") is builder-heavy:** lead, dev, dev2, ui, qa, review (was lead, ba, arch, rd, dev, ui, qa, review). BA, architect and R&D join on request with `--roles`.
- **WIP limit on the board:** with 6 or more cards waiting in `ready`, planning rooms get no new backlog card (`claim --json` says why), `move <id> ready` from backlog is refused, and a card a room adds with a check waits in backlog. The owner's own cards and P0 cards pass.
- **Approved work lands first:** backlog rooms (lead, ba) start every turn by merging approved cards when the owner allowed self-merge (else one Ship question for all of them), then unblocking cards whose reason is gone. Builders branch from `origin/main` and never stack on another card's branch (blocked "chờ PR #n" instead); review sends stacked PRs back. Cards are sized as one PR a dev finishes in one session, without separate R&D/audit/ADR cards for work a dev can do.
- `8sync ccc meet` takes `--as` like every `auto` verb.
- `8sync ccc help` and the site's command table list `awake --screen-off`.

## [0.104.0] — 2026-10-19
### Added
- **`8sync awake` turns the screen off when nobody is at the machine** (Windows). Owner (2026-10-19): "8sync awake --while-rooms fix máy chưa sleep màn hình được". The power plan had the display timeout at 180 min, and apps that reset the display timer (a room's windowed Godot runs with `keep_screen_on`) kept it on all day while rooms worked. The hold loop now checks every minute and turns the screen off (`WM_SYSCOMMAND` / `SC_MONITORPOWER`, posted) after `--screen-off N` minutes without mouse/keyboard input, default 10, `0` leaves it to the power plan. It never does when an app holds the display (video), when the machine has Modern Standby (screen off can pull it into standby), or when any of those readings is unknown. A touch turns it back on; the machine keeps working. Proven live: `--screen-off 1` with nobody at the keyboard, the console display state went from on to off on the first check and stayed off with the hold still in place.

## [0.103.0] — 2026-10-19
### Added
- **Điện và tiền điện trong chip "Máy" của HQ.** Owner (2026-10-19): "Trên hq ui xem đc ram cpu gpu điện tiêu thụ chi phí vnd kiểm soát chặt tiêu hao". The chip shows the watts next to the load; its panel shows watts now and ₫/giờ, kWh and ₫ today and this month. CPU package energy is measured (Windows RAPL "Energy Meter" counter through `typeperf`, no admin; Linux powercap `energy_uj` when readable), GPU board power is measured (`nvidia-smi power.draw`), the rest of the box (board, RAM, disks, fans, PSU loss) is an editable estimate, default 60 W. Price default 3.500 ₫/kWh (EVN top household tiers + 8 % VAT), editable. The HQ server counts every 15 s from start (`instrumentation.ts`), with or without a tab open; a gap longer than 90 s (asleep, stalled) counts only the measured CPU energy. Ledger: `~/.local/state/8sync/hq/power.json`, 70 days.
- **Daily electricity budget.** Set in ₫ from the panel. When today's spend reaches it, HQ pauses the team (`8sync ccc auto pause`) and keeps it paused for the rest of the day: "Chạy liên tục" answers 409 with the reason until the budget is raised or cleared.
- **"Thức & màn hình"** in the same panel, from the new **`8sync ccc awake status [--json]`** (also `8sync awake status`): screen on/off/dim (Windows console display state), what keeps the screen on (from `powercfg /requests` when HQ runs elevated), minutes since the last mouse/keyboard input, whether anything holds the machine awake (system-wide execution state; Linux: an `8sync` sleep inhibitor), time asleep since boot (Windows unbiased interrupt time; Linux `CLOCK_BOOTTIME − CLOCK_MONOTONIC`), Modern Standby or not, and how many rooms finished a turn since the owner left.
### Changed
- The "Máy" chip shows on phones too (it was hidden below 640 px), and its panel is a popover so the settings fields take typing.

## [0.102.1] — 2026-10-19
### Fixed
- **Typing from a phone.** Owner (2026-10-19): "input hq gửi không được ở link vps". Room and shell terminals get a real input line under the screen (Enter or "Gửi" sends the line + Enter; empty = Enter): a phone keyboard with IME, Vietnamese or autocorrect types into it reliably, where xterm's hidden textarea may drop keys. Write endpoints were checked through both VPS links (`/hq` and `:8443`): they pass HQ's checks.
- A terminal reopened, opened in a second tab, or redrawn on a theme change no longer types junk (`;5R` at a prompt, `R` in vim, a stray key in a Claude dialog): the kept screen a late viewer gets is sent as a `replay` once the bridge has had input, and the page does not answer the queries in it (ConPTY's opening `ESC[6n`, DA…) a second time.
- After HQ restarts on a new version, an open page reloads itself (`/api/version` checked every minute and when the tab comes back; a build chunk that fails to load reloads once) instead of running the old build against the new server.
- The self-restart waits while the HQ shell is open (it would kill what runs there) and says so once; it goes ahead when the shell closes. Proven on Windows with a second HQ on another port: replacing its binary restarted it on the other version within 30 s.


## [0.102.0] — 2026-10-19
### Added
- **Shell trên máy, nổi trên mọi view của HQ.** Owner (2026-10-19): "cần 1 float terminal bên ngoài để sài có hint terminal full như orca". Header button "Terminal" (or Ctrl+`) opens a draggable, resizable panel (a bottom sheet on a phone) with a real shell on the PC: `8sync ccc term --shell` runs 8sync's zsh (prompt, completion, autosuggestions — the grey hint, → accepts it) when installed, else PowerShell / `$SHELL`, in the folder in view. One shell, shared by every tab; closing the panel keeps it 30 minutes, "Tắt shell" ends it. Refused through the `--public` quick tunnel (a link key alone never gives a shell); allowed on the PC and behind a proxy that logs in first and hands HQ a loopback request.
- Room and shell terminals get a key bar for what a phone keyboard lacks (Esc, Tab, arrows in the terminal's cursor-key mode, Enter, ^C ^D ^R ^L) and a one-line hint.
- **`8sync hq ui` follows `8sync up`.** An HQ started without `--public` from the installed UI checks its binary every 30 s; when a different version is installed it stops the UI and starts again on the new binary (same arguments), so a remote link shows the new HQ without anyone at the PC. HQ older than 0.102.0 still needs one Ctrl-C + `8sync hq ui`.
### Changed
- Off loopback, HQ tries the live event stream first (messages, tasks, terminals) and polls only when no byte arrives (a Cloudflare quick tunnel holds streams back; a VPS reverse proxy does not), so a link through such a proxy updates as fast as the local page. Terminal streams ping at once so the page can tell within 4 s.

## [0.101.2] — 2026-10-19
### Fixed
- **A room's terminal works through the internet link.** Owner (2026-10-19): "Link public không connect terminal được". The Cloudflare quick tunnel holds the terminal's event stream back, so off loopback HQ now polls `GET /api/sessions/<id>/term?gen=&since=` (bytes after a running byte cursor; a cursor from another bridge or older than the kept 256 KB replays the screen) every 150 ms while the room prints and 600 ms while it is quiet. Keys and resizes were already plain POSTs. A polled terminal closes 60 s after the last poll, like a viewer leaving.

## [0.101.1] — 2026-10-19
### Fixed
- **A team that hit the 5-hour limit comes back at the reset again.** In 0.101.0 a reading taken before the reset counted as unknown; with no 7-day reading (this machine's status line has none) the subscription `$`/hour fail-safe then judged the spend that filled the window, so resume and revive refused until the lease ran out. A reading whose `resets_at` has passed now counts as 0 % (the window did start over).
- `auto up` / `auto on --loop` notes no longer say background rooms never resume after a usage limit; they point at `[8sync:resume]`, `auto revive` and `8sync awake --while-rooms`.
- Docs: the omp team runs on another provider (GLM, OpenAI…); `--omp` is refused for any `anthropic/…` default model, Console key included.
- CI typechecks the shipped omp extensions on every PR (the first v0.101.0 tag failed only in the release job).

## [0.101.0] — 2026-10-19
### Added
- **Stuck rooms restart by themselves while auto runs.** Owner (2026-10-19): "auto xử lý kẹt … tự kích hoạt chạy lại tiếp khi usage hồi lại biết mấy giờ có lại usage".
  - The StopFailure record now says when to resume. `rate_limit`: the reset time from the status line (`rate_limits.*.resets_at`; the window ≥ 90 % full, +60 s), at most 2 in a row and never more than 24 h out — the caps of Claude Code's own `autoContinueAtUsageLimit`, which background (`auto up`) rooms do not get. `overloaded` / `server_error` / `unknown`: after 1, 2, 4… min (≤ 15 min, ≤ 5 in a row). `max_output_tokens`: at once (≤ 2). Login, billing and request errors wait for the owner.
  - The `8sync-inbox` mod hands the room an `[8sync:resume]` prompt when it is idle and the resume is due (at most twice per stop, never while another delivery is in flight), only while auto runs for that project and inside the usual rails (subscription lease, usage window, `$`/hour cap).
  - Usage snapshots keep `five_hour_resets_at` / `seven_day_resets_at`, so rooms resting on a reading go on at the reset instead of waiting up to 5 hours for it to go stale (0.101.1 fixes how a past-reset reading counts).
  - `8sync ccc . ls --json` / `8sync ls --json` add `stalled_resume_at`; a resumed room is no longer shown as stuck. The stop record resolves home like the other hooks, so it also works on Windows without `HOME`.
  - Usage comes only from the status-line JSON Claude Code produces. 8sync never reads Claude credentials or calls the OAuth usage endpoint (Orca does; not copied).
- **Rooms that died with the machine come back.** Owner (2026-10-19): "tắt máy chứ chưa tắt ccc auto … mở máy lên hiển thị đang làm nhưng mà lại không có làm". `auto up` rooms are Claude Code background sessions; a shutdown kills them, and Claude Code's own wait-for-the-reset (`autoContinueAtUsageLimit`) only works in a live interactive session, never in `--bg`.
  - New `8sync ccc auto revive`: for every project auto runs for, each team room (a known role) whose background session is gone from `claude agents` resumes in the background — same conversation, same prompt as `up`, registry rebound to the forked id. It never renews the lease, never starts a room that never ran, skips a room the owner already reopened, and does nothing while auto is off, paused or gated.
  - HQ runs it at most every 2 minutes while "Chạy liên tục" is on, and right after the owner presses Chạy (a fresh owner lease after a night off).
- **`8sync awake --while-rooms`** (also `8sync ccc awake`): keeps the machine from sleeping while rooms run — Windows `SetThreadExecutionState` (no new crate), Linux `systemd-inhibit`, macOS `caffeinate -i`; the screen may still turn off. `--while-rooms` lets go after two checks a minute apart with no live Claude Code session; `--hours N` (default 8, at most 24). Never starts a room or renews the lease; on a subscription it prints where unattended runs belong. Proposed by room `core` after the night the rooms died with the machine.
- **HQ: plan usage like Orca's meter** — a bar, "N% used", the time left to the 5-hour reset ("4h 11m") and the 7-day percentage, from the status line only. Orca's per-model weekly line ("Fable") comes from the OAuth usage endpoint, which 8sync does not call.
- **A second team on omp.** `8sync ccc auto up --omp` opens an `omp-<role>` room per role (tmux on Linux/macOS, a Windows Terminal tab on Windows); `auto omp on|off` (and the HQ switch) toggles the team; omp rooms opened with `8sync . <name>` join too. Refused while omp's default model is `anthropic/…`: a Claude subscription stays in Claude Code.
  - New omp extension `8sync-team.ts` (installed by `harness global`): HQ inbox messages when the room is idle, target-queue nudges (`8sync ccc auto nudge`, ≤ 1 per 10 min, ≤ 6/h), resume after provider rate-limit/overload errors (1 → 15 min, ≤ 5), and its own `ask` answered from the options while auto runs (owner-only items go to the final answer).
  - `8sync ccc msg <room|--all> "<text>"`: any room of either team messages another. Room messages reach the inbox framed as data from that room, never as the owner's words, and show in HQ chat. `ls --json` rows gain `inbox_id` (`omp-<fnv64>` for omp rooms); `ccc_core::transcript::Row` gains the public field `inbox_id`.
- **`8sync hq ui --public`**: a Cloudflare quick tunnel to HQ with a login link `https://<host>/api/login?k=<key>` that works for 10 minutes; the session cookie (HttpOnly/Secure/SameSite=Strict) is signed with the key and checked on the server for 12 h. New host and key per start; HQ only accepts the link file written by the launcher that started it (per-run nonce); the file is removed on exit. Remote pages poll (quick tunnels drop SSE). No `cloudflared` → install hint and HQ stays local.
- HQ: stuck captions with the restart time ("Hết usage — tự chạy lại lúc HH:MM", only while auto can act), team labels and delivery to omp rooms, Đội omp switch, remote-link status, security headers (no framing, no referrer).
- Guard: room messages are delivered only while auto runs inside its rails, quoted line by line so they cannot pass for the owner's words; the guard and kit deny rules cover the HQ UI token, the public-link file, `secrets.json`, the usage snapshots, permit answers and the inbox (case- and slash-insensitive); omp rooms get the same path block from the `8sync-team` extension, and an omp room on (or with an unknown) `anthropic` provider gets owner messages only.
- Website: an "On / off" box (team, omp team, pause, HQ, HQ from the phone, emergency stop), the new rows in the command table, and `docs/huong-dan.md` / `docs/hq.md`.
- **HQ: "@" inserts a file or folder path** in "Gửi cho mọi phòng" and in the room message box.
  - Type `@` to list the project's folders and files. Type `@src/` to go one level down, or `@../` to go up and out of the project.
  - ↑/↓ choose, Enter or Tab picks, Esc closes.
  - On send, each `@path` that exists becomes an absolute path, so a room in a worktree or another folder opens the same file. Unknown names and e-mail addresses stay as typed.
  - The listing (`GET /api/fs`) returns names only and sits behind the HQ token.

### Changed
- Size ceiling 7040 → 7168 KiB: linux-x86_64 7,280,784 B (+81,952 B over v0.100.15) for the omp extension, resume, omp team, room messages, public link, revive and awake; no new dependency (`scripts/size-gate.sh`).

## [0.100.15] — 2026-10-18
### Fixed
- **A question left on screen goes to the critic after a minute.** Seen live 2026-10-18: questions asked while auto was paused stayed with the owner for an hour, even after auto was back on, because the delegate hook only sees a question as it is asked.
  - While "Chạy liên tục" is on, HQ takes any background room question that has waited 60 s and checks it with `8sync ccc delegate check`. That command uses the hook's rails: Ship, secrets, money, deploys and high-risk questions stay with the owner.
  - If the critic may take it, HQ queues the critic route in the room's inbox and closes the dialog with one Esc through the room's terminal bridge. Each question is handled once.
- `auto up --clear-ss` names a deleted or kept session by its room (`lead`, `rd`), not by the whole `/goal` prompt that older sessions were titled after.

## [0.100.14] — 2026-10-18
### Fixed
- **One git repo = one team, even when one repo sits inside another.** Seen live 2026-10-18: `ai-game-studio` is a repo inside `8sync-startup`; `auto up` in the outer one took over the game's rooms, and `auto add --now` there pushed a ZUS task into the game rooms.
  - `auto` finds the project by its git repo (a worktree counts as its repo). A subfolder with its own `package.json` (`apps/hq-ui`) no longer opens a second team.
  - Rooms running in a nested repo are not this repo's. A registry entry that points at one starts a new room instead of sharing that conversation.
  - Room names clash only across repos, and the board of a new nested repo no longer files under its parent's board.
- **`auto down` stops only this repo.** Several repos can run teams at once. `down` takes this repo out of auto and the others keep running; only the last one out pauses auto. It also finds rooms that `up` had not yet rebound, by their title. Nothing is deleted: conversations are kept and `auto up` resumes them.
- **HQ counts worktree rooms under their repo.** The broadcast box said "3 phòng" while ai-game-studio ran 8; it now says 8 and sends at the repo.
- **One question per decision.** Seven rooms asked the owner the same question for target #33. Rooms now check `su-code/DECISIONS.md` and the card notes first, and when another room is already asking, they note a proposal on the card instead.
- The lead's `/goal` fits under Claude Code's 4,000-character cap again: the backup loop inside it points at the lane playbook instead of repeating it.

### Added
- `8sync ccc auto up "<task>" [--check "<cmd>"]`: the first card goes in with the team, at the head of the queue, before any room starts.
- HQ: attach images and files in "Gửi cho mọi phòng", with the Đính kèm button or by pasting an image (up to 5 files, 10 MB each). They are copied into the repo at `.claude/hq-uploads/` (git-ignored) and the task lists their absolute paths, so every room opens them with Read.
- HQ: clicking a project folder in the sidebar opens that project's Tổng quan. The chevron still folds the list.
- HQ: "Anh cần trả lời" says when the critic is off (auto paused or off), so rooms are waiting on the owner. A question already on screen still needs the owner's click.
- `--clear-ss` explains why a session was kept (its worktree has commits that were not pushed) and what to do.
- Site: the steps name the HQ buttons in English, list the ba and ui rooms, and say what `down` and `--clear-ss` keep. The room list stays in view beside the steps.

## [0.100.13] — 2026-10-18
### Fixed
- **A room that hits the usage ceiling rests and comes back, instead of stopping for good.** Seen live 2026-10-18: the ui room hit 97% of the 5-hour window, its `/goal` counted `cap` as a stop condition, and it never resumed after the window reset (HQ showed it "Kẹt").
  - `auto wait` now rests through the whole wait while capped, without claiming a card, and only then reports `cap`.
  - The `/goal` tells the room to wait again.
  - Only `off`, `paused` or an ended lease stop a room.
- **Room names stay room names.** `auto up` resumed a background room without `--name`, so Claude Code titled it after its `/goal` prompt. HQ then showed "/goal Phòng `qa` (vai …" in the sidebar, and the hint under "Gửi cho mọi phòng" filled the page with the full prompt.
  - The resume now passes `--name`.
  - HQ shows `qa` for such a title and cuts any name longer than 32 characters (sidebar, Văn phòng, broadcast hint).

## [0.100.12] — 2026-10-18
### Fixed
- **`8sync up` can no longer leave Windows without `8sync.exe`.** Seen live on 2026-10-18: `8sync.exe` was gone, and only `.8sync.old.<pid>` and `.8sync.new.<pid>` were left. The kit's guard hook (fail-closed) then blocked every Claude Code session on the machine until the file was copied back by hand.
  - **The likely cause:** rooms still running an older image each auto-update when they see a newer release, all renaming the same `8sync.exe` at once.
  - **One update at a time:** an update lock (`.8sync.update.lock` in the install dir; a lock older than 10 minutes is taken over).
  - **No double replace:** an update whose release is already in place (same sha256) does nothing.
  - **No empty slot:** if moving the new binary in fails, the old one is renamed back, and if even that fails it is copied back.
  - **Self-heal:** when `8sync.exe` is missing, the newest `.8sync.old.*` is copied into place, and those copies are never swept while the binary is missing. A `.8sync.new.*` older than a day is swept.

## [0.100.11] — 2026-10-18
### Fixed
- **The critic now actually answers for an away owner: rooms ask through AskUserQuestion.** Seen live on 2026-10-18:
  - `delegate` was on (60 s), yet `su-code/DECISIONS.md` stayed empty. The R&D room had asked about BiRefNet as plain text at the end of a turn and waited. The delegate hook only sees an `AskUserQuestion` call, so the critic never got the question.
  - Every room's `/goal`, loop tick and new `.claude/loop.md` now say: ask the owner through `AskUserQuestion` (the recommended option first), never in prose before stopping.
  - Rooms already running pick this up after `8sync ccc auto up --clear-ss`. An existing `.claude/loop.md` is never overwritten; add the two lines from a fresh one by hand if you keep your own.
- **One Ship question per project.** The BA room shares the backlog lane with the lead and also asked the owner to Ship PR 20. Only the lead asks Ship now.
- **HQ explains why a Ship question waits.** It shows "Câu Ship (merge, release, deploy): chỉ anh duyệt", meaning the critic never answers it, however long the owner is away. A room waiting on a question typed as plain text is marked as one the critic cannot see. Ship staying with the owner is unchanged and intended.
### Fixed
- **The site catches up with v0.100.6–v0.100.10.**
  - HQ's tabs (Tổng quan, Board, Flow, Preview) and the Máy chip are listed under "Open HQ".
  - The full team lists `arch`, with a pill and a short note on what it does (ADR from The System Design Primer before an `arch` card is built, a daily sourced radar, measured scale).
  - "Answer only what needs you" mentions opening the room's terminal in Orca and copying `claude attach <id>`.
  - The reference lists `--label arch`.
  - Checked in Edge at 1440 px and 500 px.

## [0.100.10] — 2026-10-18
### Changed
- **The architect's daily tech radar works from a source catalog, primary sources first.**
  - **Source catalog:** `su-code/research/radar-sources.md` is built from the repo's manifests (`package.json`, `Cargo.toml`, `go.mod`, `pyproject`). Each main dependency gets its GitHub `releases.atom`, official changelog and registry page. Each source keeps a `last_seen`.
  - **CVEs:** the stack's local audit tools run first (`pnpm audit --json`, `cargo audit`, `govulncheck ./...`, `pip-audit`), so the dependency list of a private repo is never sent out. Details of each advisory are read with a plain GET of `https://api.osv.dev/v1/vulns/<id>`.
  - **Primary sources first:** aggregators (HN, newsletters) only flag an item, then the room reads the original.
  - **No repeats:** items already in an earlier radar are dropped, matched by normalised URL and version.
  - **Fixed ranking:** a CVE hitting the version the repo uses, then a breaking change that needs code changes, then a release with a measurable gain, then the rest.
  - **Sourced lines:** every line has version, date, source link and impact on the repo. A version or number not found in the source is not written.
  - **Failure isolation:** a failing source is logged and the pass goes on.
  - Checked both endpoints live: a GitHub `releases.atom` feed and an OSV advisory by id both answered 200.

## [0.100.9] — 2026-10-18
### Added
- **An Architect room (solution architecture) in the full team.** `8sync ccc auto up --roles full` (HQ **Team đầy đủ**) now opens `arch` in place of the second builder. The team stays at 8 rooms.
  - Room names `arch`, `architect`, `solution…` and `sa` map to it. It runs on Opus, on its own loop like `rd`.
  - It holds no board lane, so a card labelled `arch` never waits on a room the team lacks.
  - Cards labelled `arch` (new service, DB, queue, cache, scale, public API) get an ADR before they are built. The room runs `/sysdesign` (sections of The System Design Primer plus the stack's official docs, with back-of-envelope numbers), writes an ADR with at least 2 options and the trade-offs, then notes `ADR: …` on the card. The ADR goes where the repo already records decisions (`docs/adr/`, `DECISIONS.md`, `docs/*DECISION*.md`), else `docs/adr/card-<id>-<slug>.md`, never a parallel place.
  - The lead moves an `arch` card to ready only after that note. With no `arch` room, the lead writes a short ADR itself.
  - On cards in review, the room checks the diff against the ADR and `docs/adr/budgets.md`, and leaves an `[arch]` note. Review still decides.
  - Every day it does three passes:
    - a sourced tech radar (new versions, breaking changes, CVEs of the repo's own stack), saved to `su-code/research/radar-<date>.md`;
    - a measured scale-health pass (bundle or binary size, build and test time, slow queries, RAM, cold start, cost per request) against the budgets. Hard-coded limits (concurrency, pools, timeouts) go into the budgets with their reason;
    - a drift pass: decisions that contradict each other or the code, stale service lists or diagrams, and drifted `file:line` references get one reconciling ADR or a doc fix.
  - The worst bottleneck becomes an `arch` card with a measuring `--check`. With no measured number, no card is opened.
  - `auto add --label arch` is accepted. HQ shows an "kiến trúc" chip on those cards and an Architect icon for the room.

## [0.100.8] — 2026-10-18
### Fixed
- **`8sync up` now verifies the checksum even when the GitHub API gives none.** Seen on v0.100.4: the update installed fine, but printed "checksum NOT VERIFIED". The API had been rate-limited (or had not finished the digest), and the fallback had nothing to check against.
  - Each release now carries `<binary>.sha256` (sha256sum format) next to every binary.
  - When the API has no digest, `8sync up` downloads that file and checks against it. That link is a plain download, so the API rate limit does not apply.
  - Only a release with neither still warns. The message now says both were missing.

## [0.100.7] — 2026-10-18
### Added
- **HQ "Máy" chip: how loaded the machine is while rooms run.** The header shows the busiest of RAM, CPU and GPU. It turns amber from 75 % and red from 90 %. It refreshes every 5 s, and only while the page is visible.
  - Click it for bars per resource: RAM used / total, CPU across all threads, and per NVIDIA GPU its load, VRAM and temperature (from `nvidia-smi`).
  - Under the bars: how many Claude Code and Node processes are running and the RAM they hold (`tasklist` on Windows, `ps` elsewhere).
  - On Linux, **Xem trước** runs `8sync clean --dry-run` and **Dọn an toàn** runs plain `8sync clean`. The page never runs `--deep`, `--ram` or `--timer`. Other OSes get a one-line note instead.
  - Probes run with argv only and a 4 s timeout. A probe that fails is left out of the panel.
  - Checked live on Windows. The Linux clean buttons have unit tests only (not verified live).

## [0.100.6] — 2026-10-18
### Added
- **A room's terminal opens in Orca, in the room's own worktree.** The HQ terminal panel adds **Mở trong Orca** when [Orca](https://github.com/stablyai/orca) is on the machine. It opens a shell tab in the room's folder (or its repo root when Orca does not know that worktree), types `claude attach <id>` and brings the tab forward.
  - **Luôn mở Orca** makes every "Mở terminal" button go straight to Orca. If Orca fails, the web panel opens instead.
  - **Copy lệnh** copies `cd "<room folder>"; claude attach <id>`, which works in bash and PowerShell.
  - The Orca CLI is found through `ORCA_CLI_COMMAND`, the CLI bundled with the app, or `PATH`. On Linux only `orca-ide` is used, because a bare `orca` there is the GNOME screen reader.
  - Orca is called with argv only, never through a shell.
  - Two things Orca does that HQ works around: `terminal create --focus` times out when that worktree is not the one open, and `--command "claude …"` is treated as an agent launch and times out. HQ creates the tab plainly, then uses `terminal send` and `terminal switch`.
  - Checked live on Windows: the ai-game-studio lead room opened in an Orca tab showing its pending question.

## [0.100.5] — 2026-10-18
### Added
- **HQ Preview tab: see the product as the team builds it.** HQ lists the screenshots rooms save under `qa/evidence`, `evidence`, `screenshots`, `su-code/shots` and `docs/screenshots` in each live project and its worktrees. It reads 3 folder levels deep, skips files over 15 MB and links that point outside the repo, and shows the newest 120 per project. Shots are grouped by card (`card-<id>` in the file or worktree name), newest first. Click one for a large view with ← →, the full path and **Mở card**, which opens the card on Board. The QA and UI rooms now save UAT shots as `qa/evidence/card-<id>-<slug>.png`. `GET /api/preview` lists them, and `GET /api/preview/file?id=` serves an image only by an id from that list (`nosniff`, `private, max-age=60`).
- **HQ Flow tab: where every card has been and where it is now.** Each card is one row across Backlog → … → Approved → Done → Blocked, rebuilt from its board notes:
  - coloured segments for moves forward;
  - a dashed return arc for a bounce, and a lower arc into or out of Blocked;
  - the current lane marked with the holding room's role icon;
  - closed cards ending at Done (✓) or Bỏ (✗).

  The column heads say how many cards sit in each lane and which room holds them. Hover or focus (← → inside a row) shows who moved the card, when, and the note. Click a row to open the card. A **Vòng lặp** panel lists each `/ship-loop` (`su-code/ship/*/LOOP.md`) with its iteration and last evidence line (`GET /api/loops`). The card sheet adds **Lịch sử**, the card's last 12 notes.
- **HQ Tổng quan tab for wide screens (default at ≥1600 px).** "Anh cần trả lời" is pinned on top, side by side. Below it, each live project gets one block with five panels:
  - rooms and their current step;
  - a mini board (lane counts and the first cards with P0/P1);
  - the latest preview shots;
  - the cards that just moved;
  - the latest chat.

  Each panel links to its full tab. On a wide screen Văn phòng also splits into two columns: "Đang làm gì" on the left, the pixel office on the right.
- **Board shows closed cards in a Done column** between Approved and Blocked. It lists the last 10, one line each, with "xong/bỏ x trước"; widen the column to see the evidence. The header adds "· N đã xong gần đây", so an approved card that was merged and closed is no longer "lost".

- **A room's real terminal opens inside HQ.** "Mở terminal" (room brief, "Anh cần trả lời") now opens a wide panel with the room's live Claude Code screen instead of a separate window. You can type a message, move between answers with the arrow keys and press Enter, and scroll back. Closing the panel leaves the room running in the background. "Mở cửa sổ riêng" still opens a native window.
  - How it works: Claude Code documents no way to send input to a background session from outside, so the new `8sync ccc term <session-id>` runs `claude attach` inside a pseudo-terminal (ConPTY on Windows, crate `portable-pty`, MIT). It relays the screen over stdin/stdout. The HQ web asset stays pure JS, with no native module.
  - Each room has one terminal, shared by every tab. Its last 256 KB of output is replayed to a tab that opens late, and it closes 60 s after the last viewer leaves.
  - New route `GET|POST|DELETE /api/sessions/<id>/term` (HQ token required). It opens only a live background room's own session id.
  - Checked live: the rd room of ai-game-studio was attached through Edge, the screen streamed, and the room was still `background idle` after closing.

### Fixed
- **Site: the one-project steps read 1 to 7 again** (they read 2, 4, 6… because the list shared a CSS counter with another list).
- **Site: shorter steps, plus a reference you can expand,** "Every command and option". It lists every `auto` command with its flags (`--roles`, `--loop`, `--here`, `--now`, `--prio`, `--clear-ss`, `--after`, `--hours`, `--usd-per-hour`, …), grouped as Team / Work and board / Owner away / Sessions. Checked in Edge at 1440 px and 500 px.
- **Văn phòng groups a room in a worktree under its repo.** `card-14-bakeoff` now shows under `ai-game-studio`, with one header and one set of team buttons, and the room card shows the worktree branch. The meeting room appears only when 2 or more rooms of the repo are present.
- **A card's last note on Board is one line again.** It had spilled into a tall block.
- **HQ "Cách dùng" describes the team as it works now:**
  - open the team (5 rooms, or 8 with "Team đầy đủ");
  - hand out cards, with P0 for urgent work;
  - follow the Board and each room's Nhật ký;
  - answer only what needs you (60 s rule, Ship stays with the owner);
  - "Dọn & mở lại" after an update.

  It no longer tells you to "tạo nhân viên theo vai trò". Checked in Edge against live rooms.
- **Chat phòng no longer cuts room names to "r…" and "d…"** when a room runs in a long worktree path. The name keeps its width, and the path is cut from the left.

## [0.100.4] — 2026-10-18
### Added
- **A background room no longer hangs on a "proceed?" prompt nobody sees: after 60 s of silence it carries on by itself.** In the UAT the dev room waited 15 minutes on one. A new `PermissionRequest` hook (`8sync ccc hook permit`, https://code.claude.com/docs/en/hooks#permissionrequest) acts when auto and delegate are on and the owner has not typed in the room for `delegate_after_s` (60 s by default). It posts the request to HQ, where **Anh cần trả lời** shows the tool, its description and the command (secrets masked), with **Cho phép** / **Từ chối** and a countdown that says what silence will do. With no click:
  - everyday work inside the project proceeds, but only in exact shapes:
    - shell commands, chained with `&&` only, written with plain characters (no quotes, `$`, backslash, redirects or `~`), and with no free flags (three reviews found a value-taking flag such as `--output`, `-o` or `--upload-pack` in every looser rule):
      - `cargo build|check|test [-q] [-p <crate>] [--workspace]`;
      - `go build|test|vet ./...`;
      - `pnpm|npm|yarn [run] test|lint|build|typecheck|check[:x]` with no other arguments;
      - `git status|diff|log` with no arguments;
      - `git push [-u] origin card-<n>-<slug>`, which pushes only a card branch and so never main or HEAD;
      - `8sync ccc auto board|lint|queue|status [--json]`;
    - files: edits and writes inside the repo (symlinks resolved). Not allowed:
      - `.git`, `.claude`, `.github` and other CI files, `.husky`, `.mcp.json`, `.vscode`;
      - the files that decide what a run executes: `package.json`, `.pnpmfile.cjs`, `Cargo.toml`, `build.rs`, `Makefile`, `.cargo`, `.npmrc`, toolchain files, …;
      - instruction files later sessions obey (`CLAUDE.md`, `AGENTS.md`, skills);
      - credential-looking files (`.env*`, `*.pem`, `*.key`, `id_rsa*`, …), which are not read either;
    - reading docs: `https` pages on a named public host (no IP in any spelling, no port, no wildcard DNS such as `nip.io`), with no query string and no credentials;
  - anything else is skipped and is left for the owner (the room notes it on its card and does other work). That covers:
    - `pnpm install`, `git add`, merge, tag, release, any other push, moving cards;
    - Grep, Glob and Skill (a folder scan could reach `.env`/`.npmrc`, and a skill can start a loop only the owner starts), a subagent with remote isolation or unknown options, edits in `node_modules`, reads or writes of kit config (`.mcp.json`, `.claude/`), and writes to the memory files later sessions read (`su-code/STATE.md`, `KNOWLEDGE.md`, loop files);
    - `pnpm exec`/`npx`, `gh`, `curl`, inline `python -c`/`node -e`, PowerShell cmdlets;
    - anything outside the project;
    - tools 8sync does not know (MCP).

  Limits:
  - `cargo test`, `go test` and `pnpm test` run code the room wrote, the same as in auto mode with the owner present. A room that edits a source file and then runs the tests can therefore do anything that code does. The allowlist cannot stop that; only a sandbox can. The hook narrows what proceeds unattended but does not guarantee nothing ships.
  - A URL path can still carry a little data out.

  Every decision made without the owner is logged in `~/.local/state/8sync/ccc/permit/auto.jsonl`. The owner's click always wins, a "Từ chối" included. Claude Code still applies the settings' deny rules after a hook allows. The guard refuses any tool call that names the answers folder, and each request id carries a random part. This blocks a direct attempt to approve itself, but a room that writes and runs its own script is not stopped by it. With the owner present, Claude Code shows its usual prompt.
- **Cards have a priority, P0 to P3, and rooms take the most urgent first.**
  - Setting it: `8sync ccc auto add "<việc>" --prio P0`, `auto move <id> ready --prio P1`, `auto prio <id> P0|none`.
  - Claim order: `claim` and `wait` pick by priority, then queue order. Unset counts as P2.
  - Text board: `auto board` lists each lane in that order and prints `P0` next to the id.
  - HQ Board: same order. A card shows a red **P0 · gấp nhất** or amber **P1 · gấp** chip; **Kế tiếp** now marks the card a dev room really takes next. The detail sheet has a P0/P1/P2/P3 picker (new route `POST /api/board/prio`, HQ token required) and the matching command.
  - The lead room is told to mark a user-blocking bug, or anything the owner calls urgent, P0.
- **A full product team in one click.** `8sync ccc auto up --roles full` opens 8 rooms: lead, ba, rd, dev, dev2, ui, qa, review. HQ has a **Team đầy đủ** button that warns about quota first: 8 sessions cost about 8 times one, and the whole team pauses at 90% of the 5-hour/7-day window.
- **"Nhật ký" shows what a room did, live.** Chat phòng lists the room's latest 80 steps from its Claude Code transcript (local file, last 1 MB): what you typed, Claude's replies, each tool call with ok or error (the error's first 200 characters on expand), and subagents it started. The newest step is at the bottom, and the list refreshes every 4 s while the tab is visible. It follows new lines unless you scrolled up. Shell commands are never shown: a call shows its description, or only the program name (`git`, `pnpm`). Every text is passed through a secret masker first, a subset of the CLI's rules plus URL credentials and `--password` flags (known token prefixes, `name=value` secrets, Bearer, PEM blocks, long opaque strings; heuristic, not a guarantee). **Mở log đầy đủ** opens the room's terminal. New route `GET /api/sessions/<id>/activity` (HQ token required).

### Changed
- **`8sync ccc auto up --clear-ss` now also restarts rooms that run an older kit.** A background room started before the kit's `settings.json` last changed is stopped and resumed on the same conversation, so new hooks load with no manual step. A room in the middle of a turn, or one whose transcript is missing, is left running. The rooms are rebound to their new session ids. This is HQ's **Dọn & mở lại** button.
- **The default team is 5 rooms: lead, dev, qa, review and rd** (rd on Opus researches what blocks the others). `--roles small` is the same set, and `--roles full` gives the 8-room team.
- **The critic that picks for the owner runs on Opus** (was Sonnet). It grades product and technical questions while the owner is away.
- Release size ceiling 6912 → 7040 KiB, attributed in `scripts/size-gate.sh`. The linux-x86_64 binary is 7,104,624 B, 26,736 B over the old ceiling, from the board, headless team, permit hook and priority work in 0.100.x. No new dependency.
- **HQ sidebar is the list of rooms, and a click opens the room.**
  - Grouping: each live room sits under its repo. Worktrees (`<repo>/.claude/worktrees/<x>`) fold under the repo instead of showing as separate projects.
  - Each row: the role icon, the room name and its state in words (Đang làm, Chờ anh, Chờ card, Rảnh, Kẹt, Giữ card). A room waiting on you gets an amber "Chờ anh" badge, and its repo shows the count.
  - Clicking a room opens Chat phòng with a brief on top:
    - what it is doing and how long ago;
    - the card it holds;
    - what it asks you (a question or a permission request, with the same answer card as the office);
    - **Mở terminal**: the HQ drawer for tmux rooms, `claude attach` in a new window for background sessions;
    - the message box to send it work.
  - Before, a click only changed a filter and the page looked the same.
- **HQ Board cards read at a glance and open a detail sheet.**
  - Tags: the leading tags a lead writes (`[#1 v1]` epic/version, `[core]`/`[art-director]`/`[qa]` role) become chips. The label (bug, feature, qa) is a coloured chip. The title is clamped to 3 lines.
  - Status on the card: who holds it and for how long, its PR, how often it bounced (amber from 2), and "thiếu lệnh check" in red.
  - Lanes: each has its own restrained colour, a count and its purpose. Approved and Blocked are tinted harder when they hold cards.
  - Detail sheet: click or Enter on a card opens a right-side sheet with:
    - the full text, tags and lane;
    - priority and the check command (copy button);
    - the latest note and the claim;
    - the PR (a link when the card stores a pull URL) and the reviewed SHA;
    - bounces, and when it was added and by whom.

    Esc closes it and focus returns to the card.
- **The sidebar no longer says "No folders yet" while it lists projects.** Projects with running rooms appear by themselves. Folders added in HQ without a room are listed under "Chưa có team" and open the office's **Mở team** button. The add box is now "Mở team ở repo mới" and says it is only needed for a repo with no room yet.
- **The site, README and `docs/huong-dan.md` walk through one project in 7 numbered steps.** The steps are: install, open HQ, add the folder, start the team, give it work, answer only what needs you, update or stop. Each step shows the HQ button and the terminal command beside it.

## [0.100.3] — 2026-10-17
### Added
- **HQ shows what a room is asking and how to answer it.** In the UAT the game lead waited nearly 2 hours (13:44 → 15:40 UTC in its transcript) on a Ship question while HQ only said "input needed". HQ now reads the open question from the room's Claude Code transcript (local file, last 512 KB). "Anh cần trả lời" at the top of the office lists every waiting room with its questions and numbered options. A permission prompt shows its description, never the raw command. **Mở terminal để trả lời** opens `claude attach <id>` in a new window (Windows `cmd`, macOS Terminal, Linux `x-terminal-emulator`/gnome-terminal/konsole/kitty/alacritty/xterm); **Chép lệnh** copies it.
- **Team buttons in HQ, so `8sync hq ui` is the only command you need.** Each project in the office has **Mở lại team** (`auto up`), **Dọn & mở lại** (`auto up --clear-ss`, after a confirm) and **Dừng team** (`auto down`, after a confirm). A folder added under Projects with no room running gets **Mở team**. Only a project HQ already shows is accepted. README, the guide and the site now lead with the buttons and keep the commands as the alternative.

### Fixed
- **The Board dropdown missed a repo nested inside another repo.** ai-game-studio sits inside the 8sync-startup repo, and HQ folded it into the outer, empty board. `8sync ccc auto board --json` now prints the root its cards are filed under. HQ reads every live project and shows one board per root: worktrees share their repo's board, nested repos keep their own. "Giao việc → Mọi dự án" reaches nested repos too.
- **The board refreshes every 4 s (was 10 s)**, the same as the office, and right after a team button.
- **Background rooms no longer stop on a permission prompt to open a card worktree.** In the UAT the dev room waited on `EnterWorktree` until the owner attached. The kit now allows `EnterWorktree` and `ExitWorktree`, which only add or leave a worktree inside the repo. `8sync up` refreshes the kit.
- **`8sync up` no longer names the old version in its HQ UI restart hint.** The hint is printed by the binary being replaced, so after updating 0.100.1 → 0.100.2 it said "load UI 0.100.1". It now says "load the new UI". `8sync hq ui --install` still names the exact version.

## [0.100.2] — 2026-10-17
### Fixed
- **`auto up` points the registry at a resumed room's new id.** Claude Code runs `--resume <id> --bg` under a forked session id, seen in the UAT as `cd1ecaeb` → `b1f0bf3e`. The registry kept the old, stopped id, so HQ and the inbox looked at a dead session. A room whose saved name differed (`rd-ai-game-studio` vs `rd`) was also resumed a second time on the next `auto up`. Resumed rooms are now rebound like new ones.
### Changed
- **HQ Văn phòng shows what every room is doing right now.** A new "Đang làm gì" list puts one line per room in attention order (waiting for you, blocked, working, holding a card, waiting for a card, idle): role icon, model, the board card it holds (`#id`, title, lane), its latest note or `8sync ls` line and how long ago. A room with nothing to do for over a minute is marked. Each state is an icon plus words, never colour alone.
  - The room scenes follow that state only: the session's desk types while it runs, raises a hand while Claude waits for you, shows the alert pose when its card is blocked, sits still when idle, and cheers once after it moves its card on. Empty specialist seats are no longer drawn (they dozed in a loop and said nothing); a seat shows only while a subagent runs or just finished. Unmeasured stats ("chưa đo") are hidden.
  - Board lanes: a card that changed lane in the latest poll gets a ring, a one-time lift and "vừa chuyển từ …"; the toolbar announces the move to screen readers. The seven lanes fit a 1440px screen again and snap one lane at a time on a phone. Claim chips show the room's role icon (it was a blank circle for `lead`/`dev`/`qa`/`review`).
  - Văn phòng and Board share one board poll (10 s) instead of polling separately. Reduced motion keeps every state frame and the moved-card ring, without the flash, the cheer or the typing dots.

## [0.100.1] — 2026-10-17
### Added
- **Rooms never sit idle while the board has work: `/goal` plus `auto wait`.** In the first live UAT of `auto up` (5 rooms on a Godot game repo), the lead split an epic into 8 ready cards with checks within minutes. The dev room had already run its first tick on an empty lane, though, so all 5 rooms sat idle until the next 10-minute cron tick.
  - `auto up` now opens every room that owns a board lane on Claude Code's own `/goal`. Checked live: `claude --bg … "/goal …"` printed "Goal set", then "Goal achieved".
  - The condition only holds when auto stops (off, paused, or the usage cap). Each turn claims a card, does that lane's job and moves it on.
  - With the lane empty, the room runs `8sync ccc auto wait`, which blocks without tokens until a card reaches its lane. It returns `{"wake":"card"|"off"|"cap"|"timeout"}` and gives up after at most 9 minutes (under Claude Code's 10-minute Bash cap).
  - The cron loop is still set up as a fallback. Rooms without a lane (rd, ops, docs, sec) keep the loop message.
- `8sync ccc auto wait [--lane <cột>] [--as <phòng>] [--timeout 1..590] [--json]`. It sees the same card as `auto claim` would take, a stale claim included.
### Fixed
- **Board moves made from a card worktree keep the room's name.** In the UAT, a dev room ran `auto move 4 qa` inside `.claude/worktrees/card-4`. 8sync could not map that folder to a room, so the note read `-: building → qa`. Room prompts now pass `--as <room>` on every `auto claim|move|note|wait`.
- **`auto up` no longer resumes a room that is open in a terminal in another folder.** Before, the live check only listed sessions started in the project, so a room's id open elsewhere could be resumed in the background as well, running one conversation in two processes. The room's own id now counts wherever it runs. A background session with the room's name still counts only inside the project.
- **One `Ship` answer now covers the session, on Windows too.** After the owner approved Ship, every merge and tag push still prompted. There were two causes.
  - On Windows the `ship-grant` hook looked for the grant store under `HOME`. Claude Code's hook process there has no `HOME`, or holds a `/c/Users/…` path that is not absolute, so the grant was never written, while the guard reads the store under the real home directory. Both sides now find the store the same way (`dirs::home_dir`). A store that is not absolute never grants.
  - With a grant, the guard used to stay silent. Auto mode's classifier then still prompted for the merge or tag. The guard now answers `allow` for a ship step covered by the grant, which skips the prompt (https://code.claude.com/docs/en/hooks). Settings deny and ask rules still apply. A command that mixes a ship step with anything the guard asks about still asks, and force-push, secrets and deletes never consult a grant.
### Docs
- **Pages: an animated board.** The team section replays a card crossing `backlog → ready → building → qa → review → approved → done`, with the command each room ran. The static markup is the final state, so it reads the same without JavaScript or with reduced motion. The hero names v0.100.0, and the nav has a Team link.
- **README: "Quick start: a whole team in four commands"** at the top.

## [0.100.0] — 2026-10-17
### Added
- **`8sync ccc auto up`: the whole team in the background with one command.** Before, every room had to be opened in its own terminal before auto could run. `auto up` turns `auto on --here` on and starts every role room as a Claude Code background session (`claude --bg --name <room> --permission-mode auto --model <role model>`), with the loop prompt as its first message. You follow the work in `8sync hq ui`, `claude agents` or `8sync ccc auto board`. `auto down` stops the background rooms (conversations kept) and pauses auto.
  - Default team `lead,dev,qa,review`; `--roles` picks up to 8 rooms. Roles and models: lead, ba and rd on opus; dev and review on sonnet; qa on haiku. Aliases map to a role (`qc` → QA, `critic` → Review, `pm` → Lead, `analyst` → BA, `builder` → Dev). `ui`, `api`, `core`, `ops`, `docs` and `sec` keep the session's default model.
  - A room that is already live (by id, or a background session with its name) only gets the loop. A stopped room resumes in the background under the same id. A new room's registry entry is rebound to the id Claude Code picked (`--bg` ignores `--session-id`), so inbox, HQ and hooks find it.
  - An untrusted workspace stops `up` with the fix: open `claude` there once and accept the trust prompt. Rooms never run in bypass.
  - `--clear-ss` (alias `--clean`) first deletes this project's junk background sessions with `claude rm`: duplicates of a room, leftovers of old runs, rooms no longer in the team, and finished ones too. The registry entries that pointed at them go with them. Interactive sessions are never touched. Claude Code keeps a worktree with unpushed commits, and `up` prints why each kept session stayed.
- **Board with lanes, after [super-board](https://github.com/EricTechPro/super-board) (MIT), rebuilt in Rust.** The project's target queue is now a board: `backlog → ready → building → qa → review → approved → done`, plus `blocked`.
  - `auto add` lands a card in `ready` when it has a check and in `backlog` otherwise. `--label bug|feature|qa` labels it. Adding the same open text again adds a "↺ thêm lại" note instead of a twin.
  - `auto claim [--lane] [--as]` gives a room the first free card of its lane (lead/ba backlog, dev/ui/api/core ready → building, qa qa, review review), or the card it already holds. A `qa`-labelled card goes straight to qa.
  - `auto move <id> <lane>` checks the transition. `ready` needs a check, `approved` needs `--sha <reviewed head>`, and `--pr` records the PR. A card bounced back to ready more than twice goes to `blocked`.
  - A claim quiet for 2 h is taken back, and a stranded building card returns to ready. `auto note` logs progress and keeps the claim.
  - `auto board` / `auto lint` (`--json`) show the lanes and what needs the lead or you: no check, no PR, blocked, approved waiting for Ship.
  - Targets written by an older version read as `ready`.
- **Each room's loop works its lane.** The cron prompt now claims the room's card first and follows that lane's playbook:
  - lead writes the acceptance criteria and check, unblocks cards, and gathers every approved card into one Ship question.
  - dev builds in worktree `.claude/worktrees/card-<id>` on branch `card-<id>-<slug>` through `/ship`, then opens a PR.
  - qa runs the check and a UAT.
  - review approves the head SHA.
  - Merging stays a plain `gh pr merge --squash --match-head-commit <sha>` after the owner's Ship answer, which the guard already gates; 8sync has no merge verb. A new `.claude/loop.md` carries the same board section; an existing one is never overwritten.
- **HQ: the board by lane.** The Board tab opens on "Card dự án". There is one column per lane, Backlog → Blocked, for each project with a live room (project picker when there are several).
  - Each card shows its id and text, label, the room holding it and since when, PR, approved SHA and bounces, plus the last note.
  - A claim quiet for 2 h shows amber, and Approved turns amber with a Ship icon while cards wait for your answer.
  - The board refreshes every 15 s while the tab is visible.
  - "Task của session" keeps the old view of the sessions' own tasks.
  - New `GET /api/board` (token checked) runs `8sync ccc auto board --json` with argv only, in each live project's root. An 8sync without the board gets an "update with `8sync up`" note.
- **HQ: a "Gửi cho mọi phòng" box under Văn phòng and Chat tổng.** It sends one task to every room of a project, the same as `8sync ccc auto add "<việc>" --now`. Before this, Chat tổng only showed the thread and had no input, so it was unclear where to type a task for the whole team. Pick the project (or "Mọi dự án" when several have rooms), keep "Gửi ngay" ticked to push the task into every room's inbox, or untick it to only queue it for the auto loop. "Lệnh kiểm" adds an optional `--check` command. The line under the box names the rooms before you send. After sending it shows, per project, the target id and which rooms take the task as soon as they are idle and which take it after their current turn.
  - New `POST /api/targets` (token and origin checked) runs `8sync ccc auto add --json [--now] [--check <cmd>] -- <text>` with argv only and the project root as cwd.
  - It accepts only a root that has a live room right now, never an arbitrary path.
  - With "Mọi dự án", a worktree inside another project is left to that project's queue; its rooms are not counted as reached, and the line under the box says they take the task on a loop tick.
  - Ctrl+Enter (Cmd+Enter) sends; Enter alone is a new line, so a stray key never pushes a half-typed task into every room.
  - If some projects fail, the text stays in the box and the toast names them. A timeout says the task may already be queued (`8sync ccc auto queue`) instead of inviting a duplicate.
  - The "Lệnh kiểm" command runs in the project, like `--check` from the terminal.
  - The Cách dùng guide and the empty Chat tổng point at the box.
### Fixed
- **Sessions on 1M models no longer auto-compact at about 22% context.** The kit wrote `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=60` with `CLAUDE_CODE_AUTO_COMPACT_WINDOW=400000`, so a 1M session compacted at 60% × 400K = 240K tokens. On the status line, which counts against the full 1M window, that showed as about 22–24%.
  - The kit now writes 65% and window `1000000`, the top of the range. Claude Code caps the window at the model's own window (https://code.claude.com/docs/en/env-vars), so every model compacts at 65% of its real context: 650K on 1M, 130K on 200K.
  - `8sync ccc kit` / `8sync up` migrate the old pair. Window 400000 becomes 1000000, and 60% becomes 65% only when it sits next to the old window. A value the owner chose stays as it is.
  - The status line now shows each session's own point, for example `ctx 22%→nén 65%`, in red below 50%. It is computed from the window Claude Code reports (`context_window.context_window_size`) and the env the session sees.
  - `8sync ccc compact` lists every model window the status line has seen and where it compacts (`claude-opus-5-5: window 1000000 → nén ở ≈ 650000 token = 65% ctx`), with a warning when the point is early.
  - To fix a machine right away, without waiting for the release: `8sync ccc compact --window 1000000` and `8sync ccc compact --at 65`.
- **`auto on --loop` no longer rests a busy team on someone else's spend.** With `auto on --here --loop 2m --team`, every room skipped its tick on "$6.72 in the last hour against a $5/hour limit" while tasks were still open and the 5-hour window showed 23%. Two causes: the $/hour cap added up the status-line cost of every session on the machine, not only the project's, and on a subscription that cost is an API-price estimate, not money spent.
  - Under `--here`, the $/hour cap counts only sessions inside that project (API key logins too: the cap is per project).
  - On a subscription without `--usd-per-hour`, the cap is the usage window instead: rooms rest once the newest 5-hour or 7-day reading is at 90% or more, leaving the rest for the owner, and pick up again after the window resets. A reading counts only while it is younger than its window. With no fresh reading (status line off, or no session changed for a whole window), the old $5/hour default still applies. `auto status` shows both readings.
  - `--usd-per-hour X` keeps a $/hour cap on a subscription too, on top of the window. API key logins keep the $5/hour default.
  - A lease written by an older version keeps its stored $5/hour until `8sync ccc auto on` (or `idle on`) runs again; the rest message and `idle status` say how to drop it.

## [0.99.0] — 2026-10-17
### Changed
- **The repo is now `8-Sync-Dev/8sync` and the installer lives at `get.8syncdev.com`.** One-liners: `curl -fsSL https://get.8syncdev.com/install | sh` and `irm https://get.8syncdev.com/install.ps1 | iex`. Old links keep working: GitHub redirects `github.com/8-Sync-Dev/su-code` (repo, releases, downloads, API, raw files), and the org site `8-Sync-Dev/8-sync-dev.github.io` keeps `8-sync-dev.github.io/su-code/install` and `install.ps1` as shims that run the new installer (`/su-code/` forwards to the new domain). `8sync up`, `install.sh`, `install.ps1`, the kit's links and the plugin marketplace (`/plugin marketplace add 8-Sync-Dev/8sync`) use the new name; the managed `strictKnownMarketplaces` policy allows both names so machines that added the marketplace before the rename keep working. The per-project memory folder is still `su-code/`.
- **Plugin `8sync-kit` is ready for the Claude plugin directory.** `claude plugin validate --strict` passes: the plugin has a `displayName`, its own README, the new homepage and license, and the kit's `CLAUDE.md` moved from the plugin root (where Claude Code does not load it) to `assets/configs/claude/CLAUDE.md`. The `8sync-hints` and `8sync-inbox` mods moved out of the plugin folder to `assets/configs/claude/mods/`, so the plugin is Markdown only (agents and skills); `8sync ccc kit` still installs both mods to `~/.claude/skills/`. The README says what the plugin runs and that it sends nothing to 8 Sync. The plugin name stays `8sync-kit`.
- **License: MIT → PolyForm Noncommercial 1.0.0 (source-available) for everything after v0.98.4.** Personal study, hobby projects, research, education, charities and government use stay free; use at or for a company, client work, or a paid product or service needs a commercial license from 8 Sync (`COMMERCIAL.md`, atus@8syncdev.com). Releases up to and including v0.98.4 remain MIT. Third-party files keep their own licenses (THIRD_PARTY_NOTICES.md, `assets/skills/*/LICENSE`, OFL fonts). `LICENSE` holds the upstream PolyForm text unchanged under a `Required Notice` line. `Cargo.toml` declares `PolyForm-Noncommercial-1.0.0`. `.github/FUNDING.yml` adds the Sponsor button (GitHub Sponsors 8syncdev, 8syncdev.com, the commercial license page). README and the Pages footer now state the new license.
### Docs
- **Landing page SEO basics:** `robots.txt`, `sitemap.xml`, a canonical link and `SoftwareApplication` JSON-LD. The page stays static HTML, which crawlers read without running JavaScript.
- **New GitHub Pages landing** (https://get.8syncdev.com/). It replaces the v0.63-era page and is organised around the five levels of hands-off work (`/do` → `/autopilot`), shown as a staircase. Sections: the rails panel (guard, verify, stop gate, ask gate, Ship grant, no bypass); `auto on --here --loop 10m --team` with the project queue (`auto add … --check`, `--now`, `auto queue`, `auto pause`); the headless command and subscription limits; the bypass lock from v0.98.4; and the safety and bench tables, copied as measured from the README. It also replays a real verify and stop-gate run. Every command was checked against `8sync ccc help` and `claude --help`. Fonts (Archivo, JetBrains Mono) are self-hosted with their OFL licences, and the page works without JavaScript and with reduced motion. `docs/PRODUCT.md` records who the page is for and its design rules.
- **README:** new "Hands-off: five levels, one switch" section (level table, `auto on/add/queue/pause`, subscription limits, headless command). Binary sizes are now those of v0.98.4 (4.9 MB macOS arm64 to 7.0 MB linux-x86_64). The Defaults row mentions the bypass lock, and the bench rows are labelled "0.67 build".
- **`docs/huong-dan.md`:** new short section "Auto mạnh nhất, bản ngắn" (open a room, the 5 levels, `auto on` for the whole project, headless). The kit file count and the hq-ui size are corrected.

## [0.98.4] — 2026-10-17
### Fixed
- **Sessions opened by a launcher start in auto mode, not bypass.** Orca's default arguments for Claude Code are `--dangerously-skip-permissions`, and a launch flag takes precedence over `permissions.defaultMode`, so every Orca session ran in bypass although the kit sets `defaultMode: "auto"`. `8sync ccc kit` (and `8sync up`) now also sets `permissions.disableBypassPermissionsMode: "disable"` in `~/.claude/settings.json`: Claude Code rejects the bypass flag and starts the session in `defaultMode` (checked on Claude Code 2.1.296: a launch with `--dangerously-skip-permissions` reports `"permissionMode":"auto"`). Shift+Tab no longer offers bypass either.

## [0.98.3] — 2026-10-17
### Fixed
- **The release helper scripts work on Windows as written.** `su-code/handoff/scripts/merge-changelog.py` decoded `git show` with the locale codec, so on Windows (cp1252) a Vietnamese "ờ" in CHANGELOG made it crash with `TypeError … NoneType` unless run with `-X utf8`. It now reads UTF-8. Both scripts write LF instead of CRLF. `bump-version.py` takes the versions as arguments (`<worktree> <old> <new> <date>`) instead of constants edited before each release, and changes nothing when a check fails. CI runs `test-scripts.sh` (a Vietnamese CHANGELOG conflict and a CRLF bump fixture) on all three OSes.
- **`8sync ccc loop ev` records the check's verdict, not stderr noise.** The evidence line was the last line of stdout followed by stderr, so a passing `cargo test` showed cargo's `Running unittests …` and a passing script showed a build warning instead of `test result: ok. N passed` or `C1-ok`. A passing check now takes its line from stdout and a failing one from stderr, falling back to the other stream when one is empty. The printed tail no longer merges the last stdout line with the first stderr line.

## [0.98.2] — 2026-10-17
### Changed
- **CI runs the release size gate on every PR.** The new `size-gate` job builds the linux-x86_64 musl release (the largest asset, same steps as `release.yml`) and runs `scripts/size-gate.sh`, plus a self-test that the gate fails over the ceiling. Seven releases (v0.67.0, v0.74.0, v0.78.0, v0.81.0, v0.89.0, v0.93.0, v0.98.0) were tagged and only then failed the gate; now an oversized PR is red before the tag.
### Fixed
- **`auto on --loop` no longer promises that a `/bg` room resumes after a usage limit.** The note now says the next tick after the reset *may* pick the work up again, because the docs only state that background sessions don't wait. On a subscription login, the pointer to Routines now warns that a routine runs "without stopping for approval" and outside the 8sync rails, so the owner should grant only the repos and connectors it needs (https://code.claude.com/docs/en/routines). The same note is in `docs/huong-dan.md`.
- **`8sync ccc loop ev <slug> <C#> -- bash x.sh …` runs Git Bash on Windows, not WSL.** In the argv form a bare `bash` was spawned by name, and Windows looks in `System32` before PATH, so it ran the WSL launcher: no `gh`, exit 127, recorded as a failed check (seen 2026-10-16 on an autopilot item; the installed 0.98.1 gives exit 1 for `-- bash -c "command -v gh"`, this fix exit 0). A bare `bash`/`sh` (with or without `.exe`) now gets the same Git Bash the one-string form already used; any other program or full path runs as given, so WSL bash is still reachable by its path. The no-Git-Bash error no longer suggests the argv form as the way out.
### Tests
- **hq-ui: `mountSprite.setState` is tested over time** (`tests/sprite-setstate.test.ts`), not only `transitionFor()` as a table. A fake canvas and a hand-run rAF clock drive the real shared loop: stand-up/sit-down before work/rest and the hand-over after the one-shot ends, a repeated target that must not restart a transition, a mid-transition retarget, `done` re-triggering then going idle, reduced motion (frame 0, no loop) and `dispose`. Three mutations of `render.ts` (no transition, no repeated-target guard, one-shot never hands over) each make it fail.

## [0.98.1] — 2026-10-16
### Changed
- Release size ceiling 6784 → 6912 KiB, attributed in `scripts/size-gate.sh` (v0.98.0 linux-x86_64 was 6,973,520 B, 26,704 B over; +69,632 B vs v0.97.0 from `auto on --loop/--team`, the project target queue and the subscription loop notes; no new dependency). v0.98.0 was tagged but not published; 0.98.1 ships everything listed under 0.98.0.

## [0.98.0] — 2026-10-16 (tagged, not published)
### Added
- **`8sync ccc auto on --loop [10m] [--team]` puts every room of the project on its own loop with one command.** It writes `.claude/loop.md`, the file Claude Code uses as the default prompt for a bare `/loop` and re-reads every iteration. 8sync writes it only when no file is there, so the owner's edits are never overwritten, and it never follows a symlink.
  - Each tick, a room works through `loop.md`. It checks `auto status`, takes one `su-code/STATE.md` item for its role (or a `workflows/*.md` spec written with `/loop-me`) and picks the skill for the job: full `/ship` with karpathy-guidelines, tests, review and the `/sec` + `/rules` + `/aup-audit` gates before commit, or `/do`, `/deep-research`, `impeccable`, `/sysdesign`. Then it posts to the sprint meeting. A job that needs several ticks gets one `/ship` step per tick. A scheduled fire cannot run skills marked `disable-model-invocation`, so `/ship-loop`, `/ship-auto`, `/autopilot`, `/sprint` and `/loop-me` stay owner-typed, and a test keeps the playbook from routing a tick to them.
  - The command then sends one inbox message to each room of the project. The room sets up its own recurring `CronCreate` job, the same mechanism as `/loop 10m`, using the cron step for the interval (1–59 min or whole hours). Running the command again replaces the job, which restarts Claude Code's 7-day expiry.
  - With `--team`, a room opened with `--team` also fills the rd, qa and reviewer seats.
  - Every cron prompt keeps the stop check itself, so editing `loop.md` cannot remove it: the loop deletes itself when auto is off or paused. When the $/hour cap holds, the room rests that tick and keeps the loop. The cap is an average since auto turned on, so it clears as time passes. `auto status --json` now reports it as `cap`, even after the subscription lease has expired; before, an expired lease hid the cap, so a loop past 4 hours had no $ rail at all. The idle lease does not stop the loop. The loop is Claude Code's own scheduler, and it only runs while the room is alive (`/bg` keeps a room running without a terminal) (https://code.claude.com/docs/en/scheduled-tasks, https://code.claude.com/docs/en/agent-view). After a usage-limit reset, `autoContinueAtUsageLimit` resumes a room open in a terminal; Claude Code offers no such wait in a background (`/bg`) session or for a teammate, and the command now says so (https://code.claude.com/docs/en/interactive-mode#wait-for-a-usage-limit-to-reset). On a subscription it also says the loop is for ordinary use in rooms the owner opened, and that unattended multi-day or 24/7 runs belong on Routines (`/schedule`), Desktop scheduled tasks or a Console API key, the routes Claude Code documents for unattended scheduling (https://code.claude.com/docs/en/scheduled-tasks#limitations).
  - Starting the loop with this command counts as the owner being present, so the loop runs without the per-room 30-minute typing check. Nothing is queued when auto did not turn on. Ship, secret and money questions still go to the owner.
  - The HQ auto-tick prompt now follows `.claude/loop.md` too.
- **`8sync ccc auto` has a target queue for the whole team, like typing while Claude is busy.**
  - `auto on --target "<đích>" [--check "<lệnh>"]` starts auto with a target. `auto add "<việc>"` queues one at the end. `auto add --now` puts it first and pushes it into every room's inbox: Claude Code's "ctrl+x ctrl+s to send now", for the whole project. A room gets it as soon as it is idle; a running turn is not cut off.
  - `auto status --json` carries the first open target, so every tick (cron prompt, `.claude/loop.md`, HQ auto-tick) works on it. Each room does its role's part (lead splits and assigns, dev `/ship`, qa runs the check, reviewer reviews, rd unblocks). A room that proves the target met (the `--check` command exits 0, or runnable evidence) runs `auto done <id> --evidence "<lệnh: kết quả>"`, and the team moves to the next target. With none left, the loop goes back to `loop.md` and `STATE.md` Next.
  - `auto queue` lists the queue: current, open, done with evidence and who, dropped. `auto drop <id>` removes a target. A target a room queued itself (from inside Claude Code) is tagged "thêm bởi phòng <tên>", so the owner can tell it from their own and drop one an agent should not have added.
  - The kit rules teach every room that "đưa vào loop: …" means `auto add`, and "làm ngay: …" means `auto add --now`.
  - The queue lives in `~/.local/state/8sync/ccc/targets.json`, keyed by project root; a room in a subfolder uses its project's queue. Writes take a lock and replace the file atomically. A corrupt file fails closed and never breaks the stop check in `auto status`.
  - Owner (2026-10-16): "chế độ auto cũng nên có đưa prompt vào được để hiểu là auto target output ra là gì done rồi thì các agent mới tự làm tiếp việc khác … ctrl x+ s là nó đưa lên liền".
  - Owner (2026-10-16): "lệnh auto … cần là loop … all agents swarm all vị trí, thủ công quá".
### Fixed
- **Idle R&D nudges skip owner-only steps.** `8sync ccc hook idle` picks the first open `Next` item in `su-code/STATE.md` as the research question; items starting with `Owner` (Channels toggle, bot token) are now skipped, so an idle R&D room no longer researches a step only the owner can do. (`crates/cli/src/verbs/ccc/idle.rs`, `research_question`)
- **The ask gate no longer floods the terminal or blocks questions about safety rails.** When the gate turns a question back, Claude Code prints the gate's whole prompt in the error line, so the prompt is now about 520 bytes instead of about 880, and it puts the rules in four short lines. A question about loosening a safety or compliance rail (for example, how owner presence is counted on a subscription) now always reaches the owner; before, it was turned back as a "minor technical choice". Run `8sync ccc kit` to install the new prompt. Owner (2026-10-16): "hay bị bug … hook error".

## [0.97.0] — 2026-10-16
### Added
- **`8sync ccc auto on --here`** keeps auto to one project. Without the flag, `auto on` still reaches every session of every project on the machine, including sessions opened later, because its state lives under home. With `--here`, the project root of the current folder is stored in `auto.json` as `repo`. The `idle` (Stop/TeammateIdle), `delegate` and `taskdone` hooks then skip any session whose cwd is outside that root; subfolders and in-repo worktrees count as the same project. `auto status` (and `--json` `repo`) shows the scope; a plain `auto on`, `pause` or `off` clears it. If the marker cannot be written, auto is turned back off rather than left running everywhere. Owner (2026-10-16): "bổ sung thêm cờ auto all session trong 1 folder dự án".
### Fixed
- **`8sync ccc . rd` no longer opens under a new random name each time.** Claude Code session names are machine-wide, so when a session in another project already goes by `rd`, Claude Code appends a random suffix (`rd-crispy-sutton`), and a different one on every launch until the room has a transcript. In that case a new session now gets the stable name `<name>-<repo dir>` (`rd-su-code`); `8sync ccc . rd` still opens the same room, and the role (R&D, lead…) is still read from the leading name. Sessions that already have a transcript resume under their current title (rename with `/rename`). Owner (2026-10-16): "mỗi lần vô ra 1 tên khác nhau".

## [0.96.0] — 2026-10-16
### Added
- **Kit skill `/sysdesign`** — system design for a real change (new service, storage, queue, cache, scale, AI feature) with The System Design Primer (Donne Martin, CC BY 4.0) as the reading source: a scope gate (when a design is needed at all), a task-question → primer-section map (≤3 sections per task), the primer's 4-step method (use cases/constraints → high level → core components → scale) with mandatory back-of-the-envelope numbers from a named source, an ADR in `docs/adr/` (or `su-code/ship/<slug>/DESIGN.md`) reviewed by the `architect` agent, and a study track (Study guide, one `solutions/system_design/*` exercise a week, Anki decks). The primer is cloned once into `~/.cache/8sync/system-design-primer`; nothing of it is copied into the kit (size gate, licence). Owner (2026-10-16): "System Design Primer … tải thành skills luôn, quy trình đọc". Kit 40 files, `CORE_SKILLS` 16.
- **Sprite-pipeline gates as tests** (`apps/hq-ui/tests/sprite-pipeline.test.ts`): palette/canvas invariants, no anchor drift (desk rows, contact row, keyboard hands), head hair count constant, 1 px per step inside stand/sit, every transition and direct switch connects without a visible jump at any phase, manifest agreement (CLIP_MS/CLIPS/ONE_SHOT), timing caps, walker ground row and mirror involution.
### Changed
- **Ask gate prompt cut from 1,338 to under 800 characters.** When the gate denies an `AskUserQuestion`, Claude Code prints the whole hook prompt in the error line (`PreToolUse:AskUserQuestion hook error: [<prompt>]: <reason>`) and a narrow terminal wraps and cuts it into unreadable fragments (owner 2026-10-16: "check bug … icorrect, worchoices"). The four-rule checklist and the reply format are unchanged in substance; the explanatory sentences moved into a code comment. Re-run `8sync ccc kit` to install it (the gate decision itself was correct: rule 4, Claude picks and continues).
### Fixed
- **HQ sprites: no more 3 px jump after "stand"** — the work clips (typing, running, reading, waiting, meeting) now use the risen posture the `stand` transition ends in (head row 5, chair back showing), so stand → work and work → sit connect pixel-exact; `stalled` is the idle exhale pose with closed eyes (seated, reached via `sit` from work), `rest` breathes at the idle rows, and a work clip sits down before any seated clip (idle, rest, done, stalled) instead of only idle. The meeting speech bubble moved above the raised head. Owner (2026-10-16): apply the sprite-pipeline skill rigorously.

## [0.95.0] — 2026-10-16
### Added
- `8sync hq ui --install`: download the HQ UI asset for this binary version when missing and exit (no server). `8sync up` runs it after a successful update when HQ has been used on the machine, so the next `8sync hq ui` starts without a download.
- **Kit skill `/ship-tick [slug]`** — one iteration of a loop the owner already started. It is model-invocable on purpose: `/ship-loop`, `/autopilot`, `/ship-auto` and `/ship … --release` now add a Claude Code scheduled task (`CronCreate` `*/5 * * * *`, prompt `/ship-tick <slug>`) right after `8sync ccc loop init` or the first push, so the loop continues whenever the session is idle (after a turn ends, after /compact, while CI runs) without the owner typing again: the `/loop 5m` + loop-me pattern built into the ship skills. A tick: standup (`8sync ccc standup`, daily `8sync ccc meet --say` once), red CI first, then the first red criterion, `researcher`/`deep-research` when the same failure repeats, smallest change, `8sync ccc loop ev` evidence, `8sync ccc loop tick`; all green → review + `8sync ccc risk` + sec/rules/aup-audit + CHANGELOG + commit + push + CI; release only after ONE Ship question and only when the parent loop asked for it; done/stop → `loop done`, ACTIVE cleaned, its own cron deleted. Listed in `8sync ccc help`. Owner (2026-10-16): "các command ship-* có full skills khả năng loop + loop-me + scrum skill, /deep-research".
- **HQ auto-tick: "Chạy liên tục" now wakes idle sessions** — while `8sync ccc auto` is on and not paused, every Office poll of `GET /api/auto` (60 s) queues one inbox message for each room that is idle for ≥ 60 s, has the `8sync-inbox` mod live and nothing pending, at most once per 10 minutes per session (`<state>/hq/auto-tick.json`, 0600, write-then-rename; the idle clock restarts after 3 minutes without a poll). It only runs while an Office tab is open (the tab is the poll) and never while the lease gate holds (expired, over budget, owner away). The message tells the session: a `/loop` of its own → answer "đã có loop"; an open loop in `su-code/ship/ACTIVE` → `/ship-tick <slug>`; otherwise one small item from `su-code/STATE.md` Next or R&D for the next criterion, then `8sync ccc meet --say`; never merge/push main/tag/deploy. `GET /api/auto` carries `tick: { ticked: [...] }`. Owner (2026-10-16): "chờ tôi quá 1 phút không tự làm tiếp thì phải tự làm tiếp, mặc định luôn chạy liên tục". (`apps/hq-ui/lib/auto-tick.ts`, `lib/server/auto-tick.ts`)
### Changed
- `8sync up` warns when something is listening on the HQ port (8740): a running `8sync hq ui` keeps the UI it started with, so the owner must Ctrl-C and start it again to see the new version. The HQ page shows the same notice with the exact versions (running UI vs. installed 8sync, from `/api/auto` → `versions`) above the Pause / Run control.
- **`8sync ccc hook idle` (Stop) works for a session without an agent team** while `auto on` is running and not paused: the session is treated as its own lead (team name `session-<8 id chars>`, task list `~/.claude/tasks/<session_id>/`), so a standalone session that goes idle gets the same research / hand-out ladder as a team lead. `auto off` / `pause`, or no `auto` at all, keep the old behaviour (lead only). Session ids are validated before they become a path. (`crates/cli/src/verbs/ccc/idle.rs`, `auto::running`)

## [0.94.0] — 2026-10-16
### Added
- **`8sync ccc auto on [--hours N] [--after <60|1m>] | off | pause | status [--json]`** — one switch for "team never sits idle": `idle on` (lease, default 2 h; a subscription login keeps the 4 h cap and bails the same way) + `delegate on --after` (default 60 s) + `<state>/ccc/auto.json` (`{schema, on, paused, since, hours, after_s}`). `pause` turns both off and records `paused: true` so HQ does not turn it on again; `off` leaves `paused: false`. Validation runs before anything is written. `status --json` reports `on`, `paused`, `idle`, `delegate`, `after_s`, `lease_until`, `gate`, `subscription`, `manual`. The owner's hand switches win: `idle off` / `delegate off` / `ccc cancel --all` after `auto on` read as `paused` (and `cancel --all` writes the marker), `idle on` / `delegate on` by hand without `auto` read as `manual` — HQ turns auto on by itself only when neither is set, once per page load, and shows an expired lease instead of re-arming it. The marker write is fail-closed (a `pause` that cannot be saved is an error, and a lease without its marker is rolled back). Owner (2026-10-16): "chờ tôi quá 1p không tự R&D và lead tự giao nghiên cứu tự làm tiếp, có nút pause, mặc định luôn chạy liên tục".
- **`8sync ccc meet [--say "<done>|<doing>|<blocked>"] [--room <tên>] [--json]`** — daily sprint meeting of a repo's rooms: appends `| HH:MM | phòng | done | doing | blocked |` to `su-code/standup/<YYYY-MM-DD>.md` (UTC, locked, cells sanitised, ≤100 chars); a room that spoke in the last 30 minutes has its row replaced. Room name from `--room`, else the session registry, else `?`; bails without `su-code/`. Owner (2026-10-16): "các session phòng ban chưa bao giờ họp chung với nhau".
- **HQ office: a real sprint-meeting room** — a room whose lead has a row younger than 30 min in `su-code/standup/<today UTC>.md` (`8sync ccc meet --say`) is "in the meeting": its Lead seat is empty ("đi họp"), a walker leaves the room (`hq-walk-out`, 1.6 s) and returns facing left (`mirror()` frames, `hq-walk-back`) for the last 1.6 s, and a "Phòng họp" card above the project's rooms seats every attending lead around a CSS table with its "doing" line and "Họp sprint · N phòng · còn M phút". Rooms of the same project meet together; `Office.meetings` reads only that one file (≤ 64 KB). Owner (2026-10-16): "ra khỏi chỗ để họp sprint daily 30p … các session phòng ban chưa bao giờ họp chung với nhau". (`apps/hq-ui/lib/meeting.ts`, `lib/server/office.ts`)
- **HQ office: an empty chair** — a lead at the sprint meeting leaves an "away" desk (chair back, screen off, no person) instead of a dimmed resting character; in the meeting room the lead walks in (phase out) / leaves (phase back) as a walker sprite instead of a blank. Owner: "nhân vật di chuyển thật".
- **HQ office: seats clone** — a seat with 2–3 agents of one kind draws that many sprites side by side (40 px, overlapping); more than 3 keeps the ×N label. Owner: "nhiều cần nhiều thì nhân vật tự nhân bản". (`cloneCount`)
- **HQ Pause / Run button** — `GET|POST /api/auto` wraps `8sync ccc auto status --json | on | pause` (token required, only the fixed words `on`/`pause`, 422 otherwise, 200 with `error` when 8sync has no `auto`). The Office tab polls every 60 s, turns auto on by itself once per page load unless the owner paused or set idle/delegate by hand, and shows "Tạm dừng" / "Chạy liên tục" with "Luôn chạy · lease tới HH:MM", "Đang nghỉ: <gate>" or "Lease hết hạn — bấm Chạy liên tục để gia hạn" (never re-armed by itself: the 4 h subscription cap stays). A failed status read shows its own error; only a missing verb says "chạy 8sync up". Owner: "có nút pause, mặc định luôn chạy liên tục".
- **Assign dialog preset "Họp sprint (09:00 hằng ngày)"** (`MEET_DAILY`, mode "Cả dự án") — each room reports `8sync ccc meet --say`, takes one open item of another room, stops within 30 min.

### Changed
- The SessionStart "Phòng của bạn" block now lists `Sprint <slug>: role rảnh …` for each board in `su-code/ship/ACTIVE` that has idle roles, and `Họp sprint hôm nay: N phòng đã nói, phòng này chưa → 8sync ccc meet …` when today's standup file exists without a row for this room. Owner (2026-10-16): "skills scrum luôn bật, lead và R&D luôn work để giao việc".
- `auto` and `meet` are ccc verbs (reserved words): sessions with those names can no longer be opened with `8sync ccc . <name>`. `idle::on` and `delegate::on` are extracted from the CLI handlers (no behaviour change).

## [0.93.3] — 2026-10-16
### Added
- **`8sync ccc cancel [--all] [--session <tên>] [--json]`** — one command that stops everything the calling session set in motion, fail-closed: its goal and urgent flag (registry), every live loop named in the repo's `su-code/ship/ACTIVE` (`stopped: "cancelled"`, read back to verify; ACTIVE is per repo, so a loop another session listed there stops too), then ACTIVE itself; `--all` adds every live loop under `su-code/ship`, `idle off` and `delegate off`. No session id and no `--session` → refused, nothing touched, exit 1; a `--session` this repo does not have → refused; any step that cannot be verified gone (a loop.json that cannot be read or written, an ACTIVE line that is not a slug, a switch still on because an env var overrides the flag) → `✗ FAILED …`, exit 1, and ACTIVE keeps exactly those lines for the retry. Claude Code's own scheduled tasks cannot be reached from outside: the summary says `/loop clear`. Idea after oh-my-claudecode's `/cancel` skill (github.com/Yeachan-Heo/oh-my-claudecode, MIT, `skills/cancel/SKILL.md`): per-session scope by default, cross-session only behind a flag, "cancelled" only when verified. Code ours. Tests: `cancel_session_scope_…`, `cancel_all_…`, `cancel_fails_closed_…`, `scripts/uat/omc-cancel-risk.sh`.
- **`8sync ccc risk [--base <ref>] [--paths a,b] [--json]`** — which review gates this diff makes mandatory, decided from the changed file names (committed since `merge-base(origin/main, HEAD)`, staged, unstaged, untracked): `/sec` always; `/rules` + `/aup-audit` when a path falls in auth/OAuth/login, data collection, messaging people outside, third-party tools (MCP/plugins/dependency manifests), release files (workflows, version/size-gate, deploy config; CHANGELOG alone is not one, every PR edits it) or a high-risk domain (credit, hiring, medical, legal, insurance…; that one also needs a human reviewer + AI disclosure); whole name tokens only (`user-login.ts` yes, `lesson.md` no; files under `docs/` and `*.md` count only as secret dumps); `--release` forces `/rules` + `/aup-audit` for a code-only release diff; `/harden` when hooks/settings/`.claude/` files change; level low/medium/high (high = secret file or high-risk domain). Reads names only, never contents — a floor under the review, not the review (the text output says so). Git runs at the repo top level with `-z`, so a subdirectory cwd or a Vietnamese file name changes nothing; without `origin/main` it falls back to `origin/HEAD`, then `HEAD` with a stderr note that only uncommitted work is seen. The kit's CLAUDE.md rule and the ship / ship-loop / ship-auto / autopilot skills now say to run it before `sec`; the rule itself now asks for `sec` + `rules` + `aup-audit` on every diff (owner, 2026-10-16: "luôn check tuân thủ"), `risk` adds the extra gates. Idea after oh-my-claudecode's `scripts/risk-assess.mjs` + `review-gate.mjs` (MIT); code ours. Tests: `risk_classifies_paths_by_name_only`, `risk_gates_follow_the_kit_rule`, `risk_reads_the_diff_and_untracked_files_from_git`.
- `research/omc-features.md`: scan of oh-my-claudecode v5.7.4 (39,944 stars, MIT) — 64 table rows (overlapping features merged) vs ccc, what is portable, and what is not ported on purpose (OAuth usage API reading Claude Code credentials, `--dangerously-skip-permissions` launchers, auto-typing into tmux). Ideas only.

### Changed
- `cancel` and `risk` are now ccc verbs (reserved words): a session named `cancel` or `risk` can no longer be opened with `8sync ccc . <name>`.
- `8sync ccc loop` stops a loop with reason `cancelled` when `cancel` ran; `idle off`/`delegate off` share the `off()` the cancel uses.

## [0.93.2] — 2026-10-16
### Fixed
- **HQ now says whether a session will take its task now or only at its next turn end.** Owner (2026-10-16): "cứ rơi vô trạng thái xong việc là không làm tiếp dù có gửi tin nhắn cho nhau … apply active lại các session đang work tôi không muốn mở lại claude code". A session opened before `8sync ccc kit` wrote the `8sync-inbox` mod has not loaded it (Claude Code loads a skills-dir plugin at start or on `/reload-plugins`, no restart needed — code.claude.com/docs/en/plugins/loading), so a task "qua inbox (nhận ngay khi phiên rảnh)" silently waited for the Stop hook. Now `8sync ccc inbox` (only the mod calls it) touches `<state>/inbox/<session_id>.live` on every poll (from session start, then while idle); a marker from the last day means the mod is loaded — age is not "polling now", a long turn does not poll. HQ (`Room.inboxLive`, `Session.inbox_live`, `live` in the `/api/messages` and `/api/tasks` responses) shows "Inbox · mod" or "Inbox · chưa nạp mod" on the office card and the assign dialog, and the toasts/summary say "qua inbox (nhận ngay khi phiên rảnh)" only when live, else "qua inbox (nhận khi xong lượt — gõ /reload-plugins trong phiên để nhận ngay)". `8sync ccc . ls` prints the same `inbox:` line per session active in the last day; `8sync ccc kit` prints "mod … đổi: … gõ /reload-plugins" when it rewrote an existing mod file (not on first install) and `8sync up` forwards that line. Markers older than a day are swept with the claim orphans; the marker and its dir are 0600/0700 like the inbox. Not done on purpose: typing `/reload-plugins` into panes for the owner (it could answer an open dialog). Tests: `inbox_live_marker_follows_the_mod_poll`, `kit_reload_hint_names_changed_mods`, vitest `office` (live marker), `assign-ui`.
- **HQ "chưa trả lời" on handoffs that were answered.** `SendMessage(to: "core [ff2607]")` (the `name [ref]` form ListAgents prints) did not resolve, so the journal kept the typed text as `to` while the reply's `from` was a session uuid, and the two never matched. `resolve_peer` now strips the ` [ref]` suffix, and the team thread marks a handoff answered by comparing resolved names (`from_name`/`to_name`, case-insensitive, ref stripped) with the raw ids as fallback. Tests: `resolve_peer` (`rd [6de1ef]`), vitest `team-thread` "handoff answered by name".

## [0.93.1] — 2026-10-16
### Changed
- Release size ceiling 6592 → 6784 KiB, attributed in `scripts/size-gate.sh` (v0.93.0 linux-x86_64 was 6,801,424 B, 51,216 B over; +131,424 B vs v0.92.1 from `ccc hint`, `completions` with clap_complete, `ccc inbox` and the two embedded mods). v0.93.0 was tagged but not published; 0.93.1 ships everything listed under 0.93.0.

## [0.93.0] — 2026-10-16 (tagged, not published)
### Fixed
- **HQ "Giao việc" to an idle session no longer hangs.** Owner (2026-10-16): "giao task khi ccc còn working nó mới làm, còn khi nó chưa working gửi task nó bị treo". A session HQ did not start (every `8sync ccc` room, every session on Windows) gets tasks through its inbox, and only the kit's Stop hook read it, at the end of a turn; an idle session has no turn to end, so the task waited for good. New mod **`8sync-inbox`** (installed by `8sync ccc kit` into `~/.claude/skills/8sync-inbox`; open sessions need one restart) polls while the main loop is idle (every 5 s for the first minute, then 15 s, then 30 s; a finished turn starts over) and submits pending tasks as a new prompt (`$.prompt.submit`). It calls the new **`8sync ccc inbox [--session <id>] [--ack|--release] [--json]`**, which claims the messages instead of deleting them: the mod acks once the prompt entered the session, appends a refused prompt to the prompt box (the owner's draft stays) with a toast, and releases the claim back to the inbox when neither worked; a claim nobody acks (killed process) is served again after 2 minutes. The Stop hook leaves a claimed message alone, so a task is delivered once and never lost. The HQ API that writes the inbox requires the local HQ token; the text is framed as the owner's message. HQ now says "qua inbox (nhận ngay khi phiên rảnh)". Tests: `inbox_claim_ack_release_and_stale_claims`, `inbox_cmd_parses_flags_and_falls_back_to_the_env_session`, `kit_installs_the_inbox_mod`, `claude plugin test` (9). Not verified until a session restarts with the mod: a task arriving while the owner has a half-typed prompt.

### Added
- **Realtime hints inside Claude Code (`8sync ccc hint` + mod `8sync-hints`).** Owner (2026-10-16): "enhance prompt in ccc can auto hint real time like omp suggestion to tab completion". The kit now installs a Claude Code function-hooks mod at `~/.claude/skills/8sync-hints` (auto-loaded; open sessions need a restart) that draws three things from one local Rust call: **ghost text** for the next prompt (Tab/→ takes it: "tiếp tục loop <slug> (iter k/N)", own urgent flag, the prompt the owner typed after this one before — a bigram over `~/.claude/history.jsonl` filtered by project, local-only — then "/sec rồi commit" or "push nhánh … rồi mở PR" from git), **typeahead** rows with descriptions for `/skill` (installed + repo skills), `8sync <cmd>` and `8sync ccc <verb>` / `ccc <verb>` tokens, and a dim **band above the prompt** (≤ 2 lines: loop · branch ↑ahead ✎dirty · urgent · watchdog alert < 10 min) with an "Ẩn" button. The mod only calls `8sync ccc hint [--complete <token>] --json` (no network, no model, no `gh`; one `git status` with a 300 ms budget, run beside the prompt; silent when `8sync` is missing) — idea ported from omp's predictive composer, code ours. Tests: `hint_*` (Rust; < 50 ms without git on a 41-skill + 512 KiB-history fixture), `claude plugin validate|test` (8 mod tests), `kit_installs_the_hints_mod`, `scripts/uat/hints-load.sh`.
- **`8sync completions <bash|zsh|fish|powershell|elvish>`**: shell tab-completion scripts generated from the same clap tree the binary parses (`8sync completions bash > ~/.local/share/bash-completion/completions/8sync`).
- `research/omp-features.md`: scan of omp 18.11.1 features (MIT; ideas only) with what ccc already has, what this batch ports and what is queued for later.


## [0.92.1] — 2026-10-15
### Fixed
- **HQ "Giao việc" › Một phiên** on real data: every session the owner started outside HQ landed under "Phiên khác", and two rooms with the same name (two `rd`, two `web`) were indistinguishable. The list now groups those sessions by the git folder + branch their office room reports, exactly like the sidebar ("su-code ⎇ main"), and a duplicated name gets its first 8 session-id characters ("rd · 1a2b3c4d") in the list, the fan-out chips and the summary line (`groupTargets(sessions, projects, rooms)`, `distinctLabels`; tests in tests/assign-ui.test.ts).

## [0.92.0] — 2026-10-15
### Changed
- **HQ "Giao việc" dialog redesigned.** Owner (2026-10-15): one dropdown mixed roles and sessions, so it was unclear whether a task went to one session, to a role, or to every session of a repo. The dialog now has three explicit ways to hand a task: **Một phiên** (a list of live sessions grouped by project, with status dot, role and terminal/inbox delivery), **Theo vai trò** (role cards showing model and how many sessions of that role are running; "mở mới" + project picker when none) and **Cả dự án** (every live session of one project, or of all projects, each gets its own task row). A summary line above the buttons says exactly where the task will go, e.g. "Giao cho phiên rd qua inbox", "Giao cho phiên R&D rảnh lâu nhất trong 2 phiên: rd-1, rd-2" or "Giao cùng một việc cho 4 phiên trong levels-repo". Priority is a P0–P3 segmented control; "Khi nào" sits beside it; the R&D preset is a text link. Pure rules live in `lib/assign.ts` (tests/assign-ui.test.ts). Dark/light and phone widths checked with a headless browser against a seeded preview (not verified: Windows, macOS browsers).

## [0.91.1] — 2026-10-15
### Fixed
- `8sync learn trending` run from inside a project's `su-code/` memory directory (which carries its own AGENTS.md) wrote to `su-code/su-code/research/trending/`; the trending dir is now resolved by `trending_dir()`: a `su-code` memory dir without a VCS/manifest of its own belongs to its parent project, a repo that is itself named `su-code` stays a normal root, and any subfolder of the project resolves to `<project>/su-code/research/trending/<date>.md` (test `learn_trending_dir_resolves_from_memory_dir_and_subfolders`; reported by the R&D session in UAT of v0.91.0).

## [0.91.0] — 2026-10-15
### Added
- **`8sync learn trending`** (Rust): the most-starred repos created in the last N days (`--lang`, `--days 7`, `--top 25`, `--json`) through GitHub's official search API — not the trending page, which must not be scraped — written to `su-code/research/trending/<date>.md` with a "Có ích cho 8sync vì" column for the R&D room to fill. Unauthenticated, no token read; adult-content repos are dropped.
- **`8sync skill learn <owner/repo>`** (Rust): shallow-clone a public repo, delete its `.git`, check the licence (MIT/Apache/BSD/ISC/MPL/CC BY/CC BY-SA/CC0/Unlicense/GPL family allowed; NC/ND/none refused with the reason), and distil the README into a ≤ 6 KB `SKILL.md` (frontmatter, source + licence + attribution, a section index with `refs/README.md:<line>` pointers) beside the untouched `refs/README.md` + `refs/LICENSE` in `~/.claude/skills/<name>` — local only, never committed. First target: donnemartin/system-design-primer (CC BY 4.0; 109,830 B README → 6,042 B skill).
- **HQ office: sprint meeting + standing up/sitting down + carrying a task.** A room whose `su-code/ship/<slug>/STANDUP.md` was written < 2 min ago shows the `meeting` state ("họp sprint"); desks play a `stand` clip when work starts and `sit` when it ends; a walker bringing a task carries a paper. All code-drawn, reduced-motion safe.
- **`scripts/uat/hook-latency.sh`**: median hook latency with budgets (guard/wake/watchdog/resume-note ≤ 20 ms, verify no-op ≤ 50 ms). Measured on Linux (`bash scripts/uat/hook-latency.sh`, 7 runs): median 2–3 ms each; the Orca per-event shell hook on this machine adds ≈ 5 ms (not verified: macOS, Windows). `HOOK_BUDGET_SCALE=3` relaxes budgets on a loaded CI runner; `EPOCHREALTIME` is read locale-safe, macOS falls back to python3/perl. The real verify check (tsc/cargo) runs with `asyncRewake` and never blocks the model.
### Changed
- **"R&D trực" preset** now studies the codebase (`codegraph`), the web (primary sources), papers (arXiv / Semantic Scholar) and today's trending file, then hands ≤ 2 concrete tasks to the rooms that are free (`8sync ccc . ls` + SendMessage, or HQ Giao việc), instead of only writing a research note. It proposes `8sync skill learn <owner/repo>` to the owner and never installs a skill unattended (`~/.claude/skills` is loaded globally; a human approves).
### Security
- `8sync skill learn`: README/LICENSE symlinks are ignored (a hostile repo cannot pull a local file into a globally loaded skill); source-available texts that quote OSI wording (Commons Clause, SSPL, BSL, Elastic, PolyForm, "sell the software") are refused before the allow-list; README/LICENSE capped at 2 MB; `SKILL.md` has a hard 6144-byte ceiling; skill names must start with `[a-z0-9]`, ≤ 64 chars, no Windows device names; `--name --force` no longer yields a skill called "--force".
- `8sync learn trending`: rows whose `owner/repo` is not GitHub-legal are dropped; description/licence cells lose link, image, HTML, backtick, control characters and URLs, so the file the R&D room reads carries no injected links; the only link per row is the github.com URL; curl is pinned to `--proto =https`; `--days` is clamped to 1–3650.

## [0.90.0] — 2026-10-15
### Added
- **HQ: giao việc theo lịch.** The "Giao việc" dialog has "Khi nào": now, once at HH:MM, daily at HH:MM, or every 5–30 min / 1–12 h. HQ runs no timer of its own: it hands the session one prompt to book the task with Claude Code's native `CronCreate` (local time, fires between turns while the session is open, recurring jobs expire after 7 days by design and are not silently re-created). The task row reads `… · ⏰ mỗi 30 phút`. Preset **"R&D trực"**: every 30 min the R&D room researches the next backlog item when it has nothing assigned, or says `rest`.
- **`8sync ccc delegate on --after 1m`.** The critic answers a product/technical question only when the owner has typed nothing in that session for the given time; while the owner is active the question still reaches them. Owner-only topics (Ship, secrets, destructive, money, deploy/merge/release, high-risk) are unchanged. A hook cannot answer a question already on screen, so "no reply for 1 minute" is approximated by "no typing for 1 minute"; an unreadable transcript means the owner is asked.

- **`8sync ccc hook wake`** (Rust, UserPromptSubmit, no model call): a scheduled HQ prompt (marked `[8sync:wake]`) is dropped before it reaches Claude — zero tokens — when the session has an `in_progress` task, ran a scheduled prompt < 4 min ago (queued fires collapse), or, on a subscription login, the owner has typed nothing in that session for 30 min (unattended use needs a Console API key). Claude Code runs UserPromptSubmit hooks on cron and `/loop` fires too (https://code.claude.com/docs/en/hooks). Idea after ProactiveAgent's decision engine + minimum interval (github.com/leomariga/ProactiveAgent, BSD-3).

### Changed
- HQ tab "Chat nhóm" is now **"Chat tổng"**: every room (session) shares one chat.

### Fixed
- `8sync ccc . goal --help` / `-h` printed nothing and stored "--help" as the goal; it now prints usage and leaves the registry alone, and an unknown `-flag` is an error.

## [0.89.1] — 2026-10-15
### Changed
- Release size ceiling 6400 → 6592 KiB, attributed in `scripts/size-gate.sh` (v0.89.0 linux-x86_64 was 6,616,688 B, 63,088 B over; +69,664 B vs v0.88.0). v0.89.0 was tagged but not published; 0.89.1 ships everything listed under 0.89.0.

## [0.89.0] — 2026-10-15 (tagged, not published)
### Added
- **`8sync ccc . ls` lists the most recently active session first and shows an urgency flag set by the agent.**
  - New verb `8sync ccc . urgent <high|med|low|clear> [note] [--session <name>]`. With no `--session` it flags the agent's own session, found from `CLAUDE_CODE_SESSION_ID`.
  - `ls` shows the flag as text plus colour: `▲ high` (red), `◆ med` (yellow), `▽ low` (cyan). The note goes on a `flag` line, cut to one line of at most 80 characters, with secrets masked.
  - `ls --json` rows come newest first and carry `urgency` (`level`, `note`, `set_at`).
  - Old session indexes load unchanged.
  - The kit's CLAUDE.md and `8sync-cli` skill tell agents to set `high` when blocked on the owner, `med` when waiting on a teammate, and `clear` when resolved.
- **New kit skill `/sprint` adds a scrum-master cadence so no role sits idle.**
  - A scale gate runs first: tasks of ≤3 files open no sprint; mid-size tasks pick 2–4 roles; the full roster is for ≥2 independent file groups.
  - The cadence: sprint planning → roles assigned in waves (rd/plan → dev → review/qa) (R&D, Plan, Fullstack, Reviewer, Tester, Quick, Critic, the same seats as HQ) → a standup at every phase boundary or iteration (done/doing/blocked, backlog, bugs, other rooms) → sprint review → retro into `/remember`.
  - The roster maps every kit agent and skill to a role.
  - `/ship`, `/ship-auto`, `/ship-loop`, `/autopilot` and `/planning` now run this cadence.
  - It keeps token rails: at most 4 writers, real backlog items only (`rest <reason>` instead of busywork), and unattended runs dispatch only on a Console API key.
  - Measured lead delegation before this change: 237 spawns vs 4,670 own calls (`su-code/research/sprint-delegation.md`).
- **New verb `8sync ccc standup <slug> [init | set <role> <status> … | --json]` keeps the sprint board.**
  - The board is `su-code/ship/<slug>/SPRINT.md` and each standup is appended to `STANDUP.md`.
  - `init --roles` picks the sprint's roles. The verb exits 3 while a role on the board is idle (1 stays "error"), so loops can gate on it. Writes are locked, cells are sanitised on read too, and `--json` does not log.
  - It lists the other rooms' goals and warns `⚠ trùng file` when a board row's files overlap another room's claim.
- **New verb `8sync ccc . goal <mục tiêu> [--files a,b] [--session <name>]` (`goal clear` to drop it) sets a session's target and claimed files.**
  - Other rooms see the goal in `ccc . ls` (a `goal` line and `--json` `goal`), in the SessionStart/compact "Phòng khác đang làm" block, and in `standup`.
  - The text is one line, with control characters dropped and secrets masked.

## [0.88.0] — 2026-10-15
### Added
- **R&D researches when idle.** In `ccc hook idle` (still OFF by default, same rails: lease on subscription, $/hour cap, 3 blocks):
  - a teammate named for research (`rd`, `rd2`, `research…`, `explore…`) that runs out of tasks is told to run `/deep-research` on the first STATE `Next` item that has no brief in `su-code/research/` yet;
  - after the brief it runs `/planning` and asks the owner ONE AskUserQuestion table with a Recommended option first;
  - the lead gets the same nudge once the team and every other room are idle.
- **Critic picks for the owner: `8sync ccc delegate on | off | status`** (OFF by default).
  - When on, a product or technical AskUserQuestion is sent back to Claude with "have the `critic` agent grade the options (FATAL/MAJOR/MINOR), go with its pick (else the Recommended one), log it in `su-code/DECISIONS.md`, keep working".
  - The owner still answers the `Ship` question and anything about secrets/credentials/login, deletes or irreversible steps, money, production deploys, merges/releases, and high-risk decisions from the Usage Policy list (legal, medical, finance, credit, insurance, housing, hiring, admissions/grading, welfare).
  - New kit agent `critic` (read-only, Sonnet) and hook `ccc hook delegate` (PreToolUse on AskUserQuestion, no model call).
- **Rooms named after sessions.** At session start the kit reads the session's name from `8sync ccc .`'s registry and adds:
  - "Phòng của bạn": the role the name implies (`rd` → R&D, `qa`, `ui`, `api`, `ops`, `docs`, `sec`, `critic`, `lead`, `core`…; any other name is its own topic) plus up to 5 recall lines on that topic;
  - "Phòng khác đang làm": the other sessions of the same repo active in the last 2 hours, with their current task and files, so rooms don't edit the same files.
  - Same repo's registry only, masked, and fitted inside Claude Code's 10,000-char hook limit.
- **HQ office looks alive.**
  - 8th seat: Critic.
  - Every seat has a sprite with its own prop, empty seats included (resting, screen off).
  - Per-state frame timing, 1 px breathing, random blinks, a "done" flash, and a 4-frame walker with a dust puff.
  - One shared animation loop with a frame cache. It stops in hidden tabs and shows a still frame under reduced motion.
- Research brief `su-code/research/2026-10-15-always-on.md` covers Feynman, agent-sprite-forge, XERJ and Rust/wasm, with adopt/trial/skip calls and sources.

## [0.87.0] — 2026-10-14
### Added
- **Long tasks continue after a usage limit.** `8sync ccc kit` sets `autoContinueAtUsageLimit: true` in Claude Code user settings.
  - When a claude.ai usage limit stops a task, the open session waits and continues after the reset (Claude Code v2.1.234+; on by default there, now pinned).
  - An owner who turned it off in `/config` (`false`) stays off.
  - Limits of the feature (Claude Code's own): interactive sessions only (not `-p` or background sessions), resets within 24 h (not a weekly limit days out), at most 2 re-waits in a row, permission prompts still apply.
  - Same account, same plan. The kit does not switch accounts when a limit is hit: using several accounts to get around usage limits breaks the Usage Policy ("Do Not Abuse Our Platform"). To keep working before the reset, use `/usage-credits`, a bigger plan, or a Console API key.
  - Source: https://code.claude.com/docs/en/interactive-mode ("Wait for a usage limit to reset"), https://code.claude.com/docs/en/settings-reference (`autoContinueAtUsageLimit`).

## [0.86.0] — 2026-10-14
### Added
- **"Không ai rảnh" works like a real department.**
  - Quality gate: `ccc hook task-done` runs on `TaskCompleted`, sync, with the same `no_idle` switch.
    - It keeps a task open (exit 2) when the agent's transcript shows a code edit after its last test, lint or build command and the git tree still has uncommitted changes.
    - At most 2 holds per task, then the task passes.
    - Only real runners count as a check (`cargo test`, `pnpm run lint`, `pytest`, `8sync run`), not `ls tests`.
    - A teammate is judged by its own transcript. If that transcript is missing, the task passes.
  - Learning reflex: a task that was held back and then passed leaves one note. The member's next idle asks it to write the lesson with `/remember` (`failure: … → fix: …`). The hook never writes KNOWLEDGE itself.
  - The lead's advice (write the lesson, offer help to another session's room) now uses Stop `additionalContext`, which Claude Code shows as feedback, not as a hook error. Handing out an open task still blocks.
  - Source: https://code.claude.com/docs/en/hooks (TaskCompleted, Stop decision control).
- **HQ handoff cards across sessions.**
  - A `SendMessage` to another Claude Code session (a `uds:` address or a session name) is journaled under that session's id, with both session names ("core → rd").
  - The id is resolved from Claude Code's `~/.claude/sessions/<pid>.json` records. Only the `.json` files are read, never the `.key` files. The layout is not documented.
  - Only the message summary or its first line, at most 80 characters, is kept for another session, never the body (data minimisation).
  - The team thread card shows names and "đã trả lời / chưa trả lời" (the recipient wrote back afterwards).
  - Idle chips gain a "đang ghi bài học" state.
- `scripts/uat/no-idle-hook.sh`: 15/15 ok on Linux (task-done hold, then pass, then the lesson nudge).

## [0.85.0] — 2026-10-14
### Added
- **"Không ai rảnh" for agent teams** (`8sync ccc idle on|off|status`, default OFF). The kit registers a sync `ccc hook idle` on `TeammateIdle` and `Stop`; it decides from local files only (team task list `~/.claude/tasks/<team>/`, `su-code/STATE.md` Next, `su-code/KNOWLEDGE.md` `failure:` lines, other sessions' task lists), never calls a model. Teammate ladder: finish own in-progress task → take the next unblocked task via TaskList (Claude Code's file lock settles claims; the hook never assigns) → recall ≤5 lines → rest with a reason (Claude Code already notifies the lead when a teammate idles). Lead's Stop: hand out unowned tasks → when nothing is open, offer help to another session with open tasks → rest. Rails: ≤3 nudges in a row without task progress, the same nudge twice = rest, a $/hour budget from the status-line usage snapshots (default $5/h), and on a subscription login a lease the owner renews while present (`idle on --hours N`, default 2) because unattended automated use belongs on a Console API key. Each member's state is written to `~/.local/state/8sync/ccc/idle/status/` for `8sync hq ui`. Hook semantics: https://code.claude.com/docs/en/hooks (TeammateIdle exit 2), https://code.claude.com/docs/en/agent-teams (task list path).
- `scripts/uat/no-idle-hook.sh`: free sandbox UAT of the ladder and rails (12/12 ok on Linux).

## [0.84.0] — 2026-10-14
### Added
- `8sync ccc compact --window <100000..1000000>` / `--window-reset`: absolute cap on the auto-compact window (`CLAUDE_CODE_AUTO_COMPACT_WINDOW` in `~/.claude/settings.json` `env`, plain integer only; Claude Code also caps it at the model window and the env var beats `/autocompact`, `--autocompact` and `autoCompactWindow`). `compact` and `compact --json` show percent, window and the effective trigger "≈ pct × window" (8sync does not know the model window). `ccc kit` sets 400000 only when no window is set anywhere (env, `autoCompactWindow`, `modelSettings`), so Opus 1M compacts at ≈ 60 % × 400K = 240K instead of ≈ 580K; `kit --remove` drops it only while it still equals 400000. https://code.claude.com/docs/en/env-vars
- `scripts/uat/compact-window.sh`: real Haiku 5.5 run with the env var and no `--autocompact` flag. Measured first auto-compaction (override 60): 119,955 tokens = 60.0 % of 200K (US$0.21, token from the first file recalled after compaction); 58,098 at 120K and 50,136 at 100K, i.e. below 60 % at small windows (not verified why; those runs ended in Claude Code's autocompact-thrash stop, about US$0.04 each).

## [0.83.0] — 2026-10-14
### Added
- **`ccc kit` tool-output budget.** Writes `env.BASH_MAX_OUTPUT_LENGTH=20000` (documented default 30000) and `env.CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS=15000` (documented default 25,000) into `~/.claude/settings.json` only when absent. An owner value is never overwritten, and `kit --remove` drops a key only while it still equals the kit value. Output past the limit is not lost: Bash saves it to a file and Claude reads the rest on demand, and a long Read returns the first page with a `PARTIAL view` notice. Sources: https://code.claude.com/docs/en/env-vars, https://code.claude.com/docs/en/tools-reference#output-limits.
  - `scripts/uat/tool-output.sh` (real `claude -p`, Haiku 5.5, 2 runs each, cost about US$0.02 per arm): input tokens (input + cache) 171,115 / 171,177 at baseline vs 98,897 / 98,863 with the budget, about -42 %. Both runs still returned both hidden tokens (file end and command end). One task, Read and Bash effects not separated.
  - Not done: Read dedupe (skip re-reads of an unchanged file) stays a follow-up.

## [0.82.0] — 2026-10-14
### Fixed
- `8sync ccc kit` / `8sync up` / every `ccc` launch now refresh the 8sync block in ancestor CLAUDE.md files up to `$HOME` (exclusive), git repo or not: a stale FULL block becomes the current compact block (only text between the markers; CRLF and user text kept; `.bak-8sync` saved). A su-code memory dir's CLAUDE.md loses the block (a bare 8sync stub is deleted). cbm/serena lines still appear only when `harness cbm|serena on`.

## [0.81.1] — 2026-10-14
### Changed
- Release size ceiling 6272 → 6400 KiB, attributed in `scripts/size-gate.sh` (v0.81.0 linux-x86_64 was 6,428,208 B, 5,680 B over; +12,288 B vs v0.80.0). v0.81.0 was tagged but not published; 0.81.1 ships everything listed under 0.81.0.

## [0.81.0] — 2026-10-14 (tagged, not published)
### Added
- **Kit rules: cross-platform and rule gates are mandatory.**
  - Every build and release must work on Windows, macOS and Linux.
  - `/ship`, `/ship-auto`, `/ship-loop` and `/autopilot` merge only when CI is green on all three OSes (tests and release build). An OS without a job reads "not verified: <OS>" and blocks the merge.
  - Before every commit or Ship, the `sec` skill must be invoked, never replaced by a hand-written grep. `/rules` and `/aup-audit` run when the diff is high-risk, and always before a release.
- **`scripts/uat/`: real UATs with official `claude -p`.** They run in temp dirs, never touch the owner's config, and are budget-capped.
  - `compact.sh`: Claude Code auto-compacts at the `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` threshold. It measured 58.0 % of a 100K window with the override at 60, versus 75.6 % without it.
  - `up-kit.sh`: `8sync up` on an older machine refreshes the kit (stamp, statusline chain, compact env).
  - `auto-levels.sh`: `/ship-auto` and `/autopilot` on a toy repo with no remote. It checks green tests, conventional commits, a `sec` skill call in the transcript, ship state files, and that nothing was pushed.
- **`outputs/hq-team-ux.md`: cited UX brief for HQ.** It covers attention-first triage, needs-you, and the inter-agent thread. It has a gap table against v0.80.0 with a code/changelog basis for each row. Provenance is in `outputs/hq-team-ux.provenance.md`.

### Fixed
- **`8sync up` never refreshed the kit on Linux.** After the binary was replaced, `/proc/self/exe` reads `…/8sync (deleted)`, so `ccc kit` could not be started ("kit refresh failed"). `up` now resolves the install path before replacing the binary, and the path helper strips a trailing ` (deleted)`. A sandbox UAT now shows the kit stamp moving 0.79.1 → 0.80.0 with the fix.
- **`/ship-auto` and `/autopilot` skipped `/sec` and improvised without a remote.**
  - Both now must invoke the `sec` skill before every commit.
  - With no git remote, they commit, record `Ship: n/a (no remote)` and stop without asking Ship.
  - `/ship-auto` always writes `su-code/ship/<slug>/STATE.md`.
  - `/autopilot` runs every item, even a small one, through the `/ship-loop` rails (PLAN, `loop init`, `loop ev` evidence).

### Changed
- **`crates/ccc-core`** (lib `ccc_core`, `publish = false`): the session registry (`registry`, was `uuid_sessions.rs`), transcript scan + `Row`/`Digest` + `row_json`/`show_json` (`transcript`, was the pure half of `session_view.rs`), the secret masker (`secret_mask`) and `SCHEMA = 1` moved out of `crates/cli` into their own crate, with their unit tests. No behaviour change; the CLI keeps rendering/printing and re-exports the crate. ZUS pins it by git tag. Deps: `anyhow`, `serde`, `serde_json` only.

## [0.80.0] — 2026-10-14
### Added
- **HQ office: every session is a room.** The "Văn phòng" tab shows one room per running Claude Code session (started in HQ or anywhere else), grouped by the session's git folder and branch. Every room has the same seats (Lead, R&D, Plan, Fullstack, Reviewer, Tester, Quick); a seat lights up while that session's subagent of that kind runs (new `SubagentStart`/`SubagentStop` journal events). When a session messages another, its lead walks into the other room with the message (code-drawn walker sprite; static with reduced motion). The sidebar groups sessions by git folder and branch.
- **"Chat phòng" vs "Chat nhóm".** Chat phòng is one session's conversation (click a room to open it); Chat nhóm is every room talking to each other.
- **Message and assign to sessions started outside HQ (inbox).** The composer, Board and "Giao việc" reach any live session: non-tmux sessions (all of Windows) get the message through an owner inbox that the Stop hook hands over at the end of the current turn (`~/.local/state/8sync/hq/inbox/<session id>.jsonl`, 0600, secrets masked).
- **`8sync ccc secret set <encore|vercel|gh> <NAME> (--from <env-file> | --generate)`**: puts a secret into Encore (`--type prod,dev,pr,local`), Vercel (`--env production|preview|development`) or GitHub Actions through the provider CLI's stdin. The value never reaches the transcript, argv, a file or git; output shows the name and result only (the value is scrubbed and anything key-shaped masked). `secret keys <env-file>` lists key names only. `--generate` uses 48 bytes of OS randomness. Third-party keys (Mistral, PayOS…) still come from the owner. Encore's environment types are `prod, dev, pr, local` (`preview` is rejected with a hint).
- **`8sync ccc loop ev <slug> <label> -- '<cmd>'`**: runs one acceptance check and appends `iter N | label | exit E | last line` to LOOP.md; `/ship-loop` uses it instead of ad-hoc `bash -c "$2"` helpers the guard cannot read.
- **Kit teaches the auto mode classifier 8 Sync's infrastructure** (`autoMode.environment` in `~/.claude/settings.json`, Anthropic's `$defaults` kept, no allow/deny rule changed): GitHub orgs 8-Sync-Dev and 8syncdev, 8syncdev.com, Vercel and Encore Cloud deploy targets, and secrets set through `8sync ccc secret set`. `kit --remove` takes the entries back out (https://code.claude.com/docs/en/auto-mode-config).
- **`8sync ccc . report [--json]` and the "Báo cáo" tab.** Cost, time, lines +/−, context, tasks done/open and $ per finished task per session plus totals, and the `/ship-loop` runs. Numbers come from what Claude Code gives the 8sync status line (snapshot in `~/.local/state/8sync/hq/usage/`, written only when a number moves); unmeasured sessions read "chưa đo", never an estimate, and $/task only counts sessions with a measured cost.

### Fixed
- **HQ: clicking a running session showed "Start a session".** The composer only counted sessions HQ started in tmux, and scope matched the session name only. Any live session HQ can reach now counts, and a session is matched by name, session id or label; the header counts every live session.
- **HQ Board offered no session** ("Start a session to hand it tasks") while sessions were running: same tmux-only filter.
- **HQ tests wrote into the real HQ state on Windows** (`os.homedir()` reads `USERPROFILE`, tests set only `HOME`); a test run could rotate the owner's journal. Tests now isolate both.
- HQ tab bar overflowed at phone width.
- **Fewer "Do you want to proceed?" prompts in auto mode.** Replaying 2,397 real shell calls from three days of sessions: guard prompts went from 91 to 18 (the rest are pushes/merges, which the one `Ship` question approves, and deletes outside the repo). When 8sync merely cannot read a command (a command held in a variable, a delete target known only at run time, a piped script), auto mode now gets a deny with the fix, so Claude rewrites the command and continues; other permission modes still ask. Known-destructive work still asks; catastrophic deletes stay denied.
- Guard: a `|` inside a quoted search pattern (`grep -E "a|git push encore"`) was read as a push to a deploy remote. Shipping is now detected on a quote-aware split; quoted scripts (`bash -c "git push …"`) are still checked.
- Guard: the project is the git root above the session directory, so after a `cd apps/x` a delete elsewhere in the same repo no longer counts as "outside the project". `~/tmp` counts as a scratch directory.
- Guard: a recursive search that would print a `.env` is denied with the fix (`--exclude='.env*'`) instead of asking the user.
- Kit no longer installs `Edit(**/.env)` / `Edit(**/.env.*)` deny rules and removes them on update: Claude Code applies Edit deny rules to `rm` in Bash, so Claude could not delete a stray `.env` copy. Reading `.env` stays denied (`Read(...)` rules + guard), and the guard still blocks printing credentials and writing real secrets.

### Security
- The kit guard denies a session writing the HQ owner inbox or reading the HQ UI token (Bash, PowerShell, Write, Edit), so a session cannot speak as the owner to another session.

## [0.79.1] — 2026-10-14
### Fixed
- **`8sync hq ui` on Windows**: the first-run download failed with `curl: (43) A libcurl function was given a bad argument`. The stock Windows `curl.exe` (8.8.0, what PowerShell runs) rejects every `--write-out`; the HQ UI download now uses `--fail` and reads the HTTP status from curl's error, and the Discord API calls (`hq setup`/`post`/hooks) read it from the response headers (`include`). Reproduced and verified on this box with `C:\Windows\System32\curl.exe` first on PATH: 0.79.0 fails with error 43, the fix downloads, checks the sha256 and starts the UI.

## [0.79.0] — 2026-10-13
### Added
- **HQ web team control (`8sync hq ui`).** Everything works from the browser:
  - **Roles with model routing.** R&D, Plan and Architect use Opus 5.5. Fullstack, AI and Reviewer use Sonnet 5.5. Tester and Quick use Haiku 5.5. The model can be overridden from an allowlist of those three ids. The session starts with `--model` and `EIGHTSYNC_HQ_ROLE`, and the role badge shows on session rows.
  - **"Giao việc" dialog.** Send a task to a role or to one session. With a role, HQ reuses the least busy running session or starts `hq-<role>-<n>`. A new session gets the task as its first prompt, so a booting pane never loses it. Errors show inside the dialog, and projects whose folder is gone are not offered.
  - **Live terminal drawer.** Click a desk or a "needs you" card to open the session's tmux screen, refreshed under 1 s. The drawer has a "Gõ cho session" box, dialog keys and a full-screen toggle.
  - **"Chat nhóm" tab.** One thread with owner messages, replies, handoff cards (A → B), task cards with role, and "needs you" callouts.
  - **Handoff bubbles.** Desks show "→ B" / "← A" for 4 s when a session messages another. Reduced motion shows a static label.
  - **"Cách dùng" guide.** Five steps in Vietnamese, opened on first run and from the header.
  - **`scripts/hq-offline-check.sh`.** It fails on non-local fetch/WebSocket/EventSource targets, remote fonts/CDNs, or key-shaped strings in the UI source.
- **`8sync ccc compact`**: auto-compact threshold for Claude Code sessions. `compact` shows it (`--json`), `compact --at <10..95>` writes `env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` in `~/.claude/settings.json` (atomic + `.bak-8sync`, other keys kept, no-op when unchanged), `compact --reset` removes it. `ccc kit` sets 60 only when the key is absent (an owner value is never overwritten); `kit --remove` drops it only if it still equals 60. Claude Code can only lower the threshold with this variable, and it applies to new sessions (https://code.claude.com/docs/en/env-vars).
- **`8sync ccc help`**: every ccc verb on one screen (Vietnamese), grouped Session / Kit / Tự động / Xem / An toàn. A unit test reads the dispatcher and fails if a verb is missing from the list.
- **Statusline reaches every machine**: `8sync ccc kit` now installs the 8sync status line (and subagent line) by default and chains a foreign `statusLine` as the last row (parked as `statusLine_prev`), instead of only printing a hint; our command path is refreshed to the current exe. `8sync ccc statusline --uninstall` records `statusline = false` in `features.toml` so the kit never reinstalls it; `--install` clears that. **Behaviour change** (kit used to keep a foreign statusLine untouched).
- **`8sync up` refreshes the kit** after a successful update when a kit is installed (runs `ccc kit` on the new binary), so other machines get new kit files + statusline without a separate step.
- Statusline faster and tidier: branch read from `.git/HEAD` (worktrees and detached HEAD handled, no `git` spawn; one spawn left for the dirty check); model label `Opus 5.5 (1M context)` → `Opus 5.5 · 1M`, effort dim `med/high/low`; row 2 shows the dim folder name outside a git repo.

### Fixed
- HQ journal: a `SendMessage` sender that is the session's own uuid was masked to `***`, so every handoff lost its sender. The own session id now bypasses the masker, and the web falls back to the row's session for older rows.
- `8sync ccc <verb-like word>` (`help`, `compact`, `guard`, `ship-grant`, …) never starts a headless claude session: reserved words route to their handler or print help.

## [0.78.1] — 2026-10-13
### Changed
- Release size ceiling 6144 → 6272 KiB from the measured v0.78.0 linux-x86_64 asset (6,338,096 B, 46,640 B over: statusline + JSON surfaces). v0.78.0 was tagged but not published; this release carries everything listed under 0.78.0.

## [0.78.0] — 2026-10-13
### Added
- **`8sync ccc statusline`: a Claude Code status line.** Row 1: model (+ effort), context bar (green below 50%, yellow 50–80%, red above 80%), 5h and 7d rate limits with reset countdown (`↻ 1h23m`, only when Claude Code sends them), session cost, `+lines/-lines`. Row 2: branch (`*` when dirty; 50 ms git budget), PR `#12 ✓/●/✗` from Claude Code's own `pr` field (no `gh` calls), tasks done/total with the current task, fresh watchdog alert, `ccc loop` iteration, `🚢 grant` while the session holds a ship grant. Respects `COLUMNS`, never fails (falls back to `8sync · <model>`).
- `8sync ccc statusline --agents` for `subagentStatusLine`: `⚙ 2 running (task 3m12s · reviewer 40s) · 1 idle`.
- `8sync ccc statusline --install` / `--uninstall`. `ccc kit --remove` also restores your previous statusLine. A foreign `statusLine` is parked as `statusLine_prev` in `~/.config/8sync/features.toml` and chained: it runs with the same stdin and its output becomes the last row. `8sync ccc kit` installs it only when no `statusLine` exists and prints a hint otherwise.
- **ccc JSON surfaces** (`docs/hq-ui-contract.md` section 4): `8sync ccc . show <name> --json` / `8sync show <name> --json` (adds `last_users`, `last_text`, `tasks`, `files`, masked), `8sync ccc kit status --json`, `8sync ccc login-kind [--json]` (presence checks only, never prints a token or email). Every ccc/ls JSON output now carries `"schema": 1` (on each row for arrays).

## [0.77.0] — 2026-10-13
### Added
- **`--offline` for `8sync ccc`** (`new <name>`, `<name>`, `.`, `kit`; or `EIGHTSYNC_OFFLINE=1`): no network step runs — no auto-update, no background update probe, no Claude Code installer (`claude` must already be on PATH), no `claude mcp add-json` mirroring. Kit files and local skill linking still install. Each skipped step prints one `skip` line. All of these go through one `net_allowed` gate, covered by unit tests.

### Fixed
- Security: `8sync ls/show` and the HQ journal printed passwords typed in prose ("sudo password của tôi là …", "mật khẩu: …", "pass: …", "password is …"). The shared masker (`secret_mask.rs`) now masks the value after pass/password/passwd/pwd/pin/otp/secret/token/api key/mật khẩu/sudo triggers; ordinary prose ("password reset flow", "sudo apt install") is left alone.
- Floor: desk subtitle no longer shows a truncated full session uuid; a paired hq session id goes to `sid` and keeps the ls name (`apps/hq-ui/lib/floor.ts`, `lib/server/floor.ts`).
- Session registry (`index.json` for `forge` / `ccc .`) is now written atomically under an exclusive lock (`index.json.lock`, tmp + rename) through one `update` helper, so concurrent launches no longer lose entries; a corrupt index is kept as `index.json.corrupt-<unix>` and rebuilt instead of silently dropped. On-disk format unchanged.



## [0.76.0] — 2026-10-13
### Added
- **Five graded auto commands for ccc** (all inside official Claude Code; no bypassPermissions): `/do <việc>` (one small change, no plan, no commit, light checks), `/ship` (full process), `/ship-auto` (ship through PR → CI → merge → release → install → monitor with ONE "Ship" question), `/ship-loop <mục tiêu>` (acceptance criteria with check commands, iterate implement → check → fix with evidence in `LOOP.md`, caps `--max-iter 12` / `--max-min 90`, stuck and no-change detection via `8sync ccc loop`; Claude Code's built-in `/goal` can be layered on top by the owner), `/autopilot` (unattended backlog: issues labelled ccc/8sync → STATE Next → KNOWLEDGE failures; one Ship question per batch; respects other sessions' lanes). Levels 3–5 are owner-invoked only (`disable-model-invocation`).
- `8sync ccc loop <init|tick|status|done|ls>`: bounded-loop state (`su-code/ship/<slug>/loop.json`) with stop rules max-iter, max-min, stuck (same digest twice) and no-change; kit gains the `do`, `ship-auto`, `ship-loop`, `autopilot` skills (`ship-loop`, `autopilot` stay core).
- `8sync ls --json` rows gain `sid` (Claude session uuid for `claude`/`ccc` engines, `null` otherwise); other fields unchanged.

### Fixed
- **hq-ui "Văn phòng": a running Claude session no longer shows as two desks.** The floor now joins an hq session to its `8sync ls` row by session id, then by name, then by folder (`~` expanded; an agent working in a subfolder or worktree of the repo still matches when that is unambiguous). Matched sessions are never appended again. A truly unknown hq session still shows, labelled with its 8-char id instead of the full uuid, after the matched desks.

## [0.75.0] — 2026-10-13
### Changed
- Release size ceiling 6080 → 6144 KiB from the measured v0.74.0 linux-x86_64 asset (6,231,472 B, 5,552 B over: taste-skill variants + `ls` fields). v0.74.0 was tagged but not published; this release carries everything listed under 0.74.0.

### Added
- **Ship once, not at every step.** Claude now asks a single `AskUserQuestion` with header "Ship" that lists every merge, push to main, tag, release, publish and production deploy it will do. Options: "Duyệt tất cả", "Chỉ merge, chưa deploy" or "Dừng".
  - Claude Code passes the owner's answer to the new `ccc hook ship-grant` (PostToolUse on AskUserQuestion), so it cannot be forged. The hook writes an 8-hour grant for that session (0600 file).
  - The guard then lets those shipping steps through without a prompt each time. "Chỉ merge" grants shipping but not production deploys.
  - Deny rules (force-push, deleting roots, secrets) never look at a grant. A command that also contains a non-shipping ask still prompts.
  - Before this, every `gh pr merge` or `vercel --prod` prompted separately.

## [0.74.0] — 2026-10-13
### Added
- **`8sync hq ui` "Văn phòng" (default tab): every Claude Code / omp session is a pixel coworker at a desk.**
  - Seven code-drawn 32×32 animated states: resting, typing, running a command, reading/searching, waiting for you (raised hand), stuck (red "!"), done (cheer).
  - Each desk shows a Vietnamese text label, one caption line and task progress; waiting and stuck desks come first, and old idle ones are collapsed.
  - The sprites are drawn in the browser on a canvas: no image files, no image-generation APIs.
  - The animation runs at about 7 fps, pauses while the tab is hidden or the desk is offscreen, and shows a single frame under `prefers-reduced-motion`.
  - Data comes from the new token-gated `/api/floor` (`8sync ls --json --all` + hq sessions, 4 s cache, single flight).
  - Desks are grouped by repo. Working, waiting and stuck sessions sit as large desks (character ~100 px) in one shared pixel room per repo. Idle and done sessions show as one line each (state, name, engine, last line, age). Repos with someone waiting or stuck come first.
  - Each desk shows an engine badge (Claude / omp). Repeated names inside a repo get the 8-char session id (or `#n`). Leading emoji and ALLCAPS tags ("🔗 TRACE:") are hidden from titles; the full title stays in the tooltip.
  - Waiting desks get a lime ring and a "Chờ anh" badge; stuck desks get a red ring and a "Kẹt" badge.
- **Sidebar: projects whose folder no longer exists fold under "Không còn thư mục (N)".** `GET /api/projects` now returns `missing` per project. No data is deleted.
- **`8sync ls --json` rows gain `last_tool` and `stalled_error`.** `last_tool` is the raw name of the latest tool. `stalled_error` is the API error that the kit's StopFailure hook recorded for that Claude session within the last 24 h.
- **HQ UI on brand and simpler.**
  - 8 Sync mark and lime-on-near-black tokens (WCAG AA checked in light and dark); Geist and Be Vietnam Pro fonts.
  - Readable session names instead of uuids, with old or ended sessions under "Older".
  - The composer is replaced by a "Start a session" action when no session is running.
  - Chat is rendered with Vercel AI Elements components (display only: no model calls, no keys).
- CI runs hq-ui typecheck (`next typegen` + `tsc`) and vitest, and uploads the packaged hq-ui tarball as an artifact for local UAT without building.
### Changed
- **Release notes come from CHANGELOG:** the release workflow publishes the version's CHANGELOG section plus an install line, followed by GitHub's generated PR list. Before this, the notes were only the PR title. The v0.72.0 and v0.73.0 notes were rewritten the same way.
- `taste-skill` (design-taste-frontend) refreshed from upstream Leonxlnx/taste-skill d237dd3 (MIT, LICENSE now shipped). Five plain-markdown variants are added as skills: `taste-brutalist`, `taste-minimalist`, `taste-soft`, `taste-redesign` and `taste-output`. Variants that need image generation or Google Stitch are left out.

## [0.73.0] — 2026-10-13
### Added
- **`/ui-ux <việc>`**: an easy-to-type entry point for UI/UX work. The `/` menu matches skill names, so `/ui` never found `impeccable`. It opens `impeccable` (the 8 Sync design system) first and routes to the right sub-command, then to taste-skill, frontend-ui-engineering, senior-frontend, nextjs-app or browser testing when they fit.
- The kit links **every** skill in `~/.omp/skills`, not only the 29 8sync ships. Previously `frontend-ui-engineering`, `browser-testing-with-devtools`, `api-and-interface-design` and others were missing from Claude Code.
- **Workspace skill libraries for every ccc session:** `8sync ccc kit --skills-from <dir>` registers a skill folder, for example `~/startup/8sync-startup/su-code/skills` with its 237 skills (`loop-me`, `grill-me`, `agent-browser`, `live-verify`…). Before this, those skills only existed inside that repo.
  - Each kit run links every skill Claude Code doesn't have yet into `~/.claude/skills`. Kit files, bundled skills and the owner's own skills are never overwritten.
  - Library skills are listed by name only (`skillOverrides`), so a large library barely grows the session prefix.
  - The libraries are kept in `features.toml` as `skill_libraries`.

## [0.72.0] — 2026-10-13
### Fixed
- Guard: a data here-doc later in the command (`cat > report.md <<'EOF' … for … () …`) no longer turns off variable resolution, so `S=/tmp/x/scratchpad; rm -rf $S/target` stops asking (seen live in a subagent's cleanup).

### Added
- **Watchdog soft remedy + early warning:** under sustained pressure (MemAvailable, load, or PSI `/proc/pressure` memory/io full, cpu some) busy session processes — compilers, linkers, bundlers (new `build` list) and watched runtimes, above 25% CPU — get `renice 19` + `ionice -c3` once (they keep running; never killed), and Claude is told to stop parallel agents/builds and use CI. PSI gives its own `pressure` alert, earlier than MemAvailable/load.
- **Watchdog GPU without vendor tools:** AMD GPUs are read from sysfs (`gpu_busy_percent`, `mem_info_vram_*`) and warn on busy/VRAM; `8sync watchdog status` shows the GPU sources, says when an NVIDIA card is present but unmeasured (no `nvidia-smi`), and prints PSI.
- **Session fence (Linux, systemd --user):** `8sync ccc .` runs claude inside `8sync-ccc.slice` — shared by all ccc sessions, `MemoryHigh=70%` (soft: the kernel throttles, never kills), `CPUWeight=50`, `IOWeight=50` — so a heavy session slows down instead of freezing the desktop. Off: `EIGHTSYNC_FENCE=0` or `session_fence = false` in features.toml.
- **Kit rules: no heavy local builds; sessions work as a team.** Heavy build/test goes to GitHub Actions (`gh workflow run` → `gh run watch` → `--log-failed`); locally only light checks under `nice -n 19 ionice -c3 -j2`; never flip repo visibility for free minutes. Sessions check `8sync ccc . ls` / ListAgents first, split overlapping work and announce shared changes via SendMessage.

## [0.71.0] — 2026-10-13
### Added
- **Stop gate checks the task list:** when Claude touched its tasks (TaskCreate/TaskUpdate/TodoWrite) since the owner's last message and still has open tasks of this turn (in progress, or created since that message — older pending ones are left alone), a silent stop is blocked once with their titles ("finish them, or mark them completed/deleted, or say what you need"). A question to the owner, a hand-off, a risky action, the owner saying stop, or a second stop in a row still end the turn. Never blocks an agent-team lead (TeamCreate/SendMessage: teammates' completions are not in its transcript) or a transcript only tail-scanned (> 24 MB). Measured on a 14 MB transcript: 34–38 ms (release); 5 ms when tasks were not touched this turn.
- **Turns that die on an API error are caught:** `ccc hook stop-failure` (Claude Code's `StopFailure`: rate_limit, overloaded, server_error, max_output_tokens, …) records the error per session (0600 file in a 0700 dir under `~/.local/state/8sync/ccc/stopfail`, dropped after 24 h; nothing written without an absolute HOME) and shows a desktop notification; on the next prompt in that session — even a bare "tiếp" — `ccc hook resume-note` tells Claude its last turn ended early and to check TaskList and `su-code/ship/ACTIVE` before continuing (said once). StopFailure itself cannot make Claude continue (docs: no decision control).

## [0.70.0] — 2026-10-13
### Added
- **`/ship` runs the whole team process:** plan → R&D → code → test → UAT → review/QC (`/sec`, `/aup-audit` when triggered) → docs + memory → commit; with a trailing `--release`/`--deploy` flag it goes on to PR → CI → merge/tag/deploy → monitor (no push without it). State lives in `su-code/ship/<slug>/STATE.md`; `su-code/ship/ACTIVE` names the running one and the session-start digest puts its head first, so it survives /compact, /clear and resume.
- **`/planning`** (plan only: acceptance criteria, tasks by file, risks, one batched question), **`/remember`** (one evidence-backed `failure:`/`validated:`/`decision:` line in `su-code/KNOWLEDGE.md`) and **`/consolidate`** (dedup/prune memory, owner approves once). Kit: 22 files.
- **Session thread survives /compact and resume:** `ccc hook session-start` (matcher now `startup|resume|clear|compact`) appends this session's latest owner requests, open tasks first and recent files (masked, ≤ 3 KB; STATE digest + block ≤ ~9 KB, under the 10,000-char hook cap). Measured on a 14 MB transcript: 149 ms (debug build).
- Release size ceiling 6016 → 6080 KiB (+14,320 B local gnu vs v0.69.0, embedded skills; attribution in `scripts/size-gate.sh`).
- **Guard asks before shipping:** push to `main`/`master`, tag pushes (`v1.2.3`, `--tags`, `--follow-tags`), push to an `encore` remote, `gh pr merge`, `gh release create`, `vercel --prod`, `npm|pnpm|yarn|bun|cargo publish`, `fly|flyctl|wrangler|firebase deploy`. Feature-branch pushes, PRs and dry-runs stay silent.

### Fixed
- Watchdog: machine load is compared with the real core count from `/proc/stat`; under the service's `CPUQuota=5%`, `available_parallelism` reported 1 core, so load > 2 alerted on a 16-core box.
- Watchdog: a RAM/CPU alert for a process that is not a known helper (e.g. `node`) no longer says "keep that helper off"; it says the watchdog only reports it.


## [0.69.0] — 2026-10-13
### Added
- **`8sync watchdog`** — an always-on, std-only guard (reads `/proc`, ~2 s period) for runaway harness helpers. `run [--dry-run]` builds the process trees under `claude`/`omp` plus known helpers (codebase-memory-mcp, serena, headroom, codegraph, tsserver, rust-analyzer…; list in `~/.config/8sync/watchdog.toml`, created with defaults) and, on sustained CPU / RSS, machine MemAvailable or load, GPU memory (optional `nvidia-smi`, 10 s), writes an alert to `~/.local/state/8sync/watchdog/alerts.jsonl` (0600), calls `notify-send`, and — only for known helpers running inside a `claude`/`omp` process tree, never `claude`/`omp`/editors/browsers/runtimes, and never for the `warn_only` indexers (codegraph, LSPs: alert only) — sends SIGTERM then SIGKILL after a grace period; a helper killed more than 3× in 10 min is quarantined in `~/.config/8sync/watchdog-blocked`. `install|uninstall|status` manage a `systemd --user` service (Nice=10, CPUQuota=5%, MemoryMax=64M; other OSes print "not supported yet").
- **`8sync ccc hook watchdog`** (registered by `8sync ccc kit` on `UserPromptSubmit` and `PostToolUse`, synchronous, timeout 5): feeds unseen alerts for this session's process tree or the whole machine to Claude Code as `hookSpecificOutput.additionalContext` (≤ 1,500 chars; per-session cursor; no output and no writes when nothing is new).
- `8sync harness cbm|serena off` removes the Claude Code user-scope entry only when it is the exact launcher 8sync mirrored; an owner-added entry with the same name is kept (hint printed). `features.toml` that does not parse is reported, never overwritten.
- **`8sync watchdog unblock <name>|--all`** allows a quarantined helper again; the blocked list is updated under a file lock with tmp+rename, the running service re-reads it every tick and the helper starts with a clean kill history. Alerts for codebase-memory-mcp / serena point at `8sync harness cbm off` / `8sync harness serena off`.
- Release size ceiling 5952 → 6016 KiB (watchdog + cbm/serena switches: +87,176 B on a local gnu release vs v0.68.0; attribution in `scripts/size-gate.sh`).
### Changed
- **Kit question rules:** questions go in one batched `AskUserQuestion` (≤4, Recommended first, one Submit); when the owner says "tự làm đi"/"auto", Claude picks Recommended for every product/technical question and states assumptions — secrets and destructive/paid/prod/push-main actions still ask. Fewer permission prompts: run in the session dir, `git -C`/absolute paths instead of `cd … &&`, worktrees inside the repo.
- **codebase-memory-mcp is now strictly opt-in (default off).** Its index worker, one MCP server per Claude Code/omp session and a systemd --user daemon pegged the CPU (one worker ~283% / 847 MB, 1.2 GB cache). `8sync harness`, `harness up/auto` and `8sync ccc kit` no longer install, register or index it unless enabled. Toggle with `8sync harness cbm on|off|status` (stored in `~/.config/8sync/features.toml` as `codebase_memory_mcp`; `EIGHTSYNC_CBM=1|0` overrides). `off` also removes it from Claude Code (user scope) and the 8sync-written entry from `~/.omp/agent/mcp.json` (other entries untouched); it kills nothing, only prints a hint. When on, `auto_index` is set to `false` (index on demand only) instead of `true`. A stub binary (`--version` says "disabled"/"(stub)") counts as not installed and is never registered. Kit CLAUDE.md / injected block no longer tell agents to use it first (codegraph CLI first).
- **serena MCP is opt-in too (default off).** Python/JS MCP servers cost a process per agent session; 8sync prefers native/Rust tooling (codegraph CLI, Claude Code LSP plugins). `8sync harness serena on|off|status` (`serena` key in `features.toml`, `EIGHTSYNC_SERENA=1|0` overrides); `ccc kit` and `harness up` no longer register it unless enabled; `off` removes it from Claude Code (user scope) and the uvx entry from omp's mcp.json.
- **Agent guidance is codegraph-first; cbm/serena text is gated on the flags.** Rules, APPEND_SYSTEM, force-load, kit CLAUDE.md, AGENTS/CLAUDE blocks, commands and bashInterceptor messages only mention `mcp__codebase_memory_mcp_*` / `mcp__serena_*` when `harness cbm|serena on` (asset lines prefixed `@cbm ` / `@serena `; `code_intel_available` also requires the flag).

## [0.68.0] — 2026-10-13
### Added
- **`8sync hq ui` works without a repo checkout.** The UI (Next standalone) and the `8sync-hq` channel (one esbuild file, no `node_modules`) ship as a platform-independent release asset `8sync-hq-ui-v<version>.tar.gz` + `.sha256` (built by the new `hq-ui` job in `release.yml` via `scripts/package-hq-ui.sh`, which fails if any native `.node`/`.so` is inside). On first run 8sync downloads it with `curl` (https only), verifies the sha256 (mismatch or no hasher = refuse, existing install untouched), extracts it with `tar` into `.tmp-<pid>` (refuses absolute / `..` entries and any symlink or file that resolves outside the tree), then swaps it atomically into `~/.local/share/8sync/hq-ui/<version>/`, then runs `node hq-ui/server.js` (no pnpm). It also writes `~/.config/8sync/hq/channel-mcp.json` (0600) for the installed channel and defaults `HQ_CHANNEL_FLAGS` for the UI process. Resolution order: `--app` / `EIGHTSYNC_HQ_UI_APP`, installed copy, a *built* `~/tools/su-code/apps/hq-ui`, else download. `8sync hq ui --update` reinstalls; `EIGHTSYNC_HQ_UI_TARBALL=<file>` installs a local tarball (sha from `<file>.sha256`).

- Install hardening: `<base>/.install.lock` (stale after 10 min), failed update restores the previous install, leftover `.tmp-*`/`.dl-*`/`.old-*` older than 1 h are cleaned, only the current and previous version dirs are kept. The `.sha256` comes from the same release as the tarball, so it checks integrity (corrupt/partial download), not an independent root of trust; when the GitHub API lists an asset digest it is cross-checked too (mismatch = refuse; API unreachable = warning). The asset has no symlinks (dereferenced when packaged; `ci.yml` job `package-hq-ui` checks it on PRs) and no server-side `*.js.map`. `--update` with `--app` / `EIGHTSYNC_HQ_UI_APP` prints a warning.

### Fixed
- `8sync hq ui --app <dir>` / env / a repo checkout now runs the app's `pnpm start` (fallback `npm start`) instead of `.next/standalone/server.js`, which has no `.next/static` next to it (every CSS/JS asset 404). Only the installed release asset runs `hq-ui/server.js`.

### Changed
- `apps/hq-channel` pins `esbuild` 0.25.12 as a devDependency; the package script uses `pnpm exec esbuild`.
- `apps/hq-ui` builds with `output: "standalone"`, `images.unoptimized` and sharp/libvips excluded from tracing (platform-independent asset). The old `<exe>/../share/8sync/hq-ui` lookup is gone.

## [0.67.1] — 2026-10-13
### Changed
- Release size ceiling 5888 → 5952 KiB from the measured v0.67.0 linux-x86_64 asset (6,030,288 B, 976 B over). v0.67.0 was tagged but not published; this release carries everything listed under 0.67.0.

## [0.67.0] — 2026-10-13 (not published)
### Added
- **`8sync ccc . ls` shows what every session is doing**: `● running` (a live Claude Code process holds it), `● active` (written < 2 min ago) or `○ idle`; the latest request ("ask"), the latest action ("now"), task progress (`todo 3/7 ▸ current task`, from TaskCreate/TaskUpdate/TodoWrite), messages, context tokens and model. Width-aware, secrets masked (title included), reads at most the last 256 KB of transcripts over 24 MB and smaller ones whole, on at most 8 threads (45–115 ms per repo here); a session whose scan fails shows as `unreadable` instead of vanishing. `--json` carries the same fields. `8sync . ls` (omp) uses the same view.
- `8sync ls [--all]` (every session of this repo, or of every repo), `8sync show <name>` (last 5 requests, last answer, task checklist, files touched, resume line), `8sync guide` (Vietnamese quickstart, Claude Code first); full guide in `docs/huong-dan.md`.
- **Local team UI: `8sync hq ui`** (Next.js + shadcn/ui, SQLite via `node:sqlite`, 127.0.0.1 only, local token + Origin/Host checks): add project folders, start official Claude Code sessions in tmux, team chat, kanban board, live session status, an interactive terminal drawer (allow-listed keys: Enter/Esc/↑/↓/Tab/1–3/y/n/typed text) to answer Claude Code's dialogs, activity log. Hooks write a local journal (`~/.local/state/8sync/hq/events.jsonl`, 0600) when `local = true`: tasks, session start/end, cross-session `SendMessage`, and, only for `hq-*` sessions started by the UI, each turn's final answer (Stop hook `last_assistant_message`) and notifications. Every text/subject field passes the shared secret masker first (heuristic: see below). `8sync hq ui` prints a notice when it turns `local` on (and only after the UI process started); `8sync hq ui --off` turns it off; `8sync hq purge [--yes]` deletes `events*.jsonl`, `hq.db*` and `channel-*.json` under `~/.local/state/8sync/hq` (without `--yes` it only lists them). Files are rotated at 5 MB (one `events.1.jsonl` kept) and stay until you purge.
  - Owner messages go to the session through the `8sync-hq` channel when Channels work, else they are typed into the session's own terminal. The UI detects "Channels are not enabled for your org" and uses the terminal, retries an unanswered channel message in the terminal after 25 s, and **refuses (409) to type while Claude shows a dialog**: in a live test, a message typed into the "Teach auto mode" wizard had moved it to "scan shell history: true" (cancelled before Continue).
  - Live UAT on Claude Code 2.1.296 (Team login): folder-trust dialog answered from the UI's key API, owner message → task created/completed → board shows it under the session name → the Vietnamese answer appears in the chat; session `alpha` found `beta` with `ListAgents`, asked it over `SendMessage`, and relayed its answer. Channels on this org are off ("set channelsEnabled"), so the channel path itself is tested with an MCP client only.
- **`8sync ccc . <name> --team`** starts the session with Claude Code agent teams on (env `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` for that launch only, never written to settings); `--panes` shows teammates as tmux split panes (`teammateMode: "tmux"`, inside tmux). `8sync ccc . --team` with no name reopens the last-used session with teams on. Refuses `-p`, `-pc` and `--print=…`, because Claude Code spawns no teammates there. Live: the lead spawned `@helper` from the kit's `quick-task` agent, helper answered, the lead relayed it.
- `8sync ccc kit --remove` takes every 8sync hook entry out of `~/.claude/settings.json` (your own hooks stay, also when they share a group with an 8sync hook). It writes nothing when there is nothing to remove, keeps `settings.json.bak-8sync`, and replaces the file by rename. Run it before uninstalling 8sync: the guard now fails closed. If the binary is already gone, see the manual recipe in `docs/huong-dan.md`.
- **One shared secret masker** (`verbs/secret_mask.rs`) for `8sync ls/show/--json` and the HQ journal: splits on any whitespace, handles `key: value`, `key=value`, `"key":"value"` for token/secret/password/passwd/api_key/apikey/access_key/private_key/authorization/bearer/cookie/session, known prefixes (`sk-ant-`, `sk-`, `ghp_`/`gho_`, `github_pat_`, `AKIA`/`ASIA`, `xox[bpas]-`, JWT `eyJ`, `AIza`, Discord bot token shape) and PEM blocks. Heuristic: a secret with no name and no known shape is not caught, and non-English key names (e.g. Vietnamese "mật khẩu:") are not recognised. Non-ASCII text before `:`/`=` ("Lưu ý:") is handled (a slicing panic found in review is fixed and fuzz-tested).

- **The Claude Code guard now stops destructive shell commands, in Bash and in PowerShell** (`crates/cli/src/verbs/ccc/danger.rs`). Measured against omp 18.9 and Forge 2.14 on direct instructions: both deleted a folder outside the repo, printed `.env` and force-pushed; `8sync ccc` stopped all three: force-push denied by the guard, the outside delete asked first (a denial under `claude -p`), `.env` refused by the org rules before any tool call.
  - **Denied:** deleting a filesystem root, a top-level folder, the home directory, the project or any of their ancestors, or a temp root, also as "everything in it" (`rm -rf *`, `rm -rf */`, `find . -delete`, `Remove-Item -Recurse ~`, `rd /s /q C:\Users\me`, `[IO.Directory]::Delete`); disk wipes (`mkfs`, `dd of=/dev/sdX`, `Format-Volume`, `diskpart`); `wsl --unregister`; force-push in every spelling (`-f`, `-uf`, `--force-with-lease`, `+ref`, `--mirror`, `-c remote.*.push=+…`); printing or uploading a credential file (`cat .env`, `cat .env*`, `Get-Content .env`, `curl -F f=@.env`, `scp .env host:`).
  - **Asked first** (a denial Claude reads under `claude -p`): deletes outside the project and the temp dirs, `rm -rf .git`, targets only known at run time (`$VAR`, `$(…)`, `xargs`, a filtered pipeline into `Remove-Item` such as `gci | ? Name -like x | Remove-Item`), deletes inside `wsl`/`ssh`/`docker exec`/`kubectl exec`, a script piped into a shell (`curl … | bash`), `-EncodedCommand`, unbalanced quotes, `git reset --hard`, `git clean -f`, deleting a remote branch.
  - It reads the command the way the shell does: quotes, escapes, line continuations, `#` comments, here-docs and here-strings, `$(…)`/backticks/`<(…)` (also inside double quotes), `then`/`do`/`!`, `cd`/`Push-Location` tracking, `sudo`/`env`/`timeout` wrappers, `eval`/`iex`, nested `bash -c`, `pwsh -c`, `powershell '…'`, `cmd /c`, `wsl -- …`, `ssh host '…'`, here-docs fed to a shell. A structure-blind pass over the raw text also denies a delete aimed at a root, home or top-level folder and a force-push, so a parsing gap alone cannot let `rm -rf ~` through. In straight-line Bash, a variable set to a literal earlier in the same command is resolved (`out=build; rm -rf "$out"` passes, `X=/; rm -rf "$X"` is denied). Anything that could change the value unseen keeps it unknown (asked): an assignment after `||`, in a pipe or group, or reassigned from a non-literal; values with spaces, globs or `~`; and for the whole command any loop, function, `+=`, `IFS`, `eval`, `source`/`.`, `declare`/`local`/`export`/`read`/`printf`/`let`/`unset`. Scripts handed to another shell (`bash -c '…'`, `ssh h '…'`) are never rewritten. `eval "$(…)"` asks unless it runs a known shell-init generator (`ssh-agent`, `direnv`, `pyenv`, `brew shellenv`…). Everyday work passes: `rm -rf target`, `cd build && rm -rf *`, `rm -f *.log`, `rm -rf /tmp/x-*`, `find . -name '*.pyc' -delete`, `Remove-Item -Recurse .\dist`, `docker rm -f web`, `grep .env .gitignore`, commit messages that mention `rm -rf ~`.
  - The hook matcher includes Claude Code's separate `PowerShell` tool (Windows), which `Bash(...)` rules and `Bash` hooks never covered. About 9 ms per call on Windows, process start included (`8sync --version` alone: 8.6 ms; 30 runs, release build). If the analyser ever panics, the hook answers `ask` instead of letting the command run.

### Changed
- The guard hook fails closed (`onFailure: "block"`, Claude Code 2.1.295+): if it can't start, crashes, times out or returns bad JSON, the tool call is blocked instead of running unguarded.
- Release size ceiling 5760 → 5888 KiB, attributed in `scripts/size-gate.sh` (ls/show/guide ≈ +95.7 kB, HQ journal/launcher ≈ +12.1 kB on local x86_64 builds).
- **Native Stop gate** (`ccc/gate.rs`) replaces the Haiku prompt hook. No model call: it reads the last message and the user's last message from the transcript tail. Ending on an unfinished plan ("Next I'll…", "I'll fix that now.", "Tiếp theo tôi sẽ…") or a routine "shall I proceed?" continues the turn. It ends the turn when the plan is a destructive, outward-facing or paid action, when the question is about secrets, access, money or a choice between options, while a background task is still running, on a second stop in a row, and when the user's last message says stop/wait ("stop", "wait, …", "dừng lại", "khoan") — the rule 0.66.0 added to the Haiku gate, now read from the user instead of Claude's paraphrase. Words match whole words (`fix` ≠ `prefix`) and Vietnamese phrases (`đánh giá`, `khóa học` are not price/key questions). Design brief with sources (CowAgent, oh-my-pi, ForgeCode, Claude Code docs/plugins, public guards): `outputs/stop-gate-guard-design.md`. The Haiku gate cost ~30k Haiku tokens and ~2.6 s per turn end (~48k tokens per bench run), and most of its 20 real blocks were turns waiting for a background agent.
- **claude.ai connectors off by default** (`disableClaudeAiConnectors: true`, only when unset): a trivial `claude -p` on a claude.ai login went from ~8.4 s to ~7.2 s and the prefix shrank by ~2k tokens per request; Gmail/Drive tools are no longer reachable from a prompt injection.
- Same-model bench (Sonnet 5.5; ccc on the team login, omp and Forge on a Console key; Rust, TypeScript, Python and repo-exploration tasks × 2 runs; cost at API list price): every arm 82/82 hidden checks.

  | Harness | Wall median | Requests / run | Output tokens / run | $ / run |
  |---|---|---|---|---|
  | `8sync ccc` 0.65 | 44.4 s | 6.5 | 4,830 | 0.150 |
  | `8sync ccc` dev (0.65 + this change) | 43.1 s | 7.1 | 4,799 | 0.143 |
  | omp 18.9 | 40.1 s | 5.6 | 3,242 | 0.103 |
  | Forge 2.14 | 35.9 s | 6.4 | 4,958 | 0.155 |

  ccc is still a few seconds slower (Claude Code spends ~9.5 s per run outside API time) and omp is the cheapest (fewer output tokens); the gap this change closes is safety, not speed. One dev-build run took 750 s: a here-doc that hit the 120 s Bash timeout went to the background and `claude -p` waited for it.
- Release size ceiling 5632 → 5760 KiB, attributed in `scripts/size-gate.sh`: measured on release builds of v0.66.0 vs this change, separate target dirs — linux-musl (local, zig cc) +114,448 B, Windows +108,032 B. v0.66.0's published linux-x86_64 asset was 5,747,632 B, so the next one is expected near 5.86 MB (5,862,080 B), ~35 KiB under the new ceiling.

### Fixed
- `8sync setup`/package installs on Fedora: dnf5 (5.4.1) rejects `--`, so dnf commands no longer pass it (pacman keeps it); the option-like-name guard stays.
- The guard no longer denies a heredoc that only writes a file (`cat > notes.md <<'EOF' … rm -rf ~ … EOF`); heredocs fed to a shell, interpreter, `eval` or `ssh` stay denied, and `os.system('rm -rf ~')` is now caught.

## [0.66.0] — 2026-10-12
### Security
- **`8sync harness claude-code` only accepts endpoints Anthropic sanctions.** Allowed: `https://api.anthropic.com`, Amazon Bedrock, Google Vertex, Microsoft Foundry, and localhost or one exact host you run yourself (`EIGHTSYNC_SELF_HOSTED_GATEWAY=<host>`). Any other gateway is refused before anything is written: gateways that resell Claude break the Usage Policy ("Do Not Abuse Our Platform"), and your code would go to an undisclosed third party. The official-endpoint check is an exact host match now (`api.anthropic.com.evil.io` used to pass as a substring); plain `http://` is refused except on localhost.
- **Only Console API keys leave Claude Code.** `harness claude-code` writes a token into `~/.omp/agent/models.yml` (and Windows User env) only when it starts with `sk-ant-api`; `harness add-model` refuses non-Console Anthropic tokens and Claude-protocol providers outside the allowlist; `forge key` takes only a Console key for `anthropic` and refuses ForgeCode's `claude_code` provider; the Feynman bridge skips every Claude/Anthropic model. A subscription/OAuth token stays in Claude Code and is not used for the endpoint probe. Tokens are printed as `…` + the last 4 characters (`harness claude-code`, `harness gateway`, `forge`) and kept out of `curl`'s argv. `scripts/setup-claude-key.ps1` and `.sh` now only forward to `8sync harness claude-code` on stdin (the `.ps1` used to write any token for any endpoint into settings.json and the Windows User env first; the `.sh` overwrote settings.json when 8sync was missing). A subscription/OAuth token is accepted only for `api.anthropic.com`, never for localhost or a self-hosted gateway.
- **`8sync harness gateway` no longer routes Claude through the 9router proxy**: the `cc/` provider (which made omp pose as Claude Code) is gone and `apply` removes an already-deployed one. The remaining non-Claude routes need `EIGHTSYNC_GATEWAY_ACCEPT=1`, `gateway key` rewrites only its own provider block, `gateway apply` re-deploys the template but keeps your other providers (backup in `models.yml.bak`), and both refuse Anthropic keys (`sk-ant-…`).
- **`8sync codex-web` is opt-in** (`EIGHTSYNC_CODEX_WEB_ACCEPT=1`): it automates a ChatGPT Web subscription into omp, the same pattern 8 Sync's rules forbid for Claude, and OpenAI's terms for it are not verified. Without the opt-in only `status`/`off` run.
- `8sync forge` writes `~/.forge/.credentials.json` with mode 0600 (and tightens an existing file).

### Fixed
- `8sync feynman` works with Feynman ≥ 0.5.35: the bridge finds Pi's packages under `@earendil-works/*` (then `@mariozechner/*`), in the launcher and the extension (was `Cannot find module '@mariozechner/pi-ai'`).
- Claude 5.5 model IDs (`claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`) in `harness claude-code`, the `harness model` aliases (`opus`/`sonnet`/`haiku`), the endpoint probe (now `x-api-key` + `anthropic-version`, official endpoint and localhost only) and the kit's gates.
- `8sync ccc kit` says why codebase-memory-mcp / serena were not registered in Claude Code (missing from omp's `mcp.json`, not on PATH, or the `claude mcp add-json` error) instead of skipping silently; serena is registered with `alwaysLoad: false`.

### Added
- **`8sync hq` — Agent HQ on Discord** ([docs/hq.md](docs/hq.md)): `hq setup` builds a private server idempotently: categories, the forum `task-board` (required status/role/priority tags), `rfcs`, `notes`, `#standup`, team rooms, ops channels, persona roles, one webhook per channel, and a pinned charter that says the personas are AI. Claude Code hooks (`TaskCreated`, `TaskCompleted`, `TeammateIdle`, `Notification`) turn team work into forum posts and tag changes posted as PM/Architect/Backend/Frontend/QA/Reviewer/Researcher. Also `hq post`, `hq task`, `hq standup`, `hq status`, and `hq up`, which prints/installs a systemd unit running the lead session with the official Channels plugin in tmux plus a 09:00 standup timer. Tasks are tracked per agent team (or per session), because Claude Code numbers tasks from 1 again in every session; parallel async hooks create exactly one post per task. HQ never touches Claude credentials. The bot token and webhooks live in a 0600 file, are sent to `curl` on stdin, and are always masked; state keeps ids and titles only; a hook is a ~4 ms no-op until setup. Verified against a mock Discord API and with real Claude Code hooks (2 tasks created and completed → 2 tagged forum posts, then `done` + thread comments); the generated units pass `systemd-analyze verify`. Not yet run against real Discord.
- **Security commands in the kit and plugin**: `/rules` (is X allowed? Anthropic AUP/terms + 8 Sync rules + Vietnamese data law, with verdict, exact clause and official link), `/sec` (secrets with file:line and never the value, sensitive files, dependency audit, kit guard, OWASP pass), `/harden` (this machine's Claude Code posture), next to `/aup-audit`.
- **`8sync ccc policy [--org-uuid] [--out] [--strict-hooks] [--lock-mcp]`**: a managed-settings JSON for the org, built only from documented keys. It disables bypass-permissions mode, sets the kit deny rules, can force claude.ai login (optionally pinned to your org UUID), restricts marketplaces to the official one plus 8sync, turns on the sandbox and `channelsEnabled`, and with `--lock-mcp` restricts MCP to codebase-memory-mcp/serena (off by default so the Discord Channels plugin keeps working), and prints per-OS install paths. It never writes system paths itself; `ccc status` shows whether a managed file is present.
- Kit agents `pm` (lead/coordinator, one writer per worktree, aware of the 5-hour window), `architect` (writes docs/ADR/RFC only, no code edits by convention) and `qa` (tests only).
- **Public plugin marketplace**: the kit's subagents and `/ship` install as a Claude Code plugin — `/plugin marketplace add 8-Sync-Dev/su-code` then `/plugin install 8sync-kit@8sync` (~630 tokens always-on per `claude plugin details`); hooks, rules and the full skill set still come from `8sync ccc kit`.
- `8sync ccc kit` enables Anthropic's official LSP plugins (rust-analyzer, TypeScript, gopls, pyright from `claude-plugins-official`) for the language servers found on PATH — code intelligence without MCP schemas in the prompt; values you set are kept.

### Changed
- The Stop gate lets a turn end when Claude's last message quotes the user's own stop/wait words and says it is holding for the next instruction (it used to keep the turn going three times in a row after an explicit stop).
- Release size ceiling 5392 → 5632 KiB, attributed in `scripts/size-gate.sh` (compliance/kit +38,208 B, Agent HQ + policy + skills +193,712 B on local x86_64 release builds).
- **Leaner Claude Code sessions.** Measured on one machine (2026-10-12; `wc -c` of every always-loaded layer, and `message.usage` of the first request in 2 Claude Code transcripts), the kit + repo layers came to 55,663 B (≈13.9k tokens at 4 B/token) of a ~58k-token first request; most of it is gone:
  - the repo `CLAUDE.md` block is compact (≤1.1 KB), no longer orders reading 4 SKILL.md bodies (15.4 KB) before the first tool call, and no longer claims MCP tools are always present;
  - no block in a `su-code/` memory dir, and no new block in a child repo when an ancestor `CLAUDE.md` already has it (Claude Code loads both; they were byte-identical 8.6 KB copies); an existing child block is kept and refreshed to the compact one;
  - the kit's `CLAUDE.md` summarises the 8 Sync / Anthropic rules instead of importing the 6.7 KB rules doc into every session (full text: `/aup-audit`, `skills/aup-audit/8sync-anthropic-rules.md`);
  - on-demand bundled skills are `name-only` in user-scope `skillOverrides` (values you set are kept; core skills keep their descriptions).
- **Kit agents are routed by role**: explore and quick-task on Haiku (`effort: low`), task on Sonnet, reviewer on Sonnet (`effort: high`), with `maxTurns`, read-only `disallowedTools` where they only read, and a short return envelope (reviewer keeps its BLOCKER/SHOULD/NIT + verdict format).
- New kit agents `researcher` and `verifier`, and `deep-research` v2: plan → scale gate → lead drafts → verifier checks every citation → reviewer grades FATAL/MAJOR/MINOR → provenance file, `Verification: BLOCKED` when it cannot finish. Adapted from Feynman (MIT, see `THIRD_PARTY_NOTICES.md`). Private repo source is researched locally, not sent to third-party models.
- The Stop gate (Haiku 5.5) lets a turn end while Claude waits on background agents it launched (it blocked 4 times in a row in a real session); the ask gate stays on Sonnet (5.5). `/ship` requires every "done/verified" claim to cite the command output.
- New `8sync ccc hook session-start` (startup/clear/compact, found from any subdirectory): a byte-stable digest of `su-code/STATE.md` plus recent `failure:`/`validated:` lessons, at most 6,000 B.
- `docs/legal/anthropic/index.md` records the snapshot date; `legal-sync.py` refreshes it only when a page changed.

## [0.65.0] — 2026-10-11
### Added
- **`8sync ccc` keeps itself and the repo current on every launch** (no network on the launch path, never blocks it):
  - a newer 8sync release (found by the 6-hourly background probe) is installed with the usual sha256 check and the same command re-runs on the new binary (`SUSYNC_NO_AUTO_UPDATE=1` opts out);
  - after an update, the bundled skills (`~/.omp/skills`) and the Claude Code kit are refreshed once;
  - a git repo gets the 8sync harness: missing skills vendored into `su-code/skills`, memory + `AGENTS.md`/`CLAUDE.md` blocks, `.claude/skills` → `su-code/skills`, and the managed `.gitignore`.
- **Claude Code sees every 8sync skill.** Project skills come through `.claude/skills` (also created by `8sync harness create`); each bundled skill is linked into `~/.claude/skills/<name>` → `~/.omp/skills/<name>`, and personal skills win over project ones, so Claude Code always reads the current bundled copy. On-demand skills are listed by name only (`.claude/settings.local.json` → `skillOverrides`), always-on skills keep their descriptions: the per-request prefix with 237 skills is 41.1k tokens instead of 57.3k with every description (38.9k with no project skills). Live check: "which command raises the refresh rate to the max?" → Claude invoked `8sync-cli` and answered `8sync hz max`.
- **The org's Anthropic rules ship with 8sync and load into every Claude Code session.** `assets/skills/aup-audit/8sync-anthropic-rules.md` (the 8 Sync rules doc) is installed into `~/.omp/skills/aup-audit/` and `~/.claude/skills/aup-audit/`, and the kit's `CLAUDE.md` block imports it ahead of every other instruction. Live check: three rules questions answered from context with zero tool calls.
- **`legal-sync` workflow**: every Monday it snapshots Anthropic's Usage Policy, Commercial and Consumer Terms, Privacy Policy, Claude Code legal + data-usage pages and the sitemap's `/legal/` index into `docs/legal/anthropic/` (`scripts/legal-sync.py`). A change is committed and opens an issue to review the rules doc; with an `ANTHROPIC_API_KEY` repo secret (Console key), Claude Code drafts the rules update as a pull request. The draft step was rehearsed on a fake effective-date change: it changed only the date reference.
- **Free CI on the public repo**: `ci.yml` runs `cargo test` on Linux, macOS and Windows and builds `--no-default-features` on every push/PR; `install-smoke.yml` runs the published one-line installers on ubuntu x64 + arm64, macOS arm64 + Intel and Windows after each release and weekly, and fails unless the installed version is the latest and setup reports "all steps succeeded".

### Changed
- **Claude Code is about as fast as omp on a hard task now** (was ~1.8× slower). Calc evaluator: 3 bugs + missing features across 4 files, 11 hidden tests, Sonnet 5, Console key, wall-clock per run:

  | Harness | Runs | Mean | Hidden tests |
  |---|---|---|---|
  | omp | 155 · 124 · 136 s | 138 s | 11 · 10 · 11 of 11 |
  | ccc kit 0.64 | 281 · 216 s | 249 s | 11 · 11 |
  | ccc kit 0.65 at `high` effort | 209 · 179 s | 194 s | 11 · 11 |
  | ccc kit 0.65 default (`medium` effort) | 100 · 161 s | 131 s | 11 · 11 |

  - The verify hook is **async** (`asyncRewake`): edits no longer wait for `cargo check` (2.5 s per edit warm on this repo, 8.6 s cold). One check per project runs at a time and the latest edit wins; a failure wakes Claude with the errors.
  - New `8sync ccc hook verify-stop` (Stop): before a turn ends it waits for a running check or checks once, and blocks the stop while the build is broken — once per broken state, so a deliberate stop cannot loop 8 times.
  - `permissions.allow` gets the build/test/lint commands of the supported stacks plus `git add`: in auto mode each would otherwise wait for a classifier review (~0.65 s per `cargo check`). Commits, pushes and anything that discards work stay reviewed.
  - `effortLevel: "medium"` when you have not set one (Sonnet 5 and Opus 5 default to `high`; Opus 5.5 is already `medium`). Output tokens on the bench: 9.4k / 15.3k vs 17.6-20.6k at `high`. Use `/effort high` for a hard reasoning session.
  - Tried and dropped: Anthropic's `<use_parallel_tool_calls>` system-prompt snippet (`--append-system-prompt-file`) did not raise multi-call requests on a lookup task.
- `8sync-cli` skill rewritten harness-neutral (omp and Claude Code) and complete: every verb (sessions, `ccc`, `forge`, `find`, `note`, `run`, `ship`, image tools, `locate`, `gen-img`, harness/skills, `setup`/`up`/`doctor`, `hz`, `bt`, `sec`, `lcd`, `clean`, `codex-web`) plus the `su-code/` memory layout. The old text told agents never to edit `su-code/*.md`, which contradicted `AGENTS.md`.
- `assets/skills/aup-audit/RULES.md` now points at the org rules doc for the 8 Sync rules instead of keeping a second copy.

### Fixed
- **Skill links were committed.** The managed `.gitignore` used `.cursor/skills/` and `.zcode/skills/`, but git sees a symlink/junction as a file and a `dir/` pattern never matches it, so `git add -A` committed the links (this repo tracked both). The block now writes `.cursor/skills`, `.zcode/skills`, `.claude/skills` and `.claude/settings.local.json`; a test runs real `git status` against the links. The two links are untracked here.
- A repo's own committed `.claude/skills/` is never replaced, not even by `harness create --force`.
- **Windows one-liner failed whenever the GitHub API was rate-limited** (shared CI runners, office NAT): `install.ps1` resolved the latest tag with `Invoke-WebRequest -MaximumRedirection 0`, which on Windows PowerShell 5.1 throws without the response, so only the 60-per-hour API fallback ever worked. It now reads the `releases/latest` 302 with a no-redirect `HttpWebRequest` (proven on PS 5.1 and 7 with the API path disabled). Found by the new `install-smoke` run on `windows-latest`.

## [0.64.0] — 2026-10-11
### Added
- **`8sync ccc hook guard`** — a native PreToolUse hook in the kit (Bash/Edit/Write/MultiEdit/NotebookEdit, about 23 ms per call on Windows). It denies, with the reason handed back to Claude:
  - writing a credential file: `.env` / `.env.*` (templates `.example`/`.sample`/`.template` pass), `*.pem`/`*.p12`/`*.pfx`, `id_rsa*`/`id_ed25519*`, `*.session`, `*.pkl` — with either path separator;
  - content or a command carrying a real-looking Anthropic/OpenAI/GitHub/AWS/Slack/Google key or a private key (short fixtures, `EXAMPLE`/`xxxx` placeholders pass);
  - `git add` of a credential file, named or swept up by `git add -A`/`.` (`:!path` exclusions honoured);
  - code that wires a Claude subscription into another client (Claude Code's OAuth client id / OAuth beta headers).
  It replaces the bash + python `aup-guard.sh` from omp-style-kit v2, which let `C:\…\.env` and `.env.staging` through and cost ~240 ms per call.
- **`/aup-audit` skill** (bundled for omp and copied into the Claude Code kit): Anthropic Usage Policy + 8 Sync rules check — gitleaks over tree and history, sensitive files ever committed, then the model reads the product and walks `RULES.md` (Usage Policy sections incl. High-risk Physical Actions, access paths, 8 Sync internal rules). No python scanner: the kit's 240-line regex scanner reported 1 BLOCK + 52 WARN on this repo, all false positives, in 37 s.
- The kit now also ships the `deep-research` skill; more deny rules (`Edit(**/.env*)`, keys, `*.session`, `*.pkl` — `Write(...)` path rules are ignored by Claude Code, so none are used).
- Stage A of `8sync setup` installs **gitleaks** (GitHub release, sha256-checked, `~/.local/bin`), so the pre-commit secret hook exists on fresh machines.
- `8sync doctor` warns when omp's `anthropic` login is a Claude subscription (OAuth).

### Changed
- **Fewer tokens in Claude Code on 8sync repos.** `CLAUDE.md` gets a compact block (~0.7k tokens) that points at `AGENTS.md` and the skill dirs instead of a second copy of the full force-load block (~8k). Per-request prefix in this repo: 41.0k → 34.3k tokens (omp: 56.2k). Importing `AGENTS.md` instead was measured at 20.5k and rejected.
- Kit agents: `explore` runs on Haiku, `reviewer`/`designer` inherit the session model instead of forcing Opus, and the `plan` agent is gone (`/ship` plans in the main context). An unedited `plan.md` from 0.63 is removed on the next `8sync ccc kit`.
- Kit `CLAUDE.md` rules gain the Anthropic Usage Policy points (subscription only in Claude Code / claude.ai, AI disclosure, human review for high-risk decisions, `/aup-audit` before publishing); the "read AGENTS.md first" rule is gone.
- `deep-research` skill rewritten token-lean and host-neutral (omp + Claude Code tools): one artifact (`outputs/<slug>.md`) instead of five, snippets before pages, compressed worker returns, measure-when-you-can. The binary-weight audit protocol moved to `assets/skills/deep-research/references/binary-weight-audit.md`.
- The managed `.gitignore` block also ignores `*.pem`, `*.p12`, `*.pfx`, `id_rsa*`, `id_ed25519*`, `*.session`, `*.session-journal`, `*.pkl`.

### Fixed
- **Usage Policy compliance.** `8sync feynman auth-omp` no longer bridges Claude models (omp's `anthropic` OAuth login or gateways serving `claude-*`) into Feynman; set `ANTHROPIC_API_KEY` to a Console key there. `8sync harness claude-code` with a non-Anthropic endpoint configures Claude Code only and leaves omp's models alone.

## [0.63.0] — 2026-10-11
### Added
- **`8sync ccc` — Claude Code with named sessions.** `8sync ccc . <name>` create-or-resumes a Claude Code conversation by name in this repo: the name maps to a UUID that starts the session (`--session-id`, `--name`) and resumes it (`--resume`). Also `8sync ccc .` (last used), `. ls`, `. new`, `. rm` (removes the transcript too), `status`, and flags after the name go to `claude`. Installs Claude Code with Anthropic's official installer when missing.
- **The 8sync kit for Claude Code** (`8sync ccc kit`, run by `8sync setup`). It goes into `~/.claude`, so it applies to every repo:
  - 6 subagents (`explore` · `plan` · `task` · `quick-task` · `reviewer` · `designer`) and the `/ship` skill (explore → plan → implement → review → commit). Read-only agents use `disallowedTools` instead of a tool allow-list, so they keep the MCP code-intelligence tools.
  - **Verify hook**: after every Edit/Write, `8sync ccc hook verify` runs `cargo check`, the package's `typecheck` script (or `tsc --noEmit`) or `go vet` from the edited file's nearest manifest, and returns only failures to Claude. Native Rust, so no python3/jq/bash is needed, and it runs on Windows.
  - **Stop gate**: a Haiku prompt hook keeps the turn going while the last message shows unfinished work: planned steps not done, edits not verified, failing checks, `NOT MERGEABLE`, or a question it should have answered itself.
  - **Ask gate**: a Sonnet prompt hook on `AskUserQuestion` sends unnecessary questions back to Claude to decide. Questions about credentials, destructive or paid actions, and product decisions go through.
  - Auto permission mode and task tools on every model (both only when you have not set them), deny rules for `.env` reads and force-push, global rules in a managed block of `~/.claude/CLAUDE.md`, and omp's `codebase-memory-mcp` + `serena` registered in Claude Code.
  - Files you edited are kept (`--force` overwrites); settings are merged, never replaced.
- Stage A of `8sync setup` installs Claude Code + the kit (after `harness global`, so the MCP servers exist).
- The name → UUID registry is now shared by `8sync forge` and `8sync ccc` (`uuid_sessions.rs`).

### Fixed
- **Official installers on Windows launched from PowerShell 7.** Windows PowerShell 5.1 inherited pwsh's `PSModulePath`, lost `Get-FileHash`, and `claude.ai/install.ps1` failed. 8sync now clears that variable for every `powershell` child it starts.
- `8sync harness claude-code` overwrote `~/.claude/settings.json` and wrote lower-case `env` keys that Claude Code ignores. It now merges the upper-case `ANTHROPIC_*` keys into the existing file.

## [0.62.0] — 2026-10-11
### Added
- **Pro zsh for `8sync forge` and everyday use** (`assets/configs/zsh/8sync.zsh`):
  - Two-line prompt: repo-relative path, branch read straight from `.git/HEAD` (no `git` process per prompt), session name, Forge's agent · tokens · model segment, last-command duration (≥ 2 s), `❯` green/red by exit status. The Forge segment renders asynchronously (`zle -F`) and refreshes only after a Forge command, on resize, or every 30 s, so the prompt never waits for `forge`. Before this it sat in a right prompt that clipped in narrow panes (`claude-opus-5-5 ME…`).
  - Arrow-key completion menu: case-insensitive and fuzzy on `._-`, grouped, cached; the dump is rebuilt at most daily.
  - ↑/↓ history search by prefix; Windows Terminal/xterm Home, End, Delete and Ctrl/Alt word keys; window title set to `dir · forge:<session>`.
  - Pinned **zsh-autosuggestions v0.7.1** and **zsh-syntax-highlighting 0.8.0**, shallow-cloned and checked against their commits; Forge's `:command` / `@[file]` highlight rules stay.
  - Measured in a ConPTY on Windows: about 0.3 s from `8sync forge core` to a prompt (was 3.4 s), about 0.2 s per command.
- **`8sync setup --profile terminal` works on every OS:**
  - Windows: helix + JetBrainsMono Nerd Font via winget; the installed Nerd face becomes the Windows Terminal default only when none is set (targeted insert, re-parsed before writing).
  - macOS: brew helix + Nerd font cask.
  - Debian/Ubuntu: helix 25.07.1 release tarball, sha256-pinned, into `~/.local/share/8sync/helix`.
  - Arch/Fedora: native packages + kitty glass, as before.
  - Every OS: helix config if absent + the pro zsh. On Linux/macOS it is wired into `~/.zshrc` as one managed block.
  - Before this, every OS other than Arch/Fedora printed "Stage B profiles need pacman or dnf".
- **README rewritten**: Rust-core harness, one-line install table, the official Anthropic API path for Claude, the Forge shell.

### Fixed
- **zsh without sudo on Linux/macOS.** When zsh is missing and root needs a password, setup installs romkatv/zsh-bin's static zsh 5.8 (sha256-pinned per platform, relocated) into `~/.local/share/8sync/zsh`. The unattended `curl | sh` used to fail the Forge step on Ubuntu.
- **PATH bootstrap on Windows.** `~/.zshrc` / `~/.bashrc` got `C:\Users\…` entries whose `:` split PATH into junk in Git Bash and MSYS zsh. The block now uses `$HOME/…`, and existing blocks are rewritten in place.
- `8sync forge` writes its zsh files only when they change, and regenerates Forge's plugin/theme only when the forge binary changes (they were 150 ms of every launch). `compinit` now runs before Forge's plugin, which ends with `compdef`.
- Forge's per-command `$(date +%s)` fork is replaced with `$EPOCHSECONDS`, and autosuggestions run synchronously (async forks per keystroke). Each fork costs 10–25 ms on Windows.

## [0.61.3] — 2026-10-11
### Fixed
- **`8sync setup` installs gh on Debian, Ubuntu and other Linux without a native gh route.** Those distros
  only got "install `gh` manually" — not even counted as a failed step — so the one-line installer left
  Ubuntu members without gh (`8sync ship` needs it). Stage A now fetches the official
  `gh_<ver>_linux_<amd64|arm64>.tar.gz` from `cli/cli`'s latest release, checks it against the release's
  `checksums.txt`, and installs `~/.local/bin/gh` — no sudo, no apt repo.

## [0.61.2] — 2026-10-11
### Fixed
- **`8sync up` verifies checksums on Windows.** The install target came from `canonicalize`, i.e.
  `\\?\C:\…`; Git's MSYS `sha256sum` mangles that form into a missing file, and the failure was reported
  as "no sha256sum, shasum or certutil on PATH" — every Windows self-update ran unverified. The drive form
  is now unwrapped, and the hashers are tried in turn until one works.
- `8sync --help` described `up` as "8sync + omp + system pkgs + rustup + flatpak"; it updates 8sync only.

## [0.61.1] — 2026-10-11
### Fixed
- **Update check throttles on Windows.** The 6-hour window was the mtime of an empty `last_check` file;
  rewriting an empty file with `""` leaves the NTFS mtime alone, so every 8sync command in a terminal
  spawned a probe against the GitHub API (60 req/h unauthenticated). The stamp is now epoch seconds in
  the file's content; legacy empty markers, garbage and future stamps count as due.
- **`install.ps1` upgrades a running 8sync.** `Move-Item -Force` cannot replace a live `.exe` (any open
  `8sync . <session>`), so re-running the one-liner died with "Cannot create a file when that file
  already exists" and left a `.8sync.new.*` behind. The live binary is now renamed to `.8sync.old.<pid>`
  first (restored on failure, swept on the next install) — the same dance as `8sync up`.
- **`install.ps1` checksum no longer silently skipped.** Windows PowerShell launched from pwsh 7 inherits
  pwsh's `PSModulePath`, loads the wrong `Microsoft.PowerShell.Utility`, and loses `Get-FileHash`; the
  installer then printed "checksum: skipped". SHA-256 now comes from .NET directly.

## [0.61.0] — 2026-10-11
### Added
- **`8sync codex-web [up|status|wire|off]` — bridge ChatGPT Web (incl. Pro) into omp CLI.**
  Opens the [miuuyy/codex-chatgpt-web](https://github.com/miuuyy/codex-chatgpt-web) launcher so YOU
  log into ChatGPT (never logs in for you), polls the local loopback Responses server on `:17841`,
  auto-detects `/v1/models`, and wires an **isolated** `chatgpt-web` provider (`api: openai-responses`)
  into `~/.omp/agent/models.yml` — never touching native `anthropic`/`openai`, no global env var, no
  secret copied.
  `up` = launch the installed **production** Codex Web GPT app (the only build that serves omp; prints
  the one-line installer if missing) + wait-for-login + auto-wire; bare/`status` = probe + auto-wire if
  ready; `wire` = force re-detect; `off` = remove the provider. `--dir`/`CODEX_WEB_DIR` opt into the
  source `bun run app` launcher — a **DEV harness that CANNOT serve omp** (`purpose: "dev-harness"` is
  hard-blocked in `server.ts`), for tool development only. Loopback-only; ChatGPT web automation carries
  the upstream project's inherent account risk.
- **`8sync gen-img <prompt> [-o file.png]` — AI Image Generation via `gpt-image-2`.**
  Generates logos, icons, diagrams, UI mockups, and illustrations via `gpt-image-2`
  (OpenAI Images API via `https://api.apikey.fun/v1/images/generations`). Resolves API key
  from `--key`, `OPENAI_API_KEY`, or `~/.omp/agent/models.yml`. Decodes base64 or downloads
  image URL directly.
- **`image-gen` bundled skill (28th skill).** Teaches agents when and how to generate images,
  mockups, and visual assets, with prompt engineering best practices and immediate VLM inspection.
- **Standalone image generation scripts:** `scripts/gen-img.ps1` (PowerShell) and `scripts/gen-img.sh` (Bash).
- **Codex & OpenAI provider auto-configuration in `models.yml`:** Registered `gpt-5.6-sol`, `gpt-5.6-terra`,
  `gpt-5.6-luna`, `gpt-5.5`, `gpt-5.4`, `gpt-5.4-mini`, and `gpt-5.3-codex-spark`.
- **`8sync feynman [name|ls|rm|new|auth-omp|status|off]` — named session management for Feynman research agent.**
  Brings `8sync . <name>` parity to Feynman (`companion-inc/feynman`): `8sync feynman <name>` (e.g. `8sync feynman core`)
  creates or resumes an isolated named research session in the current project via `feynman --cwd <root> --session-dir <dir>`,
  tracked in `~/.config/8sync/feynman-sessions/<project-key>/index.json`. Supports `ls` (list project sessions with last active
  time), `rm <name>` (clean up session and directory), and `new <name>`. Every launch synchronizes omp's available chat catalog, including configured API-key providers.
- **`8sync forge <name> [--tui]` (alias `forgecode`) — named ForgeCode sessions, zsh-native by default.**
  `8sync forge core` opens an interactive zsh with Forge's own zsh plugin bound to the session's
  conversation: `: <prompt>` asks Forge, `:<Tab>` lists Forge commands, everything else is a normal
  terminal. `--tui` opens Forge's TUI on the same conversation; `-p "…"` is a one-shot. Names map to
  the UUID conversation ids Forge requires, per project (`<config>/8sync/forge-sessions/<key>/index.json`);
  `ls`, `new`, `rm`, `status`, `key [provider] <key>` (writes Forge's credential file — never `~/.env`,
  which Forge no longer reads) and `provider|config|workspace|mcp|info` passthrough. Forge is installed
  from its GitHub release when missing (`forgecode.dev/cli` currently 404s). Windows has no zsh: MSYS2's
  zsh 5.9.2 (pinned, sha256-verified) is unpacked with Windows' bsdtar into `%LOCALAPPDATA%\8sync\zsh`,
  reusing Git for Windows' runtime DLLs, terminfo, mount table and coreutils — no admin rights.
- **One-line installers now set up the whole harness.** `curl … /install | sh` and
  `irm … /install.ps1 | iex` run `8sync setup --no-profile` after installing the binary (opt out:
  `SUSYNC_NO_SETUP=1`). Under `curl | sh` setup reads the terminal (or `/dev/null`), never the script pipe.
### Changed
- **Setup Stage A = full AI harness on every OS:** gh, omp, codegraph, **forge + zsh**, configs, skills and
  **`harness global`** (every bundled skill, APPEND_SYSTEM, MCP, hooks). `--no-profile` now runs
  unattended (logged, a failed tool is reported and the rest still installs).
### Fixed
- **Windows Stage A no longer needs `sh`:** omp and codegraph install through their official
  `install.ps1` (`irm | iex`) instead of `sh -c "curl … | sh"`, which a stock PowerShell box lacks; tools
  that a fresh install put only on the user PATH are detected at their default locations.
- **Update notifications and `8sync up` survive GitHub API rate limits:** when `api.github.com` refuses
  (60 req/h per IP), the latest tag is resolved from the `releases/latest` redirect, as the installers do.
- **Checksums on Windows:** Git for Windows' `sha256sum` prefixes its output with `\` for backslash paths,
  so every Windows download was reported "checksum NOT VERIFIED"; the marker is now skipped.
- **`--no-default-features` builds again** (`8sync forge` no longer calls the `web`-gated project
  scaffolder — which also `git init`-ed any directory a session was opened in).
- **Size gate ceiling 5180 → 5300 KiB, with attribution** (`scripts/size-gate.sh`): v0.60.0 → v0.61.0 every
  asset grew by the same four new verbs/bridges (linux-x86_64 +102,656 B → 5,390,608 B; windows +123,392 B);
  `web` gate still +1,159,680 B. `scripts/size-report.sh` now finds `8sync.exe` on Windows hosts.
- **`8sync feynman <name>`: automatic authenticated model synchronization and native omp inference.**
  Replaces hardcoded Opus registration and copied OAuth tokens with managed `models.json` entries,
  live vault lookups and a Pi extension using `omp auth-gateway stdio`. Keeps Feynman's existing
  `/model` picker, tools and selected default; supports omp-native transports including Cursor.
  Synchronization and `off` preserve user-edited models, credentials and unrelated providers.
  Omit null/unknown model limits instead of invalidating Pi's whole catalog. On Windows, seed
  missing `shellPath` with real Git Bash; isolate Feynman's `PI_CODING_AGENT_DIR` from omp's
  vault while restoring any original user override for both key lookup and inference.
  Native stdio buffers each turn before returning its SSE events; output is not token-live.
  Verified 345 bridged models across 12 providers in actual Pi; real named-session `/model`
  selection and Opus 5.5 inference passed, as did native tool-call/result continuation.
- **Feynman Windows renderer crash:** repair the missing `truncateToWidth` import and reassigned
  `const line` on every launch. Actual differential-render smoke covers normal text, ANSI/Unicode
  overflow and intact image data; bundled versions with the intentional overflow guard remain unchanged.
- **`8sync feynman` (Windows): `/` was swallowed, so slash commands (`/model`, `/settings`) never opened.**
  Feynman's embedded Pi 0.62 key parser ignores modifiers it cannot detect, so pi-btw's default
  `super+/` focus shortcut matched a bare `/`. The launcher now patches that parser (both bundled
  `@mariozechner/pi-tui` copies) to reject unsupported modifiers. Verified via ConPTY: `/` opens the
  command menu and `/mod` filters to `model`; `ctrl+c`/`shift+tab` still match.
- **Local omp 18.8.3 Windows terminal hotfix:** preserve incomplete win32-input-mode
  packets across the 75 ms input timeout instead of inserting `ESC[8;14;8;…_`
  fragments into the composer. Reproducible upstream source/test patch:
  `scripts/omp-win32-record-framing.patch`; installed locally, not an upstream release.
  Verified all Backspace packet split positions with 500 ms delays, existing Escape,
  Enter, paste and modifier tests (23 passing), plus compiled-binary smoke test.
- **Session resume no longer clobbers active model with GLM:** `cfg.resume_flags()` previously emitted
  `--model <roles.default>`, which defaulted to `"glm"`. Whenever a user resumed a session with `8sync .`,
  `8sync . <name>`, or `8sync ai continue`, omp was invoked with `--model glm --continue`, forcibly overriding
  the session's active model (e.g. Claude Opus or Gemini Flash) to GLM. `resume_flags()` now omits `--model`,
  preserving the session's active model across resumes.
- **`8sync feynman` Windows process launch, `/model` switching, and OAuth/API-key bridge:**
  - **Preserved `google-antigravity` OAuth provider:** Previously mapped to `google`, causing all Gemini and Antigravity models (`claude-opus-4-6-thinking`, `claude-sonnet-4-6`, `gemini-3-flash`, `gemini-3.1-pro-high`) to fail or disappear. Now correctly mapped with full OAuth payload (`token`, `projectId`, `refreshToken`, `expiresAt`, `email`).
  - **Direct token resolution for API keys:** Replaced `!omp token <p> --raw` with pre-resolved keys in `auth.json`, eliminating Windows WSL bash 127 status traps where `resolveConfigValue` failed on Windows.
  - **Removed invalid legacy entries:** Purged invalid `google` (oauth) and `cursor` entries that broke model selection dialogs.
  - **Fixed broken default model on startup:** Automatically checks `settings.json` and resets failing default models (such as rate-limited `anthropic/claude-opus-4-6`) to verified available models (`google-antigravity/gemini-3-flash` or `zai/glm-5`).
  - **Direct Node runner on Windows:** Bypasses `cmd.exe /C` by invoking `node bin/feynman.js` directly with inherited stdio, avoiding quoting bugs and signal interception.
  - **CLI subcommand passthrough & flag support:** Supports `8sync feynman model [list|set]`, `8sync feynman doctor`, `8sync feynman setup`, and flags (`--model`, `--prompt`, `-h`) with `allow_hyphen_values`.
  - **Patched `pi-subagents` extension crash:** Guarded `selectedTools` access with optional chaining to prevent undefined property errors on turn startup.
## [0.60.0] — 2026-09-04
### Added
- **`8sync harness claude-code [JSON|FILE]` — one-command Claude Code settings & Anthropic models auto-setup.**
  Accepts the standard Claude Code settings JSON payload (`ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`,
  `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`, `CLAUDE_CODE_ATTRIBUTION_HEADER`). Automatically writes
  `~/.claude/settings.json`, configures Windows User environment variables, updates `~/.omp/agent/models.yml`
  with the 9 current Claude models (`claude-opus-5`, `claude-fable-5-1`, `claude-fable-5`, `claude-opus-4-8`,
  `claude-opus-4-7`, `claude-opus-4-6`, `claude-sonnet-5`, `claude-sonnet-4-6`, `claude-haiku-4-5`) under
  both `anthropic` override and custom provider slug, configures `anthropic-budget-effort` thinking, sets
  `anthropic/claude-fable-5-1:high` as default role, and verifies connectivity with a live probe.
  Also available via standalone scripts: `scripts/setup-claude-key.ps1` and `scripts/setup-claude-key.sh`.

### Fixed
- **GLM-5.3 / GLM-5.3-Flash native vision.** These models read images in-session
  (`image_url`, https://docs.z.ai/guides/vlm/glm-5.3-flash). Always-on prompts
  (`APPEND_SYSTEM`, `image-routing`, `00-force-load`, recall hook) used to treat
  every Z.ai model as text-only GLM-5.2 and bounce pixels through the
  `zai-vision` MCP (`glm-4.6v-flash`). Agents now **look at the attached image**
  when the session is `zai/glm-5.3*`. `zai-vision` remains a **fallback for
  GLM-5.2 only** (STOP gate at the top of the skill). Alias `glm`/`zai` →
  `zai/glm-5.3-flash`; combo `claude+glm` keeps `modelRoles.vision` on the cheap
  native VLM instead of routing images to Opus. Cursor/AGENTS force-load now
  states the same gate (Cursor does not read `~/.omp/APPEND_SYSTEM.md`).

## [0.59.0] — 2026-08-25

### Added
- **`8sync harness create` — full multi-host bootstrap for Cursor + Z.ai Code + omp.** One command
  vendors `su-code/skills/`, then fans the same Agent Skills tree out to **`.cursor/skills/`**
  (Cursor's project skill path) and **`.zcode/skills/`** (Z.ai Code), plus a Cursor-native
  **`.cursor/rules/8sync-harness.mdc`** (`alwaysApply: true`) so a Cursor session loads the
  CORE contract without reading `~/.omp`. Host dirs are a relative symlink / Windows junction
  when the OS allows it, otherwise a copy. `create --sweep [DIR]` stamps every omp project
  (has `su-code/` or AGENTS.md) under DIR — default `~/Projects`, and on Windows also
  `<Users>/Projects` next to the home folder. Bare `8sync harness` / `init` / `global --sweep`
  now run the same host adapters, so existing projects pick this up on the next refresh.

## [0.58.0] — 2026-08-21

### Added
- **`super-pdf` bundled skill** — the HTML→PDF report engine (design system that produced
  the admired CloudGO review/architecture PDFs) is now self-contained in su-code: annotated
  `references/report-template.html` (kicker cover + meta table + tagbox, §N section spine,
  navy comparison tables with pills, 4 callout variants, stat cards, 3-zone running footer
  with page numbers) + `scripts/build.sh` (WeasyPrint via `uv run`, page-count guard) +
  content rules (§0 = verdict first, every number traces to a source). Every machine gets
  it after `8sync setup`; previously the engine only lived inside `agentic-cloudgo-v1`
  project skills while the `repo-md2pdf-git-report` managed skill pointed at a deleted
  tool path.
  Renamed from the in-session `report-pdf` draft before release. Also adds an optional
  cover `.chips` strip (category chips, as on the architecture-PDF variant).

### Changed
- **Size ceiling recalibrated `5 MiB` → `5 180 KiB` (5,304,320 B), attribution-first.** The
  ratchet headroom was 4,208 B at v0.57.0; v0.56+v0.57 feature growth had eaten it all,
  so this release`s legitimate +20,608 B (omp hardening + sweep + super-pdf) tripped the
  gate. `size-report.sh` attribution: the `web` feature gate alone = +1,732,232 B — the
  only elephant. Ceiling stays tight on purpose: the next feature release trips it again
  and must attribute again. `AGENTS.md` §8 numbers refreshed (CI musl sizes).

### Fixed
- **`8sync omp update` could hang forever and repaired via the wrong channel.** omp's
  self-updater downloads a ~185 MB standalone binary with no progress output and no timeout
  of its own; the verb ran it with `Command::output()` (silent, unbounded), and its repair
  path reinstalled via `npm install -g` for an EEXIST scenario that no longer matches the
  omp.sh standalone layout. Now: the update attempt is time-boxed (10 min) with a 60 s
  heartbeat, interrupted-update `~/.local/bin/omp.*.new` partials (up to ~185 MB each) are
  swept, and repair reinstalls via the official `omp.sh/install --binary` (same channel as
  `8sync setup`, stall-protected + smoke-tested), with binary backup/restore insurance.
- **Retired omp extensions hard-fail loading since omp 17.4 (zod v4).** Stale copies of the
  old engine — the multi-file `8sync-gs/` and the `ckit-engine.ts` / `ckit-workflow.ts`
  interim renames — use `.default([])` array-literal zod defaults, which omp 17.4's bundled
  zod v4 rejects at load ("ParseError: A mutable default value must be specified as a
  factory"), spamming a warning and silently dropping those tools in every project still
  carrying a copy. `ensure_engine`'s sweep (formerly workflow-only) now also removes
  `8sync-gs/` and the `ckit-*` renames from the global and project extension dirs on every
  `8sync harness` / `harness up`. `ckit-*` removal is content-gated on the
  `8sync-engine`/`8sync-workflow` lineage marker so a user's own same-named file survives.

## [0.57.0] — 2026-08-14

### Added
- **`sx-plan` command**: Autonomous plan-review gate for deep research, slice decomposition, and task-reviewer contract verification using `engine_plan`, `task`, and `recall`.
- **`sx-sync-pr` command hardened**: Existence guards, branch validation gate, SHA-based main up-to-date checks, and non-push default safety.
- **4 Foundation Reference Skills**: Added `tauri-v2`, `nextjs-app`, `encore-eino-go`, and `ai-microservice-design` with `locked: true` frontmatter, grounded in real 8syncdev production repos. Registered as foundation skills in `AGENTS.md` and committed under `assets/skills/`.
- **Default Boot Kernel Enforcement**: Configured `grubby` to set `/boot/vmlinuz-6.19.10-300.fc44.x86_64` as default boot kernel, restoring native Fedora Bluetooth support (`btusb`), 180Hz display rate, and official NVIDIA RTX 5080 driver persistence across reboots.

### Changed
- **Size ceiling recalibrated `5 MiB` → `5 180 KiB` (5,304,320 B), attribution-first.** The
  ratchet headroom was 4,208 B at v0.57.0; v0.56+v0.57 feature growth had eaten it all,
  so this release`s legitimate +20,608 B (omp hardening + sweep + super-pdf) tripped the
  gate. `size-report.sh` attribution: the `web` feature gate alone = +1,732,232 B — the
  only elephant. Ceiling stays tight on purpose: the next feature release trips it again
  and must attribute again. `AGENTS.md` §8 numbers refreshed (CI musl sizes).

### Fixed
- **`8sync .` and `8sync ai` could not launch omp at all.** STEP-0 steered omp with
  `--tools`, which is an ALLOWLIST — so 8sync had to name every built-in tool omp has, and
  omp 17.3 renaming `ast_grep` and dropping `github`/`checkpoint`/`rewind`/`security_scan`
  made every launch die on the spot with `CliUsageError: Unknown tools in --tools`. The
  failure looked like a session bug rather than a flag bug: `8sync . core` printed
  `→ resume session 'core'`, omp exited before drawing a frame, and the user fell back to a
  bare `omp --continue` — which reads omp's *default* per-cwd store, not the named session's,
  so the session they had just opened appeared to have vanished.
  STEP-0 is now a DENY-list: 8sync writes `grep.enabled: false` + `glob.enabled: false` to a
  managed overlay (`~/.config/8sync/omp-step0.yml`) and passes it as `--config`. It names only
  the two tools that must go, so no omp release can brick a launch or silently disable a tool
  again, and MCP/xdev tools are untouched. Per-launch, so `--no-step0` and the user's own bare
  `omp` still get the searchers. omp's accepted-tool set turned out to be assembled
  asynchronously and to differ between runs of the same binary, so the old
  "mirror omp's list, probe for drift" approach could never have been made correct.
- **`8sync doctor` checks that STEP-0 still bites, not that a list still matches.** It asks omp
  to accept `--tools grep,glob` under the overlay and expects a rejection; the answer is now
  a property of the running omp rather than of a constant in this repo.
- **A named session now prints the omp command that reopens it** (`omp --session-dir … --continue`),
  because a named session deliberately lives in its own store and a bare `omp --continue` will
  never find it.
- **The four foundation skills shipped in v0.56.0 were never deployed.** `tauri-v2`, `nextjs-app`,
  `encore-eino-go` and `ai-microservice-design` were embedded in the binary and listed in
  `AGENTS.md` but missing from `BUNDLED_SKILLS`, so `8sync harness` never wrote them to
  `~/.omp/skills/`. The registry test caught it; they are registered now.
- **The STEP-0 overlay is written atomically.** `fs::write` truncates before it writes, so a
  second `8sync` starting concurrently — or omp itself, reading the `--config` it was just
  handed — could observe an empty file and hard-error on it. The overlay now lands via a
  staged sibling plus `rename`, so every reader sees one whole version or the other. The stage
  name carries a per-call sequence, not just the pid: two threads in one process would otherwise
  choose the same sibling and the one that renamed second would fail on a file already moved
  away, silently dropping STEP-0 for that launch. Both directions were found by the release CI
  (Windows read `""`, then Linux hit the collision) and are now covered by a concurrency test.

## [0.56.0] - 2026-08-09

### Added
- **`8sync lcd` — Lian Li fan/AIO screens from the shell.** `8sync lcd` lists every screen the
  `lian-li-linux` daemon can see, `8sync lcd photo.png` (or `.gif` / `.mp4` / `#ff0055` / `off`)
  draws on all of them, `--device` targets one by index or id, `8sync lcd bright 60` sets
  brightness. It speaks the daemon's own newline-JSON IPC on
  `$XDG_RUNTIME_DIR/lianli-daemon.sock` instead of re-implementing the USB protocol, so the
  setting lands in the daemon's config and survives a reboot — and none of it needs the GUI.
  `SetLcdMedia.device_id` is sent as `serial:<id>` because upstream matches the request against
  `LcdConfig::device_id()`; any other spelling appends a duplicate entry rather than replacing the
  screen's existing one. Verified on 8× UNI FAN TL V2 LCD (400x400): colour, image and
  single-screen targeting all confirmed in the daemon's own log.
- **`8sync lcd gui` launches the upstream GUI with the fix already applied.** `lianli-gui` is
  Tauri/WebKitGTK and its DMA-BUF renderer dies with `Error 71 (Protocol error) dispatching to
  Wayland display` on a machine whose GPU path is degraded (here: an RTX 5080 on `nouveau`) — the
  window simply never appears. The verb sets `WEBKIT_DISABLE_DMABUF_RENDERER=1`, which costs
  nothing visible and is the difference between an app that starts and one that does not.
- **`8sync hz` — refresh-rate manager.** `8sync hz` reports every output's current rate against
  the highest one available, `8sync hz max` raises each to its ceiling, `8sync hz 144` picks a
  specific rate; `--output` narrows to one connector and `--dry-run` prints the backend call.
  Resolution is never changed — only the refresh field of the mode already in use — because the
  fastest mode a monitor offers is routinely a *smaller* one (this dev box lists 2560x1440@144
  while running 3440x1440@100), and "faster" must never mean "smaller".
  Backends: GNOME/Mutter over `busctl` (Wayland *and* X11 — the only supported way to set a mode
  under GNOME Wayland), Hyprland `hyprctl`, KDE `kscreen-doctor`, and X11 `xrandr`. Mutter applies
  are `VERIFY`-ed before they are made persistent, and the full logical-monitor layout (position,
  scale, rotation, primary) is echoed back untouched, because `ApplyMonitorsConfig` replaces the
  *whole* layout and silently resets anything omitted. Backends that cannot persist a change say
  so and print the config line that would.
- **`8sync hz` diagnoses a capped panel instead of accepting it.** The verb parses the display's
  own EDID range-limits descriptor and compares the panel's ceiling with what the driver exposes.
  A 180 Hz monitor pinned to 100 Hz is not a compositor setting: the kernel filters out every mode
  above the negotiated DisplayPort link bandwidth, so the fast mode is gone before GNOME ever sees
  it. When the gap is real, `hz` names the bound driver, explains it, and prints the fix — on an
  NVIDIA card still on `nouveau` that is `8sync setup --profile nvidia`, worded per distro family
  (RPM Fusion `akmod-nvidia` on Fedora, `nvidia-open-dkms` on Arch). `8sync doctor` carries the
  same check as a one-liner. Distro-agnostic: no package manager is involved in reading or setting
  a mode, so Fedora and Arch behave identically.

### Changed
- **Size ceiling recalibrated `5 MiB` → `5 180 KiB` (5,304,320 B), attribution-first.** The
  ratchet headroom was 4,208 B at v0.57.0; v0.56+v0.57 feature growth had eaten it all,
  so this release`s legitimate +20,608 B (omp hardening + sweep + super-pdf) tripped the
  gate. `size-report.sh` attribution: the `web` feature gate alone = +1,732,232 B — the
  only elephant. Ceiling stays tight on purpose: the next feature release trips it again
  and must attribute again. `AGENTS.md` §8 numbers refreshed (CI musl sizes).

### Fixed
- **Upgrading no longer leaves duplicate slash commands.** v0.55.0 removed the pre-prefix copy of a
  command only when it was byte-identical to the asset in the *current* build — but that same
  release rewrote every command body to self-reference the new prefixed name, so the compare could
  never match and every upgraded machine kept both `/auto` and `/sx-auto` (eight stale pairs,
  frozen at v0.54.1). The gate now recognises any body 8sync has ever shipped, from a frozen table
  of digests that by construction can never grow. A command the user wrote at one of those names is
  still never touched.

## [0.55.0] - 2026-08-09

### Added
- **`/sx-super-dev`** — one command for the whole lifecycle: ground → research (feynman/web) →
  plan → parallel build → adversarial review (reviewer + security-reviewer, fresh context) → deep
  UAT that role-plays a real user with browser capture and a clean-environment CLI run → ship →
  CI/CD and **published-artifact** verification. Distilled from the v0.54.x release, including the
  traps it hit: a tag that disagrees with the manifest, a "non-blocking" background thread the
  runtime kills at exit, and reviewers finding release-breaking defects the author could not see.
  Its governing rule is that the author's own "done" is never the evidence.

### Changed
- **Every slash command now deploys under an `sx-` prefix** (`/sx-auto`, `/sx-feature`, …).
  omp merges commands from every tool into one flat namespace shared with the user's own, so an
  unprefixed `/auto` was unattributable and collided with any other tool shipping the same obvious
  name. The prefix comes from `brand::CMD_PREFIX`, so a rebranded build picks its own; assets stay
  bare and are prefixed at deploy time. omp registers a command by FILENAME, so the frontmatter
  `name:` was realigned to the invoked name, and `8sync skill new --command` scaffolds it that way.
- Upgrades remove the pre-prefix copy of a command, but ONLY when it is byte-identical to the asset
  we shipped — a same-named command the user wrote is never touched.

## [0.54.1] - 2026-08-09

### Security
- **`8sync up` now verifies the downloaded binary.** `install.sh` checked the release asset's
  sha256 `digest` from the GitHub API, but the recurring path the update notice steers everyone
  toward — `8sync up`, including `--to <tag>` — curled the asset and renamed it into place
  unverified. It now checks the same digest with the same semantics, deletes the temp file and
  refuses to install on a mismatch (naming expected vs actual), and never leaves an executable
  behind. When no digest is published or no `sha256sum`/`shasum`/`certutil` is on PATH it still
  upgrades — aborting would strand minimal images — but says `checksum NOT VERIFIED` out loud
  instead of looking verified. Both curl calls also gained `--proto '=https' --tlsv1.2`.

## [0.54.0] - 2026-08-09

### Security
- **Command injection in the shipped `8sync-engine.ts`.** `engine_advance` built
  `git commit -m <msg>` as a string for `bash -lc`; `JSON.stringify` escapes `"` and `\` but a
  double-quoted bash word still performs command substitution, and the message is a model-supplied
  parameter routinely paraphrased from files the agent just read. Git and gitleaks now run through
  an argv-based `runArgv` with no shell. Shell evaluation is retained only for a task's `verify`
  commands, where it is the documented contract.
- **Argument injection into `sudo pacman` / `sudo dnf`.** Profile package lists were spliced into a
  privileged argv with no end-of-options separator, so an entry beginning with `-` became a flag —
  `--hookdir=` hands alpm attacker-written root hooks, `--setopt=reposdir=` repoints dnf. Package
  names starting with `-` are now refused outright at all three privileged entry points, and the
  planners emit `--` before the package list.
- The autonomous-commit gitleaks gate no longer fails open silently: `if command -v gitleaks` exits
  0 when gitleaks is absent, so fresh machines got unscanned commits from a gate that claimed to
  scan. Presence is probed separately and an unscanned commit says so.

### Fixed — profiles a teammate never asked for
- **`--full`/`--yall`/`-y` applied the maintainer's personal `alexdev` bundle**, so a teammate
  running "install everything" got Lian Li chassis drivers, a Vietnamese IME, DisplayLink DKMS and
  Bitwarden. `--full` now means every **community** profile, read from the same
  `offered_profiles()` the y/N prompt uses. Personal profiles are reachable only via
  `--profile <name>`; `--profile alexdev` restores the old behaviour in one flag.
- `--full` also skips the `warp` VPN: a flag meaning "don't ask me" is the wrong way to acquire
  something that rewrites DNS and routing, and `--community` already documented that opt-out.
- **Profiles installed packages for hardware the machine does not have.** `apply` installs packages
  before `post_install`, so the nvidia profile's own "no NVIDIA GPU detected" guard ran far too
  late. New `requires.detect` probe is evaluated in `resolve`, per bundle member, before any
  package work; `nvidia` probes sysfs PCI vendor `0x10de` (no `lspci` dependency) and fails closed.
- A profile skipped for missing hardware is no longer recorded as applied.

### Changed
- **Size ceiling recalibrated `5 MiB` → `5 180 KiB` (5,304,320 B), attribution-first.** The
  ratchet headroom was 4,208 B at v0.57.0; v0.56+v0.57 feature growth had eaten it all,
  so this release`s legitimate +20,608 B (omp hardening + sweep + super-pdf) tripped the
  gate. `size-report.sh` attribution: the `web` feature gate alone = +1,732,232 B — the
  only elephant. Ceiling stays tight on purpose: the next feature release trips it again
  and must attribute again. `AGENTS.md` §8 numbers refreshed (CI musl sizes).

### Fixed
- Line endings are now pinned to LF by `.gitattributes`. 14 embedded assets (a skill and the
  impeccable keyword rules) had CRLF committed, so the binary shipped assets whose bytes differed
  from every other asset — defeating the byte-compare that keeps user-edited files untouched and
  omp's prompt-cache prefix stable, and breaking frontmatter matching that keys on `\n`. A Windows
  checkout would have baked CRLF into every asset; the new CI `Test` step caught it.
- `Cargo.toml` version now matches the release tag, enforced by a new CI gate. Shipping 0.53.0
  under a v0.54.0 tag would have told every up-to-date user "update available" forever and made
  `8sync up` re-download the binary on every run.
- **A stale `8sync-workflow.ts` kept loading after upgrade.** The extension was retired this
  release, but nothing deleted the copy an earlier 8sync had already written to
  `~/.omp/agent/extensions/` and `<root>/.omp/extensions/`, so omp went on registering its tools
  next to the engine's. `8sync harness` (any subcommand) now removes both copies; the retired
  deploy path and its six call sites are gone.
- **Two shipped skills never deployed.** `research-paper` and `remote-compute` were added to
  `assets/skills/` but never registered in the deploy list, so `~/.omp/skills/<name>/` was never
  created on any machine — while `00-force-load.md` told the agent to open those SKILL.md files.
  Both are registered now, and a new guard test walks the embedded assets in the opposite
  direction (asset → list) so an unregistered skill dir fails the build by name; `social-growth`
  stays the single documented opt-in exception.
- **The shipped skill registry pointed at a deleted asset dir.** `assets/configs/skills.toml`
  (deployed to `~/.config/8sync/skills.toml`) still declared `src = "builtin:karpathy"` after the
  rename to `karpathy-guidelines`, so `8sync skill update` warned and skipped it on every run.
- **User-facing docs advertised 15 skills that no longer ship.** `README.md`, `AGENTS.md` and the
  docs site claimed "37 skills bundled" (and, elsewhere, 17) and named `literature-review`,
  `autoresearch` and `paper-writing` among "18 research skills" — all three directories were
  deleted, and the research set is now `deep-research`, `research-paper`, `remote-compute`. Every
  count now reads 23, matching `assets/skills/*/SKILL.md`, every named skill resolves to a real
  directory, and the two-tier force-load order (4 CORE + 6 specialist always-on) is described as
  `00-force-load.md` actually implements it. The docs site also told users to run
  `8sync skill add builtin:karpathy`, which no longer resolves.

### Added — Fedora-first package core (8sync now works on Fedora/RHEL)
- `trait PkgBackend` with `Pacman` + `Dnf` impls, selected by `env_detect::distro_family()`
  (`Family::{Arch,Fedora,Other}`, reads `ID` **and** `ID_LIKE`; Fedora 44 ships no `ID_LIKE`, so
  `ID` alone resolves). `backend()` returns `Option`, so a distro with neither manager keeps
  today's warn-and-continue instead of failing — Debian/openSUSE users are unaffected.
- Every package-manager spawn now lives **only** in `pkg.rs`. `platform::install_core_pkg` takes a
  `CorePkg { arch, fedora, brew, winget }` instead of positional strings nobody could tell apart.
- Profiles gained an **additive** `[packages.fedora]` table (`dnf`/`copr`/`rpmfusion`/`swap`)
  beside the existing `pacman`/`aur`/`aur_yay` keys, plus `#[serde(deny_unknown_fields)]`. All 37
  Fedora package names were verified against the live repos with `dnf repoquery`; profiles with no
  real rpm equivalent declare none and are skipped with a printed reason rather than guessing.
- `vpn` and `harness browser` are no longer Arch-only (Cloudflare WARP / `chromium` on Fedora);
  `clean` gained a dnf arm (`dnf clean all`, `dnf autoremove`).
- COPR is treated as third-party root code: `copr_enable` refuses any `owner/project` outside a
  checked-in allowlist unless explicitly allowed, and `dnf swap --allowerasing` prints the erase
  set first.

### Changed
- **Size ceiling recalibrated `5 MiB` → `5 180 KiB` (5,304,320 B), attribution-first.** The
  ratchet headroom was 4,208 B at v0.57.0; v0.56+v0.57 feature growth had eaten it all,
  so this release`s legitimate +20,608 B (omp hardening + sweep + super-pdf) tripped the
  gate. `size-report.sh` attribution: the `web` feature gate alone = +1,732,232 B — the
  only elephant. Ceiling stays tight on purpose: the next feature release trips it again
  and must attribute again. `AGENTS.md` §8 numbers refreshed (CI musl sizes).

### Fixed
- **`8sync setup` aborted at step 3 of 8 on every non-Arch Linux.** The AUR-helper step was gated
  on `Os::Linux` instead of the Arch family, so on Fedora it failed and `try_step`'s `?`
  propagated — `codegraph`, `path-bootstrap`, `configs`, `skills` and `codegraph-skill` never ran.
  This is why `~/.omp/skills` was empty on Fedora machines.
- **Skill paths written into `AGENTS.md` were absolute to the authoring machine**
  (`/home/alexdev/...`, `/home/alexng/...`), so on any other clone omp was told to read files that
  do not exist and silently skipped the skills. `skill/inject.rs` now emits repo-relative paths for
  project skills and `~/`-anchored paths for global ones. `harness audit` could never catch this
  because it skipped every `/`-prefixed token; it now flags `/home/`, `/Users/`, `/root/` while
  still ignoring `/etc`, `/usr`, `/tmp`.
- `Dnf::install` left a half-applied batch: its plan can hold two transactions (install, then
  upgrade), and a failed upgrade returned `Err` while the committed install stayed. It now reverts
  via `dnf history undo`.
- `install.sh` created its temp file in `/tmp` (tmpfs) while installing to `~/.local/bin` (btrfs),
  so the "atomic" `mv` crossed filesystems and degraded to a copy. The temp file is now a sibling
  of the destination, matching `selfup.rs`.
- `install.ps1` hardcoded the x86_64 asset, silently giving Windows ARM64 the wrong binary.

### Changed — enforced tool routing (omp stops ignoring the code-intel stack)
- Preferring codegraph/serena/codebase-memory was previously **prose**, which omp ignores under
  load. It is now enforced by mechanisms omp implements in code: a TTSR rule
  (`condition` + `scope: "tool:grep(*), tool:glob(*)"` + `interruptMode: tool-only`) that aborts the
  stream mid-tool-call, plus `bashInterceptor` patterns closing the `bash rg` escape.
- Both are **capability-gated**: with no code-intel tool installed the rule and the interceptor
  block are removed, so a bare machine is never dead-ended. TTSR `repeatMode: once` means the worst
  case is one restarted turn, not a hard veto.
- `APPEND_SYSTEM.md` shrank 9 198 → 3 260 B (−64.6 %); it is in every prompt on every turn, and the
  TTSR rule body costs zero prompt tokens.
- Downloads are now sha256-verified using the `digest` field the GitHub Releases API already
  returns — no new dependency, no release-plumbing change.
- First tests in the repo: 48 passing (`cargo test`), covering distro parsing, the pacman argv
  regression fixture, the COPR allowlist refusal, path portability, and audit path classification.

## [0.53.0] — 2026-08-08

### Added — `8sync .` named per-project sessions (run many features at once)
- `8sync .` grew a session layer so you can keep several concurrent lines of work in one repo,
  each an isolated omp conversation. Surface (namespaced under `.`, no new top-level verbs):
  `8sync . <name>` create-or-resume · `8sync . new <name> [--worktree]` · `8sync . ls`/`--list`
  (`--json`) · `8sync . mv <old> <new>` · `8sync . rm <name> [--force]` · `8sync . merge <name>...
  [--keep-worktree]`. `8sync .` with no name resumes the last-used session (omp's default store
  when none was ever named — unchanged legacy behavior).
- Mechanism (a thin layer over omp's existing session core — not a reinvention): one omp
  `--session-dir` per name (omp's own `--continue` resumes it — zero session-id bookkeeping),
  tracked in a machine-local registry `~/.config/8sync/sessions/<repo>/index.json` that stores
  only what omp lacks (human name, worktree binding, last-used). Every launch reuses `ModelConfig`
  so STEP-0 tool-routing + advisor survive.
- `--worktree` gives a session its own `git worktree add -b 8sync/<name>` so two features edit the
  same files concurrently without collision; `ls` shows branch + dirty state.
- `merge <name>...` lands session branches into the current branch, ECC-style (affaan-m/ECC, MIT):
  read-only `git merge-tree --write-tree` conflict preflight → `git merge --no-edit` → rebase the
  conflicting worktree onto the target to unblock (auto-abort + skip on true conflict) → clean up
  merged worktree + branch + session (`--keep-worktree` to preserve). Sequential, so branch-vs-branch
  conflicts surface as the target advances. Local-only — never pushes.
- Everything runs through `git`/`omp` shell-out — **no new dependencies** (ECC's rusqlite/git2/tokio
  stack was deliberately not adopted; it would bust the size budget). `8sync doctor` reports session
  count + dirty worktrees. New module `crates/cli/src/verbs/session.rs`; `here.rs` dispatches.
- Evaluated but NOT integrated (user asked to review): linshenkx/prompt-optimizer (AGPL-3.0 +
  optimizes human prose — wrong layer) and TypeScript 7 / typescript-go (transparent to `8sync run`,
  no code change).

### Fixed — `8sync up` was Linux-only and bricked itself on Windows
- Symptom (Windows): running `8sync up` left an un-runnable file so the next `8sync` invocation popped Windows' *"Select an app to open '8sync'"* picker instead of executing. Root cause in `crates/cli/src/verbs/selfup.rs`: the self-updater hard-coded `ASSET_SUFFIX = "-linux-x86_64"` (downloaded the **Linux** binary), wrote it to `~/.local/bin/8sync` with **no `.exe`**, and replaced it with a plain `std::fs::rename` (which Windows forbids on a running `.exe`). The release CI already publishes `8sync-<tag>-windows-x86_64.exe` and `install.ps1` installs to `%LOCALAPPDATA%\Programs\8sync\8sync.exe`, so the updater was simply never taught about non-Linux.
- Fix — self-update is now genuinely cross-platform:
  - **Correct asset per OS/arch:** `asset_label()` maps `platform::os()` + `std::env::consts::ARCH` to the CI labels (`linux-x86_64`, `linux-aarch64`, `darwin-x86_64`, `darwin-arm64`, `windows-x86_64`; macOS ARM is `arm64`, not `aarch64`), and `asset_filename()` appends `.exe` on Windows. Both `fetch_latest_release` (auto-check + `8sync up`) and `install_tag` (`8sync up --to`) use it.
  - **Install to the running exe** via `dest_path()` = `std::env::current_exe()` (canonicalized), so `8sync up` replaces 8sync wherever it actually lives — the Unix `~/.local/bin/8sync` OR the Windows `…\Programs\8sync\8sync.exe` — instead of a hard-coded Unix path. Falls back to the legacy path only if the current exe can't be resolved.
  - **Windows-safe replace:** `download_and_replace()` renames the live `.exe` aside to `.8sync.old.<pid>` (allowed while running) before sliding the new binary in, restoring the original if the install fails; stale `.old` files are swept on the next run. Unix keeps the same-dir inode-swap rename.
- Verified: native Linux release build is clean; the `#[cfg(windows)]` branch type-checks (it uses only cross-platform `std::fs` APIs — confirmed by compiling it with the gate temporarily forced on).

### Fixed — serena's web dashboard opened a browser tab on every session start
- Symptom: a Serena dashboard tab kept reappearing (showing `Error loading configuration` / `Error loading stats`, since it races the server it is reporting on), and RAM climbed. Cause: serena ships `web_dashboard: true` **and** `web_dashboard_open_on_launch: true`, so every `start-mcp-server` binds an HTTP dashboard and pops a browser tab. omp spawns one serena per session, so this multiplies — measured here: **16 live serena processes holding 878 MB**, one dashboard each.
- Fix: `deploy::ensure_serena_mcp` now registers serena with `--enable-web-dashboard False`. The flag is passed on the **command line** rather than by editing `~/.serena/serena_config.yml`, because serena owns that file and rewrites it — a config edit alone does not survive. `register_omp_mcp`'s self-heal rewrites the existing `mcp.json` entry in place, so the fix lands on `8sync harness global` with no manual step.
- The dashboard is pure observability: serena's MCP tools are unaffected. Verified live — no listener on `24282`, and `mcp__serena_get_current_config` still answers.
- Note (not a leak): a serena pair (`uv` wrapper + python child ≈ 145 MB) is held per **live omp session**, not per project. Closing unused omp sessions is what reclaims that memory.

### Added — STEP-0 tool-routing ENFORCEMENT (`step0`): the rule is now code, not prose
- Measured problem (this machine, `8sync harness toolstats`): the STEP-0 MCP stack was connected and callable yet effectively unused — `cbm 0 · serena 0 · headroom 0` agent calls; every code lookup fell back to the built-in `read`/`grep`. Prose directives in `APPEND_SYSTEM.md`/AGENTS.md had failed to change behaviour three times (see KNOWLEDGE). Zero-friction built-ins always beat an instruction.
- **Fix — remove the fallback instead of asking nicely.** `8sync ai` / `8sync .` now launch omp with `--tools` DROPping the two redundant searchers `grep` + `glob` (`STEP0_TOOLS` in `crates/cli/src/models.rs`), so code lookup MUST flow through codegraph (CLI) · codebase-memory-mcp · serena. `--tools` is an **allowlist** (omp has no deny-list — `tools.blocked` is only a telemetry counter), so it must name every tool to keep: anything omitted is silently disabled. The list is omp's validator list minus `grep`/`glob`, and minus `computer` to preserve its default-disabled state. `lsp` is deliberately KEPT (zero-friction; serena needs `activate_project` per session). MCP/xdev tools are orthogonal to `--tools` and survive it.
- **Shell escape closed:** `deploy::ensure_bash_interceptor` writes `bashInterceptor.patterns` into `~/.omp/agent/config.yml`. omp's rule shape is `{ pattern, tool, message }`, and its matcher **skips any rule whose `tool` is not in the session's tool list** — so a rule pointing at `grep`/`glob` disables itself precisely because STEP-0 removed them. Every rule therefore points at `lsp` (always present, and the honest suggestion). Blocks `rg`/`ag`/`ack`, `grep -r`, and `find -name`; single-file and log `grep` stay allowed. Setting the key replaces omp's default array. Wired into both `global_pass` and `harness_init`.
- **Verified end-to-end on omp 17.2.9** (the previous iteration was verified only as "the string is embedded in the binary", which is why it shipped broken): the captured provider request carries 18 tools with `grep`/`glob` **absent** and `recall`/`retain`/`reflect`/`memory_edit`/`hub`/`eval`/`ast_edit`/`lsp` **present**; `8sync ai` returns normally; `rg main main.rs` is refused with `Blocked: STEP-0: …`; `grep -r main .` is refused; plain `grep main main.rs` still runs.
- **Drift guard so the allowlist cannot rot silently again** (`8sync doctor`): an allowlist fails in two directions, and both have now happened — a name omp *drops* bricks every launch, a name omp *adds* disappears from the agent with no error at all. `models::step0_tool_drift` asks omp itself (`omp --tools __8sync_probe__ -p ""` — the validator runs before any provider call, so the probe is free and offline) and diffs the answer against `STEP0_TOOLS`, reporting `REJECTED by omp: …` or `missing omp tool(s): …`. Proven in both directions: injecting `bogus_tool` produced the REJECTED warning, reverting restored `✓ STEP-0 allowlist matches omp's tool list`.
- **`codegraph callers` demoted in the STEP-0 routing** (`assets/configs/omp/APPEND_SYSTEM.md`): on a clean, freshly rebuilt full index it reported `No callers found` for a function with two real call sites, and the misses cluster by *caller* (nothing inside `global_pass` resolves) rather than by callee — `let _ =` discards are not the cause. codegraph is a prebuilt external binary with no local source, so "who calls X" now routes to `mcp__serena_find_referencing_symbols`, with `codegraph callers` allowed only as a second opinion, never as proof of absence. The same note warns against `rm -rf .codegraph`, which deletes the exclusion config and makes the next index walk ~16k files instead of ~6k.
- **Toggle (never a trap):** default ON; `8sync ai --no-step0` for one run, or `step0 = false` in `~/.config/8sync/models.toml`.
- `APPEND_SYSTEM.md` RULE #0 rewritten to match reality: states that `grep`/`glob` are gone, gives a cheapest-first routing decision tree (cbm → serena → codegraph), and **drops the stale omp-16 `mcp.discoveryDefaultServers` claim** (omp ≥17 mounts MCP as `xd://` devices — that key no longer exists).

### Fixed — STEP-0 review pass: interceptor over-block + config-migration data loss
An independent reviewer (12 min) caught defects the happy-path tests missed; all verified live.
- **grep rule blocked single-file/log grep on hyphenated names** (`grep x-ray my-report.txt`, `grep bug build-Release.log`). The `.*(-[rR])` shape matched `-r`/`-R` *inside* words. The first repair (`\s-`) then over-corrected — `grep\s+` already consumed the space, so a first-token `grep -r` stopped matching and recursive grep was *allowed through*. Final pattern uses a negative lookbehind `(?<![A-Za-z0-9-])` so the dash must be a real token boundary, and excludes double-dash long flags from the short-flag matcher (`--color`/`--directories` contain an `r` but are not recursive). Verified 19/19 cases in Python before editing source, then live both directions: `grep -r` blocked, hyphenated-name grep + `--color=auto` allowed. Same lookbehind applied to the `find`/`fd` `-name`/`-type` rule.
- **config migration silently deleted user keys** — block-end detection used `is_ascii_alphabetic()`, so a following `# comment`, `_private:`, or `'quoted':` key was swallowed into the block and overwritten on the next `8sync harness`. Now ends at any column-0 line that is not an indented continuation, and the scan is no longer single-occurrence: every `bashInterceptor:` block is enumerated and only those carrying the `STEP-0` signature are removed (any ordering; duplicates collapse), so a user-authored block is never touched. Proven by replicating the exact Rust logic in Python against a config with comment + `_key` + quoted key + user block + ours.
- **doctor surfaced only one drift direction** — an omp upgrade that renames *and* adds reports both now (`rejected` and `silently_disabled` are no longer mutually exclusive arms).
- Trims the blank line that accumulated per `8sync harness` run.
- **Second review round — the `^` anchor made the guard mostly decorative.** `^\s*grep` only fires when the tool starts the command string, so `cd src && grep -r foo .`, `cd crates/cli && rg TODO`, `LC_ALL=C grep -r`, `sudo grep -r`, `time rg`, `cat x | grep -r y` and `; do grep -r …` all escaped. Rules now match at a **command position** — `(?:^|[;&|])` plus optional `\` escape, env assignments and wrapper words. `(` is deliberately not a separator and `do`/`then` are wrappers only, so quoted prose (`git commit -m '(rg removal)'`, `echo "do rg later"`) no longer trips the rule.
- **Substitutes closed:** blocking `rg` alone just moved the habit. `git grep` (recursive by default — the obvious fallback), `egrep`/`fgrep`, bare `fd '\.rs$'` and `fd -t f`, and `find -path`/`-regex` were all open. Tools with no single-file mode worth preserving (`rg`, `fd`, `git grep`) are now blocked outright; only `grep` gets flag analysis.
- **The grep rule is quote-aware.** It walks the option cluster (a run of shell words that are neither quoted nor containing `;&|`) instead of `.*`, so a flag-looking string inside the *search pattern* no longer counts: `grep " -r " f.txt`, `grep 'make -r' build.log`, `grep -F -- -r file.txt` and `grep pat /var/log/-r-rotated.log` are allowed again, and the scan can no longer cross into the next command (`grep foo a.txt; ls -r`). 48/48 cases verified against the patterns as actually written to disk, in omp's own JS engine.
- **P1 — a user-authored `bashInterceptor:` block was being silently voided.** The code appended its own block beside the user's, assuming a duplicate top-level key would make omp fail loudly. It does not: omp parses config.yml with `Bun.YAML.parse`, which keeps the **last** key, and 8sync always appends last — so every rule the user wrote disappeared on each `8sync harness`, with no error anywhere. The function now detects a surviving user block, leaves the file untouched, and warns instead of installing.
- Fresh-machine formatting: no stray leading blank line when `config.yml` did not exist.

### Fixed — omp 17 "Failed to load extension: mutable default value must be specified as a factory"
- omp 17.2.9 added a schema validator that rejects any zod `.default(<mutable>)` where the value is an array or object literal — it must be a **factory**: `.default(() => [])`. Primitives (`false`/`0`/`""`/`3`) are unaffected. Every `omp` session printed `Warning: Failed to load extension …/8sync-engine.ts: ParseError: A mutable default value must be specified as a factory`, so none of the `engine_*` tools registered.
- One site: `assets/extensions/8sync-engine.ts:146`, `verify: z.array(z.string()).default([])` → `.default(() => [])`. `8sync-workflow.ts` had no defaults. Verified: `omp -p` in the affected project loads the extension with zero warnings. The asset is rust-embedded, so this needs `cargo build` + `8sync harness` to redeploy; live project copies were refreshed directly for immediate relief.
- Note: the separate "`omp --continue` loses chat history" report is **not** caused by this — omp continues past extension-load failures. It is a distinct omp-17 symptom; retest `--continue` after this fix and diagnose separately if it persists.

### Changed — CI: `aarch64` builds without Docker, and the size budget is now enforced
- **`cross` → `cargo-zigbuild`** for `aarch64-unknown-linux-musl`. This fixes a correctness bug, not just speed: `cross` ran inside a Docker image with no JS toolchain, so `build.rs` could not build the Vite dashboard and **silently embedded the stub page** into that asset. zigbuild runs on the runner, where `npm` exists. Verified locally (zig 0.16.0 + cargo-zigbuild 0.23.0): 31.9 s → statically linked aarch64 ELF, **4 151 328 B — already under the 4 MiB goal**.
- **New `scripts/size-gate.sh`**, run on every release asset: hard-fails above a **5 MiB ceiling**, warns above the **4 MiB goal**. `AGENTS.md` §8 carried a budget nothing enforced, which is how the binary drifted 52 % over unnoticed. The ceiling sits above today's size on purpose — a gate that is already red gets ignored — and ratchets down as `size-report.sh` shows headroom. Both directions tested.
- **`universal2` rejected** (reversing the earlier proposal): a fat macOS binary makes every Mac user download both slices — the opposite of the goal — and would rename assets `install.sh` resolves by `${os}-${arch}`.

### Fixed — a directory merely *named* `su-code` made its parent look like a project
- `discover::detect_current_project_root` and `harness global`'s project test accepted any folder called `su-code` as proof of an omp project. Since this repo's own checkout is `~/Projects/tools/su-code`, an auto-stamp run from `~/Projects/tools` wrote a blank memory tree (`STATE.md`, `KNOWLEDGE.md`, `PLAYBOOKS.md`, …) **plus a 74-entry `skills/` tree into the repo root**.
- Both paths now share `discover::is_omp_project`, and the `su-code` marker requires the directory to actually contain memory (`skills/` or one of `STATE.md`/`KNOWLEDGE.md`/`PROJECT.md`/`PLAYBOOKS.md`/`skills.toml`). Verified three ways: a bare `su-code/` dir is left alone, an `AGENTS.md` repo is still stamped, and a memory tree without `AGENTS.md` is still detected.

### Changed — **binary is 24 % smaller**: 6 407 848 → 4 859 696 B, no feature removed (`lean-binary` M2)
- **Dropped `rusqlite` (−1 035 384 B).** `harness toolstats` never needed a database: its ingest opened with `DELETE FROM calls` and re-parsed every session JSONL on each run, so nothing ever persisted — 1 MB of embedded SQLite C answered `COUNT`/`GROUP BY` over rows the same process had just built. Now a single in-memory pass. Output is **byte-identical**, proven by running the old and new binaries against a frozen copy of the session tree; only the provenance line changed (`→ …/toolstats.db` became `← …/sessions/<slug>`). SQLite left `ORDER BY` ties in table-scan order, so ranking tie-breaks on first appearance to preserve it.
- **Replaced `elkjs` with `@dagrejs/dagre` (−512 768 B).** `elk.bundled.js` was 1 606 238 B of the 1 891 858 B dashboard chunk — 85 % of the frontend was a GWT-compiled Java layout engine serving two `layered` calls. New `web/src/layout.ts`; bundle down to 478 704 B (−75 %). A lazy `import()` was measured first and rejected: `rust-embed` embeds the whole `web/dist` tree, so chunk-splitting saves zero binary bytes. Verified headless — codegraph lays out in four clean LR ranks, workflow auto-layout chains top-down, zero page errors.
- **`toolstats` feature flag removed** — it guarded only `rusqlite`. `features` is now just `web`; a `--no-default-features` build *gains* the tracker and sits at 3 109 496 B, **25.86 % under the 4 MiB budget**.
- `AGENTS.md` / `README.md` size and tracker claims replaced with measured numbers.

### Added — `lean-binary` feature scope (GSD planning tree): M0 + M1 landed
- `su-code/planning/lean-binary/` — 4-phase roadmap to bring the binary back under the `AGENTS.md` §8 "< 4 MB" budget **without dropping a user-visible feature**: M0 land pending WIP · M1 feature gating + per-gate byte attribution · M2 eliminate rather than gate · M3 CI (`cargo-zigbuild` `aarch64-musl`, macOS `universal2`) + budget truth.
- **M0 PASS.** Baseline **6 407 848 B** vs the 4 194 304 B budget. Every commit in the range was replayed in a throwaway `git worktree` and built from scratch — 4/4 green — because `engine_verify` only ever sees the working tree.
- **M1 PASS (8/8 AC).** `crates/cli/Cargo.toml` gets its first `[features]` table: `default = ["web","toolstats"]`, `web` = axum + tokio + tower-http + scraper, `toolstats` = rusqlite. `marketplace` folds into `web` (single caller: `/api/marketplace`). A `--no-default-features` build now compiles **and runs**, warning-clean, with no JS toolchain — `build.rs` skips the Vite bundle when `CARGO_FEATURE_WEB` is unset. Gated subcommands say `rebuild with --features web` instead of failing as unknown.
- **New `scripts/size-report.sh`** — A/Bs four feature combinations into separate `--target-dir`s. Measured: full **6 407 144** · web-only 5 346 304 · toolstats-only **4 144 576** · minimal **3 081 416**. Per-gate cost: `web` **2 262 568 B**, `toolstats` **1 060 840 B**.
- **`cargo bloat` was wrong by ~26×** on SQLite (40 KiB claimed vs 1 060 840 B measured) — it attributes `.text` by symbol and is blind to `.rodata` and C blobs. Ranking tool only; every load-bearing number now comes from an A/B build.

### Added — `deep-research` §5 "Native & Binary-Weight Audits" + a measured audit of `8sync` itself
- `assets/skills/deep-research/SKILL.md` gains a 7-step protocol for native/binary-weight research: ground with `size -A`, attribute with `cargo bloat --crates` (and chase its `[Unknown]` C row through `build/*/out/*.a`), A/B every proposed flag into a scratch `--target-dir` with an explicit `--target`, record falsified knobs as `failure:` entries, trace surprise deps with `cargo tree -i`, prefer `[features]` gating over rewrites, and reach for Zig only as build tooling.
- Applied it to this repo — brief at `outputs/native-tooling-zig-rust.md` (+ plan/drafts/provenance). Headline: the binary is **6 406 696 B (6.11 MiB)** against the `AGENTS.md` §8 "< 4 MB" budget, and the cause is that `crates/cli/Cargo.toml` has **no `[features]` section** — `harness web` (axum/tokio/hyper), marketplace scraping (scraper/html5ever) and `harness toolstats` (bundled SQLite, 2.1 MB `.a`) link into every build, alongside 4.9 MB of embedded assets (`web/dist` 1.9 MB, `impeccable/scripts` 1.6 MB).
- Release-profile knobs proven exhausted by A/B: `opt-level="s"` is **+307 392 B** vs `"z"`; `-C force-unwind-tables=no` saves **704 B**; `-C relocation-model=static` breaks proc-macro builds. No profile change made.

### Added — `branch-sync` skill & automated script for zero-conflict multi-branch sync
- **`/sync-pr` slash command**: Deployed globally (`~/.omp/agent/commands/sync-pr.md`) and per-project (`.omp/commands/sync-pr.md`). Invoking `/sync-pr [<branch>]` in any omp session automatically loads the `branch-sync` skill, audits all local/remote branches, deep-previews and safely merges specified feature branches to `main`, and synchronizes all active branches to match latest `main` with zero conflicts.
- New skill `assets/skills/branch-sync/SKILL.md` + helper script `assets/skills/branch-sync/scripts/branch_sync.py`: provides complete audit, deep-preview (`git diff main...<branch>`, commit breakdown, conflict dry-run), safe merge to `main`, and zero-conflict multi-branch synchronization across all active local/remote branches without risk of merge conflict leaks or data loss.

### Enhanced — `8sync harness global` auto-detection for `su-code/` projects
- `8sync harness global` now automatically detects if the current working directory is an `omp` project (containing `su-code/` or `AGENTS.md`) and stamps its per-project harness layer (vendors global skills into `su-code/skills/`, injects `AGENTS.md`/`CLAUDE.md`, seeds memory, installs pre-commit hook, and initializes `codegraph`) without requiring manual `--sweep`.

### Enhanced — `deep-research` skill with AI Agent loop engineering & design patterns
- Deepened `assets/skills/deep-research/SKILL.md`: incorporates state-machine loop engineering (Plan → Execute → Verify → Advance), STEP-0 code intelligence (`codegraph`, `codebase-memory-mcp`, `serena`), multi-agent wave execution (`tasks[]`), headroom output compression, modality-fit vision routing, and ponytail YAGNI discipline for large real-world codebases.

### Added — `8sync omp update` verb (update omp + auto-repair a blocked install)
- New verb `crates/cli/src/verbs/omp.rs` (`8sync omp update`, `--force`): runs `omp update`
  and, when it fails with `npm error EEXIST … ~/.local/bin/omp` or bun `Fail extracting
  tarball`, auto-repairs — backs up the current binary, clears the standalone file squatting
  the symlink path, `npm install -g @oh-my-pi/pi-coding-agent@latest`, then re-resolves and
  reports `CURRENT → NEW`. Runs from the SHELL (not an omp `/command`) so it works even when
  omp is broken; native Rust, no `sudo`/system-pkg/git. `8sync up` note now points here.
- Verified live both paths: normal ("Already up to date" @ 17.0.7) and `--force` (backup → rm
  → npm reinstall → `~/.local/bin/omp` healthy `node_modules` symlink). Root cause: omp ships
  as a standalone binary that squats the bin path where the package manager wants a symlink.

### Added — Lark (larksuite) to the `apps-personal` profile
- `assets/profiles/apps-personal.toml` now installs Lark via AUR `larksuite-bin`
  (v7.66.11, URL larksuite.com) alongside Bitwarden. AUR bin package auto-fetches the
  official `.deb` at build time and is pacman-tracked — the 437 MB binary is NEVER
  committed to the repo/GitHub, only the download reference. Sets `requires.aur_helper`.
  China build (Feishu) is a separate package, `feishu-bin`. Opt-in; the `alexdev`
  bundle intentionally excludes `apps-personal`.

### Fixed — STEP-0 MCP tools were connected but NEVER called (0.09% usage) → always visible
- Root cause (measured over 29 omp sessions / 13,854 tool calls: serena 0 · headroom 0 ·
  cbm 10 · zai 3 calls; `search_tool_bm25` taken 2×): omp's default
  `tools.discoveryMode: auto` hides ALL MCP tools behind a `search_tool_bm25` discovery
  hop once the registry exceeds 40 tools (this stack registers 48), and every instruction
  surface taught BASE tool names (`search_graph`, `find_symbol`) that are not callable —
  the registered forms are `mcp__codebase_memory_mcp_search_graph`, `mcp__serena_find_symbol`, ….
- Fix: `8sync harness`/`harness global` now writes `mcp.discoveryDefaultServers:
  [codebase-memory-mcp, headroom, serena, zai-vision]` into `~/.omp/agent/config.yml`
  (`ensure_mcp_tools_visible` in `crates/cli/src/verbs/skill/deploy.rs`) — the four
  harness servers' full catalogs stay in the active tool set, zero discovery hops.
  Key-presence idempotent; never overrides a user-set value. NOTE:
  `tools.essentialOverride` does NOT work for MCP (omp filters entries to built-in
  tool names only — verified in omp 16.4.8 bundle); an inert pin block from that
  approach is auto-migrated away (byte-exact match only).
- Instruction surfaces now teach the REGISTERED `mcp__…` names + the
  `search_tool_bm25` escape hatch for other/new servers: `APPEND_SYSTEM.md` RULE #0,
  `00-force-load.md`, the AGENTS.md STEP-0 sentinel template (`inject.rs`), the
  capabilities catalog header, and the feature-skill R10 literals (assets + su-code
  mirror). Stale names dropped everywhere: `semantic_query` (never existed on cbm),
  `codegraph search/deps/defs` (real 1.1.2 verbs: `query/explore/node/callers/callees/impact`).
  Unfollowable headroom mandate ("compress before it enters context") rewritten to the
  followable form: compress what YOU re-emit (`mcp__headroom_compress`).
- `8sync doctor` now flags hidden MCP tools (`discoveryDefaultServers` missing) and a
  dead serena (mcp.json + uvx check). Live probe verified: `omp -p` calls
  `mcp__codebase_memory_mcp_search_graph` and `mcp__serena_find_symbol` directly — both OK,
  no discovery hop; toolstats records serena/cbm optimizer calls for the first time.

### Fixed — omp ≥17 dropped bm25 discovery; the recurring "MCP HIDDEN" was a phantom
- omp 17.x replaced the pre-17 tool-discovery model (the `search_tool_bm25` hop +
  `mcp.discoveryDefaultServers`) with `tools.xdev` (default on): MCP tools mount as
  `xd://mcp__…` device URLs, callable via read/write without shipping schemas every
  request. `discoveryDefaultServers` is gone from omp's settings schema — writing it is
  a no-op that omp strips on the next config rewrite. That churn is exactly why STEP-0
  looked like it "regressed" after every omp self-upgrade (upgrade resets `config.yml`
  → doctor's string-check screamed HIDDEN → re-harness → repeat), while the tools were
  callable all along (verified live via `xd://mcp__codebase_memory_mcp_*` this session).
- `ensure_mcp_tools_visible` (`deploy.rs`) now detects omp ≥17 and skips the dead key
  (nothing to configure — `tools.xdev` mounts them); pre-17 keeps the discoveryDefaultServers write.
- `8sync doctor` MCP check is omp-version-aware: omp ≥17 reports the xd:// mount (OK)
  instead of the false "HIDDEN behind search_tool_bm25" warning; the `harness global`
  summary bullet updated to match. New `env_detect::omp_major()` parses omp's major version.

### Added — omp `/push-now` command (cross-machine handoff + commit + push)
- New embedded command `assets/commands/push-now.md`, deployed by `8sync harness`
  (`ensure_engine` in `crates/cli/src/verbs/skill/deploy.rs`) to
  `~/.omp/agent/commands/push-now.md` (global) + `<repo>/.omp/commands/push-now.md`
  (project), alongside `/auto` and `/feature`. `/push-now [msg]` is the
  "I'm switching machines right now" verb: it rewrites `su-code/STATE.md` with a
  cold-resume handoff (branch/HEAD, what changed this session, done/next/blockers,
  new-machine runbook), updates `CHANGELOG.md`/`KNOWLEDGE.md` if code changed, then
  `git add -A` + commit (gitleaks-gated, no `--no-verify` past a real secret) +
  `git push` origin current branch. No PR, no branch switch, no tag bump, no
  force-push (that's `8sync ship` / a release). Since it's in `assets/`, a fresh
  machine gets it automatically after `git pull && bash scripts/bootstrap.sh && 8sync harness`.

### Added — omp `/pull-now` command (cold-resume: pull + orient + prepare)
- New embedded command `assets/commands/pull-now.md`, deployed by `8sync harness`
  the same way (`ensure_engine`) to `~/.omp/agent/commands/pull-now.md` +
  `<repo>/.omp/commands/pull-now.md`. `/pull-now [go]` is the **receiving end of
  `/push-now`**: safe `git pull` (ff-only → rebase on divergence; stop on conflict
  or dirty tree), then read `su-code/STATE.md` HANDOFF + recent `KNOWLEDGE.md`
  learnings + `CHANGELOG.md`/`git log` to understand exactly where the project is,
  prepare the workspace (rebuild + `8sync harness` if `crates/`/`assets/` changed,
  verify the per-machine gotchas the handoff listed, `8sync doctor`), and report
  current state + the single next concrete action. `go` = start that action;
  empty = orient + prepare, then STOP for the human. No push, no clobber.

Older releases (0.52.0 and down) live in [CHANGELOG-ARCHIVE.md](CHANGELOG-ARCHIVE.md).
