# Zalo Web qua ego: công thức đã chạy

Chạy: `ego-browser nodejs -e "await import('file:///<dir>/<script>.mjs')"`. Input qua file JSON trong `<dir>`.

## Lấy space + page
```js
const sp = (await listTaskSpaces()).find((s) => s.name === "zalo-work" && s.ownership !== "user");
const task = sp ? await taskSpace(sp.id) : await taskSpace("zalo-work", { profileId: "Profile 2" });
let page; try { page = task.page("p1"); await page.url(); } catch { page = await task.newPage(); }
if (!(await page.url()).includes("chat.zalo.me")) { await page.goto("https://chat.zalo.me/"); await page.waitForTimeout(6000); }
```

## Mở chat theo số + chặn nhầm người
```js
const nb = (s) => (s || "").replace(/\u00a0/g, " ").trim();   // tên Zalo chứa NBSP
const ref = /textbox \[ref=(\d+)\]/.exec((await page.snapshot()).slice(0, 4000))?.[1];
await page.fill(`@${ref}`, phone);
await page.waitForTimeout(3000);
const m = /text "Tìm bạn qua số điện thoại:"\s*\n\s*container\s*\n\s*image\s*\n\s*text "([^"]+)"/.exec(await page.snapshot());
if (!m) throw new Error("số này không có Zalo");          // hotline tổng đài thường không có
await page.click(`text="${m[1]}" >> nth=0`);
await page.waitForTimeout(2500);
const header = await page.evaluate(() => document.querySelector("#header .title, .header-title, [class*='header'] [class*='title']")?.innerText ?? "");
if (!nb(header).includes(nb(expectedName))) throw new Error("sai chat: " + header);
const pane = await page.evaluate(() => document.querySelector("#messageViewScroll")?.innerText ?? null);
```
Chat đã có tin về việc này (regex từ khoá) → không gửi lại tin mở.

## Gửi chữ
```js
await page.click("#richInput");
await page.keyboard.paste(text);   // giữ xuống dòng
await page.waitForTimeout(600);
await page.keyboard.press("Enter");
```

## Gửi ảnh
`<input type=file>` chỉ sinh ra khi bấm icon ảnh trên thanh công cụ chat:
```js
const chooserP = page.waitForFileChooser({ timeout: 10_000 });
await page.mouse.click(477, 910);       // icon "Gửi hình ảnh" (cửa sổ ~1428x993; đo lại bằng screenshot nếu khác)
await (await chooserP).setFiles([a, b, c]);
await page.waitForTimeout(6000);
```
Kiểm tra bằng `page.screenshot` sau khi gửi: đủ số ảnh, trạng thái "Đã nhận".

## Danh thiếp (shop giới thiệu người khác)
Bấm nút "Nhắn Tin" cuối cùng trong `#messageViewScroll` (đếm phần tử lá có text đúng "Nhắn Tin", click `text="Nhắn Tin" >> nth=k`), kiểm header rồi mới gửi. Người được giới thiệu thường không chặn tin.

## Canh tin trả lời (không click)
Đọc sidebar: `[id^='conversationItem'], .msg-item` → `innerText` từng dòng. Lọc theo danh sách tên đang theo dõi. Preview bắt đầu "Bạn:" = tin của mình; khác baseline và không phải "Bạn:" = tin mới → thoát để agent đọc kỹ chat đó. Lưu baseline ra file. Đặt giờ thoát (vd 20 phút hoặc trước giờ đã hẹn) để không lỡ lời hứa. Bỏ tên shop đã kết thúc khỏi danh sách để tin "cảm ơn" không đánh thức vòng lặp.

## Dọn dẹp
Xoá file chứa link chia sẻ/khoá (`sk=`, token) sau khi dùng. Ảnh chụp chat là dữ liệu riêng tư: để trong thư mục việc, không đưa vào repo.
