# 8 Sync HQ cho Android

App Android mở HQ trên PC của bạn (bảng điều khiển web của `8sync hq ui`) ngay trên điện thoại: full screen, giao diện responsive y như bản web, theo light/dark của máy.

**Tải APK:** <https://github.com/8-Sync-Dev/8sync/releases/latest/download/8sync-hq.apk>

Link này luôn trỏ tới bản mới nhất: mỗi tag `v*` của 8sync, workflow [`hq-android.yml`](../.github/workflows/hq-android.yml) build, ký, chạy thử trên emulator rồi gắn `8sync-hq.apk` (kèm `8sync-hq.apk.sha256`) vào release đó.

## Cài đặt

1. Trên điện thoại, mở link tải ở trên bằng Chrome.
2. Android hỏi "Cho phép cài ứng dụng không rõ nguồn gốc" (install unknown apps) cho Chrome: bật cho Chrome, quay lại và bấm **Cài đặt**. Play Protect có thể cảnh báo vì app không đến từ Play Store; bấm **Vẫn cài đặt**.
3. Yêu cầu: Android 7.0 (API 24) trở lên, có Android System WebView / Chrome cập nhật. Một APK dùng cho mọi máy (arm64, armv7, x86_64).
4. Cập nhật: tải lại link trên và cài đè. APK luôn ký bằng cùng một key (chứng chỉ `CN=8 Sync HQ`), nên cài đè giữ nguyên dữ liệu; Android từ chối bản ký bằng key khác.

Kiểm tra file (tuỳ chọn): so `sha256sum 8sync-hq.apk` với `8sync-hq.apk.sha256` trên trang release, hoặc `apksigner verify --print-certs 8sync-hq.apk`.

## Kết nối với HQ

`8sync hq ui` chỉ nghe trên `127.0.0.1` của PC, nên điện thoại vào HQ qua một trong hai đường HTTPS dưới đây. App chỉ mở địa chỉ `https://`.

**Tailscale (khuyên dùng).** Cài Tailscale trên PC và điện thoại, đăng nhập cùng tài khoản. Trên PC chạy:

```bash
8sync hq ui --tailnet        # địa chỉ cố định https://<máy>.<tailnet>.ts.net, chỉ thiết bị trong tailnet của bạn vào được
8sync hq ui --at-login       # Windows: tự bật HQ --tailnet mỗi lần đăng nhập
```

Lệnh in link đăng nhập `https://<máy>.<tailnet>.ts.net/api/login?k=<khoá>`. Mở app, dán link vào ô **Địa chỉ HQ**, bấm **Mở HQ**. Đăng nhập giữ 30 ngày.

**Link public.** `8sync hq ui --public` in `https://<tên>.trycloudflare.com/api/login?k=<khoá>` (cần `cloudflared`; có domain riêng thì `--tunnel-setup hq.<domain>` cho host cố định). Link dùng được trong 10 phút, đăng nhập giữ 12 giờ. Ai có link là điều khiển được các phòng: không chia sẻ.

**Dùng hằng ngày.**

- Lần sau mở app, địa chỉ đã dùng nằm trong **Gần đây**: bấm vào là vào HQ (cookie đăng nhập còn hạn). Hết hạn thì dán link đăng nhập mới.
- Ở trang đầu của HQ, bấm **Back** của Android để quay lại màn hình kết nối; bấm Back tiếp để thoát app. Trong HQ, Back lùi trang như trình duyệt.
- Nút **×** cạnh một địa chỉ để xoá nó khỏi Gần đây.

## Bảo mật

- **Không lưu khoá.** "Gần đây" chỉ nhớ origin (`https://host[:port]`), cắt bỏ đường dẫn và `?k=`; việc cắt này làm trong Rust (`hq_origin`, có unit test). Đăng nhập là cookie `hq_pub` do HQ cấp (HttpOnly, Secure), nằm trong cookie store của WebView như trên trình duyệt; HQ tự kiểm hạn phía server.
- **Auth ở phía server.** App không có backend riêng, không gửi dữ liệu đi đâu ngoài HQ của bạn. HQ vẫn đòi khoá/cookie như trên trình duyệt.
- **HQ không gọi được Rust.** Capability của Tauri chỉ cấp cho màn hình kết nối đóng gói trong app; trang HQ tải từ PC không có quyền IPC nào (`capabilities/default.json` không có `remote`).
- **Chỉ HTTPS.** App từ chối `http://` và scheme khác (`file:`, `javascript:`, `intent:`). Bản release để `usesCleartextTraffic=false`. Đổi lại, không vào được HQ bằng `http://<ip-LAN>:8740`; điều này khớp với HQ vốn chỉ nghe trên 127.0.0.1, và giữ phiên đăng nhập không đi qua mạng dưới dạng chữ thường.
- **Mất điện thoại.** Tailscale: xoá thiết bị khỏi tailnet (hoặc xoá `session-secret` của HQ để đăng xuất mọi nơi). Public: tắt `hq ui` là link chết; cookie hết hạn sau 12 giờ.

