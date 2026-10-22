# Hướng dẫn dùng 8sync + Claude Code (ccc)

Nhanh trong terminal: `8sync guide`. File này là bản đầy đủ.

**Nguyên tắc:** chỉ dùng Claude Code chính chủ với login của anh. 8sync không giữ, không chuyển tiếp OAuth token. Mọi thứ chạy local trên máy.

---

## Auto mạnh nhất, bản ngắn

**Một thư mục dự án, làm theo thứ tự. Chỉ bước 1 cần gõ lệnh, còn lại bấm nút trên web:**

| # | Làm gì | Trong HQ | Hoặc lệnh trong terminal |
|---|---|---|---|
| 1 | Mở HQ (để nguyên terminal đó). Ở xa máy (điện thoại): thêm `--public` để có link internet đăng nhập một lần | — | `8sync hq ui` → http://127.0.0.1:8740 · `8sync hq ui --public` |
| 2 | Thêm thư mục repo. Lần đầu: mở `claude` trong thư mục đó một lần, chấp nhận câu hỏi trust | **Projects** → dán đường dẫn | — |
| 3 | Mở team: lead, dev, qa, review, rd chạy nền trong thư mục đó | **Mở team** (hoặc **Team đầy đủ**: 6 phòng, 3 phòng code: lead, dev, dev2, ui, qa, review) | `cd du-an && 8sync ccc auto up` (`--roles full`) |
| 3b | Thêm đội omp: cùng các vai, phòng tên `omp-<vai>` chạy model của omp; hai đội chung board, inbox và nhắn nhau | công tắc **Đội omp** | `8sync ccc auto up --omp` · tắt: `8sync ccc auto omp off` |
| 4 | Giao việc: viết việc + lệnh chứng minh xong (exit 0) | **Giao việc** góc trên | `8sync ccc auto add "<việc>" --check "<lệnh>"` |
| 5 | Theo dõi card đi qua các cột; việc gấp thì đặt ưu tiên (P0 gấp nhất, phòng nhận trước); card Done bấm vào mở sheet (PR, SHA đã duyệt, bằng chứng merge/release, lịch sử) | tab **Board** → bấm card → chọn P0/P1/P2/P3 | `8sync ccc auto board` · `8sync ccc auto prio <id> P0` |
| 6 | Trả lời việc cần anh. Câu sản phẩm/kỹ thuật thì critic (Opus) chọn ngay (mặc định bật; `auto on --after N` để chờ anh N giây trước), xin quyền thì việc an toàn trong repo tự chạy tiếp; merge/release/secret/ngoài repo luôn chờ anh | khung **Anh cần trả lời** đầu trang: chọn đáp án, **Cho phép / Từ chối**, hoặc **Mở terminal để trả lời** | `claude attach <id>` |
| 7 | Sau `8sync up`: cho cả team chạy bản mới (giữ hội thoại) | **Dọn & mở lại** | `8sync ccc auto up --clear-ss` |
| 8 | Dừng team (giữ hội thoại) | **Dừng team** | `8sync ccc auto down` |
| 9 | Card approved chờ Ship: bấm một phát trên cột Approved của Board — có câu Ship của lead thì nút là **Duyệt tất cả** (trả lời đúng option đó), chưa có thì **Ship tất cả** nhắc lead hỏi ngay | cột **Approved** | `8sync ccc auto ship-fast ship-ask` |
| 10 | Một team làm mọi dự án trên máy: phòng hết card ở dự án mình thì `claim`/`wait` lấy card gấp nhất ở dự án khác trong scope (card về kèm root + lệnh `env -C`) | — | `8sync ccc auto up --company` |
| 11 | Bài học dùng được ở mọi dự án (công cụ, hook, cách làm) ghi vào cây tri thức của máy; đầu phiên mỗi phòng đọc dự án mình trước rồi 3 dòng cuối của từng dự án khác dưới root của nó; chuyện riêng của khách KHÔNG vào đây | tab **Tri thức** | `8sync ccc know add "<bài học>"` · `know ls [--all]` |
| 12 | Văn phòng 3D (WebGL): mỗi dự án một sàn, mỗi phòng một bàn, màu = trạng thái; three.js chỉ nạp khi mở tab | tab **3D** | — |

