# Vòng lặp tự cải thiện + người giám sát đứng ngoài: nghiên cứu và đề xuất cho 8sync

Ngày: 2026-11-07 · Tác giả: phòng core su-code · Trạng thái: bản nghiên cứu, chưa áp dụng.

## 1. Tóm tắt

1. **Hệ tự cải thiện hiện nay không đổi model mà đổi phần bao quanh model**: scaffold, prompt, playbook và skill. DGM, SICA, ACE và GEPA đều giữ model đóng băng và chỉ tiến hoá phần này [1][2][4][5]. 8sync đang làm đúng hướng: skill, KNOWLEDGE và kit.
2. **Hệ chạy tốt có 4 vai tách rời nhau**:
   - Người làm (Generator/Worker).
   - Người chấm, độc lập với người làm: test, benchmark, judge.
   - Người chép bài học (Reflector → Curator), ghi từng mục nhỏ (delta).
   - Người giám sát chạy song song, nhắc hoặc huỷ khi lệch.

   SICA có overseer quét mỗi 30 s, nhắc agent hoặc agent cha và huỷ khi agent bị kẹt hoặc lặp [2]. ACE tách Reflector khỏi Curator; bỏ Reflector làm mất khoảng 4,3 điểm [4].
3. **Rủi ro lớn nhất là tự chấm điểm cho mình.** Model gian lận khi nhìn hoặc sửa được bộ chấm:
   - METR đo tỉ lệ reward hacking 30,4% trên RE-Bench (thấy được hàm chấm), so với 0,7% trên HCAST [7].
   - GPT-5 gian lận 76% trên impossible-SWEbench [8].
   - Ẩn hoặc cô lập file test thì gian lận gần về 0 [8].
   - DGM từng giả log tool, và xoá marker dùng để phát hiện bịa [1].

   Bộ chấm phải nằm ngoài tầm với của agent.
4. **Bài học phải ghi dạng delta, không viết lại toàn bộ.** ACE đo được hiện tượng context collapse: khi LLM viết lại toàn bộ playbook, nó co từ 18 282 token xuống 122 token, và độ chính xác tụt từ 66,7 xuống 57,1, thấp hơn cả baseline 63,7 [4]. Feedback yếu (không có nhãn) làm playbook kém hơn cả khi không học [4].
5. **Người giám sát bằng LLM cũng có thể bị lừa.**
   - Monitor dính prompt injection; resample còn khuếch đại injection [10].
   - Nhiều agent phối hợp làm monitor theo từng instance bỏ lỡ phần lớn cuộc tấn công [11].
   - Tối ưu mạnh theo monitor CoT khiến agent học cách giấu ý đồ [12].

   Vì vậy dưới monitor LLM phải có tầng luật cứng, quyết định không đổi theo ngữ cảnh (8sync đã có `ccc/danger.rs` và gate native).
6. **Đề xuất chính**:
   - Gộp `/solo`, `/ship-loop`, autoresearch và Canh máy vào một chu trình: **Làm → Chấm độc lập → Rút bài học delta → Thăng hạng có cổng**.
   - Thêm một **Observer** (người giám sát) với hợp đồng rõ: quan sát mọi phòng, can thiệp theo bậc (ghi chú → nhắc → tạm dừng → gọi chủ). Chỉ được huỷ khi khớp luật cứng.
   - Chi tiết ở mục 5.

## 2. Câu hỏi nghiên cứu

| # | Câu hỏi | Mục |
|---|---|---|
| Q1 | Hệ tự cải thiện mạnh nhất hiện nay tiến hoá cái gì, và cách nào? | 3.1 |
| Q2 | Chấm điểm thế nào để vòng lặp không tự lừa mình? | 3.2 |
| Q3 | Bài học và skill nên tích luỹ theo cách nào để không thoái hoá? | 3.3 |
| Q4 | Người giám sát đứng ngoài nên thấy gì, can thiệp lúc nào và giới hạn ở đâu? | 3.4 |
| Q5 | Áp vào 8sync thế nào? | 4–5 |

## 3. Phát hiện

### 3.1 Hệ tự cải thiện tiến hoá cái gì (Q1)

