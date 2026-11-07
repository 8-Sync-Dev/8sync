# HQ Bots: tạo bot, nhóm bot, @mention, template, UI messenger (2026-11-07)

Phạm vi: tab **Bots** của HQ (`apps/hq-ui/components/hq/bots/*`). Mỗi phiên Claude Code / omp là một "bot" gắn với một thư mục.
Ký hiệu: **(D)** = kết luận mà đề xuất dựa vào, cần ≥2 nguồn; "một nguồn" = chỉ có 1 nguồn; "chưa kiểm" = chưa đọc được nguồn chính thức; `[n]` = mục trong **Nguồn**.

## TL;DR
1. **Tạo bot**: đi theo thứ tự template → thư mục → tên (tự gợi ý) → tin nhắn đầu, tất cả trong **một sheet**. Bot của HQ là phiên chạy trong thư mục nên bước thư mục là bắt buộc. Template "Trống" được chọn sẵn (D) [9][10][11].
2. **Nhóm bot**: file local `~/.config/8sync/hq/groups.json`. Mặc định **chỉ bot được @ mới trả lời**. Có thêm chế độ "Chief điều phối", trong đó Chief of Staff chọn bot (D) [13][16][6][21][25].
3. **Chống loop**: mỗi lượt của owner được tối đa **6 tin bot→bot**, độ sâu tối đa **3 hop**. Tin trùng trong 60 giây bị bỏ. Vượt mức thì trả 409, owner bấm "Cho thêm" mới chạy tiếp (D) [22][26][29][30]. Hiện HQ **chưa có** giới hạn này.
4. **@bot-b trong chat của bot A**: owner gửi cho B kèm ngữ cảnh của A (dòng `[từ phòng …]` cộng brief ≤600 ký tự). Câu trả lời của B hiện thành thẻ trong thread A và **không tự chuyển lại cho A** (D) [29][27].
5. Tin từ bot khác **không phải lệnh của owner**: không mở quyền merge/release, không duyệt hộ owner. HQ đã làm đúng việc này, cần giữ nguyên khi thêm nhóm (D) [29][27].
6. **Template**: template có sẵn nằm trong repo (`lib/templates.ts`), template riêng của owner nằm ở `~/.config/8sync/hq/templates/*.json`. Có 6 template chung và 6 template của 8 Sync (cpa-full, research-mkt, course-writer, news-curator, zus-release, tia-release).
7. **UI**: FLIP bằng WAAPI có chặn `prefers-reduced-motion`; ô @mention theo APG combobox; avatar nhóm xếp chồng 2–3 bot; mobile dùng list→thread kèm View Transition và có fallback [31][33][35][34][37].
8. Có 8 slice triển khai, mỗi slice vừa một worker, xem phần "Đề xuất triển khai cho HQ".

## 1. Luồng tạo bot: bot trước hay thư mục trước?

### Các sản phẩm khác làm thế nào
| Sản phẩm | Thứ tự | Ghi chú |
|---|---|---|
| ChatGPT GPTs | Explore GPTs → Create → builder dạng hội thoại hoặc tab Configure (name, instructions, knowledge) [1] | Không có "thư mục". OpenAI có kế hoạch dừng GPTs để chuyển sang plugins, và tài khoản cá nhân không tạo GPT mới được nữa [1] |
| ChatGPT / Claude Projects | Tạo container (tên, icon, màu) → instructions → knowledge → chat [2][3] | Instructions của project ghi đè instructions chung. Ngữ cảnh không chia sẻ giữa các chat [2][3] |
| Poe prompt bot | Name, description → **base bot (bắt buộc)** → prompt (bắt buộc) → intro message [4] | Có thể điền sẵn qua tham số GET của `create_bot` [5] |
| Telegram BotFather | `/newbot` → name → username phải kết thúc bằng "bot" và không đổi được → token [6] | Định danh trước, tính năng sau |
| Copilot Studio / M365 Agent Builder | Home → Agent → tab Build hoặc Describe/Configure: name, description, instructions, knowledge, suggested prompts [7][8] | Instructions có thể sinh từ mô tả |
| Cursor Cloud Agent | Chọn repo (hoặc "Start from scratch") → prompt; chạy trên code đã push [9] | Không cần thư mục trên máy: agent chạy trên cloud |
| Devin | Chọn Ask/Agent → **Repository** + Agent → prompt [10] | `@Repos`, `@Sessions` dùng làm ngữ cảnh |
| GitHub Copilot coding agent | Một dialog: repo, branch gốc, **custom agent**, prompt tùy chọn → luôn mở PR [11] | Chụp ngữ cảnh lúc giao việc, bỏ qua comment đến sau [11] |
| Grok | Tasks đổi tên thành "Automations" (2026-07); Companions bị gỡ khoảng 2026-09 [12] | **chưa kiểm**: chỉ có nguồn bên thứ ba |

