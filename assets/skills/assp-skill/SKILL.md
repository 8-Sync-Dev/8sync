---
name: assp-skill
description: Brand DNA + ASSP validation framework for 8 Sync Dev (Avatar → Brand Voice → Hero Mechanism → Money Model → Offer Architect). MUST be consulted for any user-facing copy (UI microcopy, landing/pricing pages, emails, error messages) — Alex Dev voice (terse, direct, dev-to-dev Vietnamese, EN tech terms kept, banned-phrase list), brand identity + standard footer, offer/pricing structure (4-week billing). Also governs validate-before-build for new product features.
---

# SKILL.md — ASSP cho 8 Sync Dev

> File chỉ dẫn cho mọi AI coding agent (Claude Code, Cursor, GitHub Copilot, Codex, Gemini…).
> Đọc file này TRƯỚC khi làm bất cứ việc gì trong repo: brand này là ai, tư duy làm sản phẩm ra sao,
> và **ASSP** — bộ nguyên tắc "validate-trước-khi-build" mà mọi sản phẩm 8 Sync Dev phải đi qua.

---

## 1. BRAND IDENTITY (gắn cứng — không đổi)

| Field | Value |
|---|---|
| **Brand** | 8 Sync Dev |
| **Founder / Admin** | Nguyễn Phương Anh Tú |
| **Aliases** | Alex Dev · Kevin Nguyễn |
| **Email** | atus@8syncdev.com |
| **Kênh** | YouTube · TikTok · Fanpage · Cộng đồng/Hội nhóm 8 Sync Dev |
| **Vai trò** | Founder, Admin, người ra quyết định cuối về sản phẩm & offer |
| **Ngôn ngữ chính** | Tiếng Việt (giữ nguyên thuật ngữ kỹ thuật & marketing tiếng Anh) |

**Footer chuẩn cho mọi output:**
`8 Sync Dev — Nguyễn Phương Anh Tú (Alex Dev / Kevin Nguyễn) · atus@8syncdev.com`

---

## 2. SỨ MỆNH

Giúp dev Việt **build sản phẩm số có khách hàng thật** — không build sản phẩm vô danh,
không đốt thời gian code thứ không ai dùng.

Tinh thần: **Maker-Mentor** (anh thợ vừa làm vừa dạy). Trực tiếp, thực dụng, brutally honest,
nói chuyện dev-với-dev.

---

## 3. DANH MỤC SẢN PHẨM (mỗi sản phẩm 1 avatar riêng)

| Sản phẩm | Loại | Core audience |
|---|---|---|
| **8 Sync Coder** | LeetCode-style luyện thuật toán (VI-first) | Sinh viên/dev VN apply FAANG-VN |
| **8 Sync IELTS AI** | EdTech luyện IELTS + AI | Học sinh/SV cần band 7.0 săn học bổng |
| **8 Sync CRM** | CRM + AI + SaaS | Chủ SME/chuỗi dịch vụ (spa, F&B, edu…) |
| **8 Sync Vector DB** | Dev tool / AI infra | AI Engineer build RAG production |
| *(sản phẩm tương lai)* | — | — |

> Mỗi repo thường = 1 sản phẩm. Khi mở repo, AI nên xác định nó thuộc sản phẩm nào để dùng đúng avatar & voice.

---

## 4. ASSP LÀ GÌ — nguyên tắc cốt lõi (BẮT BUỘC hiểu)

**ASSP = quy trình 5 bước chốt "ai mua – mua gì – mua thế nào – tại sao chọn mình" TRƯỚC khi viết code.**

Lỗi kinh điển: build sản phẩm trước → mới đi tìm khách → ra sản phẩm chung chung không ai cần.
ASSP đảo ngược: **validate trước, build sau.**

```
SAI:  Ý tưởng hay → code ngay → ra sản phẩm → đi tìm khách → không ai dùng → công cốc
ASSP: Chốt AI MUA → MUA GÌ → MUA THẾ NÀO → TẠI SAO CHỌN MÌNH → rồi mới build
```

Bài học thật: founder từng tốn hơn 1 tuần làm SpeakNow → ra sản phẩm chung chung, không focus
được ai, pain của họ là gì. ASSP sinh ra để không lặp lại lỗi đó.

