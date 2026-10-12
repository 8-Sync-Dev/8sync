# 8sync ccc — đề xuất bước tiếp theo (chỉ đề xuất, chưa làm) — 2026-10-13

Base: 8sync main `e4c94fa` (sau v0.66.0, chưa push), Claude Code 2.1.296. Nguồn đọc local (không chạy code clone): oh-my-pi 7738a3f082, ForgeCode 8703dec, Feynman d28d964, CowAgent aa5f4c9, anthropics/claude-code 3deb873, claude-plugins-official f359d43; web: code.claude.com/docs, GitHub API (2026-10-13), anthropic.com/legal. Không phải tư vấn pháp lý.

## TL;DR — xếp hạng

| # | Đề xuất | Giá trị | Công sức | Rủi ro luật | Học từ |
|---|---|---|---|---|---|
| P0-1 | Sửa false positive guard: heredoc ghi file bị backstop deny | cao | thấp | không | đo local [5] |
| P0-2 | Guard "outward actions": `git push` thường, deploy, publish, nhắn tin → ask | cao | thấp | **giảm** rủi ro (AUP agentic) | [4] |
| P1 | **`/planning`** (skill + 3 hook native) — mục riêng bên dưới | rất cao | thấp-vừa | không (native) | omp, Forge, Feynman, superpowers, ECC, spec-kit [1][2][3] |
| P2-1 | Stop gate: còn task/checkbox chưa xong → làm tiếp | cao | thấp | không | Forge pending-todos [2] |
| P2-2 | Loop breaker (lặp cùng tool+args: nhắc 3 → chặn 5; 8 lỗi → dừng) | cao | thấp-vừa | không | CowAgent, Forge, omp [1][2] |
| P2-3 | `PreCompact`/`PostCompact` giữ plan + STATE qua compaction | vừa-cao | thấp | không | omp [1][3] |
| P2-4 | Nhắc cập nhật todo giữa chừng (N lệnh sửa không cập nhật task) | vừa | thấp | không | omp [1] |
| P2-5 | Statusline: plan x/y, verify xanh/đỏ, goal | vừa | thấp | không | CC native [3] |
| P3-1 | Guard file generated (`@generated`, Encore gen) | vừa | thấp | không | omp [1] |
| P3-2 | Redact secret trong digest session-start / memory | vừa | thấp | **giảm** rủi ro | omp [1] |
| P3-3 | `/evolve` (rút bài học, mặc định im lặng, list "không ghi") + `/consolidate` KNOWLEDGE hàng tuần | cao | vừa | có điều kiện (local, không PII/client) | CowAgent [2] |
| P3-4 | Eval kit: `claude plugin eval` + luật "đổi prompt kit phải có số trước/sau" | cao | vừa | có điều kiện (chỉ đo, không train; tốn call) | Feynman, CC [2][3] |
| P3-5 | Mặc định cho `claude -p`/headless: Console key, giới hạn turn/budget | vừa | thấp | **giảm** rủi ro | [4] |
| P3-6 | Câu chữ ask gate + luật orchestrate cho `/ship`/pm | vừa | thấp | không | omp [1] |

Không làm (vi phạm hoặc không port được): xem cuối.

## P0 — sửa trước khi release

**P0-1. Guard chặn nhầm heredoc ghi file.** Đo trên release build của `e4c94fa`: `cat > outputs/n.md <<'EOF' … rm -rf ~ … EOF` → **deny**; tương tự với text `rm -rf /`, `dd of=/dev/sda` trong body. Body ghi vào file là dữ liệu, không chạy. Nguyên nhân: raw-text backstop quét cả body heredoc. Hướng sửa: backstop bỏ qua body heredoc/here-string khi lệnh nhận là không phải shell (`cat`, `tee`, `>` file), vẫn quét khi body đổ vào `bash`/`sh`/`pwsh`. Researcher B gặp đúng lỗi này khi ghi notes [2]. [5]

**P0-2. Hành động ra ngoài.** Guard hiện chỉ chặn force-push; không có rule cho `git push` thường, deploy (`vercel --prod`, `encore … deploy`…), publish (`npm publish`, `cargo publish`), gửi tin nhắn. AUP: operator chịu trách nhiệm cho mọi hành động agent làm qua tools [4: usage-policy.md:197]. Đề xuất: `ask` (thành denial dưới `-p`); quy tắc 8 Sync đã coi push/deploy là cần hỏi. [4]

## P1 — `/planning` cho ccc