**Kết luận (D)**: chat bot thuần (GPTs, Poe, BotFather) tạo **danh tính trước**. Agent làm việc trên code (Cursor, Devin, Copilot) đặt **repo/thư mục và vai trò trong cùng một dialog**, kèm prompt đầu tùy chọn [9][10][11]. Bot của HQ thuộc nhóm thứ hai: phiên tmux/omp phải có `cwd` (`POST /api/sessions` cần project đã đăng ký, `POST /api/omp/sessions` cần `cwd`). Vì vậy **không nên tách "tạo bot" và "chọn thư mục" thành hai màn**.

### Luồng đề xuất cho HQ: sheet "Bot mới" (nút ở `BotList`, Ctrl+N vẫn mở composer Không gian như cũ)
1. **Chọn template**: lưới thẻ (emoji, tên, mục đích một dòng). "Trống" được chọn sẵn, tab "Của tôi" chứa template riêng của owner.
2. **Chọn thư mục**: danh sách dự án đã đăng ký (`GET /api/projects`), xếp gần đây lên đầu. Thư mục khớp `folderHint` của template được ghim lên đầu kèm nhãn "Gợi ý". Nút "Thư mục khác…" duyệt bằng `/api/fs`. Với engine omp có thêm ô "Worktree riêng" (`worktree:true`).
3. **Tên**: tự gợi ý `<template>-<dự án>`, ví dụ `cpa-full-content`. Hệ thống kiểm tra bằng `toTmuxName` và báo trùng ngay khi gõ.
4. **Tin nhắn đầu** (tùy chọn): placeholder lấy từ `firstMessage` của template. Nút chính là **"Tạo và gửi"**, nút phụ là "Chỉ tạo".
5. Bấm tạo xong, sheet đóng và thread của bot mới mở ngay (mobile: đẩy sang thread). Bot hiện ở đầu `BotList` với hiệu ứng FLIP (mục 5).

Chọn API theo engine: `claude` → `POST /api/sessions {name, project, role, model?}` với `role` lấy từ template (`ROLES` trong `lib/roles.ts`). `omp` → `POST /api/omp/sessions {cwd, name, model?, worktree?, prompt}` với `prompt = instructions + "\n\n" + tin đầu`. Engine omp đã có sẵn hàng đợi tin đầu.

### Empty states
- BotList trống: "Chưa có bot nào. Tạo bot đầu tiên từ một mẫu: mỗi bot làm việc trong một thư mục." Nút [Bot mới]. Bên dưới là 3 thẻ template gợi ý.
- Chưa có dự án đăng ký (bước 2): "Chưa có dự án nào. Chọn một thư mục trên máy để bắt đầu." Nút [Chọn thư mục].
- Template chưa có thư mục nào khớp `folderHint`: "Chưa thấy thư mục `content-post-agency` trên máy. Chọn tay hoặc dùng mẫu khác."
- Panel chi tiết khi chưa chọn bot (desktop): placeholder "Chọn một bot bên trái hoặc tạo bot mới", theo mẫu list-detail của Material 3 [37].