5 bước theo đúng thứ tự (không nhảy, không đảo):

| # | Bước | Câu hỏi sống còn |
|---|---|---|
| 1 | **Avatar Builder** | Ai là người DUY NHẤT tôi phục vụ? |
| 2 | **Brand Voice** | AI viết phải nghe đúng giọng Alex Dev |
| 3 | **Hero Mechanism** | Tại sao chọn tôi, không chọn đối thủ y hệt? |
| 4 | **Money Model** | Sao họ mua nhiều lần, không chỉ 1 lần? |
| 5 | **Offer Architect** | Tại sao "không mua là dại"? |

**Vì sao thứ tự bất biến:** Voice không Avatar = viết cho ma · Mechanism không Avatar = đánh không
trúng đau · Money Model không Mechanism = bị so giá · Offer không Money Model = bán 1 lần rồi chết.
Một sản phẩm tốt = (1 avatar) × (1 voice) × (1 mechanism) × (1 money model) × (1 offer). **Thiếu 1 thừa số → = 0.**

Nền lý thuyết: **Alex Hormozi** ($100M Offers/Leads/Money Models) + **Sabri Suby** (Sell Like Crazy)
+ **Unique Mechanism** (Schwartz / Brunson / Todd Brown / Stefan Georgi).

---

## 5. 4 QUY TẮC VÀNG (AI phải tuân khi hỗ trợ build)

1. **Validate trước khi build.** Trước khi đề xuất kiến trúc/code, hỏi: "Sản phẩm này đã qua ASSP chưa? Avatar là ai? Offer là gì?" Chưa rõ → nhắc founder chạy ASSP.
2. **AI First.** Dùng AI soi ngách, đối thủ, customer pain trước khi tốn 1 phút code.
3. **One avatar, one offer, one channel.** Mỗi sản phẩm phục vụ MỘT chân dung đến khi scale lớn mới tách.
4. **Free product = bỏ Money Model & Offer.** Tool/lead magnet miễn phí chỉ cần Avatar + Voice + Mechanism, nhưng phải có hook dẫn về sản phẩm trả phí.

---

## 6. CÁCH AI DÙNG SKILL NÀY KHI CODE

- **Build feature mới:** soi sản phẩm thuộc avatar nào (mục 3) → align UX/copy với pain & dream của avatar (xem STEP 1).
- **Viết text hướng người dùng** (UI copy, landing, README marketing, email, error message): tuân Voice Profile (STEP 2).
- **Viết copy bán hàng / pricing page / CTA:** dùng Hero Mechanism + Offer (STEP 3, 5).
- **Thiết kế pricing/subscription/paywall trong code:** tham chiếu Money Model (STEP 4) — VD continuity bill theo chu kỳ **4 tuần**, không phải calendar month.
- **Footer & nhận diện:** mọi tài liệu ký tên brand ở mục 1.
- **UI text/microcopy:** tiếng Việt, giọng Alex Dev — ngắn, thẳng, không sến, không "trong thời đại số ngày nay…". Thuật ngữ kỹ thuật giữ tiếng Anh.
- **Tài liệu sản phẩm:** lưu file `ASSP-{TÊN_SẢN_PHẨM}-v{N}.md` ở root hoặc `/docs`.

**Khi nào bỏ bước:** Free product → chỉ STEP 1→2→3, ghi rõ là Attraction Offer dẫn về sản phẩm trả phí nào.
Sản phẩm có phí → đủ cả 5 bước.

---

# CHI TIẾT 5 BƯỚC ASSP

## STEP 1 — AVATAR BUILDER (Dream Buyer)

**Mục đích:** xác định MỘT người duy nhất sản phẩm phục vụ. Mọi copy/feature/giá/bonus viết CHO NGƯỜI NÀY.
**Vì sao không bỏ:** avatar mơ hồ = nguyên nhân số 1 build app xong không bán được.

