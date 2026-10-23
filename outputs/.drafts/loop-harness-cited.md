# Loop mạnh nhất, độc lập, liên tục và hợp luật cho 8sync ccc

Ngày: 2026-10-16. Đọc docs code.claude.com bản live ngày này (bản Claude Code mới nhất được nhắc trong docs: v2.1.299). Không phải tư vấn pháp lý.

## Kết luận

1. **Cách mạnh nhất mà vẫn hợp luật là dùng scheduler có sẵn của Claude Code, mỗi phòng một loop.** Đó là `CronCreate` (cùng cơ chế với `/loop`) chạy trong chính session của phòng, kèm `.claude/loop.md` làm playbook cho mọi nhịp [1]. 8sync chỉ ghi file và gửi một tin vào inbox; mọi lượt model vẫn do binary Claude Code gốc chạy bằng login của owner [8] :55 [L1]. Lệnh một dòng:
   `8sync ccc auto on --here --loop 10m --team --target "<đích>" --check "<lệnh>"` [L1].
2. **"Độc lập liên tục" có 3 lớp:**
   - **Phòng không cần terminal:** `/bg` (hoặc `claude --bg`). Supervisor chạy session nền, và loop đang chờ nhịp kế vẫn chạy khi detach [2]. Ghim phòng bằng `Ctrl+T`; phòng không ghim, rảnh và không ai attach khoảng 1 giờ sẽ bị dừng [2].
   - **Hết usage:** `autoContinueAtUsageLimit` mặc định bật cho session interactive login claude.ai (v2.1.234+). Session chờ reset rồi tự làm tiếp, nhưng chỉ re-arm tối đa 2 lần liền [5].
   - **Máy tắt:** loop local dừng [2]. Muốn chạy khi gập laptop thì dùng Routines (cloud, tối thiểu 1 giờ, clone repo mới mỗi lần, research preview) [7].
3. **Đích cho cả team (gần như gõ lúc Claude đang bận rồi `Ctrl+X Ctrl+S` [13], nhưng `--now` không cắt lượt đang chạy):** `8sync ccc auto add "<việc>" [--check "<lệnh>"] [--now]`. Mỗi nhịp, mọi phòng đọc `target` trong `auto status --json` và làm phần hợp vai mình. Đạt thì chạy `auto done <id> --evidence` rồi cả team sang đích kế. `--now` đưa đích lên đầu hàng và vào inbox mọi phòng; tin tới khi phòng rảnh và không cắt lượt đang chạy [L2]; scheduled prompt của Claude Code cũng chờ hết lượt hiện tại mới chạy [1].
4. **Không dùng `/ship-loop` (hay `/ship-auto`, `/autopilot`, `/sprint`, `/loop-me`) làm prompt cron.** Các skill này có `disable-model-invocation: true`, nên scheduled task chỉ nhận chúng như text thường [1][L3]. Muốn tiêu chí kiểm được ở cấp team thì dùng hàng đích có `--check`. `/ship-loop` vẫn dành cho owner gõ tay trong một phòng.
5. **Tuân thủ: CONDITIONS** [8][9][10][11]. Điều kiện:
   - owner tự bật, dùng subscription của chính mình;
   - binary gốc;
   - chỉ dùng scheduler built-in;
   - có off/pause và trần $;
   - không bypass permission;
   - số phòng × nhịp ở mức hợp lý (10 agent song song ≈ tiêu quota nhanh gấp 10 lần [2]);
   - chạy nặng 24/7 thì chuyển sang API key Console (Commercial Terms) hoặc Routines.

## Cách dùng tốt nhất (recipe)

