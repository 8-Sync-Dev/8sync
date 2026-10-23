# ccc auto: vì sao CPU quá tải + ship chậm — nghiên cứu & plan (no code, đã review)

> Code: `origin/main` **v0.110.70** (worktree `su-code-research`, 8e355c9). Máy owner: 32 luồng, 62 GB. Ngày 2026-10-23.
> Plan đã qua 1 vòng review đối kháng (reviewer độc lập): 1 FATAL + 11 MAJOR đã sửa trong bản này.

## Kết luận

1. **CPU vượt mức là tải nằm NGOÀI cap của phòng.** Guard đã ghim mọi phòng, kể cả process con, vào 12/32 luồng (37,5 %, `pressure.rs:38-47`). Vậy mà máy vẫn đo được **94 %** (platform, L3). Phần còn lại, **≥ 56 %**, gồm: Claude daemon (cố ý không ghim), daemon trong worktree như nx/turbo/tsserver (test `pressure.rs:3056,3064` xác nhận không ghim), WmiPrvSE, Defender và app khác. → **Giảm phòng chỉ giảm được phần 37 %**, chưa chạm phần lớn.
2. **Phòng nhiều vẫn có hại theo 2 đường**:
   - Mỗi phòng ở trong cap kéo thêm daemon worktree, mà daemon này ở **ngoài** cap.
   - 13 phòng chia nhau 12 luồng thì build nào cũng chậm, card kẹt lâu hơn, và guard L3 pause bớt phòng ⇒ `holds()` dừng luôn vòng ship.
3. **Ship chậm chủ yếu vì phải chờ cổng, không phải vì CPU**:
   - Merge nền **dừng khi lease hết hạn**, kể cả khi đã có grant (`ccc.rs:716`). Đây là chỗ sửa rẻ nhất.
   - Grant tự merge chỉ sống 8 h.
   - Đội omp đang TẮT vì model mặc định của omp là anthropic.
4. **3 phòng / Sấm Sét 5: ĐỒNG Ý**, nhưng làm bằng **company mode** có sẵn (1 team phục vụ mọi dự án), không dựng hệ ghế mới. Hiện Sấm Sét = **13 phòng mỗi team** (`room.rs:58`) cộng thêm `sweep`/`eye`, và 3 team chạy song song.

## Bằng chứng: CPU

| Nguồn | Số liệu | Ở đâu |
|---|---|---|
| Sấm Sét = roster `boost` | 13 phòng/team (lead, ba, dev…dev6, ui, qa, qa2, review, review2) | `room.rs:58` |
| Mặc định / full | 5 / 6 phòng | `room.rs:41,50` |
| Cap số phòng | `MAX_ROOMS = 14` cho mỗi lệnh `up`; `--add` không bị chặn bởi cap | `team.rs:37,403-409` |
| Cap CPU | Một mask chung cho cả máy, áp cho mọi phòng của mọi dự án, process con kế thừa; thu hẹp dần 12→6→3→2 khi phòng là nguồn tải | `pressure.rs:38-47,1182-1210` |
| Không ghim | Claude daemon; daemon trong worktree (nx/turbo…); đếm "không ghim được" có ở `cap_failed` | `pressure.rs:40`, `:3056-3064`, `:1761` |
| Đo trên máy owner (ngoài cap) | typecheck platform **57 core-s**; test suite **234 core-s / 63 % máy / 12 s**; `next build` app/web **216 core-s** | GetSystemTimes trước/sau |
| Guard thấy | L3 RAM 79 % · CPU 94 % · "4/7 phòng" · app khác 38,6 GB (Wmiprvse 14,5) · 3d-game "Claude 14,8 GB" bị tính là *app khác* | `auto status` |
| Verify hook | Mỗi Edit/Write chạy check nền, khoá theo từng thư mục (không có khoá chung); Stop chạy lại check đồng bộ nếu chưa pass | `verify.rs:91-104,124-142,217-221` |
| Xác worktree | platform: **102 thư mục, chỉ 31 worktree còn đăng ký, 73 thư mục mất `.git`** (remove dở dang). Card còn sống bị dirty (`pnpm-lock.yaml`, `backend`, `su-code/*`) ⇒ `prune_card_worktree` bỏ qua | `target.rs:553-577`, đo `git worktree list` |
| WMI còn sót | `disk-clean.ts:40` (Win32_Process có command line, nặng), `omp_team.rs:167`, `machine.ts:205`; guard đã chuyển sang Toolhelp (`reap.rs:466-472`) | file:line |
| HQ | Chỉ GET `/api/auto`, auto-tick và guard-trigger (>60 s) spawn `auto status`; các route còn lại dùng chung `lastAutoStatus()` | `auto.ts:69-76` |