**Cần khai thác (8 nhóm):**
- **Định danh:** tên + ảnh tinh thần, tuổi/giới/nghề/thu nhập/thành phố, một ngày 24h.
- **Pains:** 3 nỗi đau lớn nhất + câu tự nói lúc 3h sáng (verbatim) + đã thử gì thất bại.
- **Fears:** hậu quả nếu không giải quyết; sợ gì khi mua.
- **Dream Outcome:** viễn cảnh 6 tháng sau — CỤ THỂ, có cảm xúc, có victory moment.
- **Internal language:** ≥10 cụm họ thật sự dùng (paste verbatim từ Reddit/FB/YouTube comment).
- **Nơi hang out:** 5 cộng đồng + 3 KOL + 3 sách/podcast/kênh.
- **Money:** đã trả bao nhiêu, mức giá đau, ai ra quyết định, tiền từ đâu.
- **Starving Crowd Score (Hormozi /40):** Pain + Power + Targetable + Growing. **<28 → đổi avatar.**

**Niche specificity formula (Hormozi):**
> "Tôi giải quyết **[VẤN ĐỀ]** cho **[AVATAR CỰC CỤ THỂ]** theo cách **[UNIQUE/counter-intuitive]**
> mà đảo ngược nỗi sợ sâu nhất của họ."

**Ví dụ 4 sản phẩm:**

| Sản phẩm | Avatar | Câu 3h sáng | Dream Outcome |
|---|---|---|---|
| 8 Sync Coder | Minh, 22t, năm cuối CNTT, apply VinAI/Grab/Tiki, leetcode ENG mãi fail | *"Người ta dễ vậy sao mình mãi không qua?"* | Offer 35tr/tháng tại VinAI sau 90 ngày |
| 8 Sync IELTS AI | Linh, 19t, cần 7.0 trong 4 tháng săn học bổng AUS, kẹt 6.0 Speaking | *"Mình nói tiếng Anh nghe ngu lắm…"* | 7.0 đúng kỳ thi, học bổng 50% Monash |
| 8 Sync CRM | Anh Hùng, 38t, chủ 3 spa TP.HCM, quản khách bằng Zalo+Excel | *"Doanh thu tụt mà không biết khách nào sắp bỏ đi."* | Khách quay lại 28%→55%, doanh thu/khách 1.8x trong 90 ngày |
| 8 Sync Vector DB | Khoa, 28t, AI Eng startup, hoá đơn Pinecone $1.2K/tháng ăn margin | *"Đang đốt tiền investor cho Pinecone trước PMF."* | Self-host 50M vectors, giảm 70% chi phí, p99<80ms |

**Gate qua bước 2:** ☐ Avatar có TÊN · ☐ 3 pains + 3 fears + Dream Outcome bằng ngôn ngữ avatar
· ☐ ≥10 internal language verbatim · ☐ ≥5 nơi hang out · ☐ Starving Crowd ≥28/40 · ☐ Niche formula đủ 3 chỗ.

---

## STEP 2 — BRAND VOICE (Voice Profile: Alex Dev)

**Mục đích:** đóng gói giọng văn Alex Dev thành profile tái dùng để AI viết UI copy/landing/email/script
đúng chất, không robot.
**Vì sao không bỏ:** Avatar = viết CHO AI; Voice = viết BẰNG GIỌNG AI. Thiếu Voice = văn "trợ lý ảo công ty"
→ mất trust → conversion chết. Làm SAU Avatar.

**4 trục tone (chấm 1–5):** Hài hước(1)↔Nghiêm túc(5) · Bình dân(1)↔Trang trọng(5) · Bất kính(1)↔Tôn trọng(5) · Hype(1)↔Trầm tĩnh(5).

**Voice essence Alex Dev (mặc định brand):**
- Archetype: Maker-Mentor — anh thợ vừa làm vừa dạy.
- 3 trait cốt lõi: "dev nói chuyện dev" · "brutally honest" · "code + biz cùng lúc".
- POV: "mình" với cộng đồng; "anh/em" tuỳ avatar; **KHÔNG** "quý khách".
- Gọi audience: "anh em dev", "fen", "bạn".
- Mix EN-VI: cho phép với thuật ngữ kỹ thuật & marketing (deploy, ship, MRR, CAC, ICP).
- Câu TB 12–18 từ, tối đa 25; đoạn ≤3 câu; lớp 9 đọc hiểu.
- Emoji ≤1–2/post, ưu tiên ⚡🔥💀🚀; cấm 🌟✨🎉 (sến).