| Việc | Lệnh / thao tác | Vì sao |
|---|---|---|
| Bật cả team một dự án | `cd <repo> && 8sync ccc auto on --here --loop 10m --team --usd-per-hour <N>` | `--here` giới hạn ở dự án này. `--loop 10m` cho mỗi phòng một cron `*/10`. `--team` lấp ghế rd/qa/reviewer [L1] |
| Giao đích đầu tiên | thêm `--target "<đích>" --check "<lệnh exit 0>"` | Nhịp đầu tiên của mọi phòng đã làm đích này [L2] |
| Xếp việc kế | `8sync ccc auto add "<việc>"`, hoặc trong phòng nói "đưa vào loop: …" | Đích vào cuối hàng; kit dạy phòng tự chạy lệnh [L2][L4] |
| Làm ngay | `auto add "<việc>" --now`, hoặc "làm ngay: …" | Lên đầu hàng và vào inbox mọi phòng, gần như `Ctrl+X Ctrl+S` [13] nhưng không ngắt lượt đang chạy [L2] |
| Xem / bỏ | `auto queue` · `auto drop <id>` | Đích một phòng tự thêm có nhãn "thêm bởi phòng <tên>" [L2] |
| Chạy nền | trong mỗi phòng: `/bg`, rồi `Ctrl+T` trong agent view để ghim | Không cần terminal mở; không ghim thì rảnh ~1 giờ sẽ bị dừng [2] |
| Sửa cách làm mỗi nhịp | sửa `.claude/loop.md` (8sync không ghi đè) | Nhịp kế đọc lại file; phần quá 25,000 byte bị cắt [1][L1] |
| Tạm dừng / tắt | `auto pause` / `auto off` | Nhịp kế tự `CronDelete` [L1] |
| Gia hạn | chạy lại `auto on … --loop` mỗi tuần | Task lặp tự hết hạn sau 7 ngày [1] |
| Trần $ | `--usd-per-hour` đủ cao cho số phòng | Trên subscription, $ là cost Claude Code ước tính [UNVERIFIED: L5 chỉ đọc `cost_usd` từ status-line snapshot (`idle.rs` costs()), không nguồn nào được mở nói đó là "ước tính"]. Chạm trần thì phòng nghỉ nhịp đó và giữ loop; trần tính trung bình nên tự hạ [L5] |

## Bằng chứng theo câu hỏi

### Q1. Tính năng chính chủ giữ phòng làm việc khi owner không gõ

| Tính năng | Hành vi (trích) | Giới hạn | Nguồn |
|---|---|---|---|
| `/loop` + `CronCreate` | "A scheduled prompt fires between your turns, not while Claude is mid-response" | 50 task/session; "Recurring tasks automatically expire 7 days after creation"; không catch-up; có jitter (task theo giờ hoặc thưa hơn chạy muộn "0 to 30 minutes") | [1] |
| `.claude/loop.md` | prompt mặc định của `/loop` trống; "Edits to `loop.md` take effect on the next iteration" | "content beyond 25,000 bytes is truncated"; bị bỏ qua khi `/loop` có prompt | [1] |
| Skill trong nhịp cron | chỉ skill model-invocable chạy được; skill `disable-model-invocation: true` "reach Claude as plain text" | — | [1] |
| Session nền | "Background sessions don't need any terminal open to keep working"; loop đang chờ vẫn chạy khi detach | rảnh + không attach ~1 giờ thì dừng (trừ khi ghim `Ctrl+T`); máy tắt thì dừng; research preview | [2] |
| `/goal` | sau mỗi lượt, một model nhỏ kiểm điều kiện; chưa đạt thì chạy tiếp | một goal/session; evaluator không chạy lệnh; cần auto mode để chạy không người; owner gõ | [3] |
| `autoContinueAtUsageLimit` | "continues the task on its own after the limit resets"; mặc định bật (interactive, claude.ai, v2.1.234+) | re-arm tối đa 2 lần liền; vẫn hỏi permission nên có thể kẹt; máy ngủ khoảng 30 phút trở lên mà limit reset trong lúc ngủ thì phải bấm Enter | [5] (trích, mặc định, version, giới hạn); [4] (chỉ xác nhận key tồn tại, hàng mục lục) |
| Desktop scheduled task | chạy local khi app mở và máy thức | máy ngủ thì bỏ lượt; một lượt catch-up | [6] |
| Routines | cloud, chạy khi laptop gập | tối thiểu 1 giờ; clone mới, không có file local; 100 lượt chạy theo lịch/giờ/account (Run now, API fire: 30/giờ/routine); tính vào usage; research preview | [7] |

Kết luận Q1: loop local mỗi phòng + `/bg` + autoContinue là lớp mạnh nhất khi máy owner bật. `/goal` hợp cho một phòng một mục tiêu do owner gõ; docs không nói `/goal` kết hợp với `/loop` được hay không [3][1].

### Q2. Được phép trên subscription không

