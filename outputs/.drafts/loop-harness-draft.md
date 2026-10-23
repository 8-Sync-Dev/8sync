# Loop mạnh nhất, độc lập, liên tục và hợp luật cho 8sync ccc

Ngày: 2026-10-16. Đọc docs code.claude.com bản live ngày này (bản Claude Code mới nhất được nhắc trong docs: v2.1.299). Không phải tư vấn pháp lý.

## Kết luận

1. **Cách mạnh nhất mà vẫn hợp luật là dùng scheduler có sẵn của Claude Code, mỗi phòng một loop.** Đó là `CronCreate` (cùng cơ chế với `/loop`) chạy trong chính session của phòng, kèm `.claude/loop.md` làm playbook cho mọi nhịp [1]. 8sync chỉ ghi file và gửi một tin vào inbox; mọi lượt model vẫn do binary Claude Code gốc chạy bằng login của owner [8][9]. Lệnh một dòng:
   `8sync ccc auto on --here --loop 10m --team --target "<đích>" --check "<lệnh>"` [L1].
2. **"Độc lập liên tục" có 3 lớp:**
   - **Phòng không cần terminal:** `/bg` (hoặc `claude --bg`). Supervisor chạy session nền, và loop đang chờ nhịp kế vẫn chạy khi detach [2]. Ghim phòng bằng `Ctrl+T`; phòng không ghim, rảnh và không ai attach khoảng 1 giờ sẽ bị dừng [2].
   - **Hết usage:** `autoContinueAtUsageLimit` mặc định bật cho session interactive login claude.ai (v2.1.234+). Session chờ reset rồi tự làm tiếp, nhưng chỉ re-arm tối đa 2 lần liền [5].
   - **Máy tắt:** loop local dừng [2]. Muốn chạy khi gập laptop thì dùng Routines (cloud, tối thiểu 1 giờ, clone repo mới mỗi lần, research preview) [7].
3. **Đích cho cả team (như gõ lúc Claude đang bận rồi ctrl+x ctrl+s):** `8sync ccc auto add "<việc>" [--check "<lệnh>"] [--now]`. Mỗi nhịp, mọi phòng đọc `target` trong `auto status --json` và làm phần hợp vai mình. Đạt thì chạy `auto done <id> --evidence` rồi cả team sang đích kế. `--now` đưa đích lên đầu hàng và vào inbox mọi phòng; tin tới khi phòng rảnh và không cắt lượt đang chạy, khớp cách Claude Code xếp prompt [1][L2].
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
| Làm ngay | `auto add "<việc>" --now`, hoặc "làm ngay: …" | Lên đầu hàng và vào inbox mọi phòng, như ctrl+x ctrl+s [L2] |
| Xem / bỏ | `auto queue` · `auto drop <id>` | Đích một phòng tự thêm có nhãn "thêm bởi phòng <tên>" [L2] |
| Chạy nền | trong mỗi phòng: `/bg`, rồi `Ctrl+T` trong agent view để ghim | Không cần terminal mở; không ghim thì rảnh ~1 giờ sẽ bị dừng [2] |
| Sửa cách làm mỗi nhịp | sửa `.claude/loop.md` (8sync không ghi đè) | Nhịp kế đọc lại file; phần quá 25,000 byte bị cắt [1][L1] |
| Tạm dừng / tắt | `auto pause` / `auto off` | Nhịp kế tự `CronDelete` [L1] |
| Gia hạn | chạy lại `auto on … --loop` mỗi tuần | Task lặp tự hết hạn sau 7 ngày [1] |
| Trần $ | `--usd-per-hour` đủ cao cho số phòng | Trên subscription, $ là cost Claude Code ước tính. Chạm trần thì phòng nghỉ nhịp đó và giữ loop; trần tính trung bình nên tự hạ [L5] |

## Bằng chứng theo câu hỏi

### Q1. Tính năng chính chủ giữ phòng làm việc khi owner không gõ

