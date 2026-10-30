# Hướng dẫn dùng 8sync + Claude Code (ccc)

Nhanh trong terminal: `8sync guide`. File này là bản đầy đủ.

**Nguyên tắc:** chỉ dùng Claude Code chính chủ với login của anh. 8sync không giữ, không chuyển tiếp OAuth token. Mọi thứ chạy local trên máy.

---

## Bắt đầu nhanh

**Một thư mục dự án, làm theo thứ tự:**

| # | Làm gì | Trong HQ | Hoặc lệnh trong terminal |
|---|---|---|---|
| 1 | Mở HQ (để nguyên terminal đó). Ở xa máy (điện thoại): thêm `--public` để có link internet đăng nhập một lần | — | `8sync hq ui` → http://127.0.0.1:8740 · `8sync hq ui --public` |
| 2 | Thêm thư mục repo. Lần đầu: mở `claude` trong thư mục đó một lần, chấp nhận câu hỏi trust | **Projects** → dán đường dẫn | — |
| 3 | Mở một session Claude Code có tên trong repo (tạo mới hoặc mở lại) | — | `cd du-an && 8sync ccc . api` |
| 4 | Giao việc trong session: một việc, hoặc một mục tiêu có lệnh kiểm, lặp tới khi xanh | tab **Sessions** → chat | `/ship <việc>` · `/ship-loop <mục tiêu>` |
| 5 | Xem session nào đang làm gì, việc nào chờ anh; merge/release/secret/ngoài repo luôn chờ anh | tab **Sessions** | `8sync ccc . ls` |
| 6 | Bài học dùng được ở mọi dự án (công cụ, hook, cách làm) ghi vào cây tri thức của máy; đầu phiên mỗi session đọc dự án mình trước rồi 3 dòng cuối của từng dự án khác dưới root của nó; chuyện riêng của khách KHÔNG vào đây | tab **Tri thức** | `8sync ccc know add "<bài học>"` · `know ls [--all]` |

8sync không tự mở session, không tự gửi prompt vào session: mọi session là do anh mở. Phanh khẩn: `8sync ccc cancel --all`.

- **Giữ máy thức**: công tắc "Thức & màn hình" trong tab Máy của HQ, hoặc `8sync awake on` / `8sync awake off` — bật là máy không ngủ tới khi anh tắt, không hạn giờ. `--hours N` thì nhả sau N giờ. Trên Windows lệnh tự tắt màn hình sau 10 phút không ai đụng chuột/phím (`--screen-off N` đổi số phút, `0` để Windows lo), trừ khi có app giữ màn hình (đang xem video) hoặc máy có Modern Standby; chạm chuột/phím là sáng lại, máy vẫn làm. Gập nắp laptop hoặc tắt máy thì session vẫn dừng. Kiểm tra: `8sync awake status` (máy có được giữ thức, màn hình bật/tắt, bao lâu không ai đụng chuột/phím, đã ngủ bao lâu từ lúc bật, có Modern Standby không).
- **Chip "Máy" trên HQ** (cả trên điện thoại): RAM, CPU, GPU; điện đang dùng (CPU và GPU đo thật, phần còn lại ước tính 60 W, chỉnh được), ₫/giờ, kWh và ₫ hôm nay và tháng này (giá mặc định 3.500 ₫/kWh, chỉnh được); mục "Thức & màn hình"; tab **Máy** có đồ thị RAM/CPU 30 phút (server lấy mẫu 30 s một lần, nét đứt là ngưỡng RAM của guard, từ 0.110.34).
- **Link internet** (`--public`): cần `cloudflared` (thiếu thì lệnh in cách cài). Mỗi lần bật là host + khoá mới, tắt HQ là link chết. Ai có link là điều khiển được các session — không chia sẻ.

**Giao việc theo mức**, gõ trong Claude Code (session mở bằng `8sync ccc . <tên>`; từ v0.98.4 session luôn mở ở auto mode: cờ `--dangerously-skip-permissions` của launcher (Orca…) bị Claude Code từ chối):