## 2. Nhóm bot: thành viên, ai trả lời, lượt nói, giới hạn

### Sản phẩm chat
- **Slack**: sự kiện `app_mention` chỉ gửi những tin liên quan tới app. App phải tự theo dõi mình đang ở kênh nào [13]. Tin của bot có `bot_id`/`bot_profile` để lọc [14]. Slack cảnh báo app nghe mọi tin rồi trả lời sẽ **đăng mãi không dừng** [15]. Mention một người không có trong kênh thì mặc định không báo cho họ, có tuỳ chọn thêm họ vào kênh [39].
- **Microsoft Teams**: mặc định agent trong kênh/group chat **chỉ nhận tin có @mention** [16]. Muốn nghe mọi tin thì cần quyền RSC `ChannelMessage.Read.Group` / `ChatMessage.Read.Chat` do chủ cuộc trò chuyện đồng ý [17].
- **Telegram**: bot trong nhóm chạy Privacy Mode, chỉ nhận lệnh, mention và reply tới tin của nó, trừ khi là admin [6]. Bot↔bot chỉ chạy khi bật Bot-to-Bot Communication Mode. Telegram yêu cầu bot tự chống loop: khử trùng lặp, giới hạn tốc độ theo chat và theo bot, đặt độ sâu tối đa và timeout theo từng cặp gửi/nhận [30].
- **Discord**: đọc nội dung tin cần privileged intent MESSAGE_CONTENT [18]. Ngoại lệ cho tin có mention bot: **chưa kiểm**.
- **ChatGPT group chats**: ChatGPT tự quyết khi nào trả lời và luôn trả lời khi được gọi tên. Rate limit tính cho người được trả lời. Custom instructions riêng cho từng nhóm, memory cá nhân không chia sẻ [19].
- **Poe multi-bot chat**: gọi bất kỳ bot nào bằng @-mention trong cùng thread. Bot sau thấy ngữ cảnh của bot trước [20]. Server bot gọi bot khác tối đa 100 lần mỗi tin của user, và tính phí vào user [5].

### Framework multi-agent
- **AutoGen SelectorGroupChat**: model chọn người nói tiếp dựa trên name và description. Mặc định không cho một agent nói hai lượt liền (`allow_repeated_speaker`). Có `selector_func` để ghi đè [21]. Kết thúc bằng `TextMentionTermination("TERMINATE") | MaxMessageTermination(25)` để tránh vòng vô hạn [21][22].
- **CrewAI**: `allow_delegation` cho agent công cụ "delegate/ask". Triệu chứng hay gặp là hai agent đẩy việc qua lại vô hạn [23]. Có `max_iter`: tài liệu ghi mặc định 25 ở một trang và 20 ở trang khác, tức là mâu thuẫn [24]. Process hierarchical có manager [23].
- **LangGraph**: supervisor hiện được khuyên làm bằng tool handoff. `output_mode` chọn `full_history` hoặc `last_message` [25]. `recursion_limit` sinh `GraphRecursionError` khi vượt [26].
- **Claude Code agent teams**: một lead và các teammate. Teammate nhắn nhau qua mailbox JSON `~/.claude/teams/{team}/inboxes/{agent}.json`. Teammate nạp CLAUDE.md/skills/MCP nhưng **không nhận lịch sử của lead**. Tính năng này tốn token hơn nhiều so với một phiên và đang ở dạng experimental, tắt mặc định [27]. Subagent có context riêng và chỉ trả kết quả cuối [28].

