//! `8sync ccc help`: one screen listing every ccc verb. `VERBS` is checked against the
//! dispatcher's match arms in ccc.rs by a unit test, so a new verb cannot be left out.

/// Every top-level verb the dispatcher in `ccc::run` routes (plus `help` itself).
#[cfg(test)]
pub(super) const VERBS: &[&str] =
    &["help", "hook", "statusline", "kit", "login-kind", "show", "report", "status", "policy", "loop", "hint", "inbox", "ls", "list", "urgent", "goal", "know", "rm", "new", "compact", "secret", "cancel", "risk", "term", "awake", "eco", "sleep"];

/// Words that look like verbs: never a session name, never a headless claude launch.
/// Includes hook sub-verbs people type without `hook`, and the verbs removed with the board
/// (an old script's `8sync ccc auto …` must never open a session named "auto").
pub(super) const RESERVED: &[&str] = &["help", "compact", "statusline", "login-kind", "show", "report", "loop", "hint", "inbox", "msg", "know", "kit", "guard", "hook", "ship-grant", "secret", "idle", "delegate", "cancel", "risk", "auto", "meet", "standup", "term", "stop", "awake", "eco", "sleep"];

pub(super) const TEXT: &str = "\
8sync ccc — Claude Code + kit của 8 Sync. Mọi lệnh (chạy `8sync ccc <verb>`):

SESSION
  8sync ccc . <tên>            tạo hoặc tiếp tục session <tên> trong repo này (flag sau tên đi thẳng vào claude)
  8sync ccc .                  tiếp tục session dùng gần nhất
  8sync ccc . ls [--sort priority|time|name|status] [-r] [--json]   liệt kê session (alias: list); mặc định ưu tiên: ▲ high → ⚠ dừng vì lỗi API/hết usage → ◆ med → đang chạy → ▽ low → nghỉ, cùng mức: trạng thái → mới nhất → tên; --json theo cùng thứ tự
  8sync ccc . urgent <high|med|low|clear> [ghi chú] [--session <tên>]   agent tự đặt mức cần owner chú ý cho session của mình
  8sync ccc . goal <mục tiêu> [--files a,b] [--session <tên>]   agent ghi mục tiêu + file đang giữ của session (phòng khác thấy, tránh trùng file); goal clear để bỏ
  8sync ccc . new <tên>        tạo session mới (từ chối tên đã có)
  8sync ccc . rm <tên>         xoá session và transcript

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
  8sync ccc loop <init|tick|ev|status|done|ls> <slug>   state vòng lặp cho /ship-loop; `ev <slug> <nhãn> -- <lệnh>` chạy check + ghi evidence vào LOOP.md
  8sync ccc cancel [--all] [--session <tên>] [--json]   huỷ hết việc session này đặt: goal, urgent, loop ghi trong su-code/ship/ACTIVE của repo (ACTIVE chung cả repo), rồi ACTIVE; `--all` thêm mọi loop; thiếu session hay huỷ hụt → exit 1 (fail-closed; /loop của Claude Code phải `/loop clear` trong session)
  8sync ccc hook ship-grant    (hook) ghi giấy phép khi owner duyệt câu hỏi `Ship`
  8sync ccc awake [--while-rooms] [--hours N] [--screen-off 10]   (= `8sync awake …`) giữ máy không ngủ trong lúc phiên làm: Windows SetThreadExecutionState, Linux systemd-inhibit, macOS caffeinate; mặc định giữ tới khi tắt (Ctrl+C / `awake off`), không hạn giờ; `--hours N` = nhả sau N giờ; `--while-rooms` = tự nhả khi không còn phiên Claude Code nào chạy (kiểm mỗi phút); Windows: tắt màn hình sau `--screen-off` phút không ai đụng chuột/phím (0 = để Windows lo; không tắt khi có app giữ màn hình hoặc máy có Modern Standby), chạm là sáng lại; không mở phiên; gập nắp/tắt máy vẫn dừng phiên
  8sync ccc awake on [--while-rooms] [--hours N] [--screen-off 10] | off   công tắc của HQ: `on` chạy `8sync awake` nền, giữ tới khi `off` (thêm `--while-rooms` / `--hours` để tự nhả) (không cửa sổ, sống qua lúc đóng terminal / HQ khởi động lại) rồi thoát; `off` chỉ tắt giữ thức mà 8sync ghi trong ~/.local/state/8sync/ccc/awake.json (kiểm đúng tiến trình đó trước khi tắt), chạy lại không sao; `status --json` có `ours` = giữ thức của 8sync (pid, until, while_rooms) hoặc null
  8sync ccc know add \"<bài học>\" [--repo <root> | --shared] | ls [--all] [--json]   cây tri thức chung của máy (`--shared` = sổ công ty, đúng cho mọi dự án, mọi phòng đọc đầu tiên): mỗi repo một file `~/.local/state/8sync/ccc/know/<repo>.md` (dòng `- <ngày> [<phòng>] <bài học>`); SessionStart nạp bài học của dự án này trước rồi 3 dòng cuối của từng dự án khác dưới tiêu đề root của nó (đọc để học, không lẫn); su-code/KNOWLEDGE.md vẫn là memory commit của repo; CHỈ ghi bài học chung (công cụ, hook, guard, cách làm) — chuyện riêng của khách/dự án, secret, dữ liệu khách KHÔNG vào cây chung (quy tắc tách từng client)