| Mức | Gõ | Chạy tới đâu | Còn cần anh |
|---|---|---|---|
| 1 | `/do <việc>` | sửa ≤ 3 file, không plan, không commit | xem diff, commit |
| 2 | `/ship <việc>` | plan → R&D → code → test → UAT → review → CHANGELOG + memory → commit | push (nó không push) |
| 3 | `/ship-auto <việc>` | như `/ship`, rồi PR → CI xanh 3 OS → merge → tag → release | trả lời một câu `Ship` |
| 4 | `/ship-loop <mục tiêu>` | lặp tới khi mọi lệnh kiểm exit 0 (trần 12 vòng, 90 phút, hoặc kẹt cùng lỗi 2 lần) | khi chạm trần, hoặc lúc release |
| 5 | `/autopilot` | tối đa 5 item hoặc 8 giờ từ backlog (issue có label `ccc`/`8sync`, mục Next trong `su-code/STATE.md`, failure chưa có guard), mỗi item một loop + một nhánh | một câu `Ship` cho cả batch |

Mức 3–5 chỉ anh khởi động; agent không tự gõ được. Dừng: nói "dừng" trong session, hoặc `8sync ccc cancel`.

Không mở terminal: `claude -p "/autopilot --max-items 5 --hours 8" --permission-mode auto --permission-prompts none --max-budget-usd 20`. Chạy headless không trả lời được câu `Ship`, nên dừng trước merge và để lại brief. Chạy nhiều ngày không người trông thì dùng Routines (`/schedule`) hoặc Console API key. Chi tiết ở mục 4 và 6.

**Auto-compact:** kit đặt nén ở 65% window của model, nên model 1M nén ở khoảng 650K và model 200K ở khoảng 130K. Status line hiện mốc của từng session, ví dụ `ctx 22%→nén 65%` (đỏ khi dưới 50%). `8sync ccc compact` liệt kê window đo được theo từng model; đổi mốc bằng `--at <N>`.

## 1. Cài và cập nhật

```bash
curl -fsSL https://get.8syncdev.com/install | sh      # lần đầu (Linux/macOS)
# Windows PowerShell: irm https://get.8syncdev.com/install.ps1 | iex
8sync up            # cập nhật 8sync (kiểm sha256)
8sync ccc kit       # cài hoặc cập nhật kit vào ~/.claude: agents, /ship, hook, guard, stop gate
8sync ccc status    # kiểm: claude, login, kit đủ file (vd 40/40), managed settings, MCP
```

Nếu `8sync ccc status` báo thiếu login, chạy `claude` một lần và đăng nhập.

## 2. Mỗi việc một session

Mỗi session là một cuộc hội thoại riêng, có tên, gắn với repo hiện tại.

```bash
cd ~/works/du-an
8sync ccc . core          # mở hoặc tạo session "core"
8sync ccc . fix-login     # việc khác, session khác, chạy song song được
8sync ccc .               # mở lại session dùng gần nhất
```

Đặt tên ngắn theo việc: `core`, `fix-login`, `price`, `review`. Lần sau gõ đúng tên là quay lại đúng cuộc hội thoại đó.

## 3. Biết session nào đang làm gì

```bash
8sync ccc . ls
```

```
Claude Code sessions · /home/you/works/du-an
★ core  ● running  2m ago
      ask  sửa luồng đăng nhập Zalo…               ← yêu cầu gần nhất của anh
      now  Bash: chạy test auth                    ← việc session đang làm
      todo 3/7 tasks ▸ thêm retry cho webhook      ← tiến độ + task đang làm
      42 msgs · 180k ctx · claude-opus-5-5
  price  ○ idle  16h ago
```