### Đề xuất cho HQ
- **Thành viên**: nhóm là danh sách `members[]` gồm id phòng/bot. Thêm thành viên chỉ là ghi file và không khởi động phiên mới. Bot đang tắt vẫn ở trong nhóm nhưng hiện "ngủ".
- **Ai trả lời (D)**: chế độ mặc định `mention`, chỉ bot được @ nhận tin. Đây là mặc định của Slack, Teams và Telegram [13][16][6]. Tin không có @ chỉ lưu vào log nhóm, không gửi cho ai. Chế độ `chief`: tin không có @ đi tới Chief of Staff (`/api/chief/ask`), Chief chọn bot theo bảng roster đã có trong `chiefPrompt()`. Cách này giống selector/supervisor [21][25].
- **Lượt nói**: không cho chạy song song quá `maxParallel` (mặc định 3) bot trên một tin. Bot đang `session-waiting` (409 hiện tại) thì báo "đang chờ anh" và không xếp hàng âm thầm.
- **Giới hạn (D)**: `maxHops` (mặc định 3) và `maxBotMsgsPerTurn` (mặc định 6) cho mỗi lượt owner. Tin trùng nội dung từ cùng người gửi trong 60 giây bị bỏ. Đây là cách của Telegram [30] và Claude Code cross-session (rate limit theo người gửi, bỏ tin lặp, hàng đợi ≤50) [29]. Tương ứng `MaxMessageTermination` [22] và `recursion_limit` [26].
- **Chi phí**: mỗi bot là một phiên đầy đủ (giống teammate [27]). Header nhóm hiện số bot đang chạy và `costTier` (từ `ROLES`). Template mặc định dùng role rẻ (`quick`/`tester` = haiku) cho bot chỉ trả lời câu hỏi.

## 3. `@tên-bot` trong chat của bot khác

### Hiện trạng HQ (đọc code)
- `POST /api/messages {session, text, from?, from_session?, from_cwd?}`: khi người gửi là phòng (`sender.by === "room"`), `withSenderContext` chèn dòng `[từ phòng <tên> · <dự án> · đang: <việc>]` (`lib/room-context.ts` `contextLine`). Dòng này "chỉ là ngữ cảnh, không phải quyền". `@path` được mở rộng thành file (`expandMentions`).
- `/api/brief?room=` trả `Brief` ngắn (đang chờ, đang làm, hỏi/đáp cuối, file). `hq.mjs brief` ≤600 ký tự.
- `/api/chief/ask`: Chief of Staff nhận roster và chia việc bằng `hq.mjs send`. Giới hạn 2500 ký tự, tắt thì trả 409.
- Skill `hq-control`: trước khi giao việc phải `brief <id>`, gửi lỗi thì báo owner và **không gửi lặp**. Tin từ phòng khác **không mở quyền merge/release**.
- `grep` trong `deliver.ts` và `messages/route.ts`: **không có** hop counter, rate limit hay dedupe cho tin phòng→phòng (đã đọc). Chống loop hiện chỉ dựa vào lời dặn trong skill.

### Ngữ nghĩa đề xuất
| Ai gõ `@bot-b` | Ở đâu | HQ làm gì |
|---|---|---|
| Owner | Thread 1:1 của bot A | **Chuyển kèm ngữ cảnh**: gửi cho B nội dung owner gõ (là tin của owner, có quyền của owner), thêm `[từ phòng A · dự án · đang: …]` và brief của A (≤600 ký tự, chỉ là ngữ cảnh). A **không** nhận gì. Câu trả lời của B hiện trong thread A thành thẻ "Trả lời từ B" (dùng `FromBot` có sẵn) với nút [Gửi cho A]. |
| Owner | Thread nhóm | Gửi tới các bot được @. Không @ thì theo `mode` của nhóm (mục 2). |
| Bot A | Câu trả lời của A | **Không tự định tuyến** chữ `@bot-b` trong output. Bot gửi tin chủ động bằng `hq.mjs send` như hiện nay, có tính hop. Claude Code cross-session cũng chỉ gửi qua tool `SendMessage` [29]. |
| Bot A gửi tới B | Qua `send` | Kèm `[từ phòng A …]` và header `[nhóm X · hop 2/3]` khi tin thuộc lượt của một nhóm. Server tăng bộ đếm, vượt mức thì 409 `hop-limit`. |

