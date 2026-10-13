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
8sync ccc status    # kiểm: claude, login, kit 19/19, managed settings, MCP
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

## 4. Giao việc trọn gói trong Claude Code

| Lệnh | Dùng khi |
|---|---|
| `/ship <việc>` | Làm trọn một feature hoặc bug: explore → plan → làm + test → reviewer → CHANGELOG → commit (không push) |
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
- **Stop gate**: không cho kết thúc lượt khi còn việc dở hoặc build đang hỏng, nhưng nhường khi anh nói "dừng/stop/chờ".
- **Verify hook**: tự `cargo check` / `tsc` / `go vet` sau mỗi lần sửa file.
- **Policy cho org**: `8sync ccc policy --org-uuid <uuid> --out policy.json`, rồi cài bằng lệnh `sudo install` mà lệnh in ra.
- **Gỡ 8sync**: chạy `8sync ccc kit --remove` trước, nếu không guard (fail-closed) sẽ chặn mọi lệnh. Lệnh chỉ bỏ hook của 8sync (hook của anh giữ nguyên, kể cả khi chung nhóm), không ghi gì nếu không có gì để bỏ, và để bản sao lưu `~/.claude/settings.json.bak-8sync`.
  - **Nếu binary `8sync` đã mất** (guard chặn mọi lệnh): sửa tay `~/.claude/settings.json`. Trong `hooks`, xoá các mục có `command` là `8sync` (hoặc `args` là `["ccc","hook",…]` / `["hq","hook",…]`); nhóm nào chỉ còn mục của 8sync thì xoá cả nhóm, nhóm có hook của anh thì giữ lại. Sửa bằng editor, không cần Claude Code. Nếu vẫn bị chặn, đổi tên `~/.claude/settings.json` rồi mở lại Claude Code.

## 7. Luật dùng Claude (tóm tắt — `/rules` để có điều khoản chính xác)

- Subscription (Pro/Max/Team) chỉ dùng **trong Claude Code / claude.ai chính chủ**, cho mức dùng cá nhân thông thường. Tool hay bot khác thì dùng **Console API key**.
- Không proxy, không giả client, không chia sẻ token, không decompile Claude Code.
- Không dán secret vào chat. Lỡ dán thì **rotate ngay**.
- Agent nói chuyện với người ngoài phải công bố là AI.

## 8. Khi gặp sự cố

| Triệu chứng | Làm gì |
|---|---|
| `encore run`: "docker daemon is not running" | Podman: `systemctl --user enable --now podman.socket`; `DOCKER_HOST` đã có trong `~/.bashrc` |
| Session trên UI đứng yên | Mở terminal của session trên UI: thường là Claude đang hỏi (trust folder, permission) |
| Mọi lệnh Bash trong Claude Code bị chặn | Có thể 8sync bị gỡ mà hook còn: cài lại `8sync`, hoặc `8sync ccc kit --remove` |
| Muốn xem lại hook/kit | `8sync ccc status`, `/harden` |
