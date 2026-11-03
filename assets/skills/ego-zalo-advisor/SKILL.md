---
name: ego-zalo-advisor
description: "Điều khiển ego browser (ego lite) để đọc và nhắn Zalo Web thay chủ: tìm đúng profile ego có đăng nhập (kể cả bản trong container MSIX của Claude Desktop), mở chat theo số điện thoại, gửi ảnh, canh tin trả lời, và tư vấn hoặc đàm phán với khách/shop Việt (xưng hô, tâm lý, khi nào nên và không nên nhắn, chống lừa đảo). Dùng khi chủ nhờ nhắn Zalo, bán hoặc mua đồ qua Zalo, hỏi giá nhiều shop, chăm khách, hoặc ego mở ra profile trống."
---
# Zalo qua ego: nhắn như người thật, không như bot

Chủ là người quyết. Agent chỉ đọc, soạn và gửi từng tin 1–1 trong việc chủ đã giao. Không nhắn hàng loạt, không bịa số liệu, không chốt mua bán thay chủ.

## 1. Đúng profile ego trước đã
ego lite cài từ Claude Desktop (bản MSIX/Store) có dữ liệu thật trong **container ảo hoá**, không phải `%LOCALAPPDATA%`:

| Mở từ | User Data |
|---|---|
| Claude Desktop (MSIX) | `%LOCALAPPDATA%\Packages\Claude_<id>\LocalCache\Local\Citro Labs\ego lite\User Data` |
| Terminal / omp / shortcut thường | `%LOCALAPPDATA%\Citro Labs\ego lite\User Data` (thường gần trống) |

- Dấu hiệu sai profile: hiện màn onboarding, `profiles()` chỉ có `Default`, Zalo/GitHub đòi đăng nhập dù chủ nói "profile có dữ liệu mà".
- Kiểm tra (chỉ đọc, không in cookie): liệt kê `User Data\Profile *`, so dung lượng và mtime của `Network\Cookies`, đọc tên profile trong `Local State` (`profile.info_cache`).
- Sửa: chỉ tắt instance ego **do chính agent mở** (xem giờ start), rồi chạy
  `ego.exe --user-data-dir="<User Data trong container>" --profile-directory="Profile N" --startup-ego-browser-service` (detached). `profiles()` phải trả profile có tên chủ đặt.
- KHÔNG xoá, import hay hoàn tất onboarding khi chưa biết dữ liệu nằm đâu. Hai bản User Data có thể cùng tên "Your ego".

## 2. Vận hành ego (bẫy đã gặp)
- Một task space riêng cho việc (`taskSpace("<tên>", { profileId })`). Space đã `finish` sẽ thành **của user**: label `p1/p2` không còn, không điều khiển tiếp. Mở space mới.
- Env var KHÔNG vào `ego-browser nodejs`: truyền input qua file JSON, đọc bằng `node:fs`.
- Output `console.log` có thể ra stderr: parse cả stdout+stderr.
- Mỗi lúc chỉ MỘT script gõ vào một page. Watcher và sender nên dùng page khác nhau, hoặc lấy lại baseline sau mỗi lần gửi.
- Công thức Zalo Web chi tiết (mở chat theo số, gửi ảnh, canh sidebar): `references/zalo-web-recipes.md`.

## 3. Luật gửi một tin
1. **Đúng người:** mở chat qua ô tìm theo số điện thoại → kết quả "Tìm bạn qua số điện thoại" → header chat phải khớp tên (chuẩn hoá `\u00a0` → space). Lệch → dừng, không gõ.
2. **Đọc trước khi viết:** đọc tin cuối của shop/khách và cả lịch sử liên quan. Zalo Web chỉ tìm được tin từ ~20/10 trở đi; tin cũ hơn có thể chỉ nằm trên điện thoại → hỏi chủ.
3. **Đọc trạng thái sau khi gửi:** "Đã nhận" = tới máy; "Đã gửi" = chưa tới; bong bóng "Không thể nhận tin nhắn từ bạn" = tin chữ bị chặn (người lạ). Báo đúng, không ghi "đã gửi" chung chung.
4. **Riêng tư:** chỉ đọc/in chat liên quan việc được giao. Lọc trong script, không dump cả inbox (khách CRM, nhóm gia đình).

## 4. Khi nào NHẮN / KHÔNG nhắn
| Nhắn | Không nhắn |
|---|---|
| Shop/khách vừa hỏi, trả giá, gửi danh thiếp người khác | Chủ dặn bỏ qua (shop gốc, bên đã chốt/từ chối) |
| Họ nhắn tự động chào → gửi lại nội dung chính ngắn gọn (họ chưa đọc được tin chữ) | Shop chưa trả lời và tin chữ bị chặn → đưa vào danh sách **gọi điện**, không nhắn lại |
| Đã hứa hẹn giờ ("chiều nay anh báo em") → giữ đúng hẹn, một lần | Gửi cùng một đoạn y hệt cho nhiều shop liên tiếp (Zalo chặn người lạ, đánh spam tài khoản) |
| Cảm ơn ngắn khi họ từ chối lịch sự (giữ đường quay lại) | Tin cảm ơn đáp tin cảm ơn; nhắn dồn khi họ chưa đọc |
| Hỏi mức tối đa sau khi họ từ chối giá mình nêu (một lần) | Ngoài giờ (trước 8:00, sau 21:30) hoặc giờ nghỉ trưa họ đã báo |

Tin mới cho shop lạ: giãn vài phút, mỗi shop một câu mở khác nhau, gửi ảnh trước, chữ ngắn. Thấy bong bóng chặn lần nữa → dừng cả lượt, báo chủ.

## 5. Xưng hô — đọc cách họ xưng rồi theo
- Họ gọi chủ "anh", tự xưng "em" → chủ là **anh**: KHÔNG mở đầu "Dạ" (dạ là lời người nhỏ). Dùng "Ừ em", "Ok em", "Anh hiểu", "Cảm ơn em".
- Họ xưng "anh", gọi chủ "em" → chủ là **em**: "Dạ", "Vâng anh" là đúng.
- Chưa rõ/kênh shop: **mình – bạn** (hoặc "shop"), dùng "Vâng", "Ok bạn", hạn chế "Dạ".
- Không đổi xưng hô giữa chừng. Không dùng "quý khách", "kính gửi" với shop nhỏ.

Tâm lý khách/shop Việt, chiến thuật đàm phán theo bước, mẫu câu và checklist chống lừa đảo: `references/vn-negotiation.md`. Đọc trước khi soạn tin giá.

## 6. Báo chủ
Bảng: shop · tin cuối của họ (giờ) · giá tốt nhất **có bằng chữ** · đang chờ gì · việc chủ cần tự làm (gọi điện, lời hứa còn treo). Đánh dấu "chưa xác minh" với chat chưa đọc hết. Chọn bên chốt theo con số đã ghi bằng tin nhắn, không theo lời hứa.