**Banned list (tuyệt đối tránh):** "trong thời đại số ngày nay", "hãy cùng khám phá", "điều tuyệt vời là",
"đột phá", "cách mạng", "giải pháp tối ưu hàng đầu", "Great question!", "delve into", "quý khách",
từ Sino-Việt hoa mỹ lạc tông với dev voice.

**Cần điền mỗi sản phẩm:** 5–10 mẫu writing thật của Alex Dev · 2–3 mẫu off-brand · 5–10 signature phrases (verbatim).

**Channel modulation (giữ voice, đổi tone):**

| Kênh | Hài | Trang trọng | Bất kính | Nhiệt | Độ dài |
|---|---|---|---|---|---|
| YouTube | 2 | 3 | 2 | 3 | 8–15 phút |
| TikTok | 3 | 4 | 3 | 4 | 30–60s, hook 2s đầu |
| Fanpage | 2 | 3 | 2 | 3 | 200–400 chữ |
| Cộng đồng | 3 | 4 | 3 | 3 | tuỳ |
| Email | 2 | 3 | 2 | 3 | 150–300 chữ, 1 idea |
| Sales page | 1 | 3 | 2 | 4 | dài, theo Hormozi/Suby |

**Self-check trước khi nộp:** ☐ Câu TB 12–18 từ · ☐ Không dính banned list · ☐ ≥1 signature phrase
· ☐ 4 trục lệch ≤±1 target · ☐ POV nhất quán · ☐ Đọc to nghe có giống Alex Dev không?

---

## STEP 3 — HERO MECHANISM (Unique Mechanism độc quyền)

**Mục đích:** trả lời "Tại sao chọn 8 Sync Dev, không chọn đối thủ y hệt?" Tạo cơ chế CÓ TÊN, có logic
vì sao work mà thứ khác fail → biến sản phẩm từ "một lựa chọn" thành "lựa chọn duy nhất".
**Vì sao không bỏ:** thị trường bão hoà cùng lời hứa → khách hết tin. Chỉ Unique Mechanism re-trigger niềm tin.
Thiếu nó = bán Improvement Offer (2% mua); có nó = New Opportunity, không bị so giá.

**3 thành phần phải có (Todd Brown — tránh "Faux Mechanism"):**
1. **Name** — tên riêng, đặt được, Google chưa ai chiếm.
2. **How it works** — logic "vì… nên…".
3. **Causal proof** — chứng minh cơ chế dẫn tới kết quả.

**Hai lớp cơ chế:**
- **UMoP (of the Problem):** lý do BỊ CHE GIẤU khiến avatar fail — không phải vì họ lười/dốt. Đặt tên cho "hội chứng" đó.
- **UMoS (of the Solution):** cách giải quyết khác đối thủ (process/ingredient/tech/delivery), gồm 3 trụ có tên.

**Chuỗi causal (script 30s):**
> "Bạn đã thử [A,B,C] mà vẫn [problem] vì **[UMoP có tên]**. Đây chính là lý do **[MECHANISM_NAME]** tồn tại —
> vì nó [how it works] dẫn tới [Dream Outcome trong T]."

**Đặt tên:** Acronym (RMBC) · Step-numbered ("3-Tầng ___") · Compound (SOLARCORE) · Metaphor (Tripwire) ·
Founder name. Test: nói to 5 lần dễ nhớ; Google chưa ai chiếm.

**Ví dụ 4 sản phẩm:**

| Sản phẩm | UMoP (tên hội chứng) | Mechanism Name | 3 trụ UMoS |
|---|---|---|---|
| 8 Sync Coder | "Hội chứng LeetCode Tiếng Anh" — fail vì đọc đề ENG tốn 40% năng lượng não | **VFLOW Method** | 1) Đề dịch chuẩn IT-VN 2) Pattern Tree theo công ty Việt 3) Mock AI tiếng Việt |
| 8 Sync IELTS AI | "Hội chứng Speaking Sợ Sai" | **MIRROR-7 Protocol** | 1) AI mirror lỗi điển hình VN 2) Lexis Swap 6→8 3) Stress-test cue card 72h |
| 8 Sync CRM | "Hội chứng Excel-Zalo" | **ZALO-LOOP System** | 1) Unified inbox 2) AI auto-touchpoint theo vòng đời 3) Win-back trigger hành vi |
| 8 Sync Vector DB | "Hội chứng Pinecone Tax" | **RAG-LITE Stack** | 1) Hybrid pgvector+Qdrant tiered 2) Auto-quantize cost guard 3) Eval harness recall thật |

