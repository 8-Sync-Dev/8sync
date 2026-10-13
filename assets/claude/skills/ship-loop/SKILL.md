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
3. `8sync ccc loop init <slug> --max-iter <N> --max-min <M>` (verb `loop`: `init`, `tick --changed <n> --digest "<digest>"` → in `continue` (kèm `iter/max · phút/max`) hoặc `stop:<reason>` với reason ∈ `max-iter` | `max-min` | `stuck` (digest lặp 2 lần; digest rỗng thì bỏ qua rule này) | `no-change` (không file nào đổi); `status [--json]`; `done [--reason]`; `ls`). **Digest** = content hash của trạng thái làm việc: `git diff | sha256sum | cut -c1-16` ghép với dòng output cuối của check đầu tiên đang fail (cùng file sửa hai lần với nội dung khác nhau KHÔNG bị coi là stuck). Mọi output của `tick` khác `continue …` (lỗi, loop không tồn tại, corrupt) đều nghĩa là DỪNG. Sau /compact hoặc resume: chạy `8sync ccc loop status <slug>` trước tiên. Push nhánh feature để chạy CI được phép trước câu hỏi Ship (guard chỉ chặn merge/push main/tag/release/publish/deploy). Verb chưa có trong binary (bản cũ) → ghi "not verified: loop verb thiếu", tự đếm iteration/thời gian trong LOOP.md.

## B. Vòng lặp: nội tại là chính, `/goal` là lớp gia cố tuỳ chọn
**Chính (không cần owner làm gì):** Claude tự lặp mục C trong cùng lượt — sau mỗi iteration đọc lại LOOP.md, chạy `tick`, và chỉ kết thúc lượt khi `tick` in `stop:<reason>` hoặc mọi criterion xanh (mục D). Stop gate của kit chặn việc dừng lặng khi task list còn mở, nên KHÔNG kết thúc lượt giữa chừng để "hỏi tiếp không". Mỗi iteration ≤ 1 lần block Stop (Claude Code cap 8 lần liên tiếp — https://code.claude.com/docs/en/hooks-guide), vì vậy vòng lặp đi bằng chính thân skill, không dựa vào hook.

**Gia cố (tuỳ chọn, owner-run):** `/goal` là lệnh built-in của Claude Code mà Claude không tự gõ được. Khi owner muốn evaluator độc lập kiểm sau mỗi lượt, in đúng dòng dưới (đã thay `<…>`) trong một code block để owner dán; chạy headless: `claude -p "/goal …" --permission-mode auto --max-turns <N>`. Cú pháp theo https://code.claude.com/docs/en/goal: `/goal <condition>` (≤ 4,000 ký tự; evaluator là model nhỏ, KHÔNG chạy tool, chỉ đọc transcript; goal tự xoá khi met / impossible / lỗi phải sửa; `/goal clear` bỏ goal; goal không đổi permission mode — chạy trong auto mode). Cần hooks bật và workspace đã trust.

```text
/goal Mục tiêu "<mục tiêu>" xong khi: (1) với MỖI criterion trong su-code/ship/<slug>/PLAN.md, lệnh kiểm của nó đã chạy trong lượt gần nhất và exit code 0, output hiện trong transcript; (2) mỗi lần chạy đã được ghi một dòng (iteration, lệnh, exit code, 1 dòng output) vào su-code/ship/<slug>/LOOP.md; (3) lần `8sync ccc loop tick` gần nhất in "continue" hoặc `8sync ccc loop done` đã chạy exit 0. Hoặc dừng nếu `8sync ccc loop tick` in "stop:<reason>" — khi đó ghi brief vào LOOP.md rồi kết thúc, không làm tiếp. Không sửa file test chỉ để cho pass. Hoặc dừng sau <N> turn.
```

Điều kiện phải chứng minh được từ output hiện trong transcript — nên mỗi iteration phải in nguyên văn kết quả lệnh check và dòng `tick`.

## C. Mỗi iteration (bắt đầu ngay sau khi đặt goal; goal gọi lượt kế)
1. **Implement** phần nhỏ nhất tiến tới criterion đỏ (đọc file trước khi sửa; `task`/`quick-task` song song khi file tách bạch; watchdog áp lực → không thêm agent). Code mới có test; không sửa test cho pass.
2. **Check** — chạy lệnh của TẤT CẢ criterion (nhẹ, local) hoặc workflow CI (`gh workflow run … --ref <branch>` → `gh run watch <id> --exit-status` nền). Build/test nặng chỉ trên CI.
3. **Evidence** — append vào LOOP.md: `iter <k> | <lệnh> | exit <n> | <1 dòng output>` cho mỗi lệnh. Không có dòng evidence → criterion không tính là pass.
4. **Tick** — `8sync ccc loop tick --changed <số file đổi> --digest "<sha256 diff + dòng cuối output check fail đầu tiên>"`. In `continue` → iteration kế. In `stop:<reason>` → bước D.
5. Stuck cũng tính khi hai iteration liền cùng digest (content hash, không phải tên tool) hoặc không file nào đổi (DESIGN: `su-code/ship/auto-harness/DESIGN.md`). Hết lượt mà goal chưa met, evaluator đẩy lý do làm hướng dẫn cho lượt sau.

## D. Kết thúc
- **stop:<reason>** (cap/time/stuck) hoặc owner "dừng": ghi brief ≤10 dòng vào LOOP.md (criterion nào xanh/đỏ + bằng chứng, đã thử gì, đề xuất tiếp), `8sync ccc loop done`, xoá dòng khỏi `ACTIVE`, `/goal clear` nếu goal còn, báo owner. Không làm thêm.
- **Tất cả xanh**: `/sec` trên diff (+ `/rules`/`/aup-audit` khi trigger) → CHANGELOG Unreleased + `/remember` bài học → commit conventional (không push). Có `--release` ở cuối `$ARGUMENTS`: làm như `/ship-auto` từ bước 3 — MỘT `AskUserQuestion` header `Ship` (options đúng: `Duyệt tất cả (Recommended)` · `Chỉ merge, chưa deploy` · `Dừng`) → PR → `gh pr checks --watch` nền → merge → tag/release → `8sync up`/kit refresh nếu có → monitor tới xanh. Không có `--release` → dừng sau commit.

Rails: không `bypassPermissions`; không in secret; guard chặn destructive/force-push. Mọi câu "xong/pass" phải kèm lệnh + output; thiếu → "not verified". Báo cáo cuối: criterion + evidence, iteration/thời gian đã dùng, việc còn dở.
