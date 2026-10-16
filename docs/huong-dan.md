# Hướng dẫn dùng 8sync + Claude Code (ccc)

Nhanh trong terminal: `8sync guide`. File này là bản đầy đủ.

**Nguyên tắc:** chỉ dùng Claude Code chính chủ với login của anh. 8sync không giữ, không chuyển tiếp OAuth token. Mọi thứ chạy local trên máy.

---

## 1. Cài và cập nhật

```bash
curl -fsSL https://8-sync-dev.github.io/su-code/install | sh      # lần đầu (Linux/macOS)
# Windows PowerShell: irm https://8-sync-dev.github.io/su-code/install.ps1 | iex
8sync up            # cập nhật 8sync (kiểm sha256)
8sync ccc kit       # cài hoặc cập nhật kit vào ~/.claude: agents, /ship, hook, guard, stop gate
8sync ccc status    # kiểm: claude, login, kit 28/28, managed settings, MCP
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
- `--json` có ở `ls` và `ccc . ls` cho script.

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
| `deep-research` | Nghiên cứu có trích nguồn (verifier + reviewer) |

Agent có sẵn trong kit: `explore`, `task`, `quick-task`, `reviewer`, `designer`, `pm`, `architect`, `qa`, `researcher`, `verifier`. Mỗi agent chạy model hợp với vai: Haiku cho việc dò, Sonnet cho việc làm và review.

## 4b. Team agent trong một session: `--team`

```bash
8sync ccc . lead --team            # session "lead" có agent teams (lead + teammate)
8sync ccc . lead --team --panes    # teammate hiện thành pane tmux riêng (chạy trong tmux)
```

- Bảo lead tạo team, ví dụ: *"Spawn 3 teammates: backend (agent task), qa (agent qa), reviewer (agent reviewer); mỗi người giữ một nhóm file riêng."* Teammate dùng được các agent của kit (`pm`, `architect`, `qa`, `reviewer`, `task`…).
- Phím trong session: ↑/↓ chọn teammate · Enter mở để nhắn trực tiếp · `x` dừng teammate · Ctrl+T xem task list.
- Giới hạn (theo docs Claude Code):
  - chỉ chạy ở phiên tương tác, không chạy với `-p`;
  - một team cho mỗi session;
  - `/resume` không khôi phục teammate;
  - chi phí tăng theo số teammate, nên dùng 3–5;
  - chia file rõ ràng để teammate không sửa trùng nhau.
- Khác với **nhiều session** (`8sync ccc . a`, `8sync ccc . b`): các session riêng nhắn nhau qua `SendMessage` và hiện trên `8sync hq ui`. Team thì nằm gọn trong một session.
- **Tên session là phòng ban.** Đặt tên có nghĩa: `rd`, `qa`, `ui`, `api`, `ops`, `docs`, `sec`, `critic`, `lead`, `core`. Tên khác cũng được, khi đó chính cái tên là chủ đề của phòng. Lúc mở session, kit báo cho Claude ba thứ: vai của phòng, ≤5 dòng memory theo chủ đề tên, và "Phòng khác đang làm" (session khác cùng repo hoạt động trong 2 giờ qua: việc đang làm, file đang sửa) để không sửa trùng file.
- **Không ai rảnh** (`8sync ccc idle on`, mặc định tắt): teammate R&D (tên `rd`, `research…`, `explore…`) hết việc thì tự `/deep-research` câu hỏi mở đầu tiên trong `su-code/STATE.md` → brief trong `su-code/research/` → plan, rồi hỏi anh MỘT bảng câu hỏi có option Recommended. Trên gói subscription chỉ chạy khi anh có mặt (lease), có trần $/giờ.
- **Critic chọn thay anh** (`8sync ccc delegate on`, mặc định tắt): câu hỏi sản phẩm/kỹ thuật không tới anh nữa. Agent `critic` chấm option (FATAL/MAJOR/MINOR), chọn một, ghi vào `su-code/DECISIONS.md`. Những câu vẫn hỏi anh: câu `Ship`, secret/đăng nhập, xoá/không hoàn tác, tiền, deploy prod, merge/release, quyết định high-risk. Tắt: `8sync ccc delegate off`.

## 5. Team trên web local: `8sync hq ui`

```bash
8sync hq ui            # mở http://127.0.0.1:8740 (cần node ≥ 22.5)
8sync hq ui --update   # tải lại bản UI của đúng phiên bản 8sync đang dùng
```

Không cần clone repo, không cần pnpm. Lần chạy đầu 8sync tải `8sync-hq-ui-v<phiên bản>.tar.gz` (~4 MB) từ GitHub Releases, kiểm sha256 (sai là từ chối cài), giải nén vào thư mục data của nền tảng (`~/.local/share/8sync/hq-ui/<phiên bản>/` trên Linux) rồi chạy bằng `node`. Các lần sau dùng bản đã cài, không cần mạng. Cần `curl` và `tar`. Đã kiểm trên Linux; macOS và Windows **chưa kiểm** (Windows 10+ có sẵn `curl`/`tar` nhưng đường cài này chưa chạy thử ở đó). File `.sha256` nằm cùng release với tarball nên chỉ kiểm tính toàn vẹn (file hỏng/thiếu), không phải nguồn tin cậy độc lập; nếu GitHub API có digest của asset thì 8sync đối chiếu thêm. Bản dev: `--app <thư mục>` hoặc `EIGHTSYNC_HQ_UI_APP` (chạy `pnpm start` trong thư mục đó; `--update` bị bỏ qua và có cảnh báo).

1. **Add project folder**: đường dẫn tuyệt đối tới repo.
2. **Sessions → Start**: đặt tên, ví dụ `api`. UI chạy Claude Code chính chủ trong `tmux` (tên `hq-api`), đúng thư mục dự án.
3. **Lần đầu mở một thư mục**, Claude Code hỏi "trust this folder". Mở **terminal** của session trên UI rồi bấm phím trả lời (Enter / ↑ ↓ / 1 2 3), hoặc `tmux attach -t hq-api`.
4. **Team chat**: chọn session rồi nhắn. Tin được gõ vào terminal của session (nhãn "via terminal"). Câu trả lời của Claude hiện lại trong chat ("from terminal").
5. **Board**: task do Claude tạo (TaskCreate) tự lên cột todo / doing / done, kèm vai `[be]`/`[fe]`/`[qa]`. "Add task" giao việc cho một session.
6. **Nhiều session giúp nhau**: Claude Code có `SendMessage` giữa các session trên cùng máy. Tin session A → B hiện trong Team chat dạng "A → B".

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
- **`8sync ccc auto on` áp dụng cho cả máy**: mọi session ở mọi dự án, kể cả session mở sau, cho tới khi lease hết hạn hoặc `auto pause`/`auto off`. Chỉ muốn một dự án: `cd` vào dự án đó rồi chạy `8sync ccc auto on --here --hours 4`; session ở dự án khác vẫn hỏi anh như thường. Thư mục con và worktree trong repo được tính là cùng dự án. `auto status` cho biết đang chạy "mọi dự án" hay "chỉ dự án …".
- **Mọi phòng chạy liên tục bằng một lệnh**: `8sync ccc auto on --here --hours 4 --loop 10m --team`. Lệnh gửi vào inbox của từng phòng trong dự án một yêu cầu tự đặt loop (CronCreate, giống `/loop 10m`) theo vai của phòng: lead điều phối, rd `/deep-research`, các phòng khác làm việc kế trong `su-code/STATE.md` rồi `8sync ccc meet --say`. `--team` thêm việc lấp ghế rd, qa, reviewer cho phòng mở bằng `--team`. Mỗi nhịp, loop chạy `8sync ccc auto status --json` trước và tự xoá khi anh `auto off`/`auto pause` hoặc chạm trần $/giờ; lease hết hạn không dừng loop (đây là cron chính chủ của Claude Code, tự hết hạn sau 7 ngày), hết usage thì kit (`autoContinueAtUsageLimit`) cho chạy tiếp sau khi reset. Phòng chưa nạp mod inbox nhận yêu cầu khi xong lượt kế. Loop chỉ chạy khi phòng đang mở trong terminal; tắt máy là dừng.
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
| Máy lag / CPU cao do codebase-memory-mcp | `8sync harness cbm off` (gỡ khỏi Claude Code + omp mcp.json, không tự kill; dừng tiến trình: `pkill -f codebase-memory-mcp`). Mặc định đã TẮT; bật lại: `8sync harness cbm on` hoặc `EIGHTSYNC_CBM=1` |