**Gate qua bước 4:** ☐ Có TÊN · ☐ UMoP+UMoS nối logic · ☐ ≥3 trụ có tên · ☐ Script causal 30s không vấp
· ☐ Cạnh 3 đối thủ "vì sao chọn mình" rõ trong 5s · ☐ Không phải Faux Mechanism · ☐ Google chưa trùng.

---

## STEP 4 — MONEY MODEL (4-mũi Hormozi)

**Mục đích:** vẽ TOÀN BỘ dòng tiền — không bán 1 sản phẩm 1 lần, mà chuỗi offer khiến khách mua đi mua lại,
tiền vào nhanh hơn tiền ra (Client Financed Acquisition).
**Vì sao không bỏ:** lý tưởng = kiếm đủ tiền từ 1 khách trong 30 ngày để mua thêm 2 khách nữa.
**BỎ QUA nếu** sản phẩm FREE (nó chính là Attraction Offer của sản phẩm khác).

**Bảng 4 mũi:**

| Stage | Chọn 1 loại | Quy tắc |
|---|---|---|
| I. Attraction | Win-Money-Back · Free/Giveaway · Decoy · Buy-X-Get-Y · Pay-Less-Now · Free-with-Consumption | Biến lạ thành khách |
| II. Upsell | Classic · Menu · Anchor · Rollover | Bán thêm NGAY lúc khách hài lòng nhất |
| III. Downsell | Payment Plan · Trial-with-Penalty · Feature Downsell | **KHÔNG giảm giá gốc** — đổi terms/features |
| IV. Continuity | Continuity Bonus · Continuity Discount (tặng THỜI GIAN) · Waived Fee | Giữ dòng tiền |

**2 chiêu kỹ thuật:**
- **4-week billing:** bill mỗi 4 tuần (13 chu kỳ/năm) thay vì hàng tháng (12) → +8.3% revenue. → Khi code subscription/billing, mặc định cấu trúc theo chu kỳ 4 tuần.
- **Waived-fee close:** "Anh có ngại để mình miễn phí setup nếu anh chốt 1 năm hôm nay không?" → close 80–90%.

**CFA Math (kiểm tra sống còn):** `30-day Gross Profit ≥ 2 × (CAC + COGS)?` Không đạt → chỉnh 1 lever: ↓CAC · ↑LTGP · ↓PPD.

**Sequence rule:** master 1 offer trước khi thêm offer kế. Continuity để CUỐI. "Simple scales; fancy fails."

**Ví dụ 8 Sync Coder:**

| Stage | Offer | Giá |
|---|---|---|
| Attraction | "VFLOW 90-day Challenge — hoàn 100% nếu hoàn thành đủ + offer ≥25tr" | 1.990.000đ |
| Upsell | "Mock Interview AI tiếng Việt — 10 buổi Alex Dev review" | +1.490.000đ |
| Downsell | Cùng VFLOW chia 3 kỳ × 750.000đ (không giảm tổng) | 2.250.000đ |
| Continuity | "8 Sync Pro" 290k/4 tuần — miễn 1tr setup nếu cam kết 1 năm | 290k/4w (13 kỳ = 3.77tr/năm) |

**Gate qua bước 5:** ☐ 4 mũi có TÊN+GIÁ · ☐ CFA Math pass (hoặc ghi lever sẽ fix) · ☐ Downsell không giảm giá gốc
· ☐ Continuity bill 4-week · ☐ Đồng ý master 1 offer trước.

---

## STEP 5 — OFFER ARCHITECT (Grand Slam / Godfather Offer)

**Mục đích:** đóng gói MỘT offer cho mũi Attraction (Step 4) hấp dẫn đến mức "không mua là dại".
**Quy tắc tuyệt đối:** 1 offer/lần — không bundle 4 sản phẩm vào 1 offer.

**Value Equation (Hormozi):** `Value = (Dream Outcome × Perceived Likelihood) / (Time Delay × Effort & Sacrifice)`
↑ Dream Outcome (cụ thể, cảm xúc) · ↑ Likelihood (testimonial/case/guarantee) · ↓ Time Delay · ↓ Effort (DFY/DWY/automation).

