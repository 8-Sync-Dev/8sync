# Loop mạnh nhất cho 8sync ccc: chạy liên tục khi owner có mặt, và đường hợp luật cho chạy không người trông

Ngày: 2026-10-16. Đọc docs code.claude.com bản live ngày này (bản Claude Code mới nhất được nhắc trong docs: v2.1.299). Không phải tư vấn pháp lý. Provenance: `outputs/loop-harness.provenance.md`.

## Kết luận

1. **Khi owner đang dùng máy, cách mạnh nhất là mỗi phòng một loop bằng scheduler có sẵn của Claude Code.** Đó là `CronCreate`, cùng cơ chế với `/loop`, kèm `.claude/loop.md` làm playbook cho mọi nhịp [1]. Mọi lượt model do binary Claude Code gốc chạy bằng login của owner [8]:55 [L1]. Lệnh một dòng:
   `8sync ccc auto on --here --loop 10m --team --usd-per-hour <N> --target "<đích>" --check "<lệnh>"` [L1].
   Lệnh này đổi các trạng thái sau trên máy [L1][L6]:
   - bật `idle` (lease + gate TaskCompleted: task sửa code chưa test thì chưa cho xong);
   - bật `delegate --after 60`: critic chọn thay owner các câu hỏi sản phẩm/kỹ thuật khi owner không gõ 60 giây;
   - ghi `auto.json` cho HQ, ghi `.claude/loop.md` nếu chưa có;
   - gửi mỗi phòng của dự án một tin inbox để phòng tự đặt cron.
   Ship, secret/login, xoá/không hoàn tác, tiền, deploy prod, merge/release và high-risk vẫn hỏi owner [L1].