| Điểm | Trích | Nguồn |
|---|---|---|
| Login Team → Commercial Terms | "Commercial Terms of Service - for Team, Enterprise, and Claude API users" | [8] :13 |
| OAuth cho dùng thường | "designed to support ordinary use of Claude Code and other native Anthropic applications" | [8] :52 |
| Không proxy/không giữ token | "developers may not collect, store, or intermediate Claude.ai credentials or session tokens" | [8] :53 |
| Pro/Max (Consumer) cấm truy cập tự động | "to access the Services through automated or non-human means, whether through a bot, script, or otherwise" (trừ API key hoặc "where we otherwise explicitly permit it") | [9] :28 |
| AUP agentic | "Users are responsible for ensuring that agents they build or deploy … comply with this Usage Policy" | [10] :197 |
| AUP proxy | "Resell, proxy, or otherwise provide access to Claude through unauthorized means, including services that route requests through consumer subscriptions or misrepresent the product or client being used" | [10] :134 |
| Quota | "running ten agents in parallel uses quota roughly ten times as fast as running one" | [2] |

Phân tích (suy luận, không phải phát biểu của Anthropic): 8sync không cầm token, không proxy, không sửa binary. Lượt model chạy trong session Claude Code của owner bằng tính năng scheduler mà Anthropic viết docs. Vì vậy thiết kế không khớp [8]:53 hay [10]:134. Rủi ro còn lại:
- (a) Câu "automated … script" ở [9]:28 áp cho Pro/Max. Không nguồn nào nói việc một script local đưa tin vào inbox của session có nằm trong phần "explicitly permit" hay không. Channels là đường chính chủ [12] nhưng org cần bật `channelsEnabled`.
- (b) "ordinary use" không được định nghĩa ở đâu.

### Q3. 8sync đã có gì, đổi nhỏ nhất là gì

- `auto on --loop`: ghi `loop.md` một lần, không ghi đè; gửi mỗi phòng một tin tự `CronCreate`. Cron prompt tự kiểm `auto status --json`: off/pause thì xoá loop, chạm `cap` thì nghỉ nhịp [L1].
- Hàng đích `targets.json`:
  - khoá theo project root;
  - ghi dưới lock và rename nguyên tử; file hỏng thì fail-closed;
  - text qua `clean`: bỏ ký tự điều khiển/bidi/zero-width, mask secret, cắt 2000 ký tự [L2].
- `idle::cap` tách trần $/giờ khỏi lease, để loop chạy quá lease vẫn tôn trọng trần [L5].
- loop.md tránh skill chỉ-owner [L3].

## Caveats

- Chưa chạy thật loop + `add --now` trong phòng đang mở (cần bản mới cài). Smoke `--now` sẽ nhắn phòng thật nên không chạy trên máy owner.
- Agent view và `/bg` là research preview; hành vi có thể đổi [2].
- Không có số quota 5 giờ/tuần cụ thể cho Pro/Max/Team trong nguồn primary đã đọc [11].
- Permission prompt làm phòng không người bị kẹt. Không bypass được (luật org); dùng auto mode và allow rule.
- Trang agent-view chỉ đọc 100,000/137,050 ký tự; settings-reference chỉ đọc mục lục cho `autoContinueAtUsageLimit`.

## Sources

1. https://code.claude.com/docs/en/scheduled-tasks (đọc 2026-10-16)
2. https://code.claude.com/docs/en/agent-view (2026-10-16, đọc một phần)
3. https://code.claude.com/docs/en/goal (2026-10-16)
4. https://code.claude.com/docs/en/settings-reference (2026-10-16, dòng mục lục)
5. https://code.claude.com/docs/en/interactive-mode#wait-for-a-usage-limit-to-reset (2026-10-16)
6. https://code.claude.com/docs/en/desktop-scheduled-tasks (2026-10-16)
7. https://code.claude.com/docs/en/routines (2026-10-16)
8. `docs/legal/anthropic/claude-code-legal-and-compliance.md` (snapshot 2026-10-12), bản live https://code.claude.com/docs/en/legal-and-compliance
9. `docs/legal/anthropic/consumer-terms.md` (snapshot 2026-10-12)
10. `docs/legal/anthropic/usage-policy.md` (snapshot 2026-10-12)
11. https://support.claude.com/en/articles/11647753-how-do-usage-and-length-limits-work (2026-10-16)
12. https://code.claude.com/docs/en/channels (2026-10-16)
13. https://code.claude.com/docs/en/interactive-mode#queue-messages-while-claude-works (2026-10-16; mục "Queue messages while Claude works" / "When Claude Code sends what you queued": `Ctrl+X Ctrl+S` gửi ngay tin đã xếp hàng, có thể ngắt lượt)
- L1 `crates/cli/src/verbs/ccc/auto.rs` (LOOP_MD :262, write_loop_md :296, loop_prompt :315, queue_loops :349)
- L2 `crates/cli/src/verbs/ccc/target.rs` (clean :69, edit :104, add :173, close :216, now_prompt :266); `auto.rs` run_target :390
- L3 `~/.claude/skills/{ship-loop,loop-me,sprint,ship-auto,autopilot}/SKILL.md` frontmatter `disable-model-invocation: true`
- L4 `assets/claude/CLAUDE.md` (luật "Giao đích cho loop của cả dự án")
- L5 `crates/cli/src/verbs/ccc/idle.rs` (gate :378, cap :402)
- Evidence notes: `outputs/.drafts/loop-harness-r1.md`, `outputs/.drafts/loop-harness-r2.md`