- `● running`: đang có tiến trình Claude Code mở session này. `● active`: vừa ghi trong 2 phút. `○ idle`: đang nghỉ.
- `8sync show <tên>`: chi tiết gồm 5 yêu cầu gần nhất, câu trả lời cuối, checklist task, file vừa sửa và lệnh resume.
- `8sync ls`: mọi session của repo (ccc, omp, forge). `8sync ls --all`: mọi repo trên máy.
- **Thứ tự:** mặc định theo ưu tiên — session cắm cờ `▲ high` (`8sync ccc . urgent high`), session dừng vì lỗi API / hết usage (`⚠ stopped …`), `◆ med`, session đang chạy, `▽ low`, rồi session nghỉ; cùng mức thì theo trạng thái (running → active → idle), rồi mới nhất, rồi tên. Đổi: `--sort time` (mới nhất), `--sort name`, `--sort status`; `-r` đảo ngược. Có ở `ccc . ls`, `. ls`, `ls`, `ls --all`.
- `--json` có ở `ls` và `ccc . ls` cho script (cùng thứ tự với bản in).

## 3b. Status line của Claude Code

```bash
8sync ccc statusline --install     # ghi statusLine + subagentStatusLine vào ~/.claude/settings.json
8sync ccc statusline --uninstall   # gỡ, khôi phục statusLine cũ nếu có
```

- Dòng 1: model, ngữ cảnh (thanh 10 ô, đỏ khi >80%), giới hạn 5h/7d kèm `↻ còn bao lâu`, chi phí, `+dòng/-dòng`. Dòng 2: nhánh git (`*` nếu có thay đổi), PR, tasks, cảnh báo watchdog, loop, `🚢 grant`.
- Nếu anh đã có `statusLine` riêng (ví dụ Orca), 8sync lưu nó thành `statusLine_prev` trong `~/.config/8sync/features.toml` và chạy nối tiếp: output của nó thành dòng cuối. `8sync ccc kit` không bao giờ ghi đè statusLine có sẵn.

## 4. Giao việc trọn gói trong Claude Code

| Lệnh | Dùng khi |
|---|---|
| `/ship <việc>` | Làm trọn một feature hoặc bug như một team: plan → R&D → code → test → UAT → review/QC → CHANGELOG + memory → commit. Thêm cờ `--release` hoặc `--deploy` ở cuối để đi tiếp: PR → CI → merge/tag/deploy (guard hỏi anh) → monitor. Trạng thái nằm ở `su-code/ship/<slug>/STATE.md` (con trỏ `su-code/ship/ACTIVE`), được nạp lại đầu phiên và sau /compact |
| `/planning <việc>` | Chỉ lập plan (không code): goal, acceptance criteria, task theo file, rủi ro; câu hỏi gom một bảng |
| `/remember <bài học>` | Ghi một bài học có bằng chứng vào `su-code/KNOWLEDGE.md`; session sau tự đọc |
| `/consolidate` | Dọn memory: gộp trùng, bỏ dòng sai/cũ, chuyển quy trình sang PLAYBOOKS (hỏi duyệt một lần) |
| `/rules <việc định làm>` | Hỏi "việc này có được phép không": trả lời ALLOWED / CONDITIONS / NOT ALLOWED, kèm điều khoản và link |
| `/sec` | Trước commit/PR: quét secret (chỉ báo file:dòng), dependency, guard, OWASP |
| `/harden` | Siết cấu hình Claude Code của máy |
| `/aup-audit` | Trước release, hoặc khi thêm thu thập dữ liệu / nhắn tin người ngoài |
| `deep-research` | Nghiên cứu có trích nguồn: plan + ledger, chọn số researcher theo độ khó, verifier rồi `research-reviewer`, bản cuối `outputs/<slug>.md` kèm provenance (PASS / PASS WITH NOTES / BLOCKED) |
| `/autoresearch` | Chỉ anh gõ. Tối ưu theo benchmark trong worktree riêng: hỏi một thẻ Start (mục tiêu, lệnh đo, phạm vi, ngân sách), đo baseline nhiều lần, mỗi vòng một giả thuyết, chỉ giữ cải thiện vượt nhiễu, báo cáo mọi cấu hình đã thử; đưa vào code qua `/ship` |