Tạm dừng / chạy tiếp auto: nút **Tạm dừng / Chạy** trên cùng (`8sync ccc auto pause` / `on`).

**Tắt/bật là đủ, còn lại trên HQ:** `8sync ccc auto up` / `down` (team), `--omp` (đội 2), `pause` / `on`, `8sync hq ui [--public]`, phanh khẩn `8sync ccc cancel --all`.

- **Phòng kẹt tự gỡ** (khi auto bật): dừng vì lỗi API tạm thời (`overloaded`, `server_error`) → tự thử lại sau 1, 2, 4… phút (≤ 15 phút, tối đa 5 lần liền); hết usage → tự chạy lại đúng giờ reset mà status line báo (tối đa 2 lần liền, không chờ quá 24 giờ, giống `autoContinueAtUsageLimit` của Claude Code); lỗi đăng nhập/billing → HQ ghi "cần anh xử lý". 8sync chỉ đọc usage từ status line, không đọc token đăng nhập.
- **Tắt máy khi auto còn bật**: phòng nền chết theo máy. Mở máy, mở HQ: phòng chết tự chạy lại nền (cùng hội thoại) trong ≤ 2 phút nếu lease còn hạn; lease hết (qua đêm) thì bấm **Chạy** một lần là cả team chạy tiếp. Tay: `8sync ccc auto revive`.
- **Giữ máy thức khi phòng chạy**: `8sync awake --while-rooms` — máy không ngủ, tự nhả khi không còn phòng nào chạy, tối đa 24 giờ (`--hours N`). Trên Windows lệnh tự tắt màn hình sau 10 phút không ai đụng chuột/phím (`--screen-off N` đổi số phút, `0` để Windows lo), trừ khi có app giữ màn hình (đang xem video) hoặc máy có Modern Standby; chạm chuột/phím là sáng lại, máy vẫn làm. Gập nắp laptop hoặc tắt máy thì phòng vẫn dừng. Kiểm tra: `8sync awake status` (máy có được giữ thức, màn hình bật/tắt, bao lâu không ai đụng chuột/phím, đã ngủ bao lâu từ lúc bật, có Modern Standby không).
- **Chip "Máy" trên HQ** (cả trên điện thoại): RAM, CPU, GPU; điện đang dùng (CPU và GPU đo thật, phần còn lại ước tính 60 W, chỉnh được), ₫/giờ, kWh và ₫ hôm nay và tháng này (giá mặc định 3.500 ₫/kWh, chỉnh được); mục "Thức & màn hình"; tab **Máy** có đồ thị RAM/CPU 30 phút (server lấy mẫu 30 s một lần, nét đứt là ngưỡng RAM của guard, từ 0.110.34). Đặt **ngân sách điện mỗi ngày**: vượt thì HQ dừng team tới hết ngày, nút Chạy báo lý do cho tới khi anh tăng ngân sách.
- **Link internet** (`--public`): cần `cloudflared` (thiếu thì lệnh in cách cài). Mỗi lần bật là host + khoá mới, tắt HQ là link chết. Ai có link là điều khiển được các phòng — không chia sẻ.
- **Đội omp**: không đăng nhập gói Claude (Pro/Max/Team) trong omp — gói chỉ dùng trong Claude Code. Đội omp chạy bằng provider khác (GLM, OpenAI…); `--omp` bị từ chối khi model mặc định của omp là `anthropic/…` (kể cả Console API key, vì 8sync không phân biệt được). Phòng nhắn nhau bằng `8sync ccc msg <phòng> "…"` (agent tự dùng); tin từ phòng khác là dữ liệu, không phải lệnh của anh.