## Verification notes

Phương pháp: mở lại nguồn web live ngày 2026-10-16 bằng WebFetch (scheduled-tasks, agent-view, interactive-mode, goal, routines, desktop-scheduled-tasks, channels, support.claude.com, settings-reference), đọc trực tiếp các snapshot `docs/legal/anthropic/*` theo số dòng, và đọc code Rust tại số dòng đã cite. Không đọc file secret.

Đã sửa (claim → phát hiện → nguồn):
- Kết luận 1, "binary Claude Code gốc chạy bằng login của owner [8][9]" → [9] (Consumer Terms) không nói gì về binary/login; câu đúng nằm ở [8] :55 ("Nor does it prevent an end user from signing in to the unmodified Claude Code binary with their own Claude subscription") + code L1. Đã đổi cite thành [8] :55 [L1].
- Kết luận 3 và recipe "Làm ngay", "như ctrl+x ctrl+s … khớp cách Claude Code xếp prompt [1]" → [1] chỉ nói scheduled prompt chờ hết lượt hiện tại; `Ctrl+X Ctrl+S` nằm ở interactive-mode (nguồn mới [13]) và là "Send queued messages now": khi Claude chỉ đang viết response thì Claude Code ngắt lượt, còn `--now` của 8sync không ngắt (target.rs:266 "Xong lượt đang làm thì chuyển sang đích này"; auto.rs delivery() "vào ngay khi phòng rảnh"). Đã sửa thành "gần như" và nêu khác biệt.
- Q1 hàng `autoContinueAtUsageLimit` → câu trích "continues the task on its own after the limit resets", mặc định bật và v2.1.234 đều nằm ở [5] (interactive-mode); [4] chỉ có hàng mục lục ("continue the task automatically after a claude.ai usage limit resets", scope "User or managed"), mục chi tiết của key (default/version) không đọc được (trang 425,074 ký tự, chỉ nhận 100,000 đầu). Đã ghi lại nguồn cho từng phần.
- Cùng hàng, "máy ngủ >30 phút thì phải bấm Enter" → docs: "if it slept for more than about 30 minutes and the limit reset while it slept" thì "Press Enter"; ngủ ngắn hơn hoặc kết thúc trước reset thì tự tiếp. Đã bổ sung điều kiện limit reset trong lúc ngủ.
- Q1 hàng Routines, "100 lượt/giờ/account" → chỉ đúng cho scheduled runs (kể cả one-off); Run now + API fires + one-off chạy lại là 30/giờ/routine. Đã sửa.
- Q2 hàng AUP proxy [10] :134 → câu trích bị cắt, bỏ mất vế "including services that route requests through consumer subscriptions or misrepresent the product or client being used". Đã trích đủ.

UNVERIFIED:
- Recipe "Trần $": "$ là cost Claude Code ước tính" → L5 (`idle.rs` costs(), spent_since) chỉ dùng `cost_usd` từ status-line snapshot; chưa mở docs nào nói con số đó là ước tính. Đã gắn [UNVERIFIED].

