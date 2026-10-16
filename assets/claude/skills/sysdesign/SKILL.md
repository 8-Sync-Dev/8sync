---
name: sysdesign
description: System design for a real change (new service, storage, queue, cache, scale, AI feature) using The System Design Primer as the reading source — pick the sections, run the 4-step method with back-of-envelope numbers, write the ADR. Use when a task adds a component, changes data flow or must survive more load.
---

Nguồn: The System Design Primer (Donne Martin, CC BY 4.0, https://github.com/donnemartin/system-design-primer). Skill này KHÔNG chép nội dung — nó chỉ đường đọc đúng mục và ép quy trình. Đọc bản gốc, trích đúng, ghi nguồn.

## 0. Lấy bản gốc (một lần, offline sau đó)
`git clone --depth 1 https://github.com/donnemartin/system-design-primer ~/.cache/8sync/system-design-primer` (đã có → `git -C … pull --ff-only` khi cần). Đọc bằng `sed -n`/grep theo heading, không `cat` cả README (≈110 KB).

## 1. Cổng quy mô — có cần design không?
Mở skill khi thay đổi (a) thêm service/process/daemon, (b) đổi nơi lưu dữ liệu hay schema dùng chung, (c) thêm queue/cron/retry/cache, (d) phải chịu nhiều user/tenant hơn, (e) thêm tính năng AI phía server. Một hàm, một màn hình, một bug → không mở; dùng `/planning`.

## 2. Đọc đúng mục (≤3 mục mỗi task, mỗi mục ≤15 phút)
Trong README của bản gốc, mục "Index of system design topics" (câu mở: "Everything is a trade-off"). Chọn theo câu hỏi của task:
| Câu hỏi của task | Mục cần đọc |
|---|---|
| Nhanh hơn hay chịu tải hơn? | Performance vs scalability · Latency vs throughput |
| Mất dữ liệu được không, lệch được bao lâu? | Availability vs consistency · Consistency patterns · Availability patterns |
| Vào từ đâu, chia tải thế nào? | Domain name system · Content delivery network · Load balancer · Reverse proxy (web server) · Application layer |
| Lưu ở đâu, scale đọc/ghi? | Database (SQL: replication, federation, sharding, denormalization; NoSQL: key-value, document, wide column, graph; SQL or NoSQL) |
| Cache gì, invalidate thế nào? | Cache (client/CDN/web server/database/application; cache-aside, write-through, write-behind, refresh-ahead) |
| Việc chậm/đẩy sang nền? | Asynchronism (message queues, task queues, back pressure) |
| Giao tiếp giữa service? | Communication (HTTP, TCP/UDP, RPC, REST) |
| Lộ gì, chặn gì? | Security |
Bài giải mẫu (`solutions/system_design/<tên>/README.md`): pastebin, twitter, web_crawler, mint, social_graph, query_cache, sales_rank, scaling_aws — chọn bài gần nhất với task làm khung. Bảng số: mục "Appendix" (Powers of two table, Latency numbers every programmer should know, Typical time-based latency numbers).

## 3. Quy trình 4 bước (mục "How to approach a system design interview question", áp cho task thật)
1. **Use cases, constraints, assumptions** — ai dùng, bao nhiêu, đọc/ghi tỉ lệ, dữ liệu giữ bao lâu, không làm gì. Số phải có nguồn (dashboard Vercel/Cloudflare, log, đo tay) — không có thì ghi "giả định" và chọn số bảo thủ.
2. **High level design** — một sơ đồ ASCII ≤12 hộp: client → edge → app → data; vẽ cả luồng lỗi.
3. **Core components** — mỗi hộp: schema/API/queue + lý do chọn (trích mục đã đọc, kèm trade-off ngược lại).
4. **Scale** — nút nghẽn đầu tiên và cách gỡ (cache, replica, shard, queue, CDN); mỗi nấc nêu cái mất đi (consistency, chi phí, độ phức tạp).
**Back-of-the-envelope** bắt buộc ở bước 1 và 4: QPS, dung lượng/ngày và /năm, băng thông, bộ nhớ cache (80/20) — dùng bảng Appendix của primer, ghi phép tính ra giấy.

## 4. Đầu ra
`docs/adr/NNNN-<slug>.md` (repo không có `docs/adr/` → `su-code/ship/<slug>/DESIGN.md`): Context · Use cases/constraints (số + nguồn) · Options (≥2, trade-off) · Decision · Scale plan · Nguồn (mục primer đã đọc, đường dẫn file + heading). Agent `architect` review bản ADR trước khi code; `critic` chấm khi có ≥2 option gần nhau. Quy tắc 8 Sync vẫn áp: ZUS local-first (không đưa dữ liệu user lên server), dữ liệu client tách riêng, không bịa số liệu.

## 5. Học (ngoài task)
Lộ trình theo mục "Study guide" của primer (short/medium/long tùy thời gian). Mỗi tuần một bài `solutions/system_design/*`: tự làm 4 bước trước, rồi so với bài giải; ghi khác biệt vào `su-code/KNOWLEDGE.md` dạng `decision:`. Flashcard: `resources/flash_cards/*.apkg` (Anki). Không chép nội dung primer vào repo (CC BY 4.0 → chỉ trích ngắn kèm nguồn).
