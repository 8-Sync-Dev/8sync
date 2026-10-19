//! `8sync ccc help`: one screen listing every ccc verb. `VERBS` is checked against the
//! dispatcher's match arms in ccc.rs by a unit test, so a new verb cannot be left out.

/// Every top-level verb the dispatcher in `ccc::run` routes (plus `help` itself).
#[cfg(test)]
pub(super) const VERBS: &[&str] =
    &["help", "hook", "statusline", "kit", "login-kind", "show", "report", "status", "policy", "loop", "hint", "inbox", "msg", "ls", "list", "urgent", "goal", "standup", "rm", "new", "compact", "secret", "idle", "delegate", "cancel", "risk", "auto", "meet", "term", "awake"];

/// Words that look like verbs: never a session name, never a headless claude launch.
/// Includes hook sub-verbs people type without `hook`.
pub(super) const RESERVED: &[&str] = &["help", "compact", "statusline", "login-kind", "show", "report", "loop", "hint", "inbox", "msg", "kit", "guard", "hook", "ship-grant", "secret", "idle", "delegate", "cancel", "risk", "auto", "meet", "term", "awake"];

pub(super) const TEXT: &str = "\
8sync ccc — Claude Code + kit của 8 Sync. Mọi lệnh (chạy `8sync ccc <verb>`):

SESSION
  8sync ccc . <tên>            tạo hoặc tiếp tục session <tên> trong repo này (flag sau tên đi thẳng vào claude)
  8sync ccc .                  tiếp tục session dùng gần nhất
  8sync ccc . ls [--json]      liệt kê session, mới hoạt động nhất lên đầu, kèm mức urgent (alias: list)
  8sync ccc . urgent <high|med|low|clear> [ghi chú] [--session <tên>]   agent tự đặt mức cần owner chú ý cho session của mình
  8sync ccc . goal <mục tiêu> [--files a,b] [--session <tên>]   agent ghi mục tiêu + file đang giữ của session (phòng khác thấy, tránh trùng file); goal clear để bỏ
  8sync ccc . new <tên>        tạo session mới (từ chối tên đã có)
  8sync ccc . rm <tên>         xoá session và transcript
  8sync ccc . <tên> --team     bật agent teams (thêm --panes: tmux split)

KIT & CẤU HÌNH
  8sync ccc kit [--force]      cài/làm mới kit vào ~/.claude (--remove gỡ hook; --skills-from <dir>)
  8sync ccc kit status --json  trạng thái kit dạng JSON
  8sync ccc status             claude, login, kit, managed settings, MCP, session
  8sync ccc policy [--org-uuid <u>] [--out <f>] [--strict-hooks] [--lock-mcp]   in managed-settings.json khuyến nghị
  8sync ccc statusline --install | --uninstall | --agents   status line của Claude Code
  8sync ccc compact            xem mốc auto-compact (mặc định kit: 65% của window model)
  8sync ccc compact --at 50    đặt mốc 10..95 (thấp hơn = nén sớm hơn; cần session mới)
  8sync ccc compact --reset    về mặc định của Claude Code   (--json để máy đọc)
  8sync ccc compact --window 400000   trần tuyệt đối 100000..1000000 (kit mặc định 1000000 = window model; trigger ≈ % × window)
  8sync ccc compact --window-reset    bỏ trần window
  8sync ccc login-kind [--json]   kiểu login (claude.ai hay API key; không in token)
  8sync ccc <verb> --offline   không chạm mạng (cũng EIGHTSYNC_OFFLINE=1)

