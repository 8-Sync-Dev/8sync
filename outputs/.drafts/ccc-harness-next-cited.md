# 8sync ccc — đề xuất bước tiếp theo (chỉ đề xuất, chưa làm) — 2026-10-13

Base: 8sync main `e4c94fa` (sau v0.66.0, chưa push), Claude Code 2.1.296 (bản mới nhất trong changelog docs, ngày 2026-10-09; không phải bản cài trên máy này). Nguồn đọc local (không chạy code clone): oh-my-pi 7738a3f082, ForgeCode 8703dec, Feynman d28d964, CowAgent aa5f4c9, anthropics/claude-code 3deb873, claude-plugins-official f359d43; web: code.claude.com/docs, GitHub API (2026-10-13), anthropic.com/legal. Không phải tư vấn pháp lý.

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

**P0-1. Guard chặn nhầm heredoc ghi file.** Đo lại 2026-10-13 trên release build mới từ HEAD sạch `e4c94fa`: `cat > outputs/n.md <<'EOF' … rm -rf ~ … EOF` → **deny**; tương tự với text `rm -rf /` trong body → deny. Body chứa `dd if=/dev/zero of=/dev/sda` → **pass** (không bị chặn), body vô hại → pass. Body ghi vào file là dữ liệu, không chạy. Nguyên nhân: raw-text backstop quét cả body heredoc, chỉ cho lệnh xoá nhắm vào root/home/thư mục cấp cao/project (danger.rs:33-35, 122-128; thông báo deny tự nói "If this text is data (a here-doc…)" tại danger.rs:195) [8]. Hướng sửa: backstop bỏ qua body heredoc/here-string khi lệnh nhận là không phải shell (`cat`, `tee`, `>` file), vẫn quét khi body đổ vào `bash`/`sh`/`pwsh`. Researcher B gặp đúng lỗi này khi ghi notes (theo báo cáo trả về của agent, không nằm trong file notes); `tee n.md <<EOF` cũng bị deny, còn `bash <<EOF rm -rf ~` phải và vẫn bị deny. [5]

**P0-2. Hành động ra ngoài.** Guard hiện chỉ **deny** force-push (một số biến thể `git push --prune` thì ask, danger.rs:2364); không có rule cho `git push` thường (chạy thử: pass), deploy (`vercel --prod`, `encore … deploy`…), publish (`npm publish`, `cargo publish`), gửi tin nhắn (grep danger.rs/guard.rs: không có `publish`/`deploy`/`vercel`/`encore`) [8]. AUP: người dùng chịu trách nhiệm cho mọi hành động agent họ build/deploy làm qua tools: "Users are responsible for ensuring that agents they build or deploy, including actions those agents take through tools, browsers, or connected systems, comply with this Usage Policy" [4: usage-policy.md:197]; lưu ý bản AUP này ghi "Effective November 12, 2026", tức chưa hiệu lực tại 2026-10-13 [7]. Đề xuất: `ask` (thành denial dưới `-p`, danger.rs:20-21) [8]. Về quy tắc 8 Sync: ccc.rs:360-363 ghi "commits, pushes and anything that discards work stay reviewed" (push: có căn cứ); với deploy/publish chưa tìm thấy điều khoản 8 Sync nói rõ [UNVERIFIED]. [4]

## P1 — `/planning` cho ccc