## Kiến trúc (P0)

```
apps/hq-android/
├── ui/                       màn hình kết nối (HTML/CSS/JS tĩnh, đóng gói trong APK, bảng màu = apps/hq-ui globals.css)
├── src-tauri/src/lib.rs      Rust: hq_url() kiểm địa chỉ · hq_origin · open_hq → webview.navigate()
├── src-tauri/gen/android/    project Gradle do `tauri android init` sinh (commit để build tất định); MainActivity.kt xử lý insets system bar/bàn phím
└── uat.sh                    UAT trên emulator: mở app → mở HQ thay thế → Back → dark mode
```

Rust (Tauri 2) là lõi app: đọc địa chỉ, kiểm tra và điều hướng WebView hệ thống tới HQ. Giao diện HQ là bản Next.js responsive đang chạy trên PC, nên app luôn khớp bản web, không phải viết lại từng màn hình. Build: `tauri android build --apk` cho 3 ABI, `zipalign -P 16` (trang 16 KB cho Android 15+), `apksigner` với key trong GitHub secrets.

Build tay (cần Android SDK + NDK, JDK 17, Rust với target android):

```bash
cd apps/hq-android
npm install && npm run tauri -- icon src-tauri/app-icon.png
NDK_HOME=$ANDROID_NDK_HOME npm run tauri -- android build --apk --target aarch64
```

## Roadmap

Mỗi giai đoạn chỉ bắt đầu khi giai đoạn trước đạt tiêu chí thoát (exit criteria).

### P0 · Rust shell APK (bản này)

Tauri 2 + WebView hệ thống, màn hình kết nối, Back về màn hình kết nối, light/dark, APK ký sẵn có link tải cố định.

Exit criteria: workflow `hq-android` xanh trên tag; `apksigner verify` ra `CN=8 Sync HQ`; UAT emulator có ảnh `connect.png`, `hq.png`, `back.png`, `connect-dark.png` và không crash; link `releases/latest/download/8sync-hq.apk` tải được.

### P1 · Native touches

- Thông báo đẩy (push/notification) khi một phòng đang **Chờ anh**: HQ phát sự kiện, app nhận qua plugin notification của Tauri; ưu tiên kênh không cần server trung gian (UnifiedPush/ntfy tự host, hoặc poll nền khi app mở).
- Share-to-room: chia sẻ văn bản/ảnh từ app khác vào một phòng (Android share intent → Rust → API HQ).
- Quét QR link đăng nhập: `8sync hq ui --tailnet/--public` in QR, app quét bằng plugin barcode-scanner, khỏi phải copy link sang điện thoại.
- Khoá sinh trắc (biometric) khi mở app.

Exit criteria: mỗi tính năng có UAT trên emulator hoặc máy thật; không lưu khoá `?k=` hay token nào ngoài cookie của HQ; APK tăng không quá 1 MB so với P0.

### P2 · Cổng hiệu năng (performance gate)

Đo trên một máy Android tầm trung (ghi rõ model, Android, phiên bản WebView): TTI (time-to-interactive) của danh sách phòng và chat, fps khi cuộn (Android GPU profiling / `dumpsys gfxinfo`), bộ nhớ (`dumpsys meminfo`).

Chỉ khi WebView trượt mục tiêu (ví dụ TTI > 1,5 s, hoặc khung hình giật khi cuộn danh sách phòng/chat) mới chuyển các màn hình nóng (danh sách phòng, chat) sang UI native bằng Rust (Slint hoặc egui) dùng chung API của HQ; các màn hình còn lại giữ bản web.

Exit criteria: bảng số đo trước/sau, cùng máy, cùng dữ liệu; màn hình native chỉ ship khi nhanh hơn rõ rệt và không thiếu tính năng so với bản web.

### P3 · Phân phối

- Kiểm tra cập nhật trong app: so phiên bản app với `releases/latest` trên GitHub, mở link tải khi có bản mới.
- F-Droid (build tái lập, reproducible) và/hoặc Google Play (AAB, `tauri android build --aab`).

Exit criteria: người dùng nhận được bản mới mà không cần tự vào GitHub; build F-Droid/Play dùng cùng mã nguồn.

### P4 · iOS

Tauri 2 build iOS từ cùng lõi Rust và cùng màn hình kết nối (`tauri ios build`), cần macOS runner và Apple Developer account; phân phối qua TestFlight.

Exit criteria: bản TestFlight mở được HQ qua Tailscale và `--public` với cùng hành vi như Android.