2. **Chạy không người trông nhiều ngày hoặc 24/7 thì không dùng loop này.** Docs của `/loop` viết: "Use **`/loop`** for quick polling during a session". Cho tự động hoá chạy không người trông, docs chỉ 3 đường [1]:
   - Routines: cloud; chạy cả khi gập laptop; tối thiểu 1 giờ; dùng được trên Pro, Max, Team, Enterprise; tính vào usage; research preview [7];
   - Desktop scheduled task: chạy local, tối thiểu 1 phút, cần app Desktop mở và máy thức [6];
   - GitHub Actions.

   Tool khác (không phải Claude Code/claude.ai) thì dùng Console API key [8]:53. Key tính phí theo request và không có autoContinue [5]. Trên login subscription, `auto on --loop` in đúng các đường này (sửa ở PR #59, [L1] `loop_notes`).

   **Trước khi chuyển sang Routines** [7]:
   - Run tự động hoàn toàn, không có permission mode: "without stopping for approval". Mọi connector được thêm đều dùng được, "including writes, without asking for permission".
   - Các câu 8sync giữ lại để hỏi owner (Ship, secret, xoá, high-risk) không còn ở đó. Run là cloud session với clone mới, nên không có `auto.json`, inbox, hàng đích, `idle` hay `delegate`.
   - Vì vậy prompt phải tự đủ; chỉ chọn repo và connector thật cần; khoá nhánh bằng branch protection (Claude đẩy lên nhánh `claude/…`).
   - `/schedule` cần login claude.ai, không chạy với Console API key.
3. **Ba lớp giữ phòng chạy, và chỗ chúng không cộng được với nhau:**
   - **Không cần terminal:** gõ `/bg` trong phòng. Supervisor chạy session nền, và loop đang chờ nhịp kế vẫn chạy khi detach [2]. Ghim bằng `Ctrl+T` trong agent view; phòng không ghim, rảnh và không ai attach khoảng 1 giờ sẽ bị dừng. Tắt máy thì dừng [2]. Đây vẫn là loop local trên máy owner đang bật, không phải đường cho lúc vắng nhiều ngày (xem Kết luận 2).
   - **Hết usage:** `autoContinueAtUsageLimit` mặc định bật cho session interactive login claude.ai (v2.1.234+) và chỉ re-arm tối đa 2 lần liền [5]. **Không áp dụng cho session nền**: "Claude Code doesn't offer the wait at all in these cases", bao gồm "Background sessions and `-p` runs". Chuyển session sang nền cũng huỷ lượt chờ đang có. Remote Control và teammate không tự bắt đầu chờ [5]. Phòng `/bg` có thể chạy tiếp khi nhịp cron kế rơi sau giờ reset (suy luận, chưa kiểm thật).
   - **Gặp hỏi quyền:** lượt dừng chờ người, cả khi đang auto-continue [5]. Không bypass permission (luật org).
4. **Đích cho cả team:** `8sync ccc auto add "<việc>" [--check "<lệnh>"] [--now]`.
   - Mỗi nhịp, mọi phòng đọc `target` trong `auto status --json` và làm phần hợp vai mình. Đạt thì chạy `auto done <id> --evidence`, rồi cả team sang đích kế [L2].
   - `--now` đưa đích lên đầu hàng và vào inbox mọi phòng. Nó gần giống `Ctrl+X Ctrl+S` [13], nhưng không ngắt lượt đang chạy: tin tới khi phòng rảnh [L2].
5. **Không dùng `/ship-loop`, `/ship-auto`, `/autopilot`, `/sprint`, `/loop-me` làm prompt cron.** Các skill này có `disable-model-invocation: true`, nên nhịp cron chỉ nhận chúng như text thường [1][L3]. Tiêu chí kiểm được ở cấp team thì dùng `--check` của hàng đích. `/ship-loop` vẫn để owner gõ tay trong một phòng.
6. **Tuân thủ: CONDITIONS** [8][9][10]. Điều kiện:
   - owner tự bật, dùng subscription của chính mình;
   - binary gốc;
   - chỉ dùng scheduler built-in;
   - có off/pause;
   - không bypass permission;
   - số phòng × nhịp ở mức hợp lý (10 agent song song ≈ tiêu quota nhanh gấp 10 lần [2]);
   - **loop chạy trong phòng owner mở, cho mức dùng thường; vắng nhiều ngày hoặc 24/7 → Routines, Desktop scheduled task hoặc Console API key.** Đây là suy luận từ [1] (định vị `/loop`) và [8]:52 ("ordinary use"); Anthropic không viết điều kiện này thành câu riêng.
   Trần $/giờ là rail của 8sync, không phải điều kiện của Anthropic, và không đo quota (xem Caveats).

## Cách dùng (recipe)

| Việc | Lệnh / thao tác | Ghi chú |
|---|---|---|
| Một lần trên máy | `8sync ccc kit`, `8sync ccc statusline --install` | Trần $ đọc cost từ snapshot của status line. Không có status line thì `spent` = 0 và trần không bao giờ chạm [L5] |
| Bật cả team một dự án | `cd <repo>` rồi `8sync ccc auto on --here --loop 10m --team --usd-per-hour <N>` | `--here` chỉ dự án này; `--loop 10m` = cron `*/10`, mỗi nhịp muộn 0–5 phút do jitter [1]; `--team` lấp ghế rd/qa/reviewer [L1] |
| Giao đích đầu | thêm `--target "<đích>" --check "<lệnh exit 0>"` | Nhịp đầu của mọi phòng làm đích này [L2] |
| Xếp việc kế | `8sync ccc auto add "<việc>"`, hoặc trong phòng nói "đưa vào loop: …" | Vào cuối hàng; kit dạy phòng tự chạy lệnh [L2][L4] |
| Làm ngay | `auto add "<việc>" --now`, hoặc "làm ngay: …" | Đầu hàng + inbox mọi phòng [L2] |
| Xem / bỏ | `auto queue` · `auto drop <id>` | Đích một phòng tự thêm có nhãn "thêm bởi phòng <tên>" [L2] |
| Chạy nền | trong mỗi phòng `/bg`; `claude agents` rồi `Ctrl+T` để ghim | Không cần terminal, nhưng máy owner vẫn phải bật. Hết usage thì phòng nền không tự chờ [5] |
| Sửa việc mỗi nhịp | sửa `.claude/loop.md` (8sync không ghi đè) | Có hiệu lực từ nhịp kế; phần quá 25,000 byte bị cắt [1] |
| Tạm dừng / tắt | `auto pause` / `auto off`; phanh khẩn `8sync ccc cancel --all` | Không tức thì: nhịp kế (tối đa ~15 phút với `10m`) đọc status rồi `CronDelete` [L1][1]. `cancel --all` tắt idle + delegate ngay và đánh dấu auto paused; cron trong phòng thì binary không với tới được [L7]. Dừng ngay một phòng: bảo Claude trong phòng huỷ job `8sync-auto-loop` [1], hoặc đóng session |
| Gia hạn | chạy lại `auto on … --loop` trước 7 ngày | Task lặp hết hạn sau 7 ngày [1]. Chạy lại cũng đặt lại mốc tính trung bình của trần $ [L5] |
| Vắng nhiều ngày | Routines (`/schedule`, login claude.ai) hoặc Desktop scheduled task | Đường docs viết cho chạy không người trông [1][6][7]. Routines không hỏi quyền và không có rail của 8sync: prompt tự đủ, ít connector, branch protection [7] |

## Bằng chứng theo câu hỏi

### Q1. Tính năng chính chủ giữ phòng làm việc khi owner không gõ

| Tính năng | Hành vi (trích) | Giới hạn | Nguồn |
|---|---|---|---|
| `/loop` + `CronCreate` | "A scheduled prompt fires between your turns, not while Claude is mid-response" | 50 task/session; "Recurring tasks automatically expire 7 days after creation"; không catch-up; jitter (`10m`: muộn 0–5 phút; theo giờ hoặc thưa hơn: "0 to 30 minutes late") | [1] |
| `.claude/loop.md` | prompt mặc định của `/loop` trống; "Edits to `loop.md` take effect on the next iteration" | "content beyond 25,000 bytes is truncated"; bị bỏ qua khi `/loop` có prompt | [1] |
| Skill trong nhịp cron | chỉ skill model-invocable chạy được; skill `disable-model-invocation: true` "reach Claude as plain text instead of executing" | — | [1] |
| Session nền | "Background sessions don't need any terminal open to keep working"; loop đang chờ vẫn chạy khi detach | rảnh + không attach ~1 giờ thì dừng (trừ khi ghim `Ctrl+T`); máy tắt thì dừng; research preview | [2] |
| `/goal` | sau mỗi lượt, một model nhỏ kiểm điều kiện; chưa đạt thì chạy tiếp | một goal/session; evaluator không chạy lệnh; owner gõ | [3] |
| `autoContinueAtUsageLimit` | "continues the task on its own after the limit resets"; mặc định bật (interactive, claude.ai, v2.1.234+) | tối đa 2 lần liền; không có cho session nền, `-p`, API key; teammate không tự chờ; reset xa hơn 24 giờ (hạn mức tuần) thì không tự chờ; máy ngủ hơn khoảng 30 phút mà limit reset trong lúc ngủ thì phải bấm Enter | [5]; [4] chỉ xác nhận key tồn tại |
| Desktop scheduled task | chạy local khi app mở và máy thức; tối thiểu 1 phút | máy ngủ thì bỏ lượt, có một lượt catch-up; permission theo từng task | [6] |
| Routines | cloud; "keep working when your laptop is closed" | tối thiểu 1 giờ; clone mới, không có file local; 100 lượt chạy theo lịch/giờ/account (Run now, API fire: 30/giờ/routine); "draw down subscription usage"; research preview; Owner Team/Enterprise có thể tắt | [7] |

Phạm vi đọc: trang agent-view chỉ đọc 100,000/137,050 ký tự [2]. Với `autoContinueAtUsageLimit`, settings-reference chỉ đọc được dòng mục lục [4]; hành vi lấy từ interactive-mode [5].

Kết luận Q1: khi owner có mặt, lớp mạnh nhất là loop local mỗi phòng + `/bg`, cộng autoContinue cho phòng mở trong terminal. Docs không nói `/goal` kết hợp với `/loop` được hay không [3][1].

### Q2. Được phép trên subscription không

| Điểm | Trích | Nguồn |
|---|---|---|
| Login Team → Commercial Terms | "Commercial Terms of Service - for Team, Enterprise, and Claude API users" | [8]:13 |
| OAuth cho dùng thường | "designed to support ordinary use of Claude Code and other native Anthropic applications" | [8]:52 |
| Binary gốc, account của mình | "Nor does it prevent an end user from signing in to the unmodified Claude Code binary with their own Claude subscription" | [8]:55 |
| Không proxy, không giữ token | "developers may not collect, store, or intermediate Claude.ai credentials or session tokens" | [8]:53 |
| Pro/Max (Consumer) cấm truy cập tự động | "to access the Services through automated or non-human means, whether through a bot, script, or otherwise" (trừ API key hoặc "where we otherwise explicitly permit it") | [9]:28 |
| AUP agentic | "Users are responsible for ensuring that agents they build or deploy … comply with this Usage Policy" | [10]:197 |
| AUP proxy | "Resell, proxy, or otherwise provide access to Claude through unauthorized means, including services that route requests through consumer subscriptions or misrepresent the product or client being used" | [10]:134 |
| `/loop` để làm gì | "Use **`/loop`** for quick polling during a session"; chạy không người trông → Routines, GitHub Actions, Desktop scheduled tasks | [1] |
| Quota | "running ten agents in parallel uses quota roughly ten times as fast as running one" | [2] |

Phân tích (suy luận, không phải phát biểu của Anthropic): 8sync không cầm token, không proxy, không sửa binary. Lượt model chạy trong session Claude Code của owner, bằng scheduler mà Anthropic viết docs, nên thiết kế không khớp [8]:53 hay [10]:134. Rủi ro còn lại:
- (a) "Ordinary use" [8]:52 không được định nghĩa. Docs định vị `/loop` cho polling trong session [1]. Nhiều phòng loop liên tục nhiều ngày khi owner vắng đã vượt cách dùng docs mô tả, nên phải chuyển sang Routines, Desktop task hoặc API key.
- (b) Câu "automated … script" ở [9]:28 áp cho Pro/Max. Không nguồn nào nói một script local đưa tin vào inbox của session có thuộc phần "explicitly permit" hay không. Channels là đường chính chủ [12]; Team/Enterprise cần Owner bật `channelsEnabled`.
- (c) Owner tự chịu trách nhiệm cho việc agent làm [10]:197, kể cả đích một phòng tự thêm vào hàng.

### Q3. 8sync có gì

- `auto on`, không `--loop`, trên subscription: lease idle ≤ 4 giờ. Hook chỉ đẩy phòng chạy tiếp khi owner gõ trong 30 phút gần nhất (`idle::gate`) [L5][L6].
- `auto on --loop`:
  - ghi `loop.md` một lần, không ghi đè;
  - gửi mỗi phòng một tin để tự `CronCreate`;
  - cron prompt tự kiểm `auto status --json`: off/pause thì xoá loop, chạm `cap` thì nghỉ nhịp;
  - loop không bị lease dừng, vì là scheduler của Claude Code do owner bật [L1].
- Hàng đích `targets.json` [L2]:
  - khoá theo project root;
  - ghi dưới lock rồi rename nguyên tử; file hỏng thì fail-closed;
  - text qua `clean` (bỏ ký tự điều khiển/bidi/zero-width, mask secret, cắt 2000 ký tự);
  - đích một phòng tự thêm có nhãn phòng.
- `idle::cap`: trung bình $ từ lúc bật, sàn 1 giờ, vẫn kiểm sau khi lease hết [L5].

## Caveats

- **Trần $ không phải hard stop và không đo quota.**
  - Nó là trung bình `cost_usd` (từ status line) chia số giờ kể từ lúc bật, sàn 1 giờ [L5].
  - Cần `8sync ccc statusline --install`.
  - Trên subscription, con số này không phải hoá đơn: quota thật xem ở `/usage` hoặc claude.ai/settings/usage [7].
  - Cách Claude Code tính `cost_usd`: chưa mở docs statusline [UNVERIFIED].
- **Hàng đích là đường prompt injection nội bộ.**
  - Phòng nào cũng thêm đích được; `--now` đẩy đích vào mọi phòng. Một phòng vừa đọc nội dung không tin cậy (web, issue, PR) có thể bị dụ thêm đích.
  - `--check "<lệnh>"` là lệnh các phòng sẽ chạy, qua permission và guard như mọi lệnh khác; `clean` không chặn lệnh.
  - `done --evidence` do chính phòng tự chấm, không ai kiểm độc lập.
  - Owner nên tự thêm đích và xem `auto queue` định kỳ; đích có nhãn "thêm bởi phòng" mà owner không giao thì `drop`.
- **Permission:** phòng không người gặp hỏi quyền thì dừng [5]. Giảm hỏi bằng allow rule trong settings. Permission mode "auto" của Claude Code khác lệnh `8sync ccc auto`; điều kiện gói/model của mode đó chưa kiểm [UNVERIFIED]. Không dùng `bypassPermissions` hay `--dangerously-skip-permissions` (luật org).
- Chưa chạy thật loop và `add --now` trong phòng đang mở (cần bản mới cài). Smoke `--now` nhắn phòng thật nên không chạy trên máy owner.
- Agent view, `/bg` và Routines là research preview; hành vi có thể đổi [2][7].
- Không có số quota 5 giờ/tuần cụ thể cho Pro/Max/Team trong nguồn primary đã đọc [11].

## Sources

1. https://code.claude.com/docs/en/scheduled-tasks (đọc 2026-10-16)
2. https://code.claude.com/docs/en/agent-view (2026-10-16, đọc 100,000/137,050 ký tự)
3. https://code.claude.com/docs/en/goal (2026-10-16)
4. https://code.claude.com/docs/en/settings-reference (2026-10-16, dòng mục lục)
5. https://code.claude.com/docs/en/interactive-mode#wait-for-a-usage-limit-to-reset (2026-10-16)
6. https://code.claude.com/docs/en/desktop-scheduled-tasks (2026-10-16)
7. https://code.claude.com/docs/en/routines (2026-10-16)
8. `docs/legal/anthropic/claude-code-legal-and-compliance.md` (snapshot 2026-10-12); live https://code.claude.com/docs/en/legal-and-compliance
9. `docs/legal/anthropic/consumer-terms.md` (snapshot 2026-10-12)
10. `docs/legal/anthropic/usage-policy.md` (snapshot 2026-10-12)
11. https://support.claude.com/en/articles/11647753-how-do-usage-and-length-limits-work (2026-10-16)
12. https://code.claude.com/docs/en/channels (2026-10-16)
13. https://code.claude.com/docs/en/interactive-mode#queue-messages-while-claude-works (2026-10-16)
- L1 `crates/cli/src/verbs/ccc/auto.rs`: USAGE, LOOP_MD, `write_loop_md`, `loop_prompt`, `queue_loops`, `loop_notes` (PR #59), text in `run`
- L2 `crates/cli/src/verbs/ccc/target.rs` (`clean`, `edit`, `add`, `close`, `now_prompt`); `auto.rs` `run_target`
- L3 `~/.claude/skills/{ship-loop,loop-me,sprint,ship-auto,autopilot}/SKILL.md` (frontmatter `disable-model-invocation: true`)
- L4 `assets/claude/CLAUDE.md` (luật "Giao đích cho loop của cả dự án")
- L5 `crates/cli/src/verbs/ccc/idle.rs` (`costs`, `gate`, `cap`)
- L6 `crates/cli/src/verbs/ccc/help.rs` (dòng `idle on`, `auto on`, `delegate on`)
- L7 `crates/cli/src/verbs/ccc/cancel.rs` (module doc: `--all` = loop ship + `idle off` + `delegate off`; scheduled task của Claude Code không với tới được từ ngoài session)