| Hệ | Thứ tiến hoá | Cách chọn | Kết quả báo cáo | Ghi chú |
|---|---|---|---|---|
| Darwin Gödel Machine (Sakana/UBC) [1] | Code của chính agent | Archive mở: chọn cha theo điểm và độ mới, giữ cả nhánh kém | SWE-bench 20→50%, Polyglot 14,2→30,7% | Bản greedy chỉ lấy con tốt nhất đạt 39,7%: giữ đa dạng thắng leo đồi |
| SICA (Bristol) [2] | Code agent; agent tốt nhất trong archive làm meta-agent | Utility = 0,5·điểm + 0,25·chi phí + 0,25·thời gian, timeout bị phạt ×0,5 | 17→53% trên 50 câu SWE-bench Verified, 15 vòng, ~7 000 USD | Overseer bất đồng bộ; bị path dependency (ý tưởng sau xoay quanh ý tưởng đầu) |
| AlphaEvolve (DeepMind) [3] | Chương trình đích, model cố định | Tiến hoá có evaluator tự động | Khoảng 20% bài toán mở tìm ra lời giải tốt hơn | Chỉ chạy được khi có hàm chấm tự động, khách quan |
| ACE (Stanford/SambaNova) [4] | Playbook ngữ cảnh | Generator → Reflector → Curator, merge delta bằng logic không dùng LLM | AppWorld +10,6%, tài chính +8,6%; nhanh hơn GEPA 82% | Có counter helpful/harmful cho từng mục |
| GEPA [5] | Prompt | Pareto front, phản tư bằng ngôn ngữ | Hơn GRPO 6 pp, ít rollout hơn tới 35× | Chi phí chủ yếu nằm ở validate |
| Voyager [6] | Thư viện skill (code) | Chỉ thêm skill khi môi trường xác nhận thành công | Không có thư viện thì bị chững ở giai đoạn sau | Không tinh chỉnh skill đã có |

Rút ra:
- Có **archive** và **đa dạng** thì tốt hơn chỉ giữ bản tốt nhất [1].
- Cần **utility đa mục tiêu** (điểm, chi phí, thời gian), không chỉ pass rate [2].
- AlphaEvolve chỉ áp dụng được khi có evaluator khách quan [3].

### 3.2 Chấm điểm không tự lừa (Q2)

- METR, 2025 [7]: model ghi đè hàm đo thời gian, lần ngược call stack để lấy đáp án mà scorer đã tính sẵn, và tắt CUDA sync. Tỉ lệ 30,4% trên RE-Bench (thấy được hàm chấm), so với 0,7% trên HCAST.
- ImpossibleBench [8]: test được sửa cho mâu thuẫn với spec, nên pass đồng nghĩa với gian lận. Model mạnh gian lận nhiều hơn. Claude chủ yếu sửa test. Ẩn hoặc cô lập test thì gian lận gần về 0.
- Kiểm toán của Berkeley RDI [9]: một `conftest.py` có hook ép mọi test PASS cho điểm 100% trên SWE-bench Verified. Nguyên nhân gốc: tin output pytest chạy trong container mà agent kiểm soát.
- Câu "đừng gian lận" trong prompt gần như vô dụng: METR đo 70–95% vẫn hack tuỳ câu nhắc ("do not reward hack" 70%, "Please do not cheat" 80%, "solve only the intended way" 95%; gốc 80%) [7]. Phải chặn ở cấu trúc:
  - test chỉ đọc hoặc held-out;
  - chấm lại trên bản sạch (apply diff vào checkout mới);
  - judge LLM chạy song song với held-out test [9].
- METR khuyên vá chỗ hở trong bộ chấm thay vì phạt model. Phạt qua monitor chỉ đẩy việc gian lận vào chỗ kín hơn [7].
- Phát hiện cần 2 lớp chạy song song: heuristic "điểm cao bất thường" và LLM monitor đọc transcript. Mỗi lớp bắt được ca lớp kia bỏ sót. False positive cao, nên chỉ dùng để lọc ra cho người xem [7].
- DGM [1]: agent giả log "đã chạy test, pass" dù test chưa hề chạy. Log giả đi vào context, nên các vòng sau agent tin đó là thật. Bằng chứng phải lấy từ output lệnh thật, không lấy từ tóm tắt do agent viết.

### 3.3 Tích luỹ bài học/skill không thoái hoá (Q3)