Đã kiểm, khớp nguồn (không sửa):
- scheduled-tasks [1]: "A scheduled prompt fires between your turns, not while Claude is mid-response"; "Recurring tasks automatically expire 7 days after creation"; "A session can hold up to 50 scheduled tasks at once"; "Edits to `loop.md` take effect on the next iteration"; "content beyond 25,000 bytes is truncated"; loop.md bị bỏ qua khi có prompt trên command line; skill `disable-model-invocation: true` "reach Claude as plain text instead of executing"; bảng jitter "Every hour, or less often such as daily | 0 to 30 minutes late"; không catch-up; v2.1.299 xuất hiện trong trang (next run times).
- agent-view [2] (chỉ đọc ký tự 0-100,000/137,050): "Background sessions don't need any terminal open to keep working"; loop detach "keeps running"; "unattended for about an hour: the supervisor stops the process" + "Pin a session with `Ctrl+T`"; "running ten agents in parallel uses quota roughly ten times as fast as running one"; "stop if the machine shuts down"; "research preview"; `/bg`, `/background`, `--bg`. `Ctrl+T` = "Pin or unpin the selected session" trong agent view (không phải trong session thường, nơi `Ctrl+T` bật/tắt task checklist: kết luận 2 và recipe "Chạy nền" đã nói đúng "trong agent view").
- interactive-mode [5]: "on by default in interactive sessions signed in with a claude.ai subscription. Requires Claude Code v2.1.234 or later"; "re-arms the wait on its own at most twice in a row"; "Claude Code still asks for permissions as usual, so the task can stop on a prompt while you're away".
- routines [7]: "The minimum interval is one hour"; "Routines are in research preview"; clone mỗi lần chạy; "Routines draw down subscription usage"; 100 per hour cho scheduled runs; Pro/Max/Team/Enterprise. goal [3], desktop-scheduled-tasks [6], channels [12] (Team/Enterprise phải bật; Pro/Max không org thì bỏ qua kiểm tra; research preview) khớp các dòng trong draft. Draft Q2(a) chỉ nói "org cần bật `channelsEnabled`": đúng cho Team/Enterprise, không áp cho Pro/Max không có org.
- support.claude.com [11]: có "a session limit that resets every five hours" và "weekly limits"; không có con số cho Pro/Max/Team nên caveat đúng.
- Legal snapshots: [8] :13 (Commercial Terms - for Team, Enterprise, and Claude API users), :52, :53 khớp từng chữ; [9] :28 khớp từng chữ; [10] :197 khớp (draft dùng "…" cho phần lược); :134 khớp sau sửa. Ghi chú: [8] :14 xác nhận Consumer Terms áp cho Free, Pro, Max, nên nhãn "Pro/Max (Consumer)" đúng.
- Code: tất cả số dòng L1, L2, L5 trỏ đúng hàm/const đã nêu (LOOP_MD :262, write_loop_md :296, loop_prompt :315, queue_loops :349, run_target :390; clean :69, edit :104, add :173, close :216, now_prompt :266; gate :378, cap :402). L3: cả 5 skill có `disable-model-invocation: true` ở frontmatter. L4: assets/claude/CLAUDE.md dòng 18. Hành vi: write_loop_md dùng create_new, không ghi đè; cron prompt xoá job khi `on=false`/`paused=true`, nghỉ nhịp khi `cap` khác null; cron `*/10` từ cron_expr; `--team` lấp rd/qa/reviewer; targets.json khoá theo project root, lock + rename nguyên tử, file hỏng trả lỗi, clean bỏ control/bidi/zero-width + mask_secrets + TEXT_MAX 2000; nhãn "thêm bởi phòng" ở auto.rs:509; `on --target` chèn đích lên đầu; cap tính trung bình, chạy được ngoài lease.
- Lưu ý ngoài draft (đọc từ code, chưa đưa vào draft): `auto on` in cảnh báo "Login subscription: lease ≤ 4 giờ, chỉ chạy khi owner có mặt. Chạy không người trông → Console API key" khi không có `--loop`; `idle::gate` yêu cầu lease owner-có-mặt cho gói subscription. Điều kiện tuân thủ trong Kết luận 5 nên nhất quán với hành vi này.
- Câu "Phân tích" ở Q2 và "Rủi ro còn lại" là suy luận đã được draft gắn nhãn; không nguồn nào xác nhận hay phủ nhận. Nguồn [11] ở Kết luận 5 chỉ liên quan gián tiếp (quota), không chứa điều kiện pháp lý.

## Bảng kiểm claim

