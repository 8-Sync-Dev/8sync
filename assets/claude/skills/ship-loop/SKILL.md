---
name: ship-loop
description: Goal loop until acceptance criteria pass, level 4 — /ship-loop <mục tiêu>. Turns the goal into criteria each with a check command, then iterates implement → check → fix under Claude Code /goal with iteration/time/stuck caps; evidence in LOOP.md; optional release via one Ship question. Owner-only.
argument-hint: <mục tiêu> [--max-iter 12] [--max-min 90] [--release]
disable-model-invocation: true
---
Mục tiêu: $ARGUMENTS

Level 4. Mặc định `--max-iter 12`, `--max-min 90`. Chỉ owner khởi động. "dừng"/"stop" của owner kết thúc ngay.

## A. Chuẩn bị (một lượt)
1. `/planning` — viết `su-code/ship/<slug>/PLAN.md`; mỗi **acceptance criterion** phải có MỘT lệnh kiểm được (exit 0 = pass), nhẹ, chạy local được (`nice -n 19 ionice -c3`, `-j2`) hoặc tên workflow CI. Criterion không có lệnh → viết lại hoặc bỏ. Hỏi (nếu cần) bằng MỘT `AskUserQuestion`; owner nói "tự làm đi" → chọn Recommended, ghi giả định.
2. Tạo `su-code/ship/<slug>/LOOP.md` (bảng criterion → lệnh; mục Evidence) và ghi `<slug>` vào `su-code/ship/ACTIVE`. `TaskCreate` MỘT task "Loop <slug>: lặp tới khi tick in stop" và giữ `in_progress` tới bước D (để stop gate của kit giữ vòng lặp).
2b. `8sync ccc . goal "<mục tiêu>" --files <file>` để session khác thấy mình đang làm gì.
3. `8sync ccc loop init <slug> --max-iter <N> --max-min <M>` (verb `loop`: `init`, `tick --changed <n> --digest "<digest>"` → in `continue` (kèm `iter/max · phút/max`) hoặc `stop:<reason>` với reason ∈ `max-iter` | `max-min` | `stuck` (digest lặp 2 lần; digest rỗng thì bỏ qua rule này) | `no-change` (không file nào đổi); `status [--json]`; `done [--reason]`; `ls`). **Digest** = content hash của trạng thái làm việc: `git diff | sha256sum | cut -c1-16` ghép với dòng output cuối của check đầu tiên đang fail (cùng file sửa hai lần với nội dung khác nhau KHÔNG bị coi là stuck). Mọi output của `tick` khác `continue …` (lỗi, loop không tồn tại, corrupt) đều nghĩa là DỪNG. Sau /compact hoặc resume: chạy `8sync ccc loop status <slug>` trước tiên. Push nhánh feature để chạy CI được phép trước câu hỏi Ship (guard chỉ chặn merge/push main/tag/release/publish/deploy). Verb chưa có trong binary (bản cũ) → ghi "not verified: loop verb thiếu", tự đếm iteration/thời gian trong LOOP.md.
4. **Tự tiếp khi lượt kết thúc** — ngay sau `loop init`: `CronCreate` cron `*/5 * * * *`, `recurring: true`, prompt `/ship-tick <slug>` (skill `ship-tick` model-invocable, chạy khi session rảnh: criterion đỏ → R&D khi kẹt → sửa → `loop ev` → `tick`). Vòng lặp vì thế sống qua lượt kết thúc, /compact và lúc chờ CI (`gh run watch` nền) mà owner không phải gõ lại; mỗi tick ≤ một việc; `stop:<reason>`/xanh hết → ship-tick tự đóng và `CronDelete` job đó. Cron chỉ chạy khi session mở, hết hạn sau 7 ngày.