**Quy trình 5 bước tạo offer:**
1. Identify Dream Outcome (từ STEP 1).
2. List ALL Problems (≥15 obstacle trước/trong/sau khi dùng).
3. Turn into Solutions (mỗi problem → 1 solution CÓ TÊN).
4. Delivery Cube: Group ratio · Effort (DIY/DWY/DFY) · Support · Consumption · Speed · test 10x/0.1x.
5. Trim & Stack: giữ High-Value, stack thành bundle có stated value gấp **5–10×** giá bán.

**5 enhancer (S.U.B.G.N.):**
- **Scarcity** — giới hạn SỐ LƯỢNG (slot/cohort) thật.
- **Urgency** — giới hạn THỜI GIAN (deadline) thật.
- **Bonuses** — stack value không hạ giá; mỗi bonus có TÊN + dollar value.
- **Guarantee** — Unconditional / Conditional / Anti / Implied; đặt tên branded.
- **Naming (MAGIC):** **M**agnetic reason · **A**vatar · **G**oal · **I**nterval · **C**ontainer (Challenge/Bootcamp/Accelerator/Protocol/Blueprint/Method/System…).

**Godfather components (Suby):** Rationale (kill "what's the catch") · Build value · Pricing+anchor ·
Payment options · Premiums (bonuses named) · Power Guarantee (đặt tên) · Scarcity thật.

**Self-audit:** "Offer này có khiến mình mất ngủ vì sợ giao không nổi không?" (Suby test) → phải YES ·
"Khách đọc xong thấy KHÔNG mua là ngu chưa?" → YES · "Đối thủ copy được trong 1 tuần không?" → nếu CÓ → Mechanism yếu, quay lại STEP 3.

**Ví dụ 8 Sync Coder — VFLOW 90-Day Accelerator:**

| Field | Nội dung |
|---|---|
| Tên (MAGIC) | "Free 90-Day **VFLOW Accelerator** cho dev VN apply FAANG-VN" |
| Dream Outcome | Offer ≥25tr/tháng từ VinAI/Grab/Tiki sau 90 ngày |
| Stack (12 món) | Tổng stated value ~23.75tr (đề dịch IT-VN, Pattern Tree, Mock AI, STAR template, resume audit, System Design, cộng đồng, live Q&A, PDF offline, code template, negotiation, lifetime update) |
| Giá Godfather | 1.990.000đ (~12× value) hoặc 3 kỳ × 750k |
| Guarantee | "Iron-FAANG Guarantee" (Conditional): đủ 90 ngày + không offer ≥20tr → hoàn 100% |
| Scarcity/Urgency | 100 slot/cohort, mỗi quý 1 cohort, deadline 23:59 ngày X |
| Mechanism nhắc trong copy | "VFLOW Method" |

**Gate tốt nghiệp:** ☐ Tên đủ 5 chữ MAGIC · ☐ Stack ≥12 món có tên+giá · ☐ value/price ≥5× · ☐ Guarantee branded
· ☐ Scarcity+Urgency thật · ☐ Mechanism nhắc trong offer · ☐ Voice check pass · ☐ Suby test pass · ☐ 1 offer duy nhất.

→ Đủ hết = **được phép `git init` và build.**

---

## 7. LƯU Ý VẬN HÀNH

- Ví dụ giá (1.990.000đ, slot/cohort…) và tên mechanism (VFLOW, MIRROR-7, ZALO-LOOP, RAG-LITE) là **mẫu** — thay bằng số & tên thật trước khi commit.
- Google search tên mechanism trước khi dùng (xem gate STEP 3).
- Mỗi sản phẩm chạy ASSP 1 lần → 1 offer. Không bundle nhiều sản phẩm.
- Tài liệu sống: lưu `ASSP-{SẢN_PHẨM}-v{N}.md`, update version mỗi lần refresh.

---

*8 Sync Dev — Nguyễn Phương Anh Tú (Alex Dev / Kevin Nguyễn) · atus@8syncdev.com*
*SKILL.md — ASSP v1.0 (validate trước, build sau · AI First · one offer at a time)*