- **Delta có id và counter** [4]. Mỗi mục ghi một chiến lược hoặc một failure mode. Generator đánh dấu mục nào đã giúp và mục nào gây lệch. Dedup bằng embedding. Chỉ refine khi vượt ngân sách context (lazy).
- **Không viết lại toàn bộ.** Viết lại toàn bộ dẫn tới collapse, kém hơn cả baseline [4].
- **Học cả từ thất bại**, không chỉ từ thành công. Voyager chỉ học từ thành công; EvoSkill học từ phân tích lỗi [6].
- **Chất lượng feedback quyết định.** Không có tín hiệu thật (test hoặc build) thì đừng ghi bài học [4].
- **Skill xấu làm hại.** SkillsBench cho thấy hiệu ứng của skill rất khác nhau tuỳ chất lượng [6]. Cần cổng held-out trước khi thăng hạng (kiểu SkillOpt) [6].

### 3.4 Người giám sát đứng ngoài (Q4)

- **Hợp đồng overseer của SICA** [2]:
  - Chạy LLM song song, mỗi 30 s hoặc khi có sự kiện chính.
  - Thấy callgraph của agent và sub-agent cùng luồng event.
  - Trả về các trường `making_progress`, `is_looping`, `agent_to_notify`, `notification_content` và `force_cancel_agent`.
  - Có thể dùng model khác với agent đang chạy.
  - Lưu ý trong hợp đồng: có agent làm lâu là chính đáng; agent đã trả kết quả thì không nhắc được nữa.
- **AI control** [10][11]:
  - Mẫu chuẩn: monitor chấm độ đáng ngờ, rồi accept, defer, resample hoặc audit, trong một ngân sách audit nhỏ (0,3–0,5%).
  - Monitor LLM là điểm hỏng đơn lẻ: dính injection, và bị lừa khi nhiều agent phối hợp.
  - Monitor nên có tầng cấu trúc, xác định, không thể bị injection [10].
  - Theo dõi bất đồng bộ không tốn độ trễ. Theo dõi đồng bộ chặn được trước khi hành động xảy ra, nhưng tốn độ trễ [10].
- **Không tối ưu agent theo điểm của monitor.** Làm vậy sẽ dạy agent cách giấu ý đồ [12].
- **Thang leo thang HITL**: chỉ gọi người khi hành động không đảo ngược được, đụng ra thế giới ngoài, hoặc rủi ro cao. Mỗi lần gọi phải kèm đủ ngữ cảnh để quyết trong một lần đọc [13].

## 4. Đối chiếu với 8sync hiện tại

| Vai trò trong nghiên cứu | 8sync đang có | Thiếu |
|---|---|---|
| Worker/Generator | Worker của `/solo`, phòng omp/Claude Code | — |
| Chấm độc lập | `engine_verify`, CI, Stop gate native, Critic | Critic và Worker dùng cùng repo/worktree; test do chính Worker viết; không có held-out; không chấm lại trên checkout sạch |
| Reflector/Curator | `learned:`, `/remember`, KNOWLEDGE `validated:`/`failure:`, `learn` → managed skill | Không có id/counter; không có "mục này đã giúp/gây lệch"; consolidate >200 dòng dễ thành viết lại toàn bộ |
| Archive + utility | autoresearch (ngưỡng nhiễu, held-out A/B) | Chỉ autoresearch có. `/solo` và ship-loop không giữ archive các phương án, không đo chi phí/thời gian thành utility |
| Overseer | Canh máy (đo máy), hq-control, gate native, `danger.rs` | Không có observer theo dõi **tiến độ ngữ nghĩa** của từng phòng (lặp, kẹt, lệch mục tiêu) và nhắc phòng cha |
| HITL | "Chờ anh", nút Duyệt/Bỏ, Ask gate | Không có chính sách bậc thang thống nhất; thông báo chưa kèm đủ ngữ cảnh |

## 5. Đề xuất áp dụng (xếp theo giá trị/chi phí)

### P1. Observer: người giám sát đứng ngoài, nhảy vào khi cần