Vì sao không tự động đưa câu trả lời của B về A (D): Claude Code coi tin giữa các phiên là văn bản thuần, không phải sự đồng ý của owner, không đổi cấu hình, và tự chặn loop [29]. Teammate cũng không duyệt hộ được [27]. Telegram buộc bot tự giới hạn độ sâu [30]. Giữ một bước owner bấm [Gửi cho A] giúp loop không thể xảy ra mà vẫn chỉ tốn một cú bấm.

### Data model local-first
```jsonc
// ~/.config/8sync/hq/groups.json, ghi atomic tmp+rename như writeChief()
{ "groups": [{ "id": "g_content", "name": "Nhóm nội dung", "emoji": "🎬",
  "members": ["cpa-live", "research-mkt"], "mode": "mention",   // "mention" | "chief"
  "maxHops": 3, "maxBotMsgsPerTurn": 6, "maxParallel": 3, "createdAt": "2026-11-07T00:00:00Z" }] }
```
```jsonc
// ~/.local/state/8sync/hq/groups/<id>.jsonl: log append-only, một dòng mỗi tin
{ "ts": 0, "turn": "t_…", "from": "owner|<room>", "to": ["<room>"], "text": "…", "hop": 0, "msgId": "…" }
```
Mỗi tin của owner tạo `turn` mới. Tin phòng→phòng gửi trong khi phòng gửi đang xử lý `turn` đó kế thừa `turn` (map `room → turn` giữ trong bộ nhớ, đặt lại khi owner gửi tin mới). Không đẩy gì ra server ngoài máy.

### API
- `GET/PUT /api/groups`: đọc và ghi `groups.json` (kiểm tra `members` đều là phòng có thật).
- `POST /api/groups/[id]/send {text, files?}`: tách `@tên` → `deliverText` cho từng thành viên, thêm dòng ngữ cảnh nhóm, ghi log. Trả `{turn, delivered[], held[]}`.
- `POST /api/groups/[id]/continue {turn, extra}`: owner cho thêm hop/tin cho một lượt đang bị giữ.
- `GET /api/groups/[id]/log?after=`: thread nhóm cho UI.
- `POST /api/messages` (đã có): khi `sender.by === "room"` và phòng gửi đang trong một `turn` của nhóm thì kiểm `hop` và trả `409 {error:"hop-limit", dialog}` khi vượt.

### UI
Thread nhóm là một luồng chung: tin owner bên phải, tin của bot bên trái kèm avatar và tên. Dòng `[từ phòng …]` được ẩn và chuyển thành nhãn "A → B". Khi bị giữ: banner "Đã đủ 3 lượt bot nói với nhau. [Cho thêm 3 lượt] [Dừng]".

## 4. Catalogue template bot

### Schema (`lib/templates.ts` là template có sẵn; `~/.config/8sync/hq/templates/<id>.json` là template riêng, ghi đè theo `id`)
```ts
type BotTemplate = {
  id: string; name: string; emoji: string; color: string;      // color: token Tailwind, vd "sky"
  purpose: string;                       // một dòng, tiếng Việt
  engine: "claude" | "omp";
  role?: RoleId; model?: ModelId;        // tái dùng ROLES/MODELS trong lib/roles.ts
  instructions: string;                  // ≤6 dòng, ghép vào prompt đầu
  skills: string[];                      // tên skill để nhắc nạp; không nhúng nội dung skill
  folderHint?: string;                   // tên thư mục gợi ý, khớp theo basename
  firstMessage?: string; builtIn?: boolean;
};
```
Template chỉ chứa chữ, không chứa token hay dữ liệu khách hàng. Template riêng nằm trên máy owner và không bao giờ đồng bộ lên server (local-first).

