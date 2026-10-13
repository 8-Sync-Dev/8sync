# /feature new <slug>

> Đã load `references/feature-rules.md` (luật xuyên suốt, gồm **R10 code-intelligence FIRST**) ở Dispatch chưa? Nếu chưa → load trước.

Scaffold 1 feature lớn mới. Output: `su-code/planning/<slug>/` + 4 file + set ACTIVE.

> Bước 1/4/5 (validate slug, tạo file từ template, set ACTIVE + config) cũng làm được **deterministic** bằng verb `8sync feature new <slug>` (nhanh, không cần model). `/feature new` trong session dùng khi cần thêm phán đoán (spec ở đâu, cắt phase). Cả hai đều thay placeholder `SLUG`/`FEATURE_NAME`/`DATE`.

## Steps

1. **Validate slug** — kebab-case, chưa tồn tại `su-code/planning/<slug>/`. Tồn tại → hỏi user (resume? overwrite?) — KHÔNG clobber tự động.

2. **Lấy đặc tả** — hỏi user spec ở đâu (dùng `ask` nếu tương tác):
   - File → copy vào `su-code/planning/<slug>/spec.md` (read-only ref).
   - Mô tả ngắn → ghi thẳng vào PROJECT.md.

3. **Knowledge lookup (brownfield — BẮT BUỘC, R7)**:
   - Đọc `AGENTS.md` + `su-code/PROJECT.md` → tổng thể + stack.
   - Đọc `su-code/KNOWLEDGE.md` + `su-code/DECISIONS.md` → nghiệp vụ/quyết định module feature sẽ đụng/dùng lại.
   - **R10 áp dụng**: khi cần khảo cấu trúc module thật (không chỉ đọc memory), dùng `codegraph query/impact "<module>"` TRƯỚC, KHÔNG grep/Read tràn lan toàn module.
   - Mục đích: PROJECT.md ghi đúng "cắm vào module nào", "KHÔNG đụng gì".

4. **Tạo 4 file** từ `templates/` — thay placeholder:
   - `SLUG` → slug, `FEATURE_NAME` → tên đẹp (human title), `DATE` → hôm nay (YYYY-MM-DD; hỏi nếu cần, không tự bịa).
   - `PROJECT.md`: điền What/Core value/Cắm vào codebase/Ràng buộc.
   - `REQUIREMENTS.md`: chia UC v1/v2/out-of-scope.
   - `ROADMAP.md`: **cắt phase theo dependency** (xem thuật toán dưới).
   - `STATE.md`: phase=M0, status=planning, next_action=plan-phase, progress 0%.

5. **Set active + (tuỳ chọn) git**:
   - `su-code/planning/ACTIVE.md` ← dòng đầu (không comment) = slug (giữ comment header).
   - `su-code/planning/config.json` ← `active_feature: "<slug>"`.
   - **Ticket (TUỲ CHỌN)**: nếu user có ticket number → lưu raw numeric ở `STATE.frontmatter.ticket`. KHÔNG ép ticket — để trống được.
   - **Feature branch (TUỲ CHỌN)**: nếu user muốn tách nhánh cho cả feature → tạo 1 nhánh lớn, ghi `STATE.frontmatter.branch`. KHÔNG tự tạo nhánh nếu user không yêu cầu (su-code mặc định commit local thẳng nhánh hiện tại). KHÔNG `git push`.

6. **USER DUYỆT (gate 1)** — trình 4 file, dùng `ask` xác nhận kiến trúc + cách cắt phase. KHÔNG sang plan tới khi duyệt.

## Thuật toán cắt phase (ROADMAP)

1. Liệt kê **thực thể dữ liệu** từ spec (danh từ nghiệp vụ được lưu/thao tác).
2. Vẽ dependency: "X tồn tại được mà không cần Y?" → cạnh phụ thuộc.
3. Topological sort → tầng. Tầng 0 (không cần gì) = Foundation = M0.
4. Gộp/tách theo khối lượng: phase code được 1-2 ngày. Quá nhỏ → gộp, quá lớn → tách.
5. Mỗi phase phải **demo được 1 thứ** (test: "sau phase này user làm được gì?"). Không → cắt sai (đang cắt theo layer kỹ thuật).
6. Ghi Integration Contracts: M trước export gì → M sau dùng gì.

Quy tắc vàng: **Foundation trước · nghiệp vụ giữa · tích hợp cuối**. Cái nhiều thứ phụ thuộc vào → làm trước.

## Sau khi xong

Báo user: đã tạo, đang ở M0 planning. Next: `/feature plan`.