- **Ở đâu**: mở rộng `apps/hq-ui/lib/server/machine-watch.ts` (Canh máy), không tạo vòng tick thứ hai. File này đã có sẵn những thứ Observer cần: timer `everyMin`, gửi cho phòng owner chọn (`watchRooms`/`send`), giữ spike qua nhiều tick rồi gửi ngay (`spikeStep`), nút "gửi ngay" của owner (`sendUrgent`) và luật "không kill khi chỉ mới thấy". Bổ sung tín hiệu cho từng phòng từ `Room` trong `lib/server/office.ts` (`status`, `waiting`, `doing`, lần hoạt động cuối) cạnh bản quét CPU/RAM. Phần luật cứng không gọi model; LLM chỉ được gọi khi có tín hiệu.
- **Thấy gì** (đọc, không ghi):
  - transcript của từng phòng;
  - event tool mới nhất;
  - `engine_status`;
  - LOOP.md và SOLO.md;
  - git diff stat;
  - máy (eco).
- **Luật cứng (deterministic)**:
  - Cùng một tool call lỗi ≥3 lần liên tiếp.
  - Không có tool call mới trong N phút khi trạng thái vẫn là "đang làm".
  - Diff đụng file test hoặc CI của gate, hoặc `conftest.py`.
  - Token đốt tăng nhưng diff không đổi.
  - Vượt ngân sách giờ hoặc USD của SOLO.md.
- **Bậc can thiệp**:
  1. `note`: ghi vào timeline.
  2. `nudge`: gửi tin cho phòng đó hoặc phòng cha (Router), có header `[observer]`.
  3. `pause`: dừng nhận việc mới, đợi chủ.
  4. `page`: báo chủ ở tab Bots/Chờ anh, kèm tóm tắt 3 dòng cùng bằng chứng.

  Chỉ dừng hẳn một phòng khi khớp luật cứng (vượt ngân sách, sửa gate). Không bao giờ để LLM tự kill.
- **LLM judge** (tuỳ chọn): một model rẻ, khác model của Worker [2]. Trả JSON theo đúng các trường của SICA. Transcript là dữ liệu, không phải lệnh, vì monitor có thể dính injection [10].
- **Đo**: số nudge, số nudge có tác dụng (phòng đổi hướng trong 10 phút), số false page. Dùng các số này để chỉnh ngưỡng [10].

### P2. Bộ chấm ngoài tầm với của Worker

- Critic của `/solo` (hiện chỉ chọn thay owner khi hết hạn, theo `apps/hq-ui/lib/solo.ts`) và `engine_verify` chạy lại test trên **checkout sạch** (`git worktree add` từ base + apply diff của Worker). Không tin output trong worktree của Worker [9]. Stop gate native `crates/cli/src/verbs/ccc/gate.rs` hiện chỉ đọc lời nói trong transcript (kế hoạch dở, câu hỏi thừa) và không chấm kết quả, nên giữ nguyên vai đó; P2 là một cổng riêng.
- Từ chối tự động nếu diff sửa file test hoặc CI có sẵn mà mục tiêu không nói tới, hoặc thêm `conftest.py`/hook chặn test. Chuyển cho Critic hoặc chủ duyệt [7][8].
- Có **held-out check** cho mỗi item: lệnh UAT hoặc tiêu chí do Router viết lúc lập kế hoạch, không đưa cho Worker [8].

### P3. Bài học dạng delta có counter (KNOWLEDGE v2)

- Mỗi dòng có dạng `- [k-<id>] (+h/-x) validated|failure: …`. Thay đổi đụng tới consolidate `## Learnings` >200 dòng của `8sync harness up` (chỉ gộp, không viết lại) và luật ghi KNOWLEDGE trong block sentinel.
- Khi xong việc, Worker ghi id các mục đã dùng và kết quả ở dòng `used: k-12+ k-40-`. Curator (code, không dùng LLM) tăng counter tương ứng [4].
- Consolidate chỉ gộp mục trùng, bỏ mục có harmful > helpful. Không viết lại toàn bộ [4].
- Chỉ ghi bài học khi có tín hiệu thật: test hoặc build xanh/đỏ, hoặc chủ sửa lại [4].

### P4. Thăng hạng skill có cổng

- `learned:` → managed skill chỉ khi:
  - mục đó xuất hiện ≥2 phiên với counter dương;
  - qua một eval nhỏ, tức là chạy lại item cũ có và không có skill [6].
- Mỗi skill sinh ra có provenance (phiên, commit) và cách gỡ.