### Template chung
| id | Tên | Emoji/màu | Mục đích | Engine/role | Skills | Thư mục |
|---|---|---|---|---|---|---|
| blank | Trống | 💬 slate | Phiên trống, tự giao việc | claude / quick | — | bất kỳ |
| fullstack | Dev fullstack | 🛠️ sky | Làm tính năng theo card, có test | claude / fullstack | tdd-workflow, verification-loop | repo app |
| reviewer | Reviewer | 🔍 amber | Review diff, chỉ báo lỗi có bằng chứng | claude / reviewer | security-review, karpathy-guidelines | repo bất kỳ |
| tester | Tester | 🧪 lime | Viết và chạy e2e/regression | claude / tester | e2e-testing, tdd-workflow | repo app |
| researcher | Nghiên cứu | 📚 violet | Báo cáo có trích nguồn | omp | deep-research-web, last30days | `su-code/research` |
| planner | Lập kế hoạch | 🧭 indigo | Chia việc thành card, không sửa code | claude / plan | full-flow, feature | repo bất kỳ |

Instructions mẫu (ví dụ cho reviewer, ≤6 dòng): "Đọc diff so với origin/main. Chỉ báo lỗi có file:line và cách tái hiện. Không sửa code. Kết thúc bằng: chặn / cần sửa / ổn."

### Template 8 Sync
| id | Tên | Emoji/màu | Mục đích | Engine | Skills | Thư mục gợi ý |
|---|---|---|---|---|---|---|
| cpa-full | Content full ngày | 🎬 rose | Làm trọn bộ nội dung hằng ngày qua app Content AI (`/content-daily`) | omp (như `cpa-live`) | cpa-ops-cli, cpa-app-attach, brand-8sync | `tools/content-post-agency` |
| research-mkt | Research marketing | 📈 orange | Tìm xu hướng và đối thủ, đề xuất góc nội dung cho 8 Sync | omp | market-research, deep-research-web, last30days, brand-voice | `su-code/research` |
| course-writer | Viết khóa học | 🎓 emerald | Soạn bài và bài tập cho 8 Sync Courses | claude / fullstack | article-writing, brand-voice | repo course (chưa kiểm đường dẫn) |
| news-curator | Biên tập tin | 📰 cyan | Chọn và tóm tắt tin AI/dev cho 8 Sync News | omp | last30days, deep-research-web, article-writing | repo news (chưa kiểm) |
| zus-release | Phát hành ZUS | 🚀 fuchsia | Chuẩn bị bản phát hành ZUS: gate, changelog, build Tauri | claude / fullstack | tauri-v2, encore-deploy, verification-loop | repo ZUS (chưa kiểm) |
| tia-release | Phát hành TIA | 🧠 teal | Kiểm và phát hành TIA (decision API) | claude / fullstack | encore-deploy, verification-loop | `startup/8sync-startup/ml/tia-platform` |

Instructions khởi đầu (≤6 dòng mỗi template):
- **cpa-full**: "Làm bộ nội dung hôm nay qua app (bài học, infographic trend, ASMR, MKT). UAT file xuất (ffprobe, meta.json). Ledger chỉ được đổi `ordered → drafted → checked`, không ghi đè `approved/published/rejected`. Theme sáng. **Không đăng** khi owner chưa duyệt. Báo bằng tiếng Việt." (theo `AGENTS.md` và `.claude/commands/content-daily.md` của content-post-agency)
- **research-mkt**: "Mỗi nhận định phải có URL. Số liệu traction chỉ lấy từ Vercel/Cloudflare Web Analytics và ghi rõ nguồn. Không bịa khách hàng hay đối tác. Không đụng dữ liệu CRM/AcoLeads. Kết quả là 3 góc nội dung kèm hook."
- **course-writer**: "Tinh thần 'We teach you to learn, not to copy': mỗi bài có mục tiêu, giải thích, bài tập tự làm và gợi ý, không đưa sẵn lời giải. Thuật ngữ giữ tiếng Anh."
- **news-curator**: "Chọn ≤5 tin trong 24–48 giờ từ nguồn gốc, mỗi tin 3 dòng kèm link. Ghi 'chưa kiểm' khi chưa đọc nguồn gốc. Không đăng, chỉ gửi bản nháp."
- **zus-release**: "ZUS là local-first: không đề xuất đưa dữ liệu user lên server. Chạy gate/test trước khi kết luận. Cập nhật CHANGELOG. Không push/merge/release khi chưa có lệnh của owner."
- **tia-release**: "Chạy `encore test` từ thư mục service, kiểm `/healthz` sau deploy. Không in secret. Release chỉ chạy khi owner ra lệnh."

