# omp router trên VPS 8sync

API tương thích OpenAI và Anthropic tại `https://vps.8syncdev.com/omp-router/v1`, chạy bằng `omp auth-broker` + `omp auth-gateway` (omp ≥ 18.12). Hướng dẫn cho người dùng: `https://vps.8syncdev.com/omp-router/` (file `index.html` ở đây). File này dành cho người dựng lại hoặc sửa router.

## Cài, cập nhật, kiểm tra

```bash
# từ máy Windows: Git Bash (bash mặc định là WSL, không có alias ssh 8sync-vps)
bash scripts/vps/omp-router/install.sh              # copy file, chạy setup.sh, rồi 4 kiểm tra ngoài + check.sh
ssh 8sync-vps 'sudo bash -s' < scripts/vps/omp-router/check.sh   # chỉ kiểm tra, ~40 s, vài trăm token
```

`setup.sh` idempotent nhưng **khởi động lại broker + gateway** mỗi lần chạy (vài giây 502).

Điều kiện: alias ssh `8sync-vps` (user `ubuntu`, sudo không mật khẩu), edge stack ở `/srv/apps/edge` (caddy + oauth2-proxy). Lần đầu: omp ≥ 18.12 lấy từ `/home/agent/.local/bin/omp` để đặt vào `/opt/omp-router/bin/omp`; bản 18.11 không có `auth-gateway --clients`, `setup.sh` từ chối, lần nâng đầu phải làm tay. Từ đó omp của router do `omp-router-update` quản; omp của `agent` tự cập nhật riêng.

## Kiến trúc

```
client ──HTTPS/HTTP3──▶ Caddy (docker, mạng edge) ──unix socket /run/omp-gw/gw.sock──▶
  systemd-socket-proxyd ──▶ omp auth-gateway 127.0.0.1:4000 ──▶ omp auth-broker 127.0.0.1:8765
                                                                  └─ vault /home/omprouter/.omp/agent/agent.db (user riêng, tách khỏi omp của agent)
```

| File trong repo | Cài tới | Vai trò |
|---|---|---|
| `setup.sh` | chạy trong thư mục `mktemp` riêng trên VPS | user `omprouter` + kho riêng, unit systemd, tmpfiles, mount socket vào Caddy, route Caddy (validate trong container rồi reload, lỗi thì trả bản cũ), account pool, journald cap |
| `omp-gw` | `/usr/local/bin/omp-gw` | CLI owner: `login`/`tui` (thêm login, tự dừng-guard-khởi động lại), `status`, `accounts` (mọi login theo nhà cung cấp: sống/chết, hạn mức riêng, số request từ log), `key add/rm/ls`, `models`, `usage`, `guard` |
| `omp-router-update` | `/usr/local/lib/8sync/` | timer 30 phút: bản stable ≥ 24 h, sha256, snapshot binary + DB, chat thật để kiểm, rollback; nếu bản cũ cũng hỏng thì xoá `bad-version` để thử lại; bật lại unit đang tắt |
| `vps-clean.sh` | `/usr/local/lib/8sync/` | timer hằng ngày: cache apt, file tạm CI trong `/tmp` (journal đã bị giới hạn bời `SystemMaxUse`) |
| `omp-router.routes` | `/srv/sites/omp-router.routes` | route Caddy, import trong site `vps.8syncdev.com` qua `import /sites/*.routes` |
| `index.html` | `/srv/www/omp-router/index.html` | trang hướng dẫn công khai |
| `check.sh` | không cài | kiểm tra đầu-cuối bằng key tạm |

Unit: `omp-auth-broker`, `omp-auth-gateway` (user `omprouter`, `ExecStartPre=omp-gw guard`, account pool qua `OMP_AUTH_BROKER_ACCOUNT_POOL_FILE`), `omp-gw.socket` + `omp-gw-proxy`, `omp-router-update.timer`, `omp-gw-guard.timer` (mỗi phút), `8sync-vps-clean.timer`, slice `omprouter.slice` (`MemoryLow=400M`). Cấu hình updater: `/etc/default/omp-router` (`OMP_SOAK_HOURS`, `OMP_PROBE_MODEL`). Trạng thái updater: `/var/lib/omp-router` (mode 700: snapshot DB chứa API key; `bad-version` = bản đã rollback, xoá file này để thử lại). Journal: `SystemMaxUse=100M` (`/etc/systemd/journald.conf.d/8sync.conf`).

## Vì sao làm thế này (đừng "sửa" lại)