## Bằng chứng: ship chậm

| Chặn | Chi tiết | Ở đâu |
|---|---|---|
| **Merge nền ↔ lease** | Merge nền chỉ chạy khi `gate` null; lease hết hạn là `gate` có giá trị ⇒ card approved nằm chờ dù đã có grant. Lượt revive còn < 15 s thì cũng bỏ qua | `ccc.rs:714-717`, `idle.rs:429-430` |
| Grant tự merge | Theo từng dự án, `TTL_S = 8*3600`, được chứng minh lại từ transcript. Đã quan sát: "8 approved cards sat for 9 hours" | `grant.rs:25,104-118`, `permit.rs:362-366` |
| Lease | `lease_auto` đang BẬT, nhưng chỉ gia hạn khi owner có mặt (≤ 4 h, vắng 30 phút là nghỉ). Lúc đo cả 3 team: "đang cho nghỉ" | `idle.rs:32-38`, `lease.rs:4-12` |
| Đội omp | `omp_blocked`: model mặc định của omp = `anthropic/claude-opus-5-5`. Nudge omp vẫn phải chờ lease (`auto.rs:1419`), tối đa 1 lần/10 phút, 6 lần/giờ, chỉ nhắm card đầu hàng | `auto.rs:75-76,1406-1458` |
| Guard ⇒ ship | `holds()` ở L2+ hoặc khi có phòng bị pause sẽ chặn vòng ship loop | `pressure.rs:1621-1625` |
| PR chồng | Bị cấm ⇒ card thành `blocked "chờ PR #n"` | `auto.rs:950` |

## Plan đã sửa (chưa code)

**Bước 0 — Không cần code, owner bật được ngay**
- **Company mode** (`auto company on`, có nút trên HQ): 1 team phục vụ cả 3 dự án, claim card gấp nhất của toàn công ty, tôn trọng ghim (`team.rs:531-595`, `auto.rs:271-275`). Bước này thay hẳn cảnh "3 team × N phòng".
- Roster theo đề xuất của anh: `--roles lead,dev,qa,review` (4, bản Thường tối thiểu) hoặc `lead,dev,dev2,qa,review` (5, bản Sấm Sét). Thay hẳn `boost` 13.
- `auto omp on --model zai/glm-5.3` (lệnh có sẵn ở `auto.rs:52`) để đội omp hết bị chặn.

**P0 — Đo bằng telemetry có sẵn, không viết sampler mới**
Chạy 30 phút với roster mới. Cứ 60 s đọc `auto status --json` (`rooms[].cpu`, `top`, `defender_cpu`, `cap_failed`) và `auto guard --dry-run` (`pressure.rs:305-321,1732-1738,2339-2342`).
**Gate**: tách được ≥ 56 % ngoài phòng ra Claude daemon / daemon worktree / WMI / Defender.

**P1 — Merge nền không phụ thuộc lease (sửa ship rẻ nhất)**
`merge::background` chỉ gọi `gh`, không tốn token Claude, nên an toàn với AUP. Grant của owner + gate trên đúng SHA đã reviewed vẫn là điều kiện bắt buộc. Bỏ điều kiện `gate.is_null()` riêng cho merge.
**Gate**: lease hết hạn + có grant ⇒ card approved vẫn merge.

**P2 — Theo kết quả P0: kéo tải ngoài cap về**
- Daemon trong worktree: ghim chúng, hoặc tắt daemon khi card đóng (turbo `--no-daemon`, nx `NX_DAEMON=false`).
- Bỏ WMI còn sót ở `disk-clean.ts:40` và `omp_team.rs:167`, chuyển sang Toolhelp như `reap.rs`.
- Claude daemon: chỉ đo và báo, không ghim (`pressure.rs:40` có lý do).
**Gate**: chạy P0 lại thấy tải ngoài phòng giảm và không còn chuỗi L3.

**P3 — Sửa prune worktree, không viết lại**
Tìm hiểu vì sao 73 thư mục còn sót (`git worktree remove` bị file lock giữ: node_modules/daemon) và vì sao card dirty (`pnpm-lock.yaml` bị `pnpm install` sửa ⇒ dùng `--frozen-lockfile`; `backend` submodule; `su-code/*`). Dọn bằng `git worktree prune` + xoá thư mục mồ côi sau khi kill daemon.
**Gate**: số thư mục bằng số worktree đăng ký.