| Tính năng | Hành vi (trích) | Giới hạn | Nguồn |
|---|---|---|---|
| `/loop` + `CronCreate` | "A scheduled prompt fires between your turns, not while Claude is mid-response" | 50 task/session; "Recurring tasks automatically expire 7 days after creation"; không catch-up; có jitter (task theo giờ hoặc thưa hơn chạy muộn "0 to 30 minutes") | [1] |
| `.claude/loop.md` | prompt mặc định của `/loop` trống; "Edits to `loop.md` take effect on the next iteration" | "content beyond 25,000 bytes is truncated"; bị bỏ qua khi `/loop` có prompt | [1] |
| Skill trong nhịp cron | chỉ skill model-invocable chạy được; skill `disable-model-invocation: true` "reach Claude as plain text" | — | [1] |
| Session nền | "Background sessions don't need any terminal open to keep working"; loop đang chờ vẫn chạy khi detach | rảnh + không attach ~1 giờ thì dừng (trừ khi ghim `Ctrl+T`); máy tắt thì dừng; research preview | [2] |
| `/goal` | sau mỗi lượt, một model nhỏ kiểm điều kiện; chưa đạt thì chạy tiếp | một goal/session; evaluator không chạy lệnh; cần auto mode để chạy không người; owner gõ | [3] |
| `autoContinueAtUsageLimit` | "continues the task on its own after the limit resets"; mặc định bật (interactive, claude.ai, v2.1.234+) | re-arm tối đa 2 lần liền; vẫn hỏi permission nên có thể kẹt; máy ngủ >30 phút thì phải bấm Enter | [4][5] |
| Desktop scheduled task | chạy local khi app mở và máy thức | máy ngủ thì bỏ lượt; một lượt catch-up | [6] |
| Routines | cloud, chạy khi laptop gập | tối thiểu 1 giờ; clone mới, không có file local; 100 lượt/giờ/account; tính vào usage; research preview | [7] |

Kết luận Q1: loop local mỗi phòng + `/bg` + autoContinue là lớp mạnh nhất khi máy owner bật. `/goal` hợp cho một phòng một mục tiêu do owner gõ; docs không nói `/goal` kết hợp với `/loop` được hay không [3][1].

### Q2. Được phép trên subscription không

| Điểm | Trích | Nguồn |
|---|---|---|
| Login Team → Commercial Terms | "Commercial Terms of Service - for Team, Enterprise, and Claude API users" | [8] :13 |
| OAuth cho dùng thường | "designed to support ordinary use of Claude Code and other native Anthropic applications" | [8] :52 |
| Không proxy/không giữ token | "developers may not collect, store, or intermediate Claude.ai credentials or session tokens" | [8] :53 |
| Pro/Max (Consumer) cấm truy cập tự động | "to access the Services through automated or non-human means, whether through a bot, script, or otherwise" (trừ API key hoặc "where we otherwise explicitly permit it") | [9] :28 |
| AUP agentic | "Users are responsible for ensuring that agents they build or deploy … comply with this Usage Policy" | [10] :197 |
| AUP proxy | "Resell, proxy, or otherwise provide access to Claude through unauthorized means" | [10] :134 |
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
- L1 `crates/cli/src/verbs/ccc/auto.rs` (LOOP_MD :262, write_loop_md :296, loop_prompt :315, queue_loops :349)
- L2 `crates/cli/src/verbs/ccc/target.rs` (clean :69, edit :104, add :173, close :216, now_prompt :266); `auto.rs` run_target :390
- L3 `~/.claude/skills/{ship-loop,loop-me,sprint,ship-auto,autopilot}/SKILL.md` frontmatter `disable-model-invocation: true`
- L4 `assets/claude/CLAUDE.md` (luật "Giao đích cho loop của cả dự án")
- L5 `crates/cli/src/verbs/ccc/idle.rs` (gate :378, cap :402)
- Evidence notes: `outputs/.drafts/loop-harness-r1.md`, `outputs/.drafts/loop-harness-r2.md`