### Học được gì
- **omp** [1]: plan mode thật — chặn write/edit bằng code (tools/plan-mode-guard.ts:129-150), bash chỉ bằng prompt; chuẩn chất lượng "người lạ đọc plan làm được mọi bước không cần quyết định thiết kế và biết khi nào xong" (plan-mode-active.md:116); mỗi lượt buộc "hỏi hoặc nộp plan"; review 5 lựa chọn (thực thi context mới / compact / giữ / refine / lưu); plan được tiêm lại sau compaction và giao cho subagent. Overlay annotate theo section **không port được** (TUI Claude Code không mở rộng kiểu đó).
- **ForgeCode** [2]: format Objective / `- [ ]` / Verification criteria / Risks / Alternatives / Assumptions; file `plans/YYYY-MM-DD-<task>-vN.md` + script lint (validate-plan.sh:55,144-157); trạng thái `[ ] [~] [x] [!]`; **không có cổng duyệt**.
- **Feynman** [2]: scale gate trước khi lập plan (việc nhỏ thì không plan), ledger + decision log + verification log; không cổng duyệt mặc định.
- **superpowers / ECC / spec-kit** [3]: brainstorm → plan trong repo → duyệt → task nhỏ có kết quả kiểm được → thực thi từng task bằng subagent mới + review cuối. ECC: "MUST receive user approval before proceeding". spec-kit: lặp implement → converge tới khi khớp spec.
- **Claude Code native** [3]: plan mode (Shift+Tab, `/plan`, `--permission-mode plan`), duyệt qua ExitPlanMode (3 lựa chọn, Ctrl+G sửa plan, `showClearContextOnPlanAccept`); hook `PreToolUse`/`PostToolUse` trên `ExitPlanMode` nhận `plan` + `planFilePath`; `plansDirectory` (mặc định `~/.claude/plans`) để giữ plan trong repo. ccc chưa dùng gì trong số này (grep ccc.rs).

### Thiết kế đề xuất (chỉ dùng cơ chế chính chủ)
1. **`/planning <việc>`** (skill trong kit): scale gate trước — việc nhỏ/rõ thì nói "không cần plan" và làm luôn.
2. **Vào plan mode native**; khám phá bằng `explore` (Haiku, read-only) song song; hỏi bằng AskUserQuestion **chỉ** cho quyết định sản phẩm thật (ask gate sẵn có lọc phần còn lại).
3. **Format plan** (gộp Forge + Feynman + omp): Mục tiêu · Ngoài phạm vi · Giả định · Các bước `- [ ]` (mỗi bước một hành động + lệnh kiểm chứng) · Tiêu chí xong (lệnh chạy được) · Rủi ro & rollback · Decision log. Lưu `plans/YYYY-MM-DD-<slug>-vN.md` qua `plansDirectory: "./plans"` (chỉ đặt khi chưa có).
4. **Cổng chất lượng**: hook `PreToolUse(ExitPlanMode)` native — thiếu section bắt buộc hoặc bước không có lệnh kiểm chứng → deny kèm lý do (Claude sửa plan rồi nộp lại). Đây là chỗ hơn Forge/Feynman (không có cổng) và hơn plan mode trần.
5. **Duyệt**: hộp ExitPlanMode chính chủ của Claude Code (không tự vẽ UI). Muốn 5 lựa chọn kiểu omp thì thêm AskUserQuestion sau duyệt: thực thi context mới / giữ context / refine section nào.
6. **Plan → task list**: hook `PostToolUse(ExitPlanMode)` lưu bản đã duyệt + ghi checklist vào `su-code/STATE.md` + đưa context "tạo một task cho mỗi `- [ ]`" (hook không gọi TaskCreate được; cách tiêm context này **chưa kiểm chứng**). Hook `TaskCompleted` (kit đã có cho HQ) đánh dấu `[x]` trong file plan → file và task list không lệch.
7. **Giữ plan khi chạy dài**: `PreCompact`/`SessionStart(compact)` tiêm lại plan đang active (đường dẫn trong digest sẵn có).
8. **Chống lệch**: Stop gate (P2-1) — còn `- [ ]` → làm tiếp; bước fail → `[!]` + lý do; 1-2 lần → viết `-vN+1` kèm dòng decision log rồi duyệt lại; quá nữa thì hỏi owner. Không bật đồng thời `/goal` và gate (cả hai chạy sau mỗi lượt, có thể đá nhau [2]).
9. **Thực thi**: Opus lập plan, `task` (Sonnet) làm các bước độc lập song song, `reviewer` cuối; "đọc lại plan, mọi ô có bằng chứng lệnh" trước khi báo xong.
10. **Điều kiện**: `ccc policy` tắt bypass để plan mode thật sự read-only [2].
Công sức: 1 skill + 2 hook native (lint, archive) + mở rộng gate/digest. Luật: chỉ cơ chế chính chủ; mượn ý tưởng (omp/Feynman/superpowers MIT, Forge Apache-2.0 — nếu chép chữ thì giữ notice).