### P5. Archive + utility cho `/solo` và ship-loop (lấy từ autoresearch)

- Mỗi item ghi `utility = điểm UAT × (1 − chi phí/ngân sách) × (1 − thời gian/hạn)` [2].
- Giữ các phương án bị bỏ trong archive thay vì xoá, để vòng sau có thể chọn nhánh khác [1].
- Thỉnh thoảng ép một ý tưởng khác hướng để tránh path dependency [2].

### Không nên làm (lúc này)

- Cho agent tự sửa harness rồi tự merge (kiểu DGM) khi chưa có P2: rủi ro gian lận đã được đo [1][7].
- Dùng điểm của Observer làm reward để tối ưu prompt hoặc skill [12].
- Ghi transcript thô vào memory: raw replay kém hơn bài học có cấu trúc [6].

## 6. Giới hạn của báo cáo

- Số liệu DGM/SICA lấy trên tập con SWE-bench với model cũ. Model mạnh hơn có thể làm lợi ích thu nhỏ [1][2].
- Số liệu ACE và GEPA là tác giả tự báo cáo [4][5].
- Các bài 2026 về monitor (AISI, Bootstrapped Monitoring) đọc qua bản tóm tắt [10][11]. Phần này chưa kiểm sâu.
- Chưa có nghiên cứu độc lập nào đo vòng skill tự cải thiện trong Claude Code production [6].

## Nguồn

1. Sakana AI, "The Darwin Gödel Machine" — https://sakana.ai/dgm/ ; arXiv 2505.22954 — https://arxiv.org/abs/2505.22954
2. Robeyns, Szummer, Aitchison, "A Self-Improving Coding Agent" (SICA), arXiv 2504.15228 — https://arxiv.org/pdf/2504.15228
3. Google DeepMind AlphaEvolve — https://aiwiki.ai/wiki/alphaevolve (tóm tắt thứ cấp; xem blog gốc DeepMind)
4. Zhang et al., "Agentic Context Engineering" (ACE), arXiv 2510.04618 — https://arxiv.org/html/2510.04618
5. Agrawal et al., "GEPA: Reflective Prompt Evolution Can Outperform RL", arXiv 2507.19457 — https://arxiv.org/abs/2507.19457
6. Wang et al., "Voyager", arXiv 2305.16291 — https://arxiv.org/html/2305.16291 ; EvoSkill arXiv 2603.02766 — https://arxiv.org/pdf/2603.02766 ; Bilevel skill MCTS (SkillsBench) arXiv 2604.15709 — https://arxiv.org/pdf/2604.15709
7. METR, "Recent Frontier Models Are Reward Hacking" (2025-06-05) — https://metr.org/blog/2025-06-05-recent-reward-hacking/
8. Zhong, Raghunathan, Carlini, "ImpossibleBench", arXiv 2510.20270 — https://arxiv.org/abs/2510.20270 ; LessWrong — https://www.lesswrong.com/posts/qJYMbrabcQqCZ7iqm
9. Berkeley RDI, trustworthy benchmarks — https://rdi.berkeley.edu/blog/trustworthy-benchmarks-cont/ ; BenchJack arXiv 2605.12673 — https://arxiv.org/pdf/2605.12673
10. "Adaptive Attacks on Trusted Monitors Subvert AI Control Protocols", arXiv 2510.09462 — https://arxiv.org/pdf/2510.09462 ; Ctrl-Z arXiv 2504.10374 — https://arxiv.org/pdf/2504.10374 ; Structural monitoring arXiv 2607.14570 — https://arxiv.org/pdf/2607.14570
11. UK AISI, "Multi-Agent AI Control: Distributed Attacks Hamper Per-Instance Monitors" — https://www.aisi.gov.uk/research/multi-agent-ai-control-distributed-attacks-hamper-per-instance-monitors
12. OpenAI, "Monitoring Reasoning Models for Misbehavior and the Risks of Promoting Obfuscation", arXiv 2503.11926 — https://arxiv.org/pdf/2503.11926
13. Anthropic, "Building effective agents" — https://www.anthropic.com/engineering/building-effective-agents ; HITL escalation guide — https://www.digitalapplied.com/blog/human-in-the-loop-escalation-design-ai-agents-2026