Agent có sẵn trong kit: `explore`, `task`, `quick-task`, `reviewer`, `designer`, `pm`, `architect`, `qa`, `critic`, `researcher`, `verifier`, `research-reviewer`. Mỗi agent chạy model hợp với vai: Haiku cho việc dò, Sonnet cho việc làm và review.

## 4b. Nhiều session cùng repo

- Mở nhiều session riêng (`8sync ccc . a`, `8sync ccc . b`): các session nhắn nhau qua `SendMessage` và hiện trên `8sync hq ui`.
- **Tên session là phòng ban.** Đặt tên có nghĩa: `rd`, `qa`, `ui`, `api`, `ops`, `docs`, `sec`, `critic`, `lead`, `core`. Tên khác cũng được, khi đó chính cái tên là chủ đề của session. Lúc mở session, kit báo cho Claude ba thứ: vai của session, ≤5 dòng memory theo chủ đề tên, và "Phòng khác đang làm" (session khác cùng repo hoạt động trong 2 giờ qua: việc đang làm, file đang sửa) để không sửa trùng file.

## 5. Session trên web local: `8sync hq ui`

```bash
8sync hq ui            # mở http://127.0.0.1:8740 (cần node ≥ 22.5)
8sync hq ui --update   # tải lại bản UI của đúng phiên bản 8sync đang dùng
```

Không cần clone repo, không cần pnpm. Lần chạy đầu 8sync tải `8sync-hq-ui-v<phiên bản>.tar.gz` (~9 MB) từ GitHub Releases, kiểm sha256 (sai là từ chối cài), giải nén vào thư mục data của nền tảng (`~/.local/share/8sync/hq-ui/<phiên bản>/` trên Linux) rồi chạy bằng `node`. Các lần sau dùng bản đã cài, không cần mạng. Cần `curl` và `tar`. Đã kiểm trên Linux; macOS và Windows **chưa kiểm** (Windows 10+ có sẵn `curl`/`tar` nhưng đường cài này chưa chạy thử ở đó). File `.sha256` nằm cùng release với tarball nên chỉ kiểm tính toàn vẹn (file hỏng/thiếu), không phải nguồn tin cậy độc lập; nếu GitHub API có digest của asset thì 8sync đối chiếu thêm. Bản dev: `--app <thư mục>` hoặc `EIGHTSYNC_HQ_UI_APP` (chạy `pnpm start` trong thư mục đó; `--update` bị bỏ qua và có cảnh báo).

