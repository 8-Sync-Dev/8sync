# 8sync ccc — đề xuất bước tiếp theo (chỉ đề xuất, chưa làm) — 2026-10-13

Base: 8sync main `e4c94fa` (sau v0.66.0, chưa push), Claude Code 2.1.296.

Nguồn đọc local, không chạy code clone:
- oh-my-pi 7738a3f082
- ForgeCode 8703dec
- Feynman d28d964
- CowAgent aa5f4c9
- anthropics/claude-code 3deb873
- claude-plugins-official f359d43

Nguồn web: code.claude.com/docs, GitHub API (2026-10-13), anthropic.com/legal, support.claude.com.

Bảng đối chiếu từng claim nằm ở `outputs/.drafts/ccc-harness-next-cited.md`. Đây không phải tư vấn pháp lý.

## TL;DR — xếp hạng

Cột "Chắc chắn" cho biết căn cứ: **đo** = đã chạy thử, **docs** = docs chính chủ, **nguồn** = đọc code/README, **suy luận** = chưa có bằng chứng.

| # | Đề xuất | Giá trị | Công sức | Luật | Chắc chắn |
|---|---|---|---|---|---|
| P0-1 | Guard fail-closed: `onFailure: "block"` cho hook guard (2.1.295+) | cao | rất thấp | không | docs [3] |
| P0-2 | Sửa false positive: guard deny heredoc **ghi file** có chữ `rm -rf ~` | cao | thấp | không | đo [5] |
| P1 | **`/planning`** opt-in: plan mode native + lint + archive + checkbox ↔ task (đi kèm P2-1, P2-3) | cao nếu spike đạt (chưa đo) | vừa | không (native) | docs + nguồn; 3 hành vi chưa kiểm |
| P2-1 | Stop gate: còn bước/task mở → nhắc một lần | cao | thấp | không | nguồn [2] |
| P2-2 | Loop breaker: cùng tool+args lần 3 → nhắc, lần 5 → chặn | cao | thấp-vừa | không | nguồn [1][2] |
| P2-3 | Giữ plan + STATE qua `/compact` và `/clear` | vừa-cao | thấp | không | docs [3] |
| P2-4 | Deploy/publish/nhắn tin ra ngoài → ask (push giữ nguyên) | vừa | thấp | không | nguồn [4] |
| P2-5 | Statusline: tiến độ plan, verify, goal | vừa | thấp | không | docs [3] |
| P2-6 | Nhắc cập nhật todo giữa chừng | vừa | thấp | không | nguồn [1] |
| P3-1 | Redact secret/PII trong digest + memory, **trước** P3-2 | vừa | thấp | giảm rủi ro | nguồn [1] |
| P3-2 | `/evolve` (mặc định im lặng) + `/consolidate` KNOWLEDGE | chưa đo | vừa | có điều kiện | nguồn [2] |
| P3-3 | Eval kit (`claude plugin eval`) + luật số trước/sau khi đổi prompt kit | cao | vừa | có điều kiện | docs [2][3] |
| P3-4 | Guard file generated (`@generated`, code sinh của Encore) | vừa | thấp | không | nguồn [1] |
| P3-5 | Câu chữ ask gate + luật orchestrate cho `/ship`/pm | vừa | thấp | không | nguồn [1] |
| P3-6 | Tuỳ chọn bảo thủ: headless dùng Console key | thấp-vừa | thấp | tuỳ chọn | docs [4] |

**Ngân sách cho mọi hook mới:** ≤ 15 ms/lệnh. Guard hiện tại đo 9.3 ms median, trong đó khởi động process mất 8.6 ms. Không gọi model trong hook chạy theo từng lệnh.

## P0

### P0-1. Guard fail-closed
Hiện guard hook là fail-open: nếu binary thiếu, hook timeout hoặc exit code lạ, lệnh vẫn chạy.

Claude Code 2.1.295 thêm `onFailure: "block"`: "a hook that can't start, times out, or exits with an unexpected code blocks the action instead of letting it through" [3]. Đây là một dòng config. Trên Windows native không có sandbox ("runs commands unsandboxed" [3]), nên guard là lớp phòng thủ duy nhất.

Caveat: nếu `8sync` bị gỡ mà settings còn hook, mọi lệnh Bash sẽ bị chặn. Cần một thông báo rõ và `8sync ccc kit --remove`. Đây là lý do v0.66 từng chọn không bật cờ này. Có thể bật mặc định, hoặc chỉ bật trong `ccc policy --strict-hooks`.

### P0-2. False positive heredoc ghi file
Đo trên release build mới từ HEAD sạch `e4c94fa`:

| Lệnh | Kết quả | Đúng? |
|---|---|---|
| `cat > n.md <<'EOF' … rm -rf ~ … EOF` | deny | sai (false positive) |
| `cat > n.md` với body chứa `rm -rf /` | deny | sai (false positive) |
| `tee n.md <<EOF` với body chứa `rm -rf ~` | deny | sai (false positive) |
| `cat > n.md` với body chứa `dd of=/dev/sda` | pass | đúng |
| `bash <<'EOF' rm -rf ~ EOF` | deny | đúng |

Researcher B gặp đúng lỗi này khi ghi notes (theo báo cáo trả về của agent). Nguyên nhân: backstop raw-text cố ý không nhìn cấu trúc. Nó quét từng đoạn tách theo `\n ; | &` (danger.rs:122-128), nên không biết dòng nào là body heredoc.

Cách sửa:
- Chỉ bỏ qua body khi **parser** xác định heredoc không đổ vào shell.
- Lệch thiết kế thì giữ deny. Đã có đường thoát: Write tool, và thông báo deny gợi ý điều này (danger.rs:195).
- Bắt buộc có test hồi quy cho:
  - `cat <<EOF | sh`
  - `cat <<EOF > x; sh x`
  - `eval "$(cat <<EOF …)"`
  - `bash <<EOF`

Ghi chú: guard cũng chặn khi Write file `.md` chứa marker routing subscription, ví dụ verifier trích code Forge. Đây là chặn đúng thiết kế. Nếu cần ghi tài liệu nghiên cứu có trích code, nên có cơ chế cho phép rõ ràng, ví dụ thư mục `outputs/.research/`. Đây là tuỳ chọn; mặc định giữ chặn.

## P1 — `/planning` (opt-in, cho task lớn có người duyệt)

### Học được gì
- **omp** [1]:
  - Plan mode chặn write/edit bằng code (tools/plan-mode-guard.ts:129-150). Bash chỉ bị chặn bằng prompt.
  - Chuẩn plan: "người không có context làm được mọi bước, không phải quyết định thiết kế, và biết khi nào xong" (plan-mode-active.md:116).
  - Có 5 lựa chọn khi duyệt: context mới, compact, giữ, refine, lưu.
  - Plan được tiêm lại sau compaction và giao cho subagent.
  - omp **cấm** các section Non-goals/Alternatives/Risks: plan là "execution spec, not design doc".
- **ForgeCode** [2]:
  - Plan gồm `- [ ]`, Verification criteria, Risks, Assumptions.
  - Lưu ở `plans/YYYY-MM-DD-<task>-vN.md`, có script lint (validate-plan.sh:55,144-157).
  - Trạng thái checkbox: `[ ] [~] [x] [!]`.
  - Không có cổng duyệt.
- **Feynman** [2]: có scale gate (việc nhỏ thì không lập plan), ledger và decision log. Không có cổng duyệt mặc định.
- **superpowers, ECC `/plan`, spec-kit** [3]:
  - Luồng chung: plan trong repo → duyệt → bước nhỏ, kiểm được → mỗi bước một subagent mới → review cuối.
  - ECC: "MUST receive user approval before proceeding" (commands/plan.md:17).
  - superpowers có 298,183 sao (gh api, 2026-10-13).
- **Claude Code native** [3]:
  - Plan mode bật bằng Shift+Tab, `/plan` hoặc `--permission-mode plan`.
  - Hộp ExitPlanMode có 3 lựa chọn, Ctrl+G để sửa plan, và `showClearContextOnPlanAccept`.
  - `PreToolUse(ExitPlanMode)` nhận `plan` và `planFilePath`.
  - `PostToolUse` nhận `tool_response.plan` và `tool_response.filePath`.
  - `plansDirectory` mặc định là `~/.claude/plans`.
  - ccc chưa dùng gì trong số này (grep ccc.rs).

### Khác gì cái đang có
| | Plan mode trần | `/ship` hiện tại | `/planning` đề xuất |
|---|---|---|---|
| Plan có người duyệt | có, nhưng format tự do | không (tự chủ) | có, kèm lint tối thiểu |
| Plan lưu trong repo, có version | không (`~/.claude/plans`) | không | có |
| Checkbox ↔ task list | không | Claude tự làm | hook giữ đồng bộ |
| Sống qua compact/clear | không chắc | không | có (P2-3) |

`/ship` và các luồng headless/pm/`-p` **không** dùng `/planning`, vì không có người bấm duyệt (quy ước "tự chủ, không xin phép từng bước"). Chúng chỉ dùng chung file plan và lint.

### Thiết kế
0. **Spike trước (~1 giờ, với `claude` thật).** Kiểm ba hành vi:
   - (a) Sau khi hook deny `ExitPlanMode`, Claude có sửa plan rồi nộp lại không?
   - (b) `additionalContext` của `PostToolUse(ExitPlanMode)` có làm Claude tạo task không?
   - (c) Khi chọn "clear context and accept", hook có chạy không, và `SessionStart` matcher `clear` có tiêm lại được plan không?

   Điểm nào fail thì cắt bước tương ứng.
