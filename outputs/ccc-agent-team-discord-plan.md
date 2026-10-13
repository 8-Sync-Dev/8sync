# Plan — ccc "Agent HQ": team agent tự chủ, tự tiến hoá, làm việc qua Discord

**Ngày:** 2026-10-12 · **Loại:** plan (không code) · **Nền:** 8sync ccc (PR #5), Claude Code 2.1.296
**Phương pháp:** clone + đọc CowAgent tại chỗ (`reference/CowAgent` @ `4266327`), research web 3 nhánh (Claude Code native + điều khoản, Discord, self-evolving agents), tự kiểm lại claim then chốt trong CHANGELOG/source. **Không phải tư vấn pháp lý.**

---

## 0. Trả lời nhanh

1. **CowAgent có OK làm nền không? → Không làm nền, chỉ mượn ý tưởng.** Repo tốt: MIT, 47.4k★, 499 file test, CI Python 3.11/3.13, Discord native [1]. Nhưng nó là một harness Python **thay thế** Claude Code: gọi thẳng Messages API bằng `claude_api_key` [2], không có đường nào dùng Claude Code CLI làm executor [3], và mặc định `FULL_ACCESS`, không có sandbox [4]. Lấy làm nền thì mất toàn bộ kit ccc (hook, gate, skill, verify) và mọi dòng code đều tính tiền API. **Mượn 4 thứ:** pattern Discord gateway, cách gọi `@tên` + `team.json`, prompt "evolution review" lúc rảnh kèm undo/backup, và permission modes + cron scheduler (§4).
2. **Có cần deep-research thêm không? → Đã làm, kết quả nằm trong file này.** Kết luận: **dựng trên Claude Code chính chủ** (agent teams + background agents + Channels Discord chính chủ + hooks), cộng thêm một lớp "scribe" nhỏ của 8sync đẩy hoạt động của team lên Discord cho đẹp. Không cần framework ngoài.
3. **Tự tiến hoá phải làm kiểu "tiến hoá văn bản có kiểm định"**, không cho agent tự viết lại harness. Bằng chứng: skill do model tự viết **không giúp gì trung bình** (SkillsBench) [5]. Cập nhật playbook kiểu ACE (thêm/sửa từng mục nhỏ) thì có lợi đo được [6]. Vòng tự sửa không có verifier độc lập sẽ gian lận test (DGM giả log) [7].
4. **Luật:** một chủ dùng subscription Max để lái session Claude Code chính chủ của mình (channels, `--bg`, routines) là trong phạm vi được document. **Fleet chạy 24/7 nhiều vai, hoặc nhiều người dùng chung → Console API key, hoặc mỗi người một seat Team/Enterprise** [8][9].

---

## 1. Kiến trúc đề xuất — "8 Sync Agent HQ"

```
              Discord "8 Sync Agent HQ" (private)
   #owner-desk ◄──── Channels plugin chính chủ (2 chiều, chỉ allowlist Owner)
   📋 task-board · #standup · 📓 notes · team rooms · #logs/#alerts
              ▲ (1 chiều: webhook persona — PM/Arch/BE/FE/QA/Rev/Research)
              │
   8sync "scribe" (hook → webhook, không cầm credential Claude)
              ▲ TaskCreated / TaskCompleted / TeammateIdle / Notification / Stop
              │
   Máy chủ Linux luôn bật (systemd user unit + watchdog)
   └─ Lead session Claude Code (PM/Architect)  ← CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1
        ├─ teammates theo vai (.claude/agents/*.md: model/effort/tools/maxTurns)
        ├─ mỗi việc GHI = 1 git worktree, 1 người ghi; việc ĐỌC/review chạy song song
        └─ verify hook + stop gate + reviewer + aup-audit (kit ccc hiện có)
   Routines (cloud, /schedule) → standup sáng, groom backlog đêm, review PR mới
```

**Vì sao chọn kiến trúc này:**
- **Hai chiều chỉ qua Channels chính chủ.** Đây là đường Discord được Anthropic document. Chủ nhắn vào session đang chạy, duyệt quyền tool từ điện thoại qua permission relay [10]. Tự viết bot thì phải dùng Agent SDK, mà SDK bắt buộc API key, không dùng login claude.ai [9].
- **Scribe chỉ đẩy một chiều.** Hook của Claude Code gọi `8sync hq post` → webhook Discord, mỗi vai một `username`/`avatar` [11]. Scribe không đọc Discord và không giữ credential Claude, nên không vướng luật Anthropic.
- **Team native.** Agent teams đang ở dạng research preview (≥2.1.32), từ 2.1.178 mỗi session có một team ngầm và spawn teammate qua `name` [12]. Hook `TaskCreated`/`TaskCompleted`/`TeammateIdle` làm cổng chất lượng [12]. Background agents `claude --bg` chạy mỗi session trong một worktree riêng [13].
- **Một người ghi cho mỗi worktree.** Cognition và MAST cho thấy nhiều agent cùng ghi code là nguồn hỏng chính. Agent đọc/review song song thì an toàn [14][15].

---

## 2. Tổ chức Discord (đẹp, tối giản)

```
8 Sync Agent HQ  (private · Community off · 2FA cho mod)
Roles: @Owner · @AI-Agent (nhãn "AI") · @PM @Architect @Backend @Frontend @QA @Reviewer @Researcher (persona, không quyền)
📌 HQ
  #readme          charter, cách nói chuyện với team, công bố "đây là AI"
  #owner-desk      ⇄ Channels plugin — anh nhắn ở đây, lead nhận và phân việc
  #announcements   quyết định, release (PM post)
🗂 WORK
  📋 task-board    forum · list · REQUIRE_TAG · sort theo hoạt động mới nhất
                   tags: todo·doing·review·blocked·done | pm·arch·be·fe·qa·rev·research | p0·p1·p2
                   1 post = 1 task (thread = toàn bộ trao đổi của task) · post ghim "Luật board + sprint"
  💡 rfcs          forum · proposed·accepted·rejected — đề xuất kiến trúc + đề xuất tiến hoá
🗓 RITUALS
  #standup         09:00 mỗi ngày 1 thread, mỗi vai 1 embed (≤4096 ký tự)
  📓 notes         forum · research notes, ADR, retro, "bài học" — tag theo vai/chủ đề
🤖 TEAM ROOMS      (anh đọc được; thread tự archive sau 1 ngày)
  #eng-backend  #eng-frontend  #qa-review  #research
⚙ OPS              (Owner + bot)
  #logs (mute)  #alerts (ping @Owner)  #audit (yêu cầu duyệt)
```
Thông số để thiết kế đúng (theo docs Discord, 2026-10-12): forum tối đa 20 tag, mỗi post 5 tag; `content` 2000 ký tự, embed description 4096, tổng 6000/message; bot 50 request/giây; post ghim không tự archive [11][16]. Message Content intent bật thẳng trong portal được khi bot ở dưới 100 server [16].

**Luồng "anh nhắn → cả team xem, đánh giá, trao đổi":**
1. Anh nhắn ở `#owner-desk`. Lead (PM) nhận qua Channels.
2. PM tạo post trên `task-board` (tag `todo` + vai + mức ưu tiên) và trích nguyên văn tin nhắn của anh.
3. Architect/Reviewer/Researcher đánh giá ngay trong thread của post, scribe đăng dưới tên từng vai: rủi ro, cách làm, ước lượng.
4. PM chốt và đổi tag sang `doing`, người làm ghi trong worktree riêng.
5. QA và Reviewer chạy, tag chuyển `review` → `done`, kèm link PR.
6. Cần anh quyết thì lead hỏi ở `#owner-desk` và ping ở `#alerts`. Duyệt quyền tool qua permission relay.

---

## 3. Team chuyên gia & nhịp làm việc mỗi ngày

| Vai | Model / effort (định hướng) | Quyền | Việc chính |
|---|---|---|---|
| PM (lead) | Opus 5.5 · medium | đọc + task list + Discord | nhận lệnh, chia task, chốt, báo cáo |
| Architect | Opus 5.5 · high | chỉ đọc + RFC | thiết kế, ADR, review kiến trúc |
| Backend / Frontend | Sonnet 5.5 · medium | ghi trong worktree riêng | implement + test |
| QA | Sonnet 5.5 · medium | chạy test, không sửa code sản phẩm | test, repro bug |
| Reviewer | Sonnet 5.5 · high | chỉ đọc | review diff, MERGEABLE/NOT |
| Researcher | Sonnet 5.5 · medium | đọc + web | nghiên cứu có trích nguồn (deep-research v2) |

Các vai này dựng trên agent đã có trong kit (`explore`, `task`, `reviewer`, `designer`, `researcher`, `verifier`). Cần thêm `pm`, `architect`, `qa`.

**Nhịp ngày** (giờ VN):
- 09:00 standup: routine hoặc systemd timer, mỗi vai đăng hôm qua / hôm nay / vướng gì.
- 09:30–17:30 làm việc theo board, giới hạn N task đồng thời.
- 18:00 retro: mỗi vai đề xuất tối đa 1 "bài học" vào `rfcs`.
- 02:00 đêm: chạy eval set và groom backlog.

**Ngân sách:** trần token/$ mỗi ngày và mỗi task, trần lượt (`maxTurns`), có kill-switch (flag + stop hook). Phải có trần vì chi phí multi-agent tăng tuyến tính theo số teammate [12], và hệ research đa agent của Anthropic tốn khoảng 15× token so với chat [17].

---

## 4. Mượn gì từ CowAgent (MIT — ghi công trong THIRD_PARTY_NOTICES)

| Thứ | File | Dùng cho |
|---|---|---|
| Review tiến hoá lúc rảnh, "conservative by design", undo + backup | `agent/evolution/{prompts,executor,backup}.py` [18] | prompt đề xuất bài học lúc 18:00 |
| Roster + gọi `@tên` | `agent/team.py`, `agent/team_addressing.py` [19] | quy ước `@Backend …` trong Discord |
| Permission modes read-only / workspace-write / full | `agent/permission/policy.py` [4] | map sang `disallowedTools` cho từng vai |
| Cron có timezone | `agent/tools/scheduler/` | tham khảo cho nhịp ngày (dùng systemd/routines) |

**Không lấy:** đường gọi model trực tiếp (thay Claude Code), mặc định `FULL_ACCESS`, cụm dependency nặng hướng thị trường TQ.

---

## 5. Tự tiến hoá — làm sao để "giỏi lên mỗi ngày" mà không tự phá

1. **Chỉ tiến hoá văn bản:** luật trong CLAUDE.md, `PLAYBOOKS.md`, vài skill nhỏ và tập trung. Không đụng weight, không cho agent sửa harness [5][7].
2. **Cập nhật kiểu ACE:** mỗi lần thêm/sửa/xoá một mục có ID + ngày, không viết lại toàn bộ (tránh "context collapse") [6].
3. **Anh duyệt:** agent đề xuất trong `rfcs`, anh bấm accept/reject, rồi merge thành PR. Bằng chứng: skill người viết +16.2 điểm, còn skill model tự viết 0 điểm trung bình [5].
4. **Cổng eval trước khi giữ thay đổi:**
   - Bộ cố định gồm 20–40 task thật trong quá khứ của team, mỗi task có verifier xác định (build/test/lint).
   - Chạy ít nhất 3 lần trước và sau thay đổi.
   - Chỉ giữ nếu pass rate không giảm và chi phí không tăng quá X%.
   - Verifier phải giấu với agent, và agent không chạm được git history của đáp án (chặn reward hacking) [7][20].
5. **Chỉ số tuần:**
   - pass rate trên bộ cố định;
   - tỉ lệ PR merge không cần sửa tay;
   - tỉ lệ revert trong 7 ngày;
   - token, $ và thời gian trung vị mỗi task;
   - số lần lặp lại lỗi đã có trong KNOWLEDGE;
   - luật không được dùng 30 ngày thì xoá.
6. **Chưa làm:** DGM/SICA kiểu tự sửa code harness, swarm framework (claude-flow…) với số liệu chưa kiểm chứng, tìm workflow tự động. Chỉ xem xét lại khi bộ eval đã đáng tin [21].

---

## 6. Luật & an toàn (bắt buộc)

| Chế độ | Auth | Khi nào |
|---|---|---|
| **Solo** | Max subscription, Claude Code chính chủ (channels, `--bg`, routines) | 1 chủ, tải vừa phải, trong "ordinary, individual usage" [8] |
| **Team / 24-7** | Console API key có spend limit, hoặc mỗi người 1 seat Team/Enterprise | nhiều thành viên 8 Sync, chạy liên tục, hoặc bot tự viết (Agent SDK) [9] |

**Không bao giờ:**
- đặt OAuth token của một người lên server cho cả team;
- xoay vòng account để né limit (AUP) [8];
- dùng bot kiểu `claudecode-discord` quảng cáo "chạy bằng subscription Pro/Max" qua Agent SDK, vì trái ghi chú auth của SDK [9][22].

**Discord:**
- cấm self-bot;
- không dùng nội dung tin nhắn để train AI;
- có chính sách lưu giữ và xoá dữ liệu;
- bot không cấp Administrator [23].

**Công bố AI:**
- role `@AI-Agent` và `#readme`;
- nếu có người ngoài vào server thì bắt buộc công bố (AUP, chatbot nói chuyện với người ngoài).

**An toàn vận hành:**
- không auto-push vào `main`, deploy luôn cần người;
- chỉ allowlist Discord ID của anh. Lưu ý: ai trong allowlist cũng duyệt được quyền tool [10];
- không dùng `--dangerously-skip-permissions` trừ khi máy là sandbox;
- audit log append-only;
- chạy `/aup-audit` trước khi mở server cho người khác.

---

## 7. Lộ trình (mỗi phase có tiêu chí xong)

| Phase | Nội dung | Xong khi |
|---|---|---|
| **P0 · Nền (1–2 ngày)** | Tạo server + bot (portal, intents, permission tối thiểu); cài Channels Discord chính chủ; pair Discord ID của anh; lead chạy dưới systemd + watchdog | Anh nhắn `#owner-desk` → lead trả lời; duyệt 1 quyền tool từ điện thoại; reboot máy → session tự lên lại |
| **P1 · Scribe (2–3 ngày)** | `8sync hq post`: hook → webhook persona → forum task-board (tag), `#logs`/`#alerts`; hàng đợi + batch theo rate limit | Mỗi task có 1 post đúng tag; đổi trạng thái tự đổi tag; không có 429 trong 1 ngày chạy |
| **P2 · Team (3–4 ngày)** | Thêm vai `pm`/`architect`/`qa`; agent teams + worktree/việc ghi; hook `TaskCompleted` chạy build/test; reviewer bắt buộc | 3 task thật đi hết todo→done với PR, 0 xung đột ghi |
| **P3 · Nhịp ngày (1–2 ngày)** | Standup 09:00, retro 18:00, groom đêm (routines nếu Solo / systemd nếu API key); ngân sách + kill-switch | 5 ngày liền có standup/retro tự động; vượt ngân sách thì tự dừng + ping |
| **P4 · Tiến hoá (1 tuần)** | Bộ eval cố định 20–40 task; đề xuất bài học → `rfcs` → anh duyệt → PR; chỉ số tuần post `#announcements` | Có báo cáo tuần đầu tiên với số thật; ≥1 thay đổi được giữ nhờ eval, ≥1 bị loại |
| **P5 · Cứng hoá** | Sandbox/container cho vai ghi, audit log, retention, `/aup-audit`, tài liệu; đóng gói thành plugin `8sync-hq` trong marketplace public | Audit PASS; người mới dựng lại HQ bằng 1 lệnh |

---

## 8. Rủi ro & chưa verify
- Channels, agent view, routines và agent teams đều đang **preview/experimental**, có thể đổi flag hay giới hạn. Mỗi tính năng cần ghi version tối thiểu.
- `claude --bg` **tắt khi reboot**; session rảnh khoảng 1 giờ thì ngừng [13]. Vì vậy cần watchdog.
- Routines: khoảng cách tối thiểu 1 giờ, tối đa 100 lần chạy/giờ mỗi account, trừ vào quota subscription, và phải login claude.ai, không dùng được API key [24].
- Agent teams không chạy dưới `-p`/SDK; `/resume` không khôi phục teammate [12].
- **Chưa verify:** con số "~7× token" khi teammate ở plan mode (nguồn thứ cấp); giới hạn thread active mỗi guild của Discord; version giới thiệu Workflow tool.

## 9. Cần anh quyết (trước P0)
1. **Chế độ auth:** Solo (Max) hay Team/24-7 (Console API key + spend limit, hoặc seat Team)?
2. **Ngân sách/ngày** và **giờ chạy** (chỉ giờ hành chính hay 24/7)?
3. **Repo đầu tiên** để team làm, nên chọn một sản phẩm của 8 Sync có test tốt.
4. Server **chỉ anh** hay mời thêm thành viên. Nếu mời thì cần seat riêng và công bố AI rõ.

## Sources
1. CowAgent repo + README — https://github.com/zhayujie/CowAgent ; `reference/CowAgent/channel/discord/discord_channel.py`, `.github/workflows/test.yml`
2. `reference/CowAgent/models/claudeapi/claude_api_bot.py:165-170,223-224,254`, `config.py:128`
3. `reference/CowAgent/agent/evolution/trigger.py:8` (Claude Code chỉ là cảm hứng thiết kế)
4. `reference/CowAgent/agent/permission/policy.py:41-47`
5. SkillsBench — https://arxiv.org/abs/2602.12670
6. ACE (Agentic Context Engineering) — https://arxiv.org/abs/2510.04618
7. Darwin Gödel Machine — https://arxiv.org/abs/2505.22954 , https://sakana.ai/dgm/
8. Claude Code legal & compliance — https://code.claude.com/docs/en/legal-and-compliance ; Consumer Terms — https://www.anthropic.com/legal/consumer-terms ; AUP — https://www.anthropic.com/legal/aup
9. Agent SDK overview (auth) — https://code.claude.com/docs/en/agent-sdk/overview
10. Claude Code Channels — https://code.claude.com/docs/en/channels ; CHANGELOG 2.1.80 (L6386), 2.1.81 permission relay (L6353), 2.1.128 API key (L5345)
11. Discord webhooks — https://docs.discord.com/developers/resources/webhook
12. Agent teams — https://code.claude.com/docs/en/agent-teams ; CHANGELOG L7177, L4383
13. Agent view / background agents — https://code.claude.com/docs/en/agent-view ; CHANGELOG L5140, L4117
14. Cognition, "Don't Build Multi-Agents" — https://cognition.ai/blog/dont-build-multi-agents
15. MAST, why multi-agent systems fail — https://arxiv.org/abs/2503.13657
16. Discord channels/threads/messages/gateway/rate-limits — https://docs.discord.com/developers/resources/channel , /topics/threads , /resources/message , /events/gateway , /topics/rate-limits
17. Anthropic multi-agent research system — https://www.anthropic.com/engineering/multi-agent-research-system
18. `reference/CowAgent/agent/evolution/__init__.py:1-10`, `prompts.py:52-57,123`
19. `reference/CowAgent/agent/team.py:1-12`, `agent/team_addressing.py:1-6`
20. Cursor, reward hacking on coding benchmarks — https://cursor.com/blog/reward-hacking-coding-benchmarks
21. SICA — https://arxiv.org/abs/2504.15228 ; AFlow — https://arxiv.org/abs/2410.10762
22. chadingTV/claudecode-discord (README: "No API key needed… Pro or Max") — https://github.com/chadingTV/claudecode-discord
23. Discord Developer Policy — https://support-dev.discord.com/hc/en-us/articles/8563934450327 ; Developer Terms — https://support-dev.discord.com/hc/en-us/articles/8562894815383 ; self-bots — https://support.discord.com/hc/en-us/articles/115002192352
24. Routines — https://code.claude.com/docs/en/routines

_Footer: 2026-10-12 · 1 vòng, 4 worker song song + tự kiểm 7 dòng CHANGELOG và file CowAgent · đo tại chỗ: không (plan) · chưa verify: xem §8._