`firstMessage` gợi ý: cpa-full "Làm bộ nội dung hôm nay", research-mkt "Tuần này dev Việt đang quan tâm gì?", zus-release "Kiểm xem đã sẵn sàng phát hành chưa".

## 5. UI/UX messenger hiện đại

- **FLIP khi bot nhảy lên đầu danh sách**: ghi First (rect cũ) → Last (rect mới) → Invert (`transform` ngược lại) → Play (bỏ transform) [31]. Chỉ animate `transform`/`opacity` và dùng `will-change` có chừng mực [32]. Làm bằng WAAPI `el.animate()` trong `useLayoutEffect`, không cần thư viện. Khi `prefers-reduced-motion: reduce` thì bỏ hẳn hiệu ứng [33].
- **Ô @mention**: theo APG combobox. Focus DOM luôn ở ô nhập, mục đang chọn báo qua `aria-activedescendant`, có `aria-controls`/`aria-expanded`, Escape để đóng [35]. Phải tự cuộn mục đang chọn vào tầm nhìn [36]. Danh sách lấy từ roster đang chạy, mỗi dòng có trạng thái từ brief (đang làm / chờ anh). Tên có dấu cách thì chèn trong ngoặc kép, như `@"release notes"` của Claude Code [29]. @ một bot chưa có trong nhóm thì hỏi "Thêm vào nhóm?" chứ không âm thầm bỏ qua, ngược với mặc định của Slack [39].
- **Avatar nhóm**: chồng 2–3 `BotAvatar` (đường chéo, viền nền 2px), thừa thì hiện "+N". Nhóm có emoji riêng thì dùng emoji. Quy ước của Messenger/WhatsApp: **chưa kiểm** (chưa đọc nguồn chính thức).
- **Empty state**: một câu nói trạng thái, một câu nói việc tiếp theo, một nút chính (mục 1). Panel chi tiết trống dùng placeholder theo Material 3 list-detail [37]. HIG không có trang riêng cho empty state (chưa kiểm). SwiftUI có `ContentUnavailableView` (một nguồn, chưa kiểm).
- **Mobile list→thread**: màn hình hẹp chỉ hiện một pane kèm Back, màn hình rộng hiện list và detail [37][38]. HQ đã có `mobile` và `onBack` trong `BotThread`. Thêm `document.startViewTransition` khi có hỗ trợ, nếu không thì đổi state ngay [34].
- **Trạng thái trong list**: dòng phụ lấy từ brief (đang làm gì / chờ anh) và chấm trạng thái. "Chờ anh" được ưu tiên xếp lên đầu.

## Đề xuất triển khai cho HQ
Mỗi slice vừa một worker, làm theo thứ tự (slice sau dùng API của slice trước).
1. **Template data**: `lib/templates.ts` (type `BotTemplate` và 12 template có sẵn), `lib/server/templates.ts` đọc `configDir()/templates/*.json` (bỏ file lỗi, ghi đè theo id), `GET /api/templates`. Test: parse, merge, file hỏng.
2. **Sheet "Bot mới"**: `components/hq/bots/new-bot-sheet.tsx` (template → thư mục từ `GET /api/projects` / `/api/fs` → tên → tin đầu), gọi `POST /api/sessions` hoặc `POST /api/omp/sessions` theo engine. Nối vào nút `onNew` của `BotList` và empty state. UAT bằng ảnh chụp ở port 399x.
3. **Groups store**: `lib/server/groups.ts` (đọc/ghi atomic như `writeChief`) và `GET/PUT /api/groups`, kèm test vitest cho validate members và ghi atomic.
4. **Group send + loop guard**: `POST /api/groups/[id]/send`, `/continue`, `/log`; bộ đếm `turn/hop` và dedupe 60 giây trong `lib/server/groups.ts`; móc kiểm hop vào `POST /api/messages` khi `sender.by==="room"` (409 `hop-limit`). Test: 7 tin bot→bot thì tin thứ 7 bị giữ.
5. **Composer @mention**: `components/hq/bots/mention-combobox.tsx` theo APG [35][36], nguồn là roster/brief. Dùng trong thread 1:1 (chuyển kèm ngữ cảnh) và thread nhóm.
6. **@ trong thread 1:1**: gửi cho B kèm `contextLine(A)` và brief của A; thẻ "Trả lời từ B" có nút [Gửi cho A] (`bot-conversation.tsx` `FromBot`). Không tự định tuyến output của bot.
7. **Thread nhóm và avatar nhóm**: `group-thread.tsx`, `group-avatar.tsx`, mục nhóm trong `BotList`, banner hop-limit.
8. **Chuyển động**: FLIP trong `BotList` (WAAPI, chặn reduced-motion) và View Transition cho list→thread trên mobile, có fallback.