1. **Add project folder**: đường dẫn tuyệt đối tới repo.
2. **Sessions → Start**: đặt tên, ví dụ `api`. UI chạy Claude Code chính chủ trong `tmux` (tên `hq-api`), đúng thư mục dự án.
3. **Lần đầu mở một thư mục**, Claude Code hỏi "trust this folder". Mở **terminal** của session trên UI rồi bấm phím trả lời (Enter / ↑ ↓ / 1 2 3), hoặc `tmux attach -t hq-api`.
4. **Chat**: chọn session rồi nhắn. Tin được gõ vào terminal của session (nhãn "via terminal"). Câu trả lời của Claude hiện lại trong chat ("from terminal").
5. **Nhiều session giúp nhau**: Claude Code có `SendMessage` giữa các session trên cùng máy. Tin session A → B hiện trong chat dạng "A → B".
6. **Shell trên máy** (nút "Terminal" ở header, hoặc Ctrl+`): một terminal nổi, kéo/đổi cỡ được (trên điện thoại là khung dưới), chạy shell thật trên máy ở thư mục đang xem. Có zsh của 8sync thì có gợi ý xám (→ nhận), Tab hoàn thành, ^R tìm lịch sử; không thì PowerShell / `$SHELL`. Thanh phím Esc · Tab · mũi tên · Enter · ^C ^D ^R ^L cho điện thoại. Đóng khung shell còn 30 phút; "Tắt shell" thoát hẳn. Không mở qua link `--public` (chỉ có khoá link); mở được trên máy và qua proxy có đăng nhập riêng (ví dụ VPS + GitHub).

**Cập nhật:** `8sync up` xong, HQ đang chạy (không `--public`) tự khởi động lại trên bản mới trong khoảng 30 giây, link từ xa thấy bản mới mà không cần ai ở máy. HQ cũ hơn 0.102.0 cần Ctrl-C rồi `8sync hq ui` một lần.

**Về Channels (chat hai chiều không qua terminal):** org Claude Team của anh hiện **chưa bật** Channels. Claude Code báo "Channels are not enabled for your org", và UI tự dùng đường terminal. Owner bật được ở claude.ai → Org settings → Claude Code → Channels. Bật xong, tin đi qua channel `8sync-hq` (nhãn "via channel").

Che secret là theo mẫu: khoá tên tiếng Anh (`password:`, `token=`, `api_key`…), tiền tố đã biết (`sk-ant-`, `ghp_`, `AKIA`, JWT, PEM…) và chuỗi dài ngẫu nhiên. Ghi "mật khẩu: …" bằng tiếng Việt **không** được nhận ra, nên đừng gõ secret vào chat.

Dữ liệu nằm ở `~/.local/state/8sync/hq/` (SQLite, quyền 0600), chỉ trên máy anh. UI chỉ nghe ở 127.0.0.1 và cần token local.

**Lưu trữ, tắt, xoá:**
- `8sync hq ui` bật journal local (`local = true`) và in một dòng thông báo. Journal ghi tin nhắn và câu trả lời của các session `hq-*` do UI khởi tạo; session thường chỉ để lại metadata (task, start/end), không có nội dung.
- Mọi đoạn text đi qua bộ che secret trước khi ghi (`sk-ant-`, `ghp_`, `AKIA`, `token: …`, `password=…`, `"api_key":"…"`, PEM…). Đây là heuristic: secret không có tên và không có dạng quen thuộc thì **không** bị che. Đừng coi journal là nơi an toàn cho secret.
- Journal xoay vòng ở 5 MB (giữ `events.1.jsonl`); `hq.db` và `channel-*.json` không tự hết hạn.
- Tắt: `8sync hq ui --off` (ngừng ghi, file cũ vẫn còn).
- Xoá hết: `8sync hq purge` (chỉ liệt kê), rồi `8sync hq purge --yes` (xoá `events*.jsonl`, `hq.db*`, `channel-*.json`). Tắt UI trước.

## 6. Bảo mật có sẵn

- **Guard** (trước mỗi Bash/Edit/Write):
  - chặn xoá root/home/project, wipe đĩa, force-push, in hoặc upload credential, ghi file `.env`/key;
  - hỏi trước `reset --hard`, `curl | sh`, xoá ngoài project.
  - Guard **fail-closed**: nếu guard lỗi thì lệnh bị chặn chứ không chạy bừa.
- **Hỏi trước khi ship**: push lên `main`/`master`, push tag, `gh pr merge`, `gh release create`, `vercel --prod`, `… publish`, `fly/wrangler/firebase deploy`, push tới remote `encore`. Việc thường (push nhánh, mở PR, build) không bị hỏi.
- **Nhớ qua /compact**: đầu phiên, sau `/clear`, `/compact` hoặc resume, Claude nhận lại STATE + bài học của repo; sau /compact và resume còn có thêm yêu cầu gần nhất và checklist task của chính session đó.
- **Stop gate**: không cho kết thúc lượt khi còn việc dở hoặc build đang hỏng, nhưng nhường khi anh nói "dừng/stop/chờ".
  - Claude dừng lặng lẽ mà task list còn task chưa xong → bị chặn một lần, kèm danh sách task dở. Claude hỏi anh, hoặc đang chờ thứ chỉ anh cung cấp được, thì vẫn dừng bình thường.
  - Lượt bị đứt vì lỗi API (rate limit, quá tải, lỗi server…) → có popup báo. Anh chỉ cần gõ "tiếp" trong session đó: Claude được nhắc kiểm task list và làm nốt.
  - Hết hạn mức usage claude.ai giữa chừng → session đang mở tự chờ tới giờ reset rồi làm tiếp (kit bật sẵn `autoContinueAtUsageLimit`; tắt trong `/config` → "Continue automatically at usage limit"). Cần để session mở; không áp dụng cho `-p`, session nền, hay hạn mức tuần reset sau hơn 24 giờ. Muốn làm tiếp ngay: `/usage-credits`. Kit **không** tự đổi sang account khác: dùng nhiều account để né hạn mức là vi phạm Usage Policy.
- **Verify hook**: tự `cargo check` / `tsc` / `go vet` sau mỗi lần sửa file.
- **Policy cho org**: `8sync ccc policy --org-uuid <uuid> --out policy.json`, rồi cài bằng lệnh `sudo install` mà lệnh in ra.
- **Gỡ 8sync**: chạy `8sync ccc kit --remove` trước, nếu không guard (fail-closed) sẽ chặn mọi lệnh. Lệnh chỉ bỏ hook của 8sync (hook của anh giữ nguyên, kể cả khi chung nhóm), không ghi gì nếu không có gì để bỏ, và để bản sao lưu `~/.claude/settings.json.bak-8sync`.
  - **Nếu binary `8sync` đã mất** (guard chặn mọi lệnh): sửa tay `~/.claude/settings.json`. Trong `hooks`, xoá các mục có `command` là `8sync` (hoặc `args` là `["ccc","hook",…]` / `["hq","hook",…]`); nhóm nào chỉ còn mục của 8sync thì xoá cả nhóm, nhóm có hook của anh thì giữ lại. Sửa bằng editor, không cần Claude Code. Nếu vẫn bị chặn, đổi tên `~/.claude/settings.json` rồi mở lại Claude Code.

## 7. Luật dùng Claude (tóm tắt — `/rules` để có điều khoản chính xác)

- Subscription (Pro/Max/Team) chỉ dùng **trong Claude Code / claude.ai chính chủ**, cho mức dùng cá nhân thông thường. Tool hay bot khác thì dùng **Console API key**.
- Không proxy, không giả client, không chia sẻ token, không decompile Claude Code.
- Nhiều account của chính mình (công việc / cá nhân) thì được: mỗi account một `CLAUDE_CONFIG_DIR`. Xoay account khi hết hạn mức thì **không**.
- Không dán secret vào chat. Lỡ dán thì **rotate ngay**.
- Agent nói chuyện với người ngoài phải công bố là AI.

## 8. Khi gặp sự cố

| Triệu chứng | Làm gì |
|---|---|
| `encore run`: "docker daemon is not running" | Podman: `systemctl --user enable --now podman.socket`; `DOCKER_HOST` đã có trong `~/.bashrc` |
| Session trên UI đứng yên | Mở terminal của session trên UI: thường là Claude đang hỏi (trust folder, permission) |
| Mọi lệnh Bash trong Claude Code bị chặn | Có thể 8sync bị gỡ mà hook còn: cài lại `8sync`, hoặc `8sync ccc kit --remove` |
| Muốn xem lại hook/kit | `8sync ccc status`, `/harden` |

## Bản quyền

8sync là source-available theo PolyForm Noncommercial 1.0.0: học, dự án cá nhân, nghiên cứu, trường học, tổ chức từ thiện, cơ quan nhà nước dùng miễn phí. Dùng ở công ty, làm cho khách hoặc làm sản phẩm/dịch vụ thu tiền cần license thương mại, xem [`COMMERCIAL.md`](../COMMERCIAL.md). Các bản tới v0.98.4 vẫn là MIT. Ủng hộ: https://github.com/sponsors/8syncdev.