## B. Vòng lặp: nội tại là chính, `/goal` là lớp gia cố tuỳ chọn
**Chính (không cần owner làm gì):** Claude tự lặp mục C trong cùng lượt — sau mỗi iteration đọc lại LOOP.md, chạy `tick`, và chỉ kết thúc lượt khi `tick` in `stop:<reason>` hoặc mọi criterion xanh (mục D). Stop gate của kit chặn việc dừng lặng khi task list còn mở, nên KHÔNG kết thúc lượt giữa chừng để "hỏi tiếp không". Mỗi iteration ≤ 1 lần block Stop (Claude Code cap 8 lần liên tiếp — https://code.claude.com/docs/en/hooks-guide), vì vậy vòng lặp đi bằng chính thân skill, không dựa vào hook.

**Gia cố (tuỳ chọn, owner-run):** `/goal` là lệnh built-in của Claude Code mà Claude không tự gõ được. Khi owner muốn evaluator độc lập kiểm sau mỗi lượt, in đúng dòng dưới (đã thay `<…>`) trong một code block để owner dán; chạy headless: `claude -p "/goal …" --permission-mode auto --max-turns <N>`. Cú pháp theo https://code.claude.com/docs/en/goal: `/goal <condition>` (≤ 4,000 ký tự; evaluator là model nhỏ, KHÔNG chạy tool, chỉ đọc transcript; goal tự xoá khi met / impossible / lỗi phải sửa; `/goal clear` bỏ goal; goal không đổi permission mode — chạy trong auto mode). Cần hooks bật và workspace đã trust.

```text
/goal Mục tiêu "<mục tiêu>" xong khi: (1) với MỖI criterion trong su-code/ship/<slug>/PLAN.md, lệnh kiểm của nó đã chạy trong lượt gần nhất và exit code 0, output hiện trong transcript; (2) mỗi lần chạy đã được ghi một dòng (iteration, lệnh, exit code, 1 dòng output) vào su-code/ship/<slug>/LOOP.md; (3) lần `8sync ccc loop tick` gần nhất in "continue" hoặc `8sync ccc loop done` đã chạy exit 0. Hoặc dừng nếu `8sync ccc loop tick` in "stop:<reason>" — khi đó ghi brief vào LOOP.md rồi kết thúc, không làm tiếp. Không sửa file test chỉ để cho pass. Hoặc dừng sau <N> turn.
```

Điều kiện phải chứng minh được từ output hiện trong transcript — nên mỗi iteration phải in nguyên văn kết quả lệnh check và dòng `tick`.

## C. Mỗi iteration (bắt đầu ngay sau khi đặt goal; goal gọi lượt kế)
1. **Implement** phần nhỏ nhất tiến tới criterion đỏ (đọc file trước khi sửa; `task`/`quick-task`/`qa` song song khi file tách bạch, ≤4 writer; watchdog áp lực → không thêm agent). Code mới có test; không sửa test cho pass.
2. **Check** — chạy lệnh của TẤT CẢ criterion (nhẹ, local) hoặc workflow CI (`gh workflow run … --ref <branch>` → `gh run watch <id> --exit-status` nền). Build/test nặng chỉ trên CI.
3. **Evidence** — chạy mỗi check bằng `8sync ccc loop ev <slug> <C#> -- '<lệnh>'`: nó chạy lệnh, in 15 dòng cuối và tự append `iter <k> | <C#> | exit <n> | <dòng cuối>` vào LOOP.md. KHÔNG tự viết hàm bọc kiểu `r(){ bash -c "$2" …}`: guard không đọc được lệnh trong biến nên auto mode sẽ từ chối. Không có dòng evidence → criterion không tính là pass.
4. **Tick** — nếu MỌI criterion đã xanh ở bước 2 (có evidence) → sang D "tất cả xanh" ngay, KHÔNG tick (tránh `stop:max-iter` ở vòng cuối). Còn criterion đỏ → `8sync ccc loop tick --changed <số file đổi> --digest "<sha256 diff + dòng cuối output check fail đầu tiên>"`. In `continue` → iteration kế. In `stop:<reason>` → bước D.
5. Stuck cũng tính khi hai iteration liền cùng digest (content hash, không phải tên tool) hoặc không file nào đổi (DESIGN: `su-code/ship/auto-harness/DESIGN.md`). Hết lượt mà goal chưa met, evaluator đẩy lý do làm hướng dẫn cho lượt sau.

## D. Kết thúc
- **stop:<reason>** (cap/time/stuck) hoặc owner "dừng": ghi brief ≤10 dòng vào LOOP.md (criterion nào xanh/đỏ + bằng chứng, đã thử gì, đề xuất tiếp), `8sync ccc loop done`, xoá dòng khỏi `ACTIVE`, `CronList` → `CronDelete` job `/ship-tick <slug>`, `/goal clear` nếu goal còn, báo owner. Owner "huỷ hết" → `8sync ccc cancel` (goal + urgent + loop trong ACTIVE, fail-closed; `--all` thêm mọi loop). Không làm thêm.
- **Retro** (cả hai nhánh dưới): keep/drop/try ≤3 dòng → `/remember`; `8sync ccc . goal clear`.
- **Tất cả xanh**: review (`reviewer` + `qa` UAT + `verifier`, chạy song song) → `8sync ccc risk` (gate bắt buộc từ tên file đổi) → `/sec` trên diff (+ `/rules`/`/aup-audit` khi risk liệt kê) → CHANGELOG Unreleased + `/remember` bài học → commit conventional (không push). Có `--release` ở cuối `$ARGUMENTS`: làm như `/ship-auto` từ bước 3 — MỘT `AskUserQuestion` header `Ship` (options đúng: `Duyệt tất cả (Recommended)` · `Chỉ merge, chưa deploy` · `Dừng`) → PR → `gh pr checks --watch` nền (CI phải xanh trên cả Windows, macOS và Linux (test + build release) trước merge/tag; OS nào chưa có job → ghi "not verified: <OS>" và không merge) → merge → tag/release → `8sync up`/kit refresh nếu có → monitor tới xanh. Không có `--release` → dừng sau commit.

Rails: không `bypassPermissions`; không in secret; guard chặn destructive/force-push. Mọi câu "xong/pass" phải kèm lệnh + output; thiếu → "not verified". Báo cáo cuối: criterion + evidence, iteration/thời gian đã dùng, việc còn dở.