1. `/planning <việc>` (skill): chạy scale gate trước. Việc nhỏ thì làm luôn, không lập plan.
2. Vào plan mode native. Khám phá bằng `explore` (Haiku, read-only). Chỉ hỏi bằng AskUserQuestion khi có quyết định sản phẩm thật.
3. Format tối thiểu, bắt buộc:
   - Mục tiêu
   - Các bước, mỗi bước có ID và một lệnh kiểm chứng, ví dụ `- [ ] [T1] … — verify: <lệnh>`
   - Tiêu chí xong

   Thêm Giả định, Rủi ro/rollback và Decision log **chỉ khi** plan lớn (theo omp: plan là spec để thực thi).

   Lưu ở `plans/YYYY-MM-DD-<slug>-vN.md`, qua `plansDirectory: "./plans"`, chỉ đặt khi user chưa đặt.
4. Hook `PreToolUse(ExitPlanMode)` native: lint tối thiểu. Không có checkbox, hoặc có bước thiếu `verify:` → deny kèm lý do. Hơn Forge/Feynman, hai bên đó không có cổng.
5. Duyệt bằng hộp ExitPlanMode chính chủ, không tự vẽ UI. Overlay annotate theo section của omp: khả năng port qua Mods chưa kiểm chứng.
6. Hook `PostToolUse(ExitPlanMode)`:
   - lưu bản đã duyệt
   - ghi checklist vào `su-code/STATE.md`
   - tiêm context "tạo task `[Tn]` cho mỗi bước"

   Hook `TaskCompleted` ánh xạ task sang dòng `[Tn]` theo ID rồi đánh dấu `[x]`. Hook này đã được đăng ký async cho HQ, chỉ thêm một vai trò.
7. P2-3: `PreCompact`/`PostCompact` và `SessionStart` (compact, clear) tiêm lại plan đang active.
8. Chống lệch (P2-1):
   - Còn `[Tn]` mở → nhắc **một lần**, theo `stop_hook_active` của gate hiện tại.
   - Bước outward-facing (deploy, publish…) **không** buộc làm tiếp.
   - Bước fail → đánh `[!]` kèm lý do → viết `-vN+1` với một dòng decision log → duyệt lại.
   - Bộ đếm số lần re-plan lưu trong file plan (gate không giữ trạng thái).
   - Không bật đồng thời `/goal` và gate: cả hai chạy sau mỗi lượt (suy luận, chưa kiểm).
9. Thực thi: Opus lập plan, `task` (Sonnet) làm các bước độc lập song song, `reviewer` chạy cuối. Trước khi báo xong, mỗi `[x]` phải có output lệnh làm bằng chứng.

Caveat: plan mode **không phải cơ chế bảo mật**. Bash vẫn chạy được trong plan mode; bảo mật là việc của guard.

Công sức thực tế:
- 1 skill
- PreToolUse và PostToolUse trên ExitPlanMode
- thêm vai trò cho TaskCompleted
- PreCompact và SessionStart(clear)
- mở rộng gate
- lint tối thiểu

Effort mức vừa, và phải làm cùng P2-1 và P2-3.

Luật: chỉ dùng cơ chế chính chủ, chỉ mượn ý tưởng. Nếu chép nguyên văn chữ từ Forge (Apache-2.0) thì phải giữ NOTICE. `THIRD_PARTY_NOTICES.md` hiện chưa có mục Apache-2.0, và đang ghi Feynman `4cec627`.