### Học được gì
- **omp** [1]: plan mode thật — chặn write/edit bằng code (tools/plan-mode-guard.ts:129-150), bash chỉ bằng prompt (grep `tools/bash.ts` + `exec/*.ts` không thấy check plan mode; mức grep, chưa đọc hết); chuẩn chất lượng "người lạ đọc plan làm được mọi bước không cần quyết định thiết kế và biết khi nào xong" (plan-mode-active.md:116); khi một lượt kết thúc mà không có tool call, host ép `tool_choice: required` + nhắc "hỏi hoặc nộp plan", tối đa 3 lần (agent-session.ts:10622-10665, `PLAN_MODE_REMINDER_MAX = 3`); review 5 lựa chọn (thực thi context mới / compact / giữ / refine / lưu; interactive-mode.ts:6567-6573); plan được tiêm lại sau compaction và giao cho subagent. Overlay annotate theo section: **chưa rõ có port được không** — ghi chú gốc cho rằng TUI Claude Code không mở rộng kiểu đó, nhưng docs có thành phần "Mods" (live pane/panel, band trên prompt) mà trang chi tiết chưa đọc [UNVERIFIED] [3].
- **ForgeCode** [2]: format Objective / `- [ ]` / Verification criteria / Risks / Alternatives / Assumptions; file `plans/YYYY-MM-DD-<task>-vN.md` + script lint (validate-plan.sh:55,144-157); trạng thái `[ ] [~] [x] [!]` (skill execute-plan SKILL.md:36-38); **không có cổng duyệt** (muse.md:34-36: "Make reasonable assumptions … rather than asking").
- **Feynman** [2]: scale gate trước khi lập plan (việc nhỏ thì không plan), ledger + decision log + verification log; không cổng duyệt mặc định.
- **superpowers / ECC / spec-kit** [3]: brainstorm → plan trong repo → duyệt → task nhỏ có kết quả kiểm được → thực thi từng task bằng subagent mới + review cuối. ECC: "MUST receive user approval before proceeding" (commands/plan.md:17). spec-kit: lặp implement → converge tới khi khớp spec (README:77,90).
- **Claude Code native** [6]: plan mode (Shift+Tab, `/plan`, `--permission-mode plan`), duyệt qua ExitPlanMode (3 lựa chọn, Ctrl+G sửa plan, `showClearContextOnPlanAccept`; permission-modes.md:286-292); hook `PreToolUse` trên `ExitPlanMode` nhận `plan` + `planFilePath` trong `tool_input`, còn `PostToolUse` nhận `tool_response` có `plan` + `filePath` (hooks.md:1891-1901); `plansDirectory` (mặc định `~/.claude/plans`; settings-reference.md "plansDirectory") để giữ plan trong repo. ccc chưa dùng gì trong số này (grep ccc.rs + ccc/*.rs: 0 hit cho `plansDirectory`, `ExitPlanMode`, `PreCompact`, `statusLine`) [8].

### Thiết kế đề xuất (chỉ dùng cơ chế chính chủ)
1. **`/planning <việc>`** (skill trong kit): scale gate trước — việc nhỏ/rõ thì nói "không cần plan" và làm luôn.
2. **Vào plan mode native**; khám phá bằng `explore` (Haiku, read-only; assets/claude/agents/explore.md:4-5) song song; hỏi bằng AskUserQuestion **chỉ** cho quyết định sản phẩm thật (ask gate sẵn có lọc phần còn lại) [8].
3. **Format plan** (gộp Forge + Feynman; omp **không** có các mục Ngoài phạm vi/Rủi ro/Alternatives — plan-mode-active.md:16,99 cấm các mục này, nên đây là lựa chọn của ta, không phải học từ omp): Mục tiêu · Ngoài phạm vi · Giả định · Các bước `- [ ]` (mỗi bước một hành động + lệnh kiểm chứng) · Tiêu chí xong (lệnh chạy được) · Rủi ro & rollback · Decision log. Lưu `plans/YYYY-MM-DD-<slug>-vN.md` qua `plansDirectory: "./plans"` (chỉ đặt khi chưa có; docs: đường dẫn ngoài project root hoặc có backslash trên macOS/Linux sẽ rơi về `~/.claude/plans`) [6].
4. **Cổng chất lượng**: hook `PreToolUse(ExitPlanMode)` native — thiếu section bắt buộc hoặc bước không có lệnh kiểm chứng → deny kèm lý do (docs: `deny` chặn tool call, lý do hiển thị cho Claude; hooks.md:1909-1910). Claude có sửa plan rồi nộp lại hay không: chưa thử [UNVERIFIED]. Đây là chỗ hơn Forge/Feynman (không có cổng) và hơn plan mode trần.
5. **Duyệt**: hộp ExitPlanMode chính chủ của Claude Code (không tự vẽ UI). Muốn 5 lựa chọn kiểu omp thì thêm AskUserQuestion sau duyệt: thực thi context mới / giữ context / refine section nào.
6. **Plan → task list**: hook `PostToolUse(ExitPlanMode)` lưu bản đã duyệt (đọc `tool_response.plan`) + ghi checklist vào `su-code/STATE.md` + đưa context "tạo một task cho mỗi `- [ ]`". `additionalContext` trên PostToolUse có trong docs (hooks.md, mục PostToolUse decision control) nhưng việc Claude có thật sự tạo task theo context đó **chưa kiểm chứng**; "hook không gọi TaskCreate được" cũng chưa có nguồn [UNVERIFIED]. Hook `TaskCompleted` (kit đã có cho HQ, ccc.rs:668) đánh dấu `[x]` trong file plan → file và task list không lệch [8].
7. **Giữ plan khi chạy dài**: `PreCompact`/`SessionStart(compact)` tiêm lại plan đang active (đường dẫn trong digest sẵn có). `PreCompact`/`PostCompact` và matcher `compact` của SessionStart đều có trong docs (hooks.md:308, 1193) [6].
8. **Chống lệch**: Stop gate (P2-1) — còn `- [ ]` → làm tiếp; bước fail → `[!]` + lý do; 1-2 lần → viết `-vN+1` kèm dòng decision log rồi duyệt lại; quá nữa thì hỏi owner. Không bật đồng thời `/goal` và gate (cả hai chạy sau mỗi lượt, có thể đá nhau; suy luận từ việc `/goal` là "wrapper around a session-scoped prompt-based Stop hook", chưa thử [UNVERIFIED]) [2].
9. **Thực thi**: Opus lập plan, `task` (Sonnet; task.md:4) làm các bước độc lập song song, `reviewer` cuối (reviewer.md:4-5); "đọc lại plan, mọi ô có bằng chứng lệnh" trước khi báo xong [8].
10. **Điều kiện**: `ccc policy` tắt bypass (`disableBypassPermissionsMode: "disable"`, ccc.rs:849,870) để plan mode thật sự read-only; docs nói trong terminal tương tác có bypass sẵn thì plan mode không chặn cứng (permission-modes.md:28,270) [6][8].
Công sức: 1 skill + 2 hook native (lint, archive) + mở rộng gate/digest. Luật: chỉ cơ chế chính chủ; mượn ý tưởng (omp/Feynman/superpowers MIT, Forge Apache-2.0 — nếu chép chữ thì giữ notice; THIRD_PARTY_NOTICES.md hiện chỉ liệt kê Feynman MIT, chưa có cơ chế cho Apache-2.0) [9].

## P2/P3 — chi tiết ngắn
- **P2-1** Forge `PendingTodosHandler` nhắc khi còn todo, dedup theo tập todo (pending_todos.rs:25-99) [2]. Gắn vào gate native: đọc task/plan còn mở.
- **P2-2** CowAgent: md5(args) — 3 lần thành công giống nhau thì chèn hint nhắc (agent_stream.py:1241-1264, chỉ khi turn >= 3), 5 lần giống nhau dừng, 3 lỗi liên tiếp cùng args dừng, 6 lỗi cùng tool dừng, 8 lỗi abort cả run (agent_stream.py:819-880); Forge doom_loop.rs:12-38 (ngưỡng 3); omp ngưỡng 5, bật mặc định (session/settings.ts:283-293; tool-call-loop-guard.ts) [1][2]. Native: PostToolUse + ring buffer theo session.
- **P2-3** CC có `PreCompact`/`PostCompact` (hooks.md bảng events); ccc chưa dùng [3][6][8].
- **P2-4** omp: 12 lệnh sửa không cập nhật todo → nhắc, tối đa 2 lần/chu kỳ (todo-tracker.ts:17-26,310-340) [1]. `additionalContext` trên PostToolUse có trong docs (hooks.md, PostToolUse decision control); hiệu quả thực tế chưa thử.
- **P2-5** statusLine là script nhận JSON session qua stdin; ccc chưa dùng [3].
- **P3-3** CowAgent evolution: mặc định SILENT (evolution/prompts.py:29-41) + danh sách "Do NOT capture" (prompts.py:103-), Deep Dream gộp memory (memory/summarizer.py:53-90) [2]. Làm local, git là undo, không daemon gọi Claude.
- **P3-4** `claude plugin eval` (v2.1.269+), so với baseline không plugin, mỗi lần chạy là call thật (plugin-evals doc) [3][6]; Feynman evals README:3,9 [2]. Chỉ đo, không train (usage-policy.md:133, bản hiệu lực 12/11/2026) [4].
- **P3-5** `claude -p`/Agent SDK vẫn dùng subscription limits (support.claude.com, cập nhật 2026-10-07) nhưng Consumer Terms §3 chỉ cho tự động hoá "via an Anthropic API Key or where we otherwise explicitly permit it"; "ordinary, individual usage" không có số cụ thể → chạy không người dùng Console key [4][7].

## Luật — tóm tắt cho các đề xuất trên [4]
- Được: hook gọi Claude, `/goal`, nhiều session/agent team dưới **một** login chính chủ, Channels chính chủ có allowlist chỉ owner, plugin public (không dùng tên/logo Claude Code làm tên sản phẩm), eval chỉ để đo, mượn code MIT/Apache có giữ notice.
- Không: chia login/route credential subscription cho tool/người khác; proxy qua subscription (ghi rõ trong AUP bản "Effective November 12, 2026", tức chưa hiệu lực tại 2026-10-13; AUP có bullet "Resell, proxy, or otherwise provide access to Claude through unauthorized means, including services that route requests through consumer subscriptions or misrepresent the product or client being used"; chưa rõ bản mới có được áp dụng trước ngày hiệu lực không [UNVERIFIED]) [7]; train trên output; copy code Claude Code (repo "All rights reserved", LICENSE.md:1; Consumer Terms cấm "decompile, reverse engineer", Commercial Terms D.4 cấm "reverse engineer or duplicate"); không điều khoản nào nêu riêng "system prompt", việc cấm sao chép prompt Claude Code là luật nội bộ 8 Sync (assets/claude/CLAUDE.md:4) [4][7][8].

## Không làm
- omp `cache-warmer` (replay request để giữ prompt cache, session/cache-warmer.ts:1-12) + `anthropic-slow-mode` (port `/low-priority`, dùng header rate-limit của subscription OAuth, session/anthropic-slow-mode.ts:1-20): không port vào Claude Code vì cần tự gửi request như một client riêng; kết luận "vi phạm" là phán đoán của ghi chú, không có điều khoản cụ thể cho cache-warmer [UNVERIFIED]; hook `context` sửa từng request (cần proxy) [1].
- ForgeCode provider `claude_code` (khi dùng OAuth, gắn beta header đặc thù của Claude Code cùng cờ OAuth; anthropic.rs:76-79); Feynman offer OAuth login "Claude Max" (commands.ts:843): dùng token subscription ngoài Claude Code, trái luật nội bộ và trang legal-and-compliance (OAuth chỉ cho Claude Code và app native của Anthropic) [2][7].
- claude-code-router (gateway chuyển Claude Code sang provider khác) — proxy [3]; claude-mem: README nói "Default is CMEM Pro, the hosted memory. Local observer is opt-in" nhưng câu này nằm trong mục cài cho Grok Bot, mặc định khi dùng với Claude Code chưa xác minh [UNVERIFIED]; có tính năng Cloud Sync tuỳ chọn sang cmem.ai — nếu dùng sẽ trái ZUS local-first nên chỉ cân nhắc khi tắt hẳn [3]; claude-squad AGPL-3.0 — không chép code [3].
- Overlay review plan kiểu omp (xem điểm chưa chắc ở trên; chưa kết luận không port được) [1].

## Caveats
- Số sao GitHub đọc qua API ngày 2026-10-13 [3] (kiểm lại cùng ngày: superpowers 298,183, khớp ghi chú 298,181 trừ vài sao); changelog Claude Code chỉ đọc ~100k/1.05M ký tự đầu → ngày ra mắt `/goal`, agent teams, `asyncRewake` chưa xác định [3].
- Kiro specs, Conductor (closed source), trang Mods: chưa đọc [3].
- CowAgent "không có planning" là kết quả grep agent/, channel/, bridge/, skills/ [2].
- Các mục dẫn ghi chú [1]-[3] mà bảng bên dưới đánh "OK (notes)" chỉ đối chiếu với file notes, chưa mở lại nguồn gốc.

## Sources
1. omp notes — outputs/.research/ccc-harness-next/omp.md (oh-my-pi @7738a3f082, MIT)
2. ForgeCode/Feynman/CowAgent notes — outputs/.research/ccc-harness-next/forge-feynman-cow.md (forge @8703dec Apache-2.0; feynman @d28d964 MIT; CowAgent @aa5f4c9 MIT)
3. Hot harnesses + Claude Code features — outputs/.research/ccc-harness-next/hot-harnesses.md (code.claude.com/docs, GitHub API 2026-10-13)
4. Compliance + ccc inventory — outputs/.research/ccc-harness-next/compliance-gap.md (docs/legal/anthropic snapshot; anthropic.com/legal; code.claude.com legal-and-compliance; support.claude.com)
5. Local repro 2026-10-13: `target/release/8sync.exe ccc hook guard` (binary mtime 12/10 21:16) with 4 heredoc cases — 2 deny (`rm -rf ~`, `rm -rf /`), 2 pass (`dd of=/dev/sda`, nội dung vô hại); verifier chạy lại cùng kết quả.
6. Claude Code docs (verifier đọc lại 2026-10-13): https://code.claude.com/docs/en/hooks.md, /settings-reference.md, /permission-modes.md, /plugin-evals.md, /changelog (2.1.295, 2.1.296)
7. Anthropic legal (verifier đọc lại 2026-10-13): https://www.anthropic.com/legal/aup (Effective November 12, 2026), https://www.anthropic.com/legal/consumer-terms (Effective October 8, 2025), docs/legal/anthropic/{usage-policy,consumer-terms,commercial-terms,claude-code-legal-and-compliance}.md, https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan
8. Code 8sync tại HEAD e4c94fa: crates/cli/src/verbs/ccc.rs, ccc/danger.rs, ccc/guard.rs, assets/claude/agents/*.md, assets/claude/CLAUDE.md
9. Clone read-only (không chạy code) ở C:\Users\Admin\research\gate-guard\src\{oh-my-pi,forge,CowAgent,feynman,claude-code}; THIRD_PARTY_NOTICES.md; `gh api` repos obra/superpowers, affaan-m/ECC, github/spec-kit, smtg-ai/claude-squad, thedotmack/claude-mem

## Bảng kiểm claim

| claim | nguồn | kết quả |
|---|---|---|
| Base `e4c94fa`, chưa push (4 commit ahead origin/main), sau tag v0.66.0 | `git log origin/main..HEAD`, `git tag` | OK |
| Hash 6 clone khớp (omp 7738a3f082, forge 8703dec, feynman d28d964, CowAgent aa5f4c9, claude-code 3deb873, plugins-official f359d43) | `git log -1` từng clone | OK |
| Claude Code 2.1.296 | changelog: entry mới nhất 2.1.296, 9/10/2026 | FIXED (làm rõ là bản mới nhất trong docs, không phải bản cài) |
| P0-1: heredoc body `rm -rf ~` → deny | chạy `8sync ccc hook guard` | OK |
| P0-1: heredoc body `rm -rf /` → deny | chạy lại | OK |
| P0-1: heredoc body `dd of=/dev/sda` → deny | chạy lại: pass; `dd` trần thì deny | FIXED (body dd pass) |
| P0-1: nguyên nhân raw-text backstop | danger.rs:33-35,122-128,195 | OK |
| P0-1: binary khớp HEAD | lead rebuilt release from clean HEAD `e4c94fa` (2026-10-13 06:30) and re-ran: heredoc→file `rm -rf ~`/`rm -rf /` deny, `dd` pass, `bash <<EOF rm -rf ~` deny, `tee` heredoc `rm -rf ~` deny | OK |
| P0-1: Researcher B gặp lỗi này khi ghi notes | ở báo cáo trả về của researcher B (không trong file notes): "My first attempt to write the notes was blocked by the `8sync` guard on the Bash heredoc"; verifier cũng bị guard chặn khi Write chuỗi beta-header OAuth (chặn đúng thiết kế) | OK (agent report) |
| P0-2: guard chỉ chặn force-push, không rule push thường/deploy/publish/nhắn tin | grep danger.rs/guard.rs; chạy `git push origin main` → pass; danger.rs:2364 | FIXED (thêm: một số `push --prune` là ask) |
| P0-2: ask thành denial dưới `-p` | danger.rs:20-21 | OK |
| P0-2: AUP "operator chịu trách nhiệm" | usage-policy.md:197 ("Users are responsible…"), header Effective 12/11/2026 | FIXED (dẫn đúng chữ, ghi chưa hiệu lực) |
| P0-2: quy tắc 8 Sync coi push là cần hỏi | ccc.rs:360-363 | OK (push) |
| P0-2: quy tắc 8 Sync coi deploy/publish là cần hỏi | không tìm thấy điều khoản rõ | UNVERIFIED |
| omp chặn write/edit bằng code plan-mode-guard.ts:129-150 | Read file | OK |
| omp bash chỉ bằng prompt | grep bash.ts/exec: 0 hit; plan-mode-active.md:3 | OK (mức grep) |
| omp chuẩn "người lạ…" plan-mode-active.md:116 | Read/grep dòng 116 | OK |
| omp "mỗi lượt buộc hỏi hoặc nộp plan" | agent-session.ts:10622-10665 (chỉ khi lượt không có tool call, cap 3) | FIXED |
| omp review 5 lựa chọn | interactive-mode.ts:6567-6573 | OK |
| omp plan tiêm lại sau compaction + giao subagent | notes S21/S22; plan-handoff.ts:23 có `loadOverallPlanReference` | OK (notes) |
| Overlay omp không port được | notes suy luận; hot-harnesses S46 cho thấy Mods (pane/panel) chưa đọc | UNVERIFIED |
| Forge format sections + lint validate-plan.sh:55,144-157 | validate-plan.sh:52-55,117-124,144-157 | OK |
| Forge trạng thái `[ ] [~] [x] [!]` | execute-plan SKILL.md:36-38 | OK |
| Forge không cổng duyệt | muse.md:34-36 | OK |
| Feynman scale gate, ledger, decision log, không cổng duyệt | notes S48-S51 | OK (notes) |
| superpowers/spec-kit quy trình | notes S55; spec-kit README:77,90 | OK |
| ECC "MUST receive user approval before proceeding" | `gh api` commands/plan.md:17 | OK |
| CC plan mode: 3 lựa chọn, Ctrl+G, showClearContextOnPlanAccept | permission-modes.md:286-292 | OK |
| ExitPlanMode hook nhận `plan` + `planFilePath` | hooks.md:1891-1901 (PreToolUse); PostToolUse dùng `filePath` | FIXED |
| `plansDirectory` mặc định `~/.claude/plans` | settings-reference.md "plansDirectory": "Default: unset, so Claude Code uses `~/.claude/plans`" | OK |
| PreCompact/PostCompact tồn tại | hooks.md bảng events (fetch) | OK |
| SessionStart matcher `compact` | hooks.md:308 | OK |
| `onFailure: "block"` ở 2.1.295 (không có trong draft, đã kiểm theo yêu cầu) | changelog 2.1.295 (8/10/2026) + hooks.md:461 | OK |
| ccc chưa dùng plansDirectory/ExitPlanMode/PreCompact/statusLine | grep ccc.rs + ccc/*.rs: 0 hit | OK |
| explore = Haiku read-only; task/reviewer = Sonnet | agents/*.md frontmatter | OK |
| "hook không gọi TaskCreate được" | không có nguồn | UNVERIFIED |
| `additionalContext` trên PostToolUse "chưa kiểm chứng" | hooks.md PostToolUse decision control: có field | FIXED (có trong docs; hiệu quả chưa thử) |
| Claude sửa plan và nộp lại sau deny ExitPlanMode | không có nguồn/test | UNVERIFIED |
| `TaskCompleted` hook kit đã có cho HQ | ccc.rs:668 | OK |
| `/goal` và Stop gate đá nhau | suy luận từ notes | UNVERIFIED |
| `ccc policy` tắt bypass; plan mode không chặn cứng khi có bypass | ccc.rs:849,870; permission-modes.md:28,270 | OK |
| Mục format plan "gộp omp" | plan-mode-active.md:16,99 cấm Non-Goals/Alternatives/Risks | FIXED (ghi rõ là lựa chọn của ta) |
| Forge pending_todos.rs:25-99 dedup theo tập todo | Read file | OK |
| Forge doom_loop.rs ngưỡng 3 | doom_loop.rs:12-38 | OK |
| omp loop guard ngưỡng 5 (tool-call-loop-guard.ts) | ngưỡng nằm ở session/settings.ts:283-293 | FIXED (sửa cite) |
| CowAgent: 5 lần dừng, 3 lỗi cùng args dừng, 8 lỗi abort | agent_stream.py:819-880 | OK |
| CowAgent: 3 lần giống nhau thì nhắc | agent_stream.py:1241-1264 (ngoài range đã cite; chỉ khi turn>=3 và thành công) | FIXED (sửa cite + điều kiện) |
| omp mid-run nudge 12 lệnh / 2 lần | todo-tracker.ts:17-26,310-340 | OK |
| CowAgent SILENT + Do NOT capture ở prompts.py:23-79 | SILENT :29-41; "Do NOT capture" :103 | FIXED (sửa cite) |
| Deep Dream summarizer.py:53-90 | summarizer.py:53-90, "Never fabricate" :108, "under 50 items" :122 | OK |
| `claude plugin eval` v2.1.269+, baseline, call thật | plugin-evals.md:7,22,29 | OK |
| Feynman evals README:3,9 | Read README | OK |
| Chỉ đo, không train (usage-policy.md:133) | usage-policy.md:133 | OK |
| support.claude.com: `claude -p` vẫn dùng subscription limits (2026-10-07) | fetch trang: "October 7, 2026" + "You can still use the Claude Agent SDK, claude -p…" | OK |
| Consumer Terms §3 trích "via an Anthropic API Key or where we otherwise explicitly permit it" | live consumer-terms (Effective October 8, 2025) + consumer-terms.md | OK |
| "ordinary, individual usage" không có số cụ thể | claude-code-legal-and-compliance.md:46 | OK |
| AUP effective 2026-11-12 | fetch live aup + usage-policy.md:4 | OK (thêm: chưa hiệu lực tại 13/10/2026) |
| AUP proxy bullet | usage-policy.md:134 (chữ đầy đủ) | OK |
| Bản AUP mới có áp dụng trước ngày hiệu lực không | Anthropic không nêu | UNVERIFIED |
| Luật "Được" (Channels allowlist, nhiều session một login, plugin public…) | notes S11/S12, compliance-gap A2/A3/A5 | OK (notes) |
| Claude Code repo "All rights reserved" | claude-code/LICENSE.md:1 | OK |
| Terms cấm reverse engineer/duplicate | consumer-terms.md:24; commercial-terms.md D.4 | OK |
| "Terms cấm copy system prompt" | không điều khoản nêu "system prompt"; là luật nội bộ assets/claude/CLAUDE.md:4 | FIXED |
| omp cache-warmer/slow-mode hoạt động như mô tả | cache-warmer.ts:1-12; anthropic-slow-mode.ts:1-20 | OK |
| cache-warmer/slow-mode là "vi phạm" | phán đoán, không có điều khoản | UNVERIFIED |
| Forge provider `claude_code` gắn beta header Claude Code | anthropic.rs:76-79; provider.rs:57 | OK |
| Feynman "Claude Max" OAuth login | commands.ts:843 | OK |
| Feynman login là "giả client" | không có bằng chứng giả client | FIXED (đổi thành "dùng token subscription ngoài Claude Code") |
| claude-code-router là gateway/proxy | notes S30 | OK (notes) |
| claude-mem mặc định gửi memory lên hosted | README:143 nằm trong mục Grok Bot | UNVERIFIED (phạm vi) |
| claude-squad AGPL-3.0 | `gh api` license | OK |
| Forge Apache-2.0; superpowers MIT | forge/LICENSE (Apache 2.0); `gh api` MIT | OK |
| Số sao superpowers (notes ghi 298k, nghi ngờ) | `gh api repos/obra/superpowers`: 298,183, MIT | OK |
| Changelog chỉ đọc 100k/1.05M ký tự | fetch lại: cùng giới hạn | OK |
| CowAgent không có planning; Kiro/Conductor/Mods chưa đọc | notes (grep) | OK (notes) |