**P4 — Gộp quyết định L3 thành một chỗ cho cả máy**
Hiện cap đã chung cả máy, `CALM_S = 180`, sàn `ROOMS_FLOOR_PCT` và `HARD_PCT 92` đã có; còn L3 thì mỗi dự án tự quyết. Với company mode thì chỉ còn 1 team ⇒ phần lớn vấn đề tự hết. Chỉ làm P4 nếu vẫn chạy nhiều team.

**P5 — Quyết định của owner (thuộc rails)**
- (a) TTL grant tự merge: giữ 8 h hay tăng lên 24 h. Đây là quyết định của owner. Grant chứng minh lại từ transcript, nên TTL dài thì transcript phải còn.
- (b) omp chạy khi owner vắng: cần **giờ và ngân sách $ riêng cho omp**, giữ `omp_blocked` fail-closed. Không bỏ lease đi mà không có giới hạn thay thế (lease đồng thời là công tắc API key và ngân sách $/giờ, `lease.rs:4-7`).
- (c) Claude chạy khi vắng mặt: chỉ được qua Console API key (tốn tiền).

**Hoãn**: semaphore build chung. Cap đã giới hạn phòng ở 37 %. Ngoài ra Stop hook sẽ phải *chờ* slot (bỏ qua thì build hỏng vẫn kết thúc lượt được), tức là đổi lấy độ trễ. Chỉ làm khi P0 chứng minh build thoát cap.

**Thứ tự**: Bước 0 (hôm nay) → P0 → P1 → P2 → P3 → (P4 nếu cần). P5 khi owner chốt.

## Rủi ro

- **Ít phòng thì throughput giảm?** Throughput thực đang bị chặn ở merge/lease/L3. [INFERENCE] 5 phòng + P1 có thể cho nhiều card done/giờ hơn 13 phòng. Cần đo card done/ngày trước và sau Bước 0.
- **Roster 3 phòng (`lead,dev,qa`) không có review**: card dừng ở cột review. Critic (delegate) không phải lane review và không bao giờ quyết merge (`delegate.rs:1-14,35-39`). Nếu muốn 3 phòng thì qa phải kiêm review và mất review độc lập. Vì vậy đề xuất **tối thiểu 4**.
- **Đội nhỏ toàn phòng core** (lead/dev/qa được `kept()`, `pressure.rs:136-142`) ⇒ L3 không có gì để pause; lúc đó chỉ còn cap. `sweep` (HQ tự thêm) và `eye` cũng chiếm chỗ.
- **Dùng lại worktree cho dev**: `danger.rs:2291-2331` chỉ thả reset/clean trong `qa<N>`; với dev thì `switch -f`/`clean` sẽ hỏi owner ⇒ không làm, ngoài phạm vi.
- **Không nhúng PowerShell kill-process vào binary** (bài học v0.110.67).

## Câu hỏi cho owner

1. Bật company mode cho 3 dự án không (khuyên: có)?
2. Thường = 4 (`lead,dev,qa,review`) hay đúng 3 (qa kiêm review)?
3. Grant tự merge: 8 h hay 24 h?
4. omp: model `zai/glm-5.3`? Ngân sách $/giờ khi owner vắng là bao nhiêu?

## Sources
1. `room.rs:41,50,58` · 2. `team.rs:37,403-409,531-595` · 3. `pressure.rs:38-47,108-142,305-321,1182-1210,1621-1625,1732-1761,2339-2342,3056-3064` · 4. `verify.rs:91-142,217-221` · 5. `ccc.rs:714-717` · 6. `idle.rs:32-38,429-430`, `lease.rs:4-12` · 7. `grant.rs:25,104-118`, `permit.rs:362-366` · 8. `auto.rs:52,75-76,271-275,950,1406-1458` · 9. `target.rs:553-577` · 10. `delegate.rs:1-14,35-39`, `danger.rs:2291-2331` · 11. `reap.rs:466-472`, `disk-clean.ts:40`, `omp_team.rs:167`, `auto.ts:69-76` · 12. `8sync ccc auto status [--json]` live · 13. đo cục bộ (GetSystemTimes; `git worktree list`)

---
2026-10-23 · 3 vòng (scout v0.108 bị bỏ vì checkout cũ, scout ×2 trên v0.110.70, reviewer đối kháng) · ~25 file · **đo**: typecheck/test/build platform, worktree (102 thư mục / 31 đăng ký / 73 mất `.git`) · **chưa xác minh**: phân bổ ≥ 56 % ngoài phòng (→ P0).