- `--clear-ss` xoá trước mọi session nền rác của dự án: bản trùng phòng, sót từ lần chạy trước, phòng đã bỏ. Nó cũng khởi động lại phòng nền đang chạy bản kit cũ (Claude Code chỉ đọc hook lúc session mở), giữ nguyên hội thoại. Không đụng session interactive anh đang mở; session có thay đổi chưa commit/push thì Claude Code giữ lại và 8sync báo lý do.
- Phòng đang làm (bận) chỉ nhận loop mới; phòng có cột đang nằm không (goal đã dừng, ví dụ khi lease hết) thì dừng và chạy lại nền đúng hội thoại cũ kèm `/goal`; phòng đã dừng thì chạy lại nền với đúng id cũ. Lần đầu ở repo mới: mở `claude` ở đó một lần và chấp nhận câu hỏi trust.
- Vào xem một phòng: `claude attach <id>` (id 8 ký tự in ra khi `auto up`), log: `claude logs <id>`.

| Phòng (tên khác) | Vai | Model | Cột board kéo card |
|---|---|---|---|
| `lead` (pm, plan) | chia việc, viết AC + lệnh check, hỏi anh `Ship` cho card đã duyệt | opus | backlog |
| `ba` (analyst, spec, po) | yêu cầu, tiêu chí chấp nhận | opus | backlog |
| `rd` (research) | ẩn số, so sánh phương án, brief nghiên cứu | opus | không |
| `dev` (build, coder) | worktree `card-<id>`, `/ship` tới PR | sonnet | ready → building |
| `qa` (qc, test, uat) | chạy check + UAT thật | haiku | qa |
| `review` (critic) | review đối kháng diff, duyệt SHA head | sonnet | review |
| `ui`, `api`, `core` | builder chuyên mảng | mặc định | ready |
| `ops`, `docs`, `sec` | mảng của mình | mặc định | không |

Team mặc định `lead,dev,qa,review`; tự chọn: `--roles lead,ba,dev,dev2,qa,review` (tối đa 9). **⚡ Sấm Sét** `--roles boost`: 9 phòng — lead, 5 phòng code (dev…dev4, ui), 2 phòng QA (qa, qa2), review; tốn quota ~9× một phiên.

**Không phòng nào ngồi rảnh:**
- Phòng có cột board mở bằng `/goal` chính chủ của Claude Code. Mỗi lượt phòng claim → làm → chuyển cột, rồi tự sang lượt kế, không chờ nhịp loop.
- Cột trống thì phòng chạy `8sync ccc auto wait`. Lệnh này chặn và không tốn token cho tới khi có card, nên phòng nhận việc gần như ngay.
- Goal chỉ dừng khi auto tắt, tạm dừng, chạm trần (cửa sổ dùng ≥ 90%), hoặc khi lease subscription hết (≤ 4 giờ). Anh bấm **Chạy liên tục** lại thì trong ≤ 2 phút HQ (`auto revive`) chạy lại `/goal` cho phòng có cột còn nằm không (phải thấy nằm không ở hai lần kiểm cách nhau ≥ 1 phút, inbox trống).