XEM
  8sync ccc . show <tên> [--json]   tóm tắt một session
  8sync ccc . report [--json]       token, cost (số Claude Code báo statusline), thời gian, +/- dòng, task xong, cost/task, loop
  8sync hq ui                       dashboard HQ trong trình duyệt
  8sync ccc hint [--complete <token>] [--json]   gợi ý prompt kế (ghost text), band trên prompt, typeahead /skill · 8sync · ccc — mod 8sync-hints gọi
  8sync ccc inbox [--session <id>] [--json]   lấy task/tin HQ đang chờ cho phiên rảnh (một lần, masked) — mod 8sync-inbox gọi
  8sync ccc sleep (= 8sync sleep) work [--hours N] [--screen-off PHÚT] [--no-lock] [--force] | off | status [--json]   tắt màn hình + khoá máy ngay (Win+L), máy vẫn thức cho Claude Desktop / Claude Code làm tiếp; chạm chuột/phím là sáng lại, tự tắt lại sau 2 phút; Modern Standby: không tự tắt màn hình trừ --force
  8sync ccc eco (= 8sync eco) [status|tick|reap [--dry-run]|run|install|uninstall|set ram|cpu <%>|set battery on|off] [--json]   máy đang dùng bao nhiêu (RAM, CPU, GPU, W, pin, Claude Code/node) + giữ máy nhẹ cho phiên chạy lâu: hạ ưu tiên tiến trình phiên sinh ra, Efficiency mode khi chạy pin/RAM-CPU chạm ngưỡng (80/75%), trả RAM helper, mỗi lượt dọn helper mồ côi (pyright/tsserver/bash-language-server, MCP zai/headroom/serena/unreal/codebase-memory, worker trail-code ≥ 10 phút) đã ≥ 2 phút mà không còn claude/omp/editor/terminal nào phía trên, tối đa 20/lượt, ghi ~/.config/8sync/eco-reap.log; `reap --dry-run` = chỉ liệt kê; `install` chạy nền khi đăng nhập
  8sync completions <bash|zsh|fish|powershell|elvish>   script tab-completion cho lệnh 8sync (nguồn vào shell rc)

AN TOÀN
  8sync ccc hook <verify|verify-stop|guard|watchdog|session-start|stop-failure|resume-note|ship-grant|plugin <hook>>
                               hook do kit đăng ký, không gõ tay
  8sync ccc risk [--base <ref>] [--paths a,b] [--release] [--json]   gate bắt buộc cho diff này từ tên file đổi (token nguyên từ, không đọc nội dung): /sec luôn; /rules + /aup-audit khi đụng auth · data · messaging · third-party · release · high-risk (+ người review) hoặc có --release; /harden khi đụng .claude/ · settings · hook của kit
  8sync ccc term <session-id> [--cols 120] [--rows 34]   terminal thật của một phòng nền cho HQ web: chạy `claude attach` trong pseudo-terminal (ConPTY trên Windows), stdin nhận JSON {\"i\":\"phím\"} hoặc {\"r\":[cột,dòng]}, stdout là màn hình; đóng stdin chỉ rời phòng, phòng vẫn chạy
  8sync ccc term --shell [--cols 120] [--rows 34]   cùng giao thức, nhưng là shell thật trên máy (thư mục hiện tại) cho terminal nổi của HQ: zsh của 8sync (prompt + gợi ý) nếu đã cài, không thì pwsh/powershell (Windows) hoặc $SHELL; không cài/tải gì; đóng stdin là tắt shell
  8sync ccc secret keys <file.env>  tên key trong file (không bao giờ in giá trị)
  8sync ccc secret set <encore|vercel|gh> <TÊN> (--from <file.env> | --generate) --type prod,dev | --env production
                               đưa secret thẳng vào Encore/Vercel/GitHub qua stdin, giá trị không vào transcript
  /sec  /rules  /aup-audit  /harden   quét secret · được phép không · repo vs Usage Policy · cấu hình Claude Code

ĐÃ BỎ (2026-10-30)
  board/card/team: `8sync ccc auto`, `8sync stop all`, `ccc idle`, `ccc delegate`, `ccc msg`, `ccc meet`, `ccc standup`
  và skill đội của kit — 8sync không tự mở phiên, không đẩy prompt vào phiên; chỉ dùng phiên owner mở

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