TỰ ĐỘNG (gõ trong Claude Code)
  /do <việc>                   đổi nhỏ ≤3 file, không plan/commit
  /ship <việc>                 một feature/bug tới commit
  /ship-auto <việc>            như /ship rồi PR → CI → merge → release sau một câu `Ship`
  /ship-loop <mục tiêu>        lặp tới khi tiêu chí xanh (có cap iter/phút)
  /autopilot                   nhiều item từ backlog, không người trông
  /ship-tick [slug]            một nhịp của vòng lặp đang mở (cron */5 do /ship-loop, /ship-auto, /autopilot đặt; tự xoá khi xong)
  /sysdesign <thay đổi>        system design theo The System Design Primer: cổng quy mô → đọc ≤3 mục → 4 bước + back-of-envelope → ADR (clone primer vào ~/.cache/8sync, không chép vào repo)
  8sync ccc standup <slug> [init|set <role> <status> [--agent a] [--files a,b] [việc]|--json]   bảng sprint 7 role (rd plan dev review qa quick critic): báo done/doing/blocked, exit 3 khi có role ngồi không, cảnh báo trùng file với phòng khác (/sprint)
  8sync ccc loop <init|tick|ev|status|done|ls> <slug>   state vòng lặp cho /ship-loop; `ev <slug> <nhãn> -- <lệnh>` chạy check + ghi evidence vào LOOP.md
  8sync ccc cancel [--all] [--session <tên>] [--json]   huỷ hết việc session này đặt: goal, urgent, loop ghi trong su-code/ship/ACTIVE của repo (ACTIVE chung cả repo), rồi ACTIVE; `--all` thêm mọi loop + idle off + delegate off; thiếu session hay huỷ hụt → exit 1 (fail-closed; /loop của Claude Code phải `/loop clear` trong session)
  8sync ccc hook ship-grant    (hook) ghi giấy phép khi owner duyệt câu hỏi `Ship`
  8sync ccc idle on [--hours 2] [--usd-per-hour X]   không-ai-rảnh cho agent team (mặc định TẮT; subscription = lease khi owner có mặt)
  8sync ccc auto on [--here] [--omp] [--loop [30m]] [--team] [--hours 2] [--after 60|1m] | off | pause | status [--json]   một công tắc \"team luôn work\": idle lease + delegate sau 60 s owner không gõ + auto.json cho HQ; mặc định mọi session ở mọi dự án trên máy, `--here` = chỉ các session của dự án ở thư mục hiện tại; `--omp` = bật cả đội omp; `--loop 30m` (≥ 30 phút) = ghi .claude/loop.md (playbook chọn skill, không ghi đè) rồi gửi vào inbox mọi phòng của dự án lệnh tự đặt loop cron (như /loop 30m) theo vai phòng; phòng không giữ cột (arch, rd, ops, docs, sec) không đặt loop, chỉ chạy khi có tin/card; loop tự xoá khi auto off/pause, chạm trần thì nghỉ nhịp (subscription: cửa sổ 5 giờ/7 ngày ≥ 90%; API key hoặc `--usd-per-hour`: $/giờ trung bình, chỉ tính session của dự án khi `--here`); Claude Code xoá sau 7 ngày (chạy lại = gia hạn); `--team` = phòng mở bằng --team tự lấp ghế rd, qa, reviewer; `--target \"<đích>\" [--check \"<lệnh>\"]` = đích đầu hàng cho cả team; `pause` = owner tạm dừng (HQ không tự bật lại), `off` = tắt (HQ có thể bật lại); subscription giữ lease ≤ 4 giờ, chỉ chạy khi owner có mặt; `status --json` có `ci` (ok · failing · billing · unknown) của repo dự án
  8sync ccc auto ci [--json]   CI GitHub của dự án lúc này: `gh run list` 5 run gần nhất + annotation của job fail → ok · failing · billing (GitHub không chạy job vì thanh toán/spending limit) · unknown (thiếu gh/chưa login/offline); lưu cho `auto status` (đọc lại sau 10 phút, chạy nền); billing → báo owner một lần mỗi ngày ở kênh #alerts của HQ
  8sync ccc auto up [--roles lead,dev,qa,review,rd] [--loop 30m] [--clear-ss] [--omp] | down   cả team chạy nền (claude --bg) bằng một lệnh, không mở terminal từng phòng: auto on --here + mỗi phòng một session nền đúng vai/model (lead opus, dev sonnet, qa sonnet, review sonnet, rd opus; thêm ba, ui, api, core, ops, docs, sec); phòng đang chạy chỉ nhận loop, phòng đã dừng chạy lại cùng id; `--clear-ss` = xoá trước mọi session nền rác của dự án (trùng phòng, sót từ lần trước) và khởi động lại phòng nền đang chạy kit cũ (nạp hook mới, giữ hội thoại), không đụng session interactive; `--omp` (hoặc khi auto.json đã có đội omp) = thêm đội omp: mỗi vai một phòng omp `omp-<vai>` (`8sync . omp-<vai>`) chạy tách terminal (tmux trên Linux/macOS, tab Windows Terminal `8sync-omp` trên Windows, không có thì in lệnh để chạy tay), bật luôn omp trong `teams`; chặn khi model omp là anthropic/…; xem tiến độ `8sync hq ui`; `down` = dừng phòng nền + phòng `omp-<vai>` của dự án (hội thoại giữ nguyên) + pause
  8sync ccc auto revive   mở lại nền các phòng team có session nền đã chết (tắt máy, process bị kill) khi auto còn bật cho dự án: cùng hội thoại, cùng prompt như `up`; không gia hạn lease, không mở phòng chưa từng chạy, không làm gì khi auto tắt/tạm dừng/lease hết/chạm trần — HQ gọi mỗi ≤ 2 phút và ngay khi bấm Chạy
  8sync ccc awake [--while-rooms] [--hours 8] [--screen-off 10]   (= `8sync awake …`) giữ máy không ngủ trong lúc phòng làm: Windows SetThreadExecutionState, Linux systemd-inhibit, macOS caffeinate; `--while-rooms` = tự nhả khi không còn phòng Claude Code nào chạy (kiểm mỗi phút); tối đa 24 giờ; Windows: tắt màn hình sau `--screen-off` phút không ai đụng chuột/phím (0 = để Windows lo; không tắt khi có app giữ màn hình hoặc máy có Modern Standby), chạm là sáng lại; không mở phòng, không gia hạn lease; gập nắp/tắt máy vẫn dừng phòng (`auto revive` mở lại)
  8sync ccc awake on [--hours 8] [--screen-off 10] | off   công tắc của HQ: `on` chạy `8sync awake --while-rooms` nền (không cửa sổ, sống qua lúc đóng terminal / HQ khởi động lại) rồi thoát; `off` chỉ tắt giữ thức mà 8sync ghi trong ~/.local/state/8sync/ccc/awake.json (kiểm đúng tiến trình đó trước khi tắt), chạy lại không sao; `status --json` có `ours` = giữ thức của 8sync (pid, until, while_rooms) hoặc null
  8sync ccc auto add \"<việc>\" [--check \"<lệnh>\"] [--label bug|feature|qa] [--role <vai>] [--prio P0..P3] [--now] | queue | done <id> --evidence \"<lệnh: kết quả>\" | drop <id> | reopen <id> [--note \"…\"]   hàng đích của dự án: mỗi nhịp loop các phòng làm phần hợp vai cho đích đầu hàng, đạt thì `done` rồi sang đích kế (evidence phải có `<lệnh>: <kết quả>` hoặc SHA commit; \"chưa\", \"ok\" bị từ chối); `reopen` = mở lại card đóng nhầm về cột cũ, giữ lịch sử, ghi ai mở; `--now` = lên đầu hàng + vào inbox mọi phòng ngay (như ctrl+x ctrl+s); trong phòng nói \"đưa vào loop: …\" là đủ
  8sync ccc auto board | lint | claim | wait | move <id> <cột> [--role <vai>] | prio <id> <P0..P3|none> | note <id> \"…\" [--json]   board kiểu super-board: backlog → ready → building → qa → review → approved (chờ Ship) → done, blocked; phòng `claim` card gấp nhất của cột mình (P0 trước, chưa đặt = P2, cùng mức theo thứ tự hàng) (lead/ba backlog, dev ready, qa qa, review review), cột ready chỉ giao card đúng vai phòng hoặc card không gắn vai (vai = `--role` hoặc tag đầu tiêu đề `[ui]`, `[dev]`, `[rd]`…; dev, dev2, backend, core cùng vai dev; card `[qa]` sang cột qa; tag chữ hay chữ-gạch-nối lạ như `[art-director]` cũng là vai, `[#125]`, `[hot-fix]`, `[wip]`, `[bug]`, `[p1]` thì không), card có vai mà dự án không có phòng không giao cho ai và `lint` báo cho lead, cột trống thì `wait` (chặn, không tốn token, tới khi có card; không `--timeout` thì chờ theo BASH_MAX_TIMEOUT_MS của phòng: ≤ 30 phút, không có thì 9 phút; phòng mở bằng `auto up` chạy trên /goal của Claude Code nên không ngồi rảnh), `move` chuyển cột có luật (ready cần --check, approved cần --sha; vào qa/approved thì PR phải mở, base main, không conflict, approved đúng head SHA, kiểm bằng `gh pr view`; mergeable UNKNOWN thì đọc lại 3 lần cách 3 s rồi báo GitHub đang tính, không tính lần bị trả; gh lỗi thì từ chối), bị trả về quá 2 lần → blocked, claim im 2 giờ → thu hồi
  8sync ccc auto merge [--as <phòng>] [--json]   lead chạy đầu mỗi nhịp: code (không tốn token) merge mọi card approved theo thứ tự board — `gh pr view` → base main (base đã merge thì `gh pr edit --base main`), MERGEABLE, head = SHA review duyệt → `gh pr merge --squash --delete-branch --match-head-commit <sha>` → done `merged <sha>`; conflict, SHA đổi, base khác → về ready kèm lý do (tính một lần bị trả); mergeable UNKNOWN (GitHub đang tính sau push) → chờ, không phải conflict; cần quyền tự merge của owner cho dự án (8 giờ, giữ qua relaunch: câu `Ship` được duyệt hoặc câu trả lời bắt đầu \"Tự merge\"), thiếu thì in sẵn MỘT câu AskUserQuestion Ship (mọi card approved + PR) để lead hỏi ngay lượt đó, trước `auto wait`, và exit 1; khi có quyền, guard cũng cho `gh pr merge <pr> --match-head-commit <sha>` đúng card approved, base main; `auto wait` của lead thức ngay khi có card approved mới
  8sync ccc auto omp on [--model <provider/model>]|off [--json]   đội omp (phòng `8sync . <tên>`) chạy cạnh đội Claude Code: chỉ đổi `teams` (và `omp_model` khi có --model) trong auto.json, giữ mọi thứ khác; `--model <provider>/<model>` = model của đội (phòng mở bằng `8sync . omp-<vai> --model <m>`; giữ khi on/off không có --model; `on --omp`/`up --omp` nhận `--omp-model <m>`); mỗi phòng omp được nhắc đích đầu hàng ≤ 1 lần/10 phút, ≤ 6 lần/giờ; tắt khi model đội (không đặt = model mặc định của omp) là anthropic/… (subscription Claude chỉ dùng trong Claude Code)
  8sync ccc auto nudge --session <room id> --cwd <dir> [--model <provider/model>] [--json]   (extension omp gọi, --model = model đang chạy của phòng; không có → xét model mặc định của omp) {\"text\"}: lời nhắc đích hiện tại cho phòng omp, null khi auto tắt/tạm dừng, đội omp tắt, phòng chạy anthropic/…, ngoài --here, lease hết, hàng trống hoặc vừa nhắc
  8sync ccc msg <phòng> \"<tin>\" [--from <phòng>] | msg --all \"<tin>\"   nhắn phòng khác của dự án này (cả phòng Claude Code `ccc . <tên>` lẫn phòng omp `. <tên>`; trùng tên → gửi theo id hoặc ccc:<tên> / omp:<tên>): vào inbox phòng đó như dữ liệu từ phòng gửi (không phải lệnh của owner) + hiện trong chat HQ; không có phòng khớp → exit 1
  8sync ccc meet [--say \"done|doing|blocked\"] [--room <tên>] [--json]   họp sprint daily của các phòng: ghi một dòng vào su-code/standup/<ngày>.md (phòng nói lại trong 30 phút thì thay dòng cũ), đọc dòng của phòng khác; cần su-code/
  8sync ccc idle off | status [--json]                 (bật thêm gate TaskCompleted: task sửa code chưa test thì chưa cho xong)
  8sync ccc delegate on [--after 1m] | off | status    critic chọn thay owner câu hỏi sản phẩm/kỹ thuật (mặc định TẮT; --after: chỉ khi owner không gõ prompt N giây — bấm trả lời dialog không tính; Ship/secret/xoá/tiền vẫn hỏi)

XEM
  8sync ccc . show <tên> [--json]   tóm tắt một session
  8sync ccc . report [--json]       token, cost (số Claude Code báo statusline), thời gian, +/- dòng, task xong, cost/task, loop
  8sync hq ui                       dashboard HQ trong trình duyệt
  8sync ccc hint [--complete <token>] [--json]   gợi ý prompt kế (ghost text), band trên prompt, typeahead /skill · 8sync · ccc — mod 8sync-hints gọi
  8sync ccc inbox [--session <id>] [--json]   lấy task/tin HQ đang chờ cho phiên rảnh (một lần, masked) — mod 8sync-inbox gọi
  8sync completions <bash|zsh|fish|powershell|elvish>   script tab-completion cho lệnh 8sync (nguồn vào shell rc)

AN TOÀN
  8sync ccc hook <verify|verify-stop|guard|watchdog|session-start|stop-failure|resume-note|ship-grant|idle|task-done|delegate|permit|wake>
                               hook do kit đăng ký, không gõ tay
  8sync ccc risk [--base <ref>] [--paths a,b] [--release] [--json]   gate bắt buộc cho diff này từ tên file đổi (token nguyên từ, không đọc nội dung): /sec luôn; /rules + /aup-audit khi đụng auth · data · messaging · third-party · release · high-risk (+ người review) hoặc có --release; /harden khi đụng .claude/ · settings · hook của kit
  8sync ccc term <session-id> [--cols 120] [--rows 34]   terminal thật của một phòng nền cho HQ web: chạy `claude attach` trong pseudo-terminal (ConPTY trên Windows), stdin nhận JSON {\"i\":\"phím\"} hoặc {\"r\":[cột,dòng]}, stdout là màn hình; đóng stdin chỉ rời phòng, phòng vẫn chạy
  8sync ccc term --shell [--cols 120] [--rows 34]   cùng giao thức, nhưng là shell thật trên máy (thư mục hiện tại) cho terminal nổi của HQ: zsh của 8sync (prompt + gợi ý) nếu đã cài, không thì pwsh/powershell (Windows) hoặc $SHELL; không cài/tải gì; đóng stdin là tắt shell
  8sync ccc secret keys <file.env>  tên key trong file (không bao giờ in giá trị)
  8sync ccc secret set <encore|vercel|gh> <TÊN> (--from <file.env> | --generate) --type prod,dev | --env production
                               đưa secret thẳng vào Encore/Vercel/GitHub qua stdin, giá trị không vào transcript
  /sec  /rules  /aup-audit  /harden   quét secret · được phép không · repo vs Usage Policy · cấu hình Claude Code

Trợ giúp: `8sync ccc help` · `8sync ccc --help` (đầy đủ ví dụ).
";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_verb_is_in_the_help_text() {
        for v in VERBS {
            assert!(TEXT.contains(&format!("ccc {v}")) || TEXT.contains(&format!("ccc . {v}")) || TEXT.contains(&format!("| {v}")) || *v == "list" || *v == "help", "verb {v} missing from help");
        }
        for v in RESERVED {
            assert!(TEXT.contains(v), "reserved {v} missing from help");
        }
    }

    /// Reads the real dispatcher: each `"verb" ... =>` arm of `match verb` must be in VERBS.
    #[test]
    fn dispatcher_arms_are_all_listed() {
        let src = include_str!("../ccc.rs");
        let body = src.split("match verb {").nth(1).expect("match verb");
        let mut found = vec![];
        for l in body.lines().take_while(|l| !l.starts_with("fn ") && !l.starts_with("/// Every launch")) {
            let t = l.trim_start();
            if l.starts_with("        \"") && t.starts_with('"') {
                let arms = t.split("=>").next().unwrap_or("");
                for w in arms.split('|') {
                    if let Some(x) = w.trim().strip_prefix('"').and_then(|r| r.split('"').next()) {
                        if !x.is_empty() {
                            found.push(x.to_string());
                        }
                    }
                }
            }
        }
        assert!(found.len() >= 8, "parsed too few arms: {found:?}");
        for v in found {
            assert!(VERBS.contains(&v.as_str()), "dispatcher verb {v} not in help::VERBS");
        }
        for v in ["hook", "statusline"] {
            assert!(src.contains(&format!("verb == \"{v}\"")) && VERBS.contains(&v));
        }
    }

    #[test]
    fn reserved_words_are_never_session_names() {
        assert!(RESERVED.contains(&"compact") && RESERVED.contains(&"guard") && RESERVED.contains(&"ship-grant"));
    }
}