## P2/P3 — tóm tắt
- **P2-1** ForgeCode `PendingTodosHandler` nhắc khi còn todo mở, dedup theo tập todo (pending_todos.rs:25-99) [2].
- **P2-2** Ngưỡng ở các nguồn: CowAgent nhắc ở lần 3 (agent_stream.py:1241-1264) và dừng ở 5; omp dùng ngưỡng 5 (session/settings.ts:283-293); Forge có doom_loop.rs. **Chốt đề xuất: nhắc ở lần 3, deny ở lần 5 lặp cùng tool+args, trong một session.** Làm bằng PostToolUse + PreToolUse native và một file state, trong ngân sách ≤ 15 ms.
- **P2-4** Guard hiện **cố ý** cho `git push` thường đi qua (test danger.rs:2465-2467). `git push` không nằm trong ALLOW (ccc.rs:355-363), nên vẫn qua permission prompt/classifier. Hành vi này chưa đo trên default, auto và `-p`. Căn cứ nội bộ: AGENTS.md:279 ("không tự `push`/PR ở L3 mặc định"). Đề xuất: đo trước, sau đó chỉ thêm ask cho deploy (`vercel --prod`, `encore … deploy`), publish (`npm`/`cargo publish`) và nhắn tin. Lưu ý: `ask` thành denial dưới `-p`, có thể làm gãy luồng pm/headless.
- **P2-5** `statusLine` là script nhận JSON session qua stdin. ccc chưa dùng [3].
- **P2-6** omp: 12 lệnh sửa mà không cập nhật todo thì nhắc, tối đa 2 lần mỗi chu kỳ (todo-tracker.ts) [1]. `additionalContext` của PostToolUse có trong docs; hiệu quả chưa kiểm.
- **P3-1 → P3-2** Làm redact trước. CowAgent evolution [2]: mặc định SILENT, có danh sách "Do NOT capture", có Deep Dream gộp memory. Làm local, git là undo, không daemon gọi Claude. Lọc client/PII bằng chính cơ chế redact của P3-1. Giá trị chưa đo.
- **P3-3** `claude plugin eval` (v2.1.269+) so với baseline không plugin; mỗi run là một call thật [3]. Chỉ đo, không train: Commercial Terms D.4(a), Consumer Terms (consumer-terms.md:23) [4].
- **P3-6** Consumer Terms §3: tự động hoá chỉ "via an Anthropic API Key or where we otherwise explicitly permit it". Trang support (2026-10-07) nói `claude -p`/Agent SDK vẫn dùng subscription limits. Vì vậy Console key là **lựa chọn bảo thủ, không bắt buộc**. Nó tốn tiền API và xung đột với `forceLoginMethod: "claudeai"` mà `ccc policy` đặt (ccc.rs:871,956).

## Luật cho các đề xuất trên [4]
- **Được:**
  - hook gọi Claude, `/goal`
  - nhiều session hoặc agent team dưới một login chính chủ
  - Channels chính chủ, allowlist chỉ có owner
  - plugin public, không dùng tên hay logo Claude Code làm tên sản phẩm
  - eval chỉ để đo
  - mượn code MIT/Apache, có giữ notice
- **Không:**
  - chia login, hoặc route credential subscription cho tool hay người khác
  - proxy qua subscription: ghi rõ trong AUP "Effective November 12, 2026"; bản đang áp dụng chưa có câu này, nhưng kit tuân theo ngay
  - train trên output
  - copy code Claude Code: repo ghi "All rights reserved", terms cấm reverse engineer/duplicate
  - copy system prompt Claude Code: đây là quy tắc nội bộ 8 Sync, terms không có điều khoản nêu tên "system prompt"

## Không làm
- omp `cache-warmer` (replay request để giữ prompt cache) và `anthropic-slow-mode` (dùng header rate-limit của subscription OAuth). Đánh giá "không làm" là phán đoán rủi ro, không dựa trên điều khoản cụ thể.
- Hook `context` của omp sửa từng request: cần proxy [1].
- Provider `claude_code` của ForgeCode: OAuth của Claude Code, đi kèm header và system prompt tự xưng [2]. Login "Claude Max" của Feynman [2].
- claude-code-router: gateway chuyển Claude Code sang provider khác = proxy [3].
- claude-squad: AGPL, không chép code [3].
- claude-mem: README ghi mặc định là hosted, nhưng câu này nằm trong mục Grok Bot, phạm vi chưa rõ [3]. Nếu dùng thì phải bật local.

## Caveats
- Số sao lấy qua GitHub API ngày 2026-10-13.
- Changelog Claude Code chỉ đọc ~100k/1.05M ký tự đầu, nên chưa biết ngày ra mắt của `/goal`, agent teams, `asyncRewake` [3].
- Chưa đọc: Kiro specs, Conductor (closed source), trang Mods [3].
- CowAgent "không có planning": kết quả grep agent/, channel/, bridge/, skills/ [2].
- Các mục "chưa kiểm" ở P1 (spike), P2-4 (đo push) và P2-6 phải đo trước khi build.

## Sources
1. omp notes — outputs/.research/ccc-harness-next/omp.md (oh-my-pi @7738a3f082, MIT)
2. ForgeCode/Feynman/CowAgent notes — outputs/.research/ccc-harness-next/forge-feynman-cow.md (forge @8703dec Apache-2.0; feynman @d28d964 MIT; CowAgent @aa5f4c9 MIT)
3. Hot harnesses + Claude Code features — outputs/.research/ccc-harness-next/hot-harnesses.md (code.claude.com/docs; GitHub API 2026-10-13)
4. Compliance + ccc inventory — outputs/.research/ccc-harness-next/compliance-gap.md (docs/legal/anthropic snapshot; anthropic.com/legal; code.claude.com legal-and-compliance; support.claude.com)
5. Local repro 2026-10-13: `cargo build --release` from clean `e4c94fa` (06:30), `8sync ccc hook guard` with 5 heredoc cases.