- **Socket unix chứ không TCP:** Caddy ở mạng docker `edge`, ufw `DEFAULT_INPUT_POLICY=DROP` chặn container → host. Cùng cách với HQ (`/run/8sync-hq`) và terminal (`/run/8sync-term`).
- **`/run/omp-gw` tạo bằng tmpfiles.d**, không để socket unit hay Docker tạo: thư mục bị tạo lại thì container không còn thấy nó.
- **Slice không có dấu gạch** (`omprouter.slice`): `omp-gw.slice` nằm dưới `omp.slice` và `MemoryLow` mất tác dụng.
- **`.socket` cần `Service=omp-gw-proxy.service`** vì tên khác service.
- **Không có fail2ban:** ban IP chặn luôn `/hq` và `/term` trên cổng 443, client IPv6 đều hiện là `172.18.0.1` (docker-proxy), và HTTP/3 đi UDP. Key 256 bit là đủ khoá.
- **Rollback thay binary bằng file tạm + `rename`**, ghi `bad-version` trước và `systemctl start` trong `finally`: copy đè lên binary đang chạy dễ lỗi ETXTBSY và bỏ router ở trạng thái dừng.
- **Guard Anthropic, hai lớp + một quy tắc:** account pool (`/etc/omp-router/account-pool.json`) giấu mọi tài khoản OAuth Anthropic khỏi gateway ngay cả khi có login đó trong kho; guard (`ExecStartPre` + `omp-gw-guard.timer` mỗi phút) dừng gateway khi thấy login đó; `omp-gw login/tui` dừng gateway trong lúc đăng nhập nên login kiểu đó không bao giờ được phục vụ. Nguồn các cơ chế: docs omp (bảng trên). Claude chỉ qua API key Console (`anthropic-compliance` §1.1, §1.3).
- **User và kho riêng (`omprouter`):** vault của router tách khỏi omp của `agent` (terminal web), nên `/login` trong phiên omp thường không chạm tới router. Binary của router ở thư mục chỉ root ghi được (`/opt/omp-router/bin`), để `omp-router-update` (chạy root) không bị cắm symlink từ phía user chạy agent.
- **Không viết lại bằng Rust/Go:** router chỉ cộng ~1,8 ms (p50 24,1 → 25,9 ms), model mất hàng giây; Caddy đã phục vụ HTTP/3. Số đo: `outputs/omp-router-perf.md`.

## Giới hạn đã biết
- **Z.ai hiện là GLM Coding Plan (Pro)**: Z.ai chỉ cho dùng trong công cụ lập trình được hỗ trợ ([FAQ](https://docs.z.ai/devpack/faq), [danh sách](https://docs.z.ai/devpack/tool/others)). Chia cho script, SDK hay người khác qua router có thể vi phạm; cần API key Z.ai trả theo token trước khi cấp key cho việc đó.
- **Chỉ `zai/glm-5.3` và `zai/glm-5.3-flash` nằm trong gói** (cùng FAQ: "Only the following two models can be called"). 16 model khác router vẫn liệt kê nhưng có thể bị trừ vào số dư tài khoản. Vì vậy probe của updater và `check.sh` dùng `zai/glm-5.3-flash`, updater không bao giờ thử model khác, và key nên cấp kèm `--models zai/glm-5.3,zai/glm-5.3-flash`. USD trong `omp-gw usage` là ước tính của omp, không phải hoá đơn Z.ai.
- Token và chi phí gộp theo header `x-omp-app` + model (bảng `client_usage`), không theo key; tên key chỉ có trong log từng request.
- Client omp dùng `transport: pi-native` với provider `zai` sẽ gửi key Z.ai đã lưu của máy đó tới router trước. Hướng dẫn khuyên provider `omp-router` kiểu `openai-completions`.
- Account pool ẩn OAuth Anthropic: docs omp nói với provider bị giới hạn, report usage của credential API key có thể "fail closed" (không hiện hạn mức trong `/v1/usage`) — nếu sau này thêm key Console Anthropic, hạn mức của nó có thể không hiện trong `omp-gw usage` dù model vẫn gọi được.

## Xem usage và request

Lệnh đọc log từng request và bảng `client_usage` / `usage_history` nằm ở mục "Xem trực tiếp" của `index.html`. Nội dung prompt và câu trả lời không được lưu.

## Nguồn chính thống

Mỗi thiết kế dựa vào một nguồn chính chủ; link để tracking, đọc lại khi nâng cấp. Không có thành phần nào của router viết bằng Rust: HTTP/3 là của Caddy (Go, qua quic-go), proxyd là của systemd, phần còn lại là omp — xem `outputs/omp-router-perf.md` vì sao không viết lại.

| Chủ đề | Nguồn (đọc/đã mở lại 23/10/2026) |
|---|---|
| broker, gateway, client key, account pool | https://github.com/can1357/oh-my-pi/blob/main/docs/auth-broker-gateway.md |
| HTTP/3 mặc định của Caddy | https://caddyserver.com/docs/caddyfile/options (mục `protocols`) |
| QUIC của Caddy (không phải Rust) | https://github.com/quic-go/quic-go |
| HTTP/3 nói chung | https://www.rfc-editor.org/rfc/rfc9114 |
| socket proxyd | https://www.freedesktop.org/software/systemd/man/latest/systemd-socket-proxyd.html |
| `ListenStream`, `SocketMode` | https://www.freedesktop.org/software/systemd/man/latest/systemd.socket.html |
| `MemoryLow`, `StartLimitBurst` | https://www.freedesktop.org/software/systemd/man/latest/systemd.resource-control.html và …/systemd.unit.html |
| `OnUnitActiveSec`, `AccuracySec` | https://www.freedesktop.org/software/systemd/man/latest/systemd.timer.html |
| `SystemMaxUse` | https://www.freedesktop.org/software/systemd/man/latest/journald.conf.html |
| tmpfiles.d | https://www.freedesktop.org/software/systemd/man/latest/tmpfiles.d.html |
| digest sha256 của asset release | https://docs.github.com/en/rest/releases/releases |
| SQLite backup online | https://www.sqlite.org/backup.html và https://docs.python.org/3/library/sqlite3.html |
| `os.replace` nguyên tử | https://docs.python.org/3/library/os.html |
| prompt caching (TTL, 1 h) | https://docs.claude.com/en/docs/build-with-claude/prompt-caching |
| adaptive thinking + effort của Claude | https://docs.claude.com/en/docs/build-with-claude/thinking-steering-and-cost và …/effort |
| điều khoản gói Claude | https://www.anthropic.com/legal/consumer-terms và https://www.anthropic.com/legal/aup |
| gói Z.ai Coding Plan | https://docs.z.ai/devpack/faq và https://docs.z.ai/devpack/tool/others |