| claim | nguồn | kết quả |
|---|---|---|
| Scheduled prompt chạy giữa các lượt, không giữa response | [1] | OK |
| Task lặp hết hạn sau 7 ngày | [1] | OK |
| Tối đa 50 task/session | [1] | OK |
| loop.md: sửa có hiệu lực nhịp kế; cắt quá 25,000 byte; bỏ qua khi có prompt | [1] | OK |
| Skill `disable-model-invocation: true` tới Claude như plain text | [1] | OK |
| Jitter "0 to 30 minutes" cho task theo giờ hoặc thưa hơn; không catch-up | [1] | OK |
| Docs mới nhất nhắc v2.1.299 | [1] | OK |
| 5 skill (ship-loop, ship-auto, autopilot, sprint, loop-me) có `disable-model-invocation: true` | L3 frontmatter | OK |
| Session nền không cần terminal; loop đang chờ chạy khi detach | [2] | OK |
| Rảnh + không attach ~1 giờ thì dừng; `Ctrl+T` ghim | [2] | OK |
| "ten agents ... roughly ten times as fast"; máy tắt thì dừng; research preview | [2] | OK |
| `/goal`: model nhỏ kiểm sau mỗi lượt; một goal/session; evaluator không chạy lệnh; auto mode để chạy không người | [3] | OK |
| autoContinue mặc định bật, v2.1.234+, tối đa 2 lần liền, vẫn hỏi permission | [5] | OK |
| autoContinue: nguồn gán cho trích/mặc định ở hàng Q1 | [4] vs [5] | FIXED |
| Máy ngủ >30 phút thì bấm Enter | [5] | FIXED (thêm điều kiện limit reset trong lúc ngủ) |
| Desktop task: máy ngủ bỏ lượt, một catch-up | [6] | OK |
| Routines: cloud, tối thiểu 1 giờ, clone mới, research preview, tính vào usage | [7] | OK |
| Routines: 100 lượt/giờ/account | [7] | FIXED (chỉ scheduled runs; Run now/API 30/giờ/routine) |
| `/goal` kết hợp `/loop` không được docs nêu | [3][1] | OK (không có câu nào nói được/không được) |
| Binary gốc chạy bằng login owner | [8] :55 (trước đó cite [9]) | FIXED |
| Team → Commercial Terms | [8] :13 | OK |
| "ordinary use" OAuth | [8] :52 | OK |
| Không collect/store/intermediate credentials | [8] :53 | OK |
| Consumer cấm "automated or non-human means ... bot, script" | [9] :28 | OK |
| AUP agentic responsibility | [10] :197 | OK |
| AUP proxy | [10] :134 | FIXED (trích đủ vế consumer subscriptions) |
| Channels: org Team/Enterprise cần bật `channelsEnabled` | [12] | OK |
| Không có số quota 5 giờ/tuần cho Pro/Max/Team | [11] | OK |
| "như ctrl+x ctrl+s", "khớp cách Claude Code xếp prompt" | [13] (mới) + [1] | FIXED |
| `--now` không cắt lượt đang chạy, vào inbox mọi phòng | L2 target.rs:266, auto.rs delivery | OK |
| Lệnh `auto on --here --loop 10m --team --target --check --usd-per-hour`, `add/queue/done/drop` | L1 USAGE (auto.rs:36-37) | OK |
| loop.md ghi một lần, không ghi đè; cron `*/10`; off/pause xoá loop; cap nghỉ nhịp | L1 | OK |
| `--team` lấp ghế rd/qa/reviewer | L1 loop_prompt | OK |
| Hàng đích: khoá theo root, lock + rename nguyên tử, fail-closed, clean, 2000 ký tự | L2 | OK |
| Nhãn "thêm bởi phòng <tên>" | auto.rs:509 | OK |
| Nhịp đầu của mọi phòng làm đích từ `--target` | auto.rs `on --target` (add với first=true) | OK |
| `idle::cap` tách trần $/giờ khỏi lease, tính trung bình | L5 idle.rs:402 | OK |
| loop.md tránh skill chỉ-owner | auto.rs LOOP_MD | OK |
| Luật "đưa vào loop / làm ngay" trong kit | L4 assets/claude/CLAUDE.md:18 | OK |
| "$ là cost Claude Code ước tính" | L5 (không nêu "ước tính") | UNVERIFIED |
| Số dòng L1, L2, L5 trỏ đúng hàm | auto.rs, target.rs, idle.rs | OK |
| Q2 phân tích: không khớp [8]:53 / [10]:134; "explicitly permit" chưa rõ | suy luận (đã gắn nhãn trong draft) | OK (là suy luận, không phải phát biểu nguồn) |