## P2/P3 — chi tiết ngắn
- **P2-1** Forge `PendingTodosHandler` nhắc khi còn todo, dedup theo tập todo (pending_todos.rs:25-99) [2]. Gắn vào gate native: đọc task/plan còn mở.
- **P2-2** CowAgent: md5(args) — 3 lần giống nhau nhắc, 5 lần dừng, 3 lỗi cùng args dừng (agent_stream.py:819-880); Forge doom_loop.rs:12-38; omp ngưỡng 5 (tool-call-loop-guard.ts) [1][2]. Native: PostToolUse + ring buffer theo session.
- **P2-3** CC có `PreCompact`/`PostCompact`; ccc chưa dùng [3].
- **P2-4** omp: 12 lệnh sửa không cập nhật todo → nhắc, tối đa 2 lần/chu kỳ (todo-tracker.ts:17-26,310-340) [1]. `additionalContext` trên PostToolUse **chưa kiểm chứng**.
- **P2-5** statusLine là script nhận JSON session qua stdin; ccc chưa dùng [3].
- **P3-3** CowAgent evolution: mặc định SILENT + danh sách "Do NOT capture" (evolution/prompts.py:23-79), Deep Dream gộp memory (summarizer.py:53-90) [2]. Làm local, git là undo, không daemon gọi Claude.
- **P3-4** `claude plugin eval` (v2.1.269+), so với baseline không plugin, mỗi lần chạy là call thật [3]; Feynman evals README:3,9 [2]. Chỉ đo, không train (usage-policy.md:133) [4].
- **P3-5** `claude -p`/Agent SDK vẫn dùng subscription limits (support.claude.com 2026-10-07) nhưng Consumer Terms §3 chỉ cho tự động hoá "via an Anthropic API Key or where we otherwise explicitly permit it"; "ordinary, individual usage" không có số cụ thể → chạy không người dùng Console key [4].

## Luật — tóm tắt cho các đề xuất trên [4]
- Được: hook gọi Claude, `/goal`, nhiều session/agent team dưới **một** login chính chủ, Channels chính chủ có allowlist chỉ owner, plugin public (không dùng tên/logo Claude Code làm tên sản phẩm), eval chỉ để đo, mượn code MIT/Apache có giữ notice.
- Không: chia login/route credential subscription cho tool/người khác; proxy qua subscription (ghi rõ trong AUP bản hiệu lực **12/11/2026**); train trên output; copy code/system prompt Claude Code (repo "All rights reserved"; terms cấm reverse engineer/duplicate).

## Không làm
- omp `cache-warmer` + `anthropic-slow-mode` (replay request, bắt chước `/low-priority` qua header rate-limit subscription); hook `context` sửa từng request (cần proxy) [1].
- ForgeCode provider `claude_code`, Feynman login "Claude Max" (giả client) [2].
- claude-code-router (gateway chuyển Claude Code sang provider khác) — proxy [3]; claude-mem mặc định gửi memory lên dịch vụ hosted — trái ZUS local-first [3]; claude-squad AGPL — không chép code [3].
- Overlay review plan kiểu omp (không port được vào TUI Claude Code) [1].

## Caveats
- Số sao GitHub đọc qua API ngày 2026-10-13 [3]; changelog Claude Code chỉ đọc ~100k/1.05M ký tự đầu → ngày ra mắt `/goal`, agent teams, `asyncRewake` chưa xác định [3].
- Kiro specs, Conductor (closed source), trang Mods: chưa đọc [3].
- CowAgent "không có planning" là kết quả grep agent/, channel/, bridge/, skills/ [2].

## Sources
1. omp notes — outputs/.research/ccc-harness-next/omp.md (oh-my-pi @7738a3f082, MIT)
2. ForgeCode/Feynman/CowAgent notes — outputs/.research/ccc-harness-next/forge-feynman-cow.md (forge @8703dec Apache-2.0; feynman @d28d964 MIT; CowAgent @aa5f4c9 MIT)
3. Hot harnesses + Claude Code features — outputs/.research/ccc-harness-next/hot-harnesses.md (code.claude.com/docs, GitHub API 2026-10-13)
4. Compliance + ccc inventory — outputs/.research/ccc-harness-next/compliance-gap.md (docs/legal/anthropic snapshot; anthropic.com/legal; code.claude.com legal-and-compliance; support.claude.com)
5. Local repro 2026-10-13: `target/release/8sync.exe ccc hook guard` (build of e4c94fa) with 4 heredoc cases — 2 deny, 2 pass.