**Board kiểu [super-board](https://github.com/EricTechPro/super-board):** `backlog → ready → building → qa → review → approved (chờ Ship) → done`, thêm `blocked`. Mỗi phòng `claim` card đầu cột của mình rồi `move` sang cột kế:

- `ready` cần lệnh check, `approved` cần SHA đã review.
- Card bị trả về quá 2 lần thì sang `blocked`; claim im 2 giờ thì phòng khác lấy lại.
- Merge chỉ sau khi anh trả lời `Ship` (lead chạy `gh pr merge --squash --match-head-commit <sha>`); cột Approved trên HQ có nút **Ship tất cả / Duyệt tất cả** để trả lời một phát.
- Xem: `8sync ccc auto board`; việc cần lead/anh: `8sync ccc auto lint`.

**Tự mở từng phòng (cách cũ, vẫn dùng được):**

1. **Mở phòng** trong repo, tên theo vai: `8sync ccc . lead` (muốn nhiều phòng thì mở thêm `api`, `qa`, `rd`… ở terminal khác). Từ v0.98.4 session luôn mở ở auto mode: cờ `--dangerously-skip-permissions` của launcher (Orca…) bị Claude Code từ chối.
2. **Giao việc theo mức**, gõ trong Claude Code:

| Mức | Gõ | Chạy tới đâu | Còn cần anh |
|---|---|---|---|
| 1 | `/do <việc>` | sửa ≤ 3 file, không plan, không commit | xem diff, commit |
| 2 | `/ship <việc>` | plan → R&D → code → test → UAT → review → CHANGELOG + memory → commit | push (nó không push) |
| 3 | `/ship-auto <việc>` | như `/ship`, rồi PR → CI xanh 3 OS → merge → tag → release | trả lời một câu `Ship` |
| 4 | `/ship-loop <mục tiêu>` | lặp tới khi mọi lệnh kiểm exit 0 (trần 12 vòng, 90 phút, hoặc kẹt cùng lỗi 2 lần) | khi chạm trần, hoặc lúc release |
| 5 | `/autopilot` | tối đa 5 item hoặc 8 giờ từ backlog (issue có label `ccc`/`8sync`, mục Next trong `su-code/STATE.md`, failure chưa có guard), mỗi item một loop + một nhánh | một câu `Ship` cho cả batch |

   Mức 3–5 chỉ anh khởi động; agent không tự gõ được.
3. **Bật cả dự án chạy liên tục**: `8sync ccc auto on --here --loop 30m --team`. Giao đích: `8sync ccc auto add "<việc>" --check "<lệnh kiểm>"` (gấp thì thêm `--now`), hoặc nói trong phòng "đưa vào loop: …" / "làm ngay: …". Xem hàng: `8sync ccc auto queue`. Dừng: `8sync ccc auto pause` (hoặc `auto off`, `8sync ccc cancel`).

Không mở terminal: `claude -p "/autopilot --max-items 5 --hours 8" --permission-mode auto --permission-prompts none --max-budget-usd 20`. Chạy headless không trả lời được câu `Ship`, nên dừng trước merge và để lại brief. Trên subscription, auto giữ lease ≤ 4 giờ và chỉ chạy khi anh có mặt; phòng nghỉ nhịp khi cửa sổ 5 giờ/7 ngày dùng ≥ 90%. Chạy nhiều ngày không người trông thì dùng Routines (`/schedule`) hoặc Console API key. Chi tiết ở mục 4 và 6.

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
- **Không ai rảnh** (`8sync ccc idle on`, mặc định tắt): teammate R&D (tên `rd`, `research…`, `explore…`) hết việc thì tự `/deep-research` câu hỏi mở đầu tiên trong `su-code/STATE.md` → brief trong `su-code/research/` → plan, rồi hỏi anh MỘT bảng câu hỏi có option Recommended. Trên gói subscription chỉ chạy khi anh có mặt (lease), nghỉ khi cửa sổ 5 giờ hoặc 7 ngày đã dùng 90%.
- **Critic chọn thay anh** (`8sync ccc delegate on`, mặc định BẬT từ 0.110.38 khi `auto on`; công tắc "Critic trả lời ngay" ở Văn phòng HQ): câu hỏi sản phẩm/kỹ thuật không tới anh nữa. Agent `critic` chấm option (FATAL/MAJOR/MINOR), chọn một, ghi vào `su-code/DECISIONS.md`. Những câu vẫn hỏi anh: câu `Ship`, secret/đăng nhập, xoá/không hoàn tác, tiền, deploy prod, merge/release, quyết định high-risk. Tắt: `8sync ccc delegate off`. Phòng kẹt câu hỏi không ai bắt được (hỏi lúc chưa có kit) → lead nhận tin và trả lời qua `8sync ccc msg`; lead kẹt câu rails → HQ báo thẳng anh một câu (0.110.36–38).

## 5. Team trên web local: `8sync hq ui`

```bash
8sync hq ui            # mở http://127.0.0.1:8740 (cần node ≥ 22.5)
8sync hq ui --update   # tải lại bản UI của đúng phiên bản 8sync đang dùng
```

Không cần clone repo, không cần pnpm. Lần chạy đầu 8sync tải `8sync-hq-ui-v<phiên bản>.tar.gz` (~9 MB) từ GitHub Releases, kiểm sha256 (sai là từ chối cài), giải nén vào thư mục data của nền tảng (`~/.local/share/8sync/hq-ui/<phiên bản>/` trên Linux) rồi chạy bằng `node`. Các lần sau dùng bản đã cài, không cần mạng. Cần `curl` và `tar`. Đã kiểm trên Linux; macOS và Windows **chưa kiểm** (Windows 10+ có sẵn `curl`/`tar` nhưng đường cài này chưa chạy thử ở đó). File `.sha256` nằm cùng release với tarball nên chỉ kiểm tính toàn vẹn (file hỏng/thiếu), không phải nguồn tin cậy độc lập; nếu GitHub API có digest của asset thì 8sync đối chiếu thêm. Bản dev: `--app <thư mục>` hoặc `EIGHTSYNC_HQ_UI_APP` (chạy `pnpm start` trong thư mục đó; `--update` bị bỏ qua và có cảnh báo).

1. **Add project folder**: đường dẫn tuyệt đối tới repo.
2. **Sessions → Start**: đặt tên, ví dụ `api`. UI chạy Claude Code chính chủ trong `tmux` (tên `hq-api`), đúng thư mục dự án.
3. **Lần đầu mở một thư mục**, Claude Code hỏi "trust this folder". Mở **terminal** của session trên UI rồi bấm phím trả lời (Enter / ↑ ↓ / 1 2 3), hoặc `tmux attach -t hq-api`.
4. **Team chat**: chọn session rồi nhắn. Tin được gõ vào terminal của session (nhãn "via terminal"). Câu trả lời của Claude hiện lại trong chat ("from terminal").
5. **Board**: task do Claude tạo (TaskCreate) tự lên cột todo / doing / done, kèm vai `[be]`/`[fe]`/`[qa]`. "Add task" giao việc cho một session.
6. **Nhiều session giúp nhau**: Claude Code có `SendMessage` giữa các session trên cùng máy. Tin session A → B hiện trong Team chat dạng "A → B".
7. **Shell trên máy** (nút "Terminal" ở header, hoặc Ctrl+`): một terminal nổi, kéo/đổi cỡ được (trên điện thoại là khung dưới), chạy shell thật trên máy ở thư mục đang xem. Có zsh của 8sync thì có gợi ý xám (→ nhận), Tab hoàn thành, ^R tìm lịch sử; không thì PowerShell / `$SHELL`. Thanh phím Esc · Tab · mũi tên · Enter · ^C ^D ^R ^L cho điện thoại. Đóng khung shell còn 30 phút; "Tắt shell" thoát hẳn. Không mở qua link `--public` (chỉ có khoá link); mở được trên máy và qua proxy có đăng nhập riêng (ví dụ VPS + GitHub).

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
- **`8sync ccc auto on` áp dụng cho cả máy**: mọi session ở mọi dự án, kể cả session mở sau, cho tới khi lease hết hạn hoặc `auto pause`/`auto off`. Chỉ muốn một dự án: `cd` vào dự án đó rồi chạy `8sync ccc auto on --here --hours 4`; session ở dự án khác vẫn hỏi anh như thường. Thư mục con và worktree trong repo được tính là cùng dự án. `auto status` cho biết đang chạy "mọi dự án" hay "chỉ dự án …".
- **Mọi phòng chạy liên tục bằng một lệnh**: `8sync ccc auto on --here --loop 30m --team`.
  - Lệnh ghi `.claude/loop.md` (nếu chưa có; không ghi đè bản anh sửa): playbook mỗi nhịp. Nó kiểm `auto status`, lấy một việc hợp vai từ `su-code/STATE.md` (hoặc spec trong `workflows/*.md` do `/loop-me` viết), tự chọn skill (`/ship` đủ flow với karpathy-guidelines, test, review và gate `/sec` + `/rules` + `/aup-audit`; `/do`; `/deep-research`; `impeccable`; `/sysdesign`) rồi `8sync ccc meet --say`. Việc cần nhiều nhịp thì mỗi nhịp `/ship` phần kế. `/ship-loop`, `/ship-auto`, `/autopilot`, `/sprint`, `/loop-me` chỉ anh gõ: nhịp cron không gọi được skill có `disable-model-invocation`. Sửa file là đổi việc của mọi phòng từ nhịp kế; gõ `/loop` không kèm prompt trong phòng nào cũng chạy đúng file này.
  - Rồi gửi vào inbox từng phòng của dự án một yêu cầu tự đặt loop cron (CronCreate, như `/loop 30m`) theo vai phòng. `--team` thêm việc lấp ghế rd, qa, reviewer cho phòng mở bằng `--team`.
  - Loop tự xoá khi anh `auto off`/`auto pause`. Chạm trần thì phòng nghỉ nhịp đó và giữ loop:
    - Gói subscription: nghỉ khi cửa sổ 5 giờ hoặc 7 ngày (số ở status line) đã dùng 90%, phần còn lại để anh dùng; tự chạy lại khi cửa sổ reset. $ ở status line trên subscription là giá API ước tính, không phải tiền bị trừ, nên mặc định không có trần $.
    - API key, hoặc anh đặt `--usd-per-hour X`: trần $/giờ (API key mặc định 5), tính trung bình từ lúc bật kể cả khi lease đã hết, tự hạ khi thời gian trôi. Với `--here` chỉ tính session của dự án đó, không cộng session của dự án khác trên máy.
    - Trần chỉ đo được khi status line của 8sync bật (`8sync ccc statusline --install`); chưa có số cửa sổ nào thì subscription dùng tạm trần $5/giờ.
    - Bật từ bản cũ hơn: lease giữ trần $5/giờ cũ tới khi anh chạy lại `8sync ccc auto on …`.
  - Lease không dừng loop. Claude Code tự xoá loop sau 7 ngày: chạy lại lệnh để gia hạn.
  - Loop chỉ chạy khi phòng còn sống. Gõ `/bg` trong phòng để chuyển sang chạy nền (không cần terminal; tắt máy là dừng), mở `claude agents` để xem, `Ctrl+T` để ghim.
  - Hết usage: phòng mở **trong terminal** tự chờ reset rồi chạy tiếp (`autoContinueAtUsageLimit`, tối đa 2 lần liên tiếp; gặp hỏi quyền thì dừng chờ). Phòng nền (`auto up`, `/bg`) không có chế độ chờ đó của Claude Code: 8sync ghi giờ reset lúc phòng dừng và đưa `[8sync:resume]` vào phòng đúng giờ (khi auto bật, lease còn, cửa sổ < 90%); phòng chết vì tắt máy thì `auto revive` (HQ tự gọi) mở lại.
  - Login subscription: loop là scheduler có sẵn của Claude Code chạy trong phòng anh mở, cho mức dùng thường. Chạy không người trông nhiều ngày hoặc 24/7 thì dùng đường Claude Code viết cho việc này: Routines (`/schedule`, chạy trên cloud, tối thiểu 1 giờ, tính vào usage) hoặc Desktop scheduled task (chạy local khi app Desktop mở và máy thức); tool khác thì Console API key. N phòng tiêu quota nhanh gần N lần.
  - Trước khi dùng Routines: run tự động hoàn toàn, không hỏi quyền, dùng mọi connector được thêm kể cả ghi. Run là clone mới trên cloud nên không có rail của 8sync (hàng đích, idle, delegate, các câu vẫn hỏi anh). Viết prompt tự đủ, chỉ chọn repo/connector cần, khoá nhánh bằng branch protection. `/schedule` cần login claude.ai ([routines](https://code.claude.com/docs/en/routines)).
  - Phòng chưa nạp mod inbox nhận yêu cầu khi xong lượt kế.
- **Giao đích cho cả team (hàng chờ như khi gõ lúc agent bận)**:
  - `8sync ccc auto on --here --loop 30m --team --target "<đích>" --check "<lệnh kiểm>"`: bật auto kèm đích đầu hàng.
  - `8sync ccc auto add "<việc>" [--check "<lệnh>"] [--prio P0..P3]`: thêm vào cuối hàng. Card có `--prio P0` được phòng nhận trước mọi card khác (chưa đặt = P2; đổi sau bằng `8sync ccc auto prio <id> P1`).
  - `8sync ccc auto add --now "<việc>"`: giống `ctrl+x ctrl+s` của Claude Code nhưng cho cả dự án. Việc lên đầu hàng và vào inbox của lead/ba (dự án chưa có team: mọi phòng); phòng nhận ngay khi rảnh, phòng đang `auto wait` thức dậy nhận trong vài giây, lượt đang chạy không bị cắt ngang.
  - Trong phòng nào cũng chỉ cần gõ "đưa vào loop: …" hoặc "làm ngay: …", Claude tự chạy lệnh trên (luật kit).
  - Có team (`auto up`): lead/ba tách đích thành card, mỗi phòng chỉ làm card claim được đúng vai. Không team: mỗi nhịp mọi phòng làm phần hợp vai cho đích đầu hàng: lead chia việc, dev `/ship`, qa chạy `check`, reviewer review, rd gỡ chỗ kẹt. Đạt (lệnh `check` exit 0, hoặc có bằng chứng chạy được) thì một phòng chạy `8sync ccc auto done <id> --evidence "<lệnh: kết quả>"` và cả team sang đích kế (ý của owner chỉ lead/ba nghiệm thu). Hết hàng thì quay về `.claude/loop.md` (`STATE.md` Next).
  - `8sync ccc auto queue` xem hàng (▶ đang làm, ✓ xong kèm bằng chứng, ✗ đã bỏ). `8sync ccc auto drop <id>` bỏ một đích. `auto status` in đích hiện tại.
  - CI/CD trên máy release, GitHub chỉ lưu code: `8sync ccc auto ci local` (trong repo) tắt GitHub Actions của repo; `auto status` báo `ci: local` và các phòng lấy gate local mỗi head SHA làm CI, không chờ GitHub. Bật lại: `8sync ccc auto ci github`. Card của team ghi changelog vào `changelog.d/card-<id>.md` (không sửa `CHANGELOG.md`, chỗ mọi PR từng conflict), gộp vào `CHANGELOG.md` lúc release.
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

## Bản quyền

8sync là source-available theo PolyForm Noncommercial 1.0.0: học, dự án cá nhân, nghiên cứu, trường học, tổ chức từ thiện, cơ quan nhà nước dùng miễn phí. Dùng ở công ty, làm cho khách hoặc làm sản phẩm/dịch vụ thu tiền cần license thương mại, xem [`COMMERCIAL.md`](../COMMERCIAL.md). Các bản tới v0.98.4 vẫn là MIT. Ủng hộ: https://github.com/sponsors/8syncdev.