Rủi ro mở: bộ đếm `turn` giữ trong bộ nhớ sẽ mất khi HQ restart. Chấp nhận được vì sau restart thì lượt mới bắt đầu từ 0, nhưng cần ghi rõ trong code. Đường dẫn repo ZUS, course và news chưa kiểm. `folderHint` chỉ khớp theo basename.

## Nguồn
1. https://help.openai.com/en/articles/8554397-creating-and-editing-gpts
2. https://help.openai.com/en/articles/10169521-projects-in-chatgpt
3. https://support.claude.com/en/articles/9519177-how-can-i-create-and-manage-projects
4. https://creator.poe.com/docs/prompt-bots/how-to-create-a-prompt-bot
5. https://creator.poe.com/docs/server-bots/server-bots-functional-guides
6. https://core.telegram.org/bots/features
7. https://learn.microsoft.com/en-us/microsoft-copilot-studio/agents-experience/build-new-agent
8. https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/agent-builder-build-agents
9. https://cursor.com/docs/cloud-agent/setup
10. https://docs.devin.ai/get-started/first-run
11. https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/use-cloud-agent-on-github
12. https://twitterapi.io/blog/grok-tasks (bên thứ ba, chưa kiểm)
13. https://docs.slack.dev/reference/events/app_mention/
14. https://docs.slack.dev/reference/events/message/bot_message/
15. https://docs.slack.dev/tools/deno-slack-sdk/guides/creating-event-triggers/
16. https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/conversations/channel-and-group-conversations
17. https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/conversations/channel-messages-for-bots-and-agents
18. https://docs.discord.com/developers/events/gateway
19. https://openai.com/index/group-chats-in-chatgpt/
20. https://poe.com/blog/multi-bot-chat-on-poe
21. https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/selector-group-chat.html
22. https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/tutorial/termination.html
23. https://docs.crewai.com/en/concepts/collaboration
24. https://docs.crewai.com/en/learn/customizing-agents
25. https://reference.langchain.com/python/langgraph-supervisor
26. https://docs.langchain.com/oss/python/langgraph/graph-api
27. https://code.claude.com/docs/en/agent-teams
28. https://code.claude.com/docs/en/sub-agents
29. https://code.claude.com/docs/en/cross-session-messaging
30. https://core.telegram.org/api/bots/bot-to-bot
31. https://aerotwist.com/blog/flip-your-animations/
32. https://web.dev/articles/animations-guide
33. https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion
34. https://developer.mozilla.org/en-US/docs/Web/API/View_Transition_API/Using
35. https://www.w3.org/WAI/ARIA/apg/patterns/combobox/
36. https://www.w3.org/WAI/ARIA/apg/patterns/combobox/examples/combobox-autocomplete-list/
37. https://m3.material.io/foundations/layout/canonical-examples/list-detail
38. https://developer.apple.com/design/human-interface-guidelines/split-views
39. https://slack.com/help/articles/360002063088-Understand-your-actions-in-Slack
