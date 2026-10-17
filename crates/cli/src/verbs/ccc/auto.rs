//! `8sync ccc auto on [--here] [--hours N] [--after <60|1m>] [--usd-per-hour X] | off | pause | status [--json]`:
//! one switch for "the team never sits idle and the critic answers when the owner is away" =
//! `idle on` (lease) + `delegate on --after` (default 60 s) + a marker file the HQ office reads.
//!
//! Marker: `<state>/ccc/auto.json` (one level above the idle state dir, `idle::state_dir`), schema 1:
//! `{ "on", "paused", "since", "hours", "after_s", "repo"? }`. `pause` = the owner pressed pause: HQ
//! must not turn it on again; `off` = plain off, HQ may turn it on again. Both are idempotent.
//!
//! The switch is per user (one state dir under home), so it reaches every session of every project.
//! `--here` stores the project root of the current folder as `repo`: the `idle`, `delegate` and
//! `taskdone` hooks then skip sessions whose cwd is outside it ([`in_scope`]); subfolders and
//! worktrees inside the repo count as the same project.
//!
//! `--loop [10m] [--team]` queues one inbox message per room of this project ([`loop_prompt`]):
//! the room sets up its own recurring `CronCreate` loop, which re-reads [`status`] every tick and
//! deletes itself once auto is off/paused; while the `cap` holds (this project's $/hour, or on a
//! subscription the 5-hour/7-day usage window at 90%) it rests. The lease does not stop it: the
//! loop is Claude Code's own scheduler (session-scoped, expires after 7 days,
//! https://code.claude.com/docs/en/scheduled-tasks), started by the owner's own command.
//!
//! `on --target "<đích>" [--check "<lệnh>"]`, `add [--now]`, `queue`, `done <id> --evidence`,
//! `drop <id>`: the project's target queue ([`super::target`]). `status --json` carries the first
//! open target, so every tick works on it until a room proves it met; `add --now` also pushes it
//! into every room's inbox, the project-wide "ctrl+x ctrl+s to send now".
//!
//! Rails stay those of `idle` and `delegate`: a subscription login keeps the idle lease ≤ 4 h and
//! only nudges while the owner types; Ship, secrets, money, deploys and high-risk questions still
//! reach the owner. `--loop` runs inside rooms the owner opened (ordinary use of Claude Code's own
//! scheduler); unattended multi-day or 24/7 use belongs on Routines, Desktop scheduled tasks or a
//! Console API key (https://code.claude.com/docs/en/scheduled-tasks#limitations), and on a
//! subscription `auto on --loop` says so ([`loop_notes`]; `assets/skills/aup-audit/8sync-anthropic-rules.md`).
//! Validation runs before anything is written.
use std::path::{Path, PathBuf};

use anyhow::{bail, Result};
use serde_json::{json, Value};

use super::{delegate, idle, target};

const USAGE: &str = "usage: 8sync ccc auto on [--here] [--loop [10m]] [--team] [--target \"<đích>\" [--check \"<lệnh>\"]] [--hours N] [--after <giây|1m>] [--usd-per-hour X] | off | pause | status [--json]
       8sync ccc auto up [--roles lead,dev,qa,review] [--loop 10m] [--hours N] [--usd-per-hour X] [--clear-ss] | down
       8sync ccc auto add \"<việc>\" [--check \"<lệnh>\"] [--label bug|feature|qa] [--now] | queue | done <id> --evidence \"<lệnh: kết quả>\" | drop <id>
       8sync ccc auto board | lint | claim [--lane <cột>] [--as <phòng>] | wait [--lane <cột>] [--timeout 540] | move <id> <cột> [--note \"…\"] [--check \"…\"] [--pr <số>] [--sha <commit>] | note <id> \"…\"   [--json]
       cột: backlog → ready → building → qa → review → approved (chờ Ship) → done; blocked";
pub(super) const DEFAULT_AFTER_S: u64 = 60;
pub(super) const DEFAULT_LOOP_MIN: u64 = 10;
/// Tag every loop carries, so a room never gets two and `CronList` finds it.
const LOOP_TAG: &str = "8sync-auto-loop";

#[derive(Debug, Clone, PartialEq)]
pub(super) enum Mode {
    On {
        hours: f64,
        after: u64,
        /// `--usd-per-hour`; `None` = the default for the login ([`idle::on`]).
        rate: Option<f64>,
        repo: Option<PathBuf>,
    },
    Pause,
    Off,
}

fn marker(home: &Path) -> PathBuf {
    idle::state_dir(home)
        .parent()
        .map(|p| p.join("auto.json"))
        .unwrap_or_else(|| idle::state_dir(home).join("auto.json"))
}

/// Apply `mode`, then report [`status`]. Fail closed: bad `hours`/`after` → nothing is touched.
pub(super) fn set(home: &Path, mode: Mode, subscription: bool, now: u64) -> Result<Value> {
    match mode {
        Mode::On {
            hours,
            after,
            rate,
            repo,
        } => {
            if after == 0 || after > 86_400 {
                bail!("--after: 1..86400 giây");
            }
            // idle::on validates (hours, rate, subscription cap) before writing anything.
            idle::on(home, hours, rate, subscription, true)?;
            if let Err(e) = delegate::on(home, after) {
                // Half-on is worse than off: no lease without the marker that lets HQ show / pause it.
                let _ = idle::off(home);
                return Err(e);
            }
            let mut m = json!({ "schema": 1, "on": true, "paused": false, "since": now, "hours": hours, "after_s": after });
            if let Some(r) = repo {
                m["repo"] = json!(canon(&r).to_string_lossy());
            }
            if let Err(e) = write_marker(home, &m) {
                // Without the marker the `--here` scope is lost and auto would run everywhere.
                let _ = idle::off(home);
                let _ = delegate::off(home);
                return Err(e);
            }
        }
        Mode::Pause | Mode::Off => {
            idle::off(home)?;
            delegate::off(home)?;
            write_marker(
                home,
                &json!({ "schema": 1, "on": false, "paused": mode == Mode::Pause, "since": now }),
            )?;
        }
    }
    Ok(status(home, subscription, now))
}

/// The marker write must not fail silently: a lost `paused` would let HQ turn auto on again.
fn write_marker(home: &Path, v: &Value) -> Result<()> {
    let p = marker(home);
    if let Some(d) = p.parent() {
        std::fs::create_dir_all(d)?;
    }
    let tmp = p.with_extension(format!("{}.tmp", std::process::id()));
    std::fs::write(&tmp, format!("{v}\n"))?;
    if let Err(e) = std::fs::rename(&tmp, &p) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e.into());
    }
    Ok(())
}

/// `ccc cancel --all` pressed the owner's off switch: remember it so HQ does not turn auto on again.
pub(super) fn mark_paused(home: &Path, now: u64) -> Result<()> {
    write_marker(
        home,
        &json!({ "schema": 1, "on": false, "paused": true, "since": now }),
    )
}

/// `auto on` is in force (marker on, both flags on, not paused): the idle hook then treats a
/// session without an agent team as its own lead. Cheap on purpose — it runs at every Stop of
/// every session — so no cost snapshot and no gate here; the hook applies its own gate.
pub(super) fn running(home: &Path) -> bool {
    let m = idle::read_json(&marker(home));
    let flag = |k: &str| m.as_ref().and_then(|m| m[k].as_bool()).unwrap_or(false);
    flag("on") && !flag("paused") && idle::enabled(home) && delegate::enabled(home)
}

/// Symlinks and `C:\x` vs `\\?\C:\x` resolved, so a hook's cwd and the stored root compare equal.
pub(super) fn canon(p: &Path) -> PathBuf {
    std::fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf())
}

/// The project root `auto on --here` limited auto to, while the marker is on.
fn scope(home: &Path) -> Option<PathBuf> {
    let m = idle::read_json(&marker(home))?;
    if m["on"].as_bool() != Some(true) {
        return None;
    }
    m["repo"]
        .as_str()
        .filter(|r| !r.is_empty())
        .map(PathBuf::from)
}

/// Hooks ask this before acting on a session: `true` unless `auto on --here` limited auto to one
/// project and `cwd` (from the hook input) is missing or outside it.
pub(super) fn in_scope(home: &Path, cwd: Option<&str>) -> bool {
    scoped(home)(cwd)
}

/// [`in_scope`] for many cwds, the marker read once (the idle rails count only this project's spend).
pub(super) fn scoped(home: &Path) -> impl Fn(Option<&str>) -> bool {
    let repo = scope(home);
    move |cwd| match &repo {
        None => true,
        Some(repo) => cwd
            .map(Path::new)
            .filter(|c| c.is_absolute())
            .is_some_and(|c| canon(c).starts_with(repo)),
    }
}

/// Pure over files: what is on right now.
pub(super) fn status(home: &Path, subscription: bool, now: u64) -> Value {
    let m = idle::read_json(&marker(home));
    let lease = idle::read_json(&idle::state_dir(home).join("lease.json"));
    let used = idle::usage(home, lease.as_ref(), now);
    let gate = idle::gate(lease.as_ref(), subscription, &used, now, None).err();
    let cap = lease
        .as_ref()
        .and_then(|l| idle::cap(l, &used, subscription, now).err());
    let (i, d) = (idle::enabled(home), delegate::enabled(home));
    let flag = |k: &str| m.as_ref().and_then(|m| m[k].as_bool()).unwrap_or(false);
    // The marker says on but `idle off` / `delegate off` / `cancel --all` ran by hand: that is the
    // owner's off switch, so HQ must treat it as paused. Flags on without the marker (`idle on
    // --hours 8` by hand): "manual" — HQ must not clobber that lease with its own defaults.
    let on = i && d && flag("on");
    json!({
        "schema": 1,
        "on": on,
        "paused": flag("paused") || (flag("on") && !on),
        "manual": !flag("on") && (i || d),
        "idle": i,
        "delegate": d,
        "after_s": delegate::after_s(home),
        "lease_until": lease.as_ref().and_then(|l| l["until"].as_u64()),
        "gate": gate,
        "cap": cap,
        // What the subscription rail reads (%, null = no fresh status-line reading).
        "five_hour_pct": used.five_hour,
        "seven_day_pct": used.seven_day,
        "subscription": subscription,
        "repo": scope(home).map(|r| r.to_string_lossy().into_owned()),
    })
}

pub(super) fn text(v: &Value) -> String {
    if v["on"].as_bool() == Some(true) {
        let lease = v["lease_until"]
            .as_u64()
            .map(|u| format!(" · lease tới {} UTC", &super::standup::utc_stamp(u)[11..16]))
            .unwrap_or_default();
        let only = v["repo"]
            .as_str()
            .map(|r| format!(" · chỉ dự án {}", r.trim_start_matches(r"\\?\")))
            .unwrap_or_else(|| " · mọi dự án".into());
        let pct = |k: &str| v[k].as_f64().map_or("?".into(), |p| format!("{p:.0}%"));
        let window = if v["subscription"].as_bool() == Some(true) {
            format!(" · cửa sổ 5 giờ {} · 7 ngày {}", pct("five_hour_pct"), pct("seven_day_pct"))
        } else {
            String::new()
        };
        let mut s = format!(
            "auto: ĐANG CHẠY liên tục{lease} · critic trả lời sau {} s{only}{window}",
            v["after_s"].as_u64().unwrap_or(0)
        );
        if let Some(g) = v["gate"].as_str() {
            s.push_str(&format!("\nđang cho nghỉ: {g}"));
        }
        // The lease can expire (gate) while the $/hour average still holds: loops rest on `cap`.
        if let Some(c) = v["cap"].as_str().filter(|c| v["gate"].as_str() != Some(*c)) {
            s.push_str(&format!("\nloop nghỉ nhịp: {c}"));
        }
        s
    } else if v["paused"].as_bool() == Some(true) {
        "auto: TẠM DỪNG (owner)".into()
    } else if v["manual"].as_bool() == Some(true) {
        "auto: TẮT (idle/delegate đang bật tay — `auto on` sẽ ghi đè)".into()
    } else {
        "auto: TẮT".into()
    }
}

fn num(rest: &[String], flag: &str) -> Result<Option<String>> {
    match rest.iter().position(|a| a == flag) {
        Some(i) => Ok(Some(
            rest.get(i + 1)
                .filter(|v| !v.starts_with("--"))
                .ok_or_else(|| anyhow::anyhow!("{flag} cần một giá trị\n{USAGE}"))?
                .clone(),
        )),
        None => Ok(None),
    }
}

/// `--loop` interval in minutes: `10`, `10m`, `2h`. 1..59 minutes or whole hours up to 24, the
/// steps a 5-field cron expression can express ([`cron_expr`]).
pub(super) fn parse_every(s: &str) -> Result<u64> {
    let (n, mul) = match s.strip_suffix('h') {
        Some(h) => (h, 60),
        None => (s.strip_suffix('m').unwrap_or(s), 1),
    };
    match n.parse::<u64>().ok().map(|n| n * mul) {
        Some(m @ 1..=59) => Ok(m),
        Some(m @ 60..=1440) if m % 60 == 0 => Ok(m),
        _ => bail!("--loop: 1m..59m hoặc số giờ chẵn 1h..24h (vd 10m, 2h)\n{USAGE}"),
    }
}

/// The cron expression `CronCreate` gets for an interval from [`parse_every`] (local time).
pub(super) fn cron_expr(every_min: u64) -> String {
    match every_min {
        m if m < 60 => format!("*/{m} * * * *"),
        1440 => "0 0 * * *".into(),
        m => format!("0 */{} * * *", m / 60),
    }
}

/// `<project>/.claude/loop.md`: Claude Code's default prompt for a bare `/loop`, re-read every
/// iteration (https://code.claude.com/docs/en/scheduled-tasks), and the playbook every
/// `--loop` tick follows, so one file steers every room and the owner can edit it live.
const LOOP_MD: &str = "# Loop của dự án (8sync)

`/loop` không kèm prompt chạy file này; loop do `8sync ccc auto on --loop` đặt cũng đọc file này mỗi nhịp.
Sửa file là đổi việc của mọi phòng từ nhịp kế. 8sync không ghi đè file đã có.
Owner giao đích cho cả team: `8sync ccc auto add \"<việc>\" [--check \"<lệnh>\"]` (vào hàng), thêm `--now` để gửi ngay
mọi phòng; trong phòng, owner nói \"đưa vào loop: …\" / \"làm ngay: …\" thì chạy đúng lệnh đó. Xem hàng: `8sync ccc auto queue`.

Mỗi nhịp:
1. Chạy `8sync ccc auto status --json`. `on` là false hoặc `paused` là true → huỷ loop của phòng này (CronDelete job
   chứa `8sync-auto-loop`; `/loop` tự canh nhịp thì dừng, không hẹn nhịp kế) rồi dừng. `cap` khác null (gói subscription:
   cửa sổ 5 giờ/7 ngày đã dùng ≥ 90%; API key hoặc có `--usd-per-hour`: chạm trần $/giờ của dự án này, tính trung bình
   từ lúc bật) → nghỉ nhịp này, giữ loop: trần tự hạ khi cửa sổ reset hoặc thời gian trôi.
   Board (card theo cột, `8sync ccc auto board`): phòng có cột (lead/ba: backlog · dev/ui/api/core: ready · qa · review)
   chạy `8sync ccc auto claim --json`; có `card` → nhịp này chỉ làm card đó rồi chuyển cột, không card → bước 2.
   - backlog: viết AC + một lệnh check → `8sync ccc auto move <id> ready --check \"<lệnh>\"`; gỡ card blocked;
     card approved → MỘT câu hỏi Ship cho owner, duyệt rồi mới `gh pr merge <pr> --squash --match-head-commit <sha>`
   - building: worktree `.claude/worktrees/card-<id>`, nhánh `card-<id>-<slug>`, `/ship` tới commit, push, PR → `move <id> qa --pr <số>`
   - qa: `check` + UAT → `move <id> review`, trượt → `move <id> ready --note \"[qa] …\"`
   - review: review đối kháng → `move <id> approved --sha <head>`, lỗi → `move <id> ready --note \"[review] …\"`
   Card bị trả về ready quá 2 lần tự sang blocked; claim im 2 giờ thì phòng khác lấy lại.
2. `target` khác null → việc của nhịp là phần hợp vai phòng cho đích đó: lead chia việc và giao, dev `/ship` phần mình,
   qa chạy `check`/test, reviewer review, rd gỡ chỗ kẹt. Đạt đích (có `check` thì lệnh đó exit 0 trong nhịp này, không thì
   bằng chứng chạy được) → `8sync ccc auto done <id> --evidence \"<lệnh: kết quả>\"`; nhịp sau cả team sang đích kế.
3. Không có đích: `su-code/ship/ACTIVE` có vòng lặp mở → `/ship-tick <slug>`.
4. Không thì lấy MỘT việc hợp vai phòng (vai đọc từ tên session: lead điều phối, rd nghiên cứu, qa test, review…)
   từ `su-code/STATE.md` mục Next, bỏ mục bắt đầu bằng \"Owner\"; có spec trong `workflows/*.md` (do /loop-me viết) thì làm theo spec.
   Giữ file trước: `8sync ccc . goal \"<việc>\" --files a,b`. Trùng file phòng khác → nhắn phòng đó, chọn việc khác.
   Không có STATE.md → tiếp việc dở trong hội thoại, chăm PR của nhánh (review, CI đỏ, conflict), rồi bug hunt/simplify.
5. Tự chọn skill theo việc:
   - feature, bug, refactor → `/ship <việc>` đủ flow: karpathy-guidelines khi sửa code, test, review, gate `/sec` + `/rules` + `/aup-audit` trước commit
   - đổi nhỏ ≤ 3 file → `/do`
   - cần nhiều nhịp mới xanh → mỗi nhịp `/ship` phần kế, ghi tiến độ vào STATE.md
     (`/ship-loop`, `/ship-auto`, `/autopilot`, `/sprint`, `/loop-me` chỉ owner gõ; nhịp cron không gọi được)
   - câu hỏi mở, R&D → `/deep-research` (brief vào `su-code/research/`)
   - UI → `impeccable` · thiết kế hệ thống → `/sysdesign` · bài học có bằng chứng → `/remember`
6. Báo phòng họp: `8sync ccc meet --say \"done|doing|blocked: <một dòng>\"`.

Không bao giờ: merge, push main, tag, release, publish, deploy khi owner chưa trả lời Ship; đọc hay in secret; xoá dữ liệu; nhắn người ngoài.
Câu hỏi Ship, secret, tiền, high-risk chờ owner. Không có việc hợp vai → R&D cho mục Next kế tiếp, không ngồi không.
";

/// Write [`LOOP_MD`] at `<root>/.claude/loop.md` unless something is already there (the owner's
/// edits win). `create_new` also refuses a dangling symlink, so the write never lands elsewhere.
pub(super) fn write_loop_md(root: &Path) -> Result<(PathBuf, bool)> {
    use std::io::Write;
    let p = root.join(".claude").join("loop.md");
    if std::fs::symlink_metadata(&p).is_ok() {
        return Ok((p, false));
    }
    std::fs::create_dir_all(root.join(".claude"))?;
    let mut f = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&p)?;
    f.write_all(LOOP_MD.as_bytes())?;
    Ok((p, true))
}

/// The message `auto on --loop` queues for one room: set up its own recurring loop (what `/loop`
/// does: `CronCreate`) that follows `.claude/loop.md` for the room's role. The stop check stays in
/// the cron prompt itself, so an edited loop.md cannot drop it: `off` or `pause`
/// delete the loop on its next tick, the `cap` ([`idle::cap`]) rests it. Re-running the command replaces the job (a fresh 7 days).
/// What a room does with the card `auto claim` gives it, per lane (super-board's lane playbooks).
pub(super) fn lane_playbook(lane: &str) -> &'static str {
    match lane {
        "backlog" => "card backlog: viết AC + MỘT lệnh check (exit 0 = đạt) → `8sync ccc auto move <id> ready --check \"<lệnh>\" --note \"AC: …\"`. Hết card backlog: `8sync ccc auto lint` → gỡ card blocked (`move <id> ready`), card approved → gom MỌI card approved vào MỘT câu hỏi Ship cho owner; owner duyệt → `gh pr merge <pr> --squash --match-head-commit <sha>` → `8sync ccc auto done <id> --evidence \"merged <sha>\"`",
        "ready" => "card building: worktree `.claude/worktrees/card-<id>` nhánh `card-<id>-<slug>`, `/ship` card tới commit (test + gate), push nhánh, `gh pr create` → `8sync ccc auto move <id> qa --pr <số>`; làm dở → `8sync ccc auto note <id> \"…\"` (giữ claim)",
        "qa" => "card qa: checkout nhánh PR, chạy `check` + UAT thật → đạt `8sync ccc auto move <id> review`; trượt → `8sync ccc auto move <id> ready --note \"[qa] <lỗi + cách tái hiện>\"`",
        "review" => "card review: review đối kháng diff PR (bug, test thiếu, bảo mật, quy ước) → ổn `8sync ccc auto move <id> approved --sha <head commit đã review>`; lỗi → `8sync ccc auto move <id> ready --note \"[review] <lỗi>\"`",
        _ => "",
    }
}

/// One tick of a room's loop: the recurring cron job's prompt.
fn tick_prompt(name: &str) -> String {
    let (role, _) = super::room::role(name);
    let board = match super::room::find(name).and_then(|r| r.lane) {
        Some(lane) => format!(
            "2) `8sync ccc auto claim --json` (cột {lane} của vai {role}): `card` khác null → nhịp này chỉ làm card đó: {}. Không có card → bước 3. ",
            lane_playbook(lane)
        ),
        None => "2) Vai không giữ cột board: bước 3. ".into(),
    };
    format!(
        "{LOOP_TAG} {name} (vai {role}): 1) chạy `8sync ccc auto status --json`; on=false hoặc paused=true → CronDelete job {LOOP_TAG} này và dừng; `cap` khác null → nghỉ nhịp này (giữ loop). {board}3) `target` khác null → nhịp này làm phần hợp vai {role} cho đích đó; đạt (có `check` thì lệnh đó exit 0) → `8sync ccc auto done <id> --evidence \"<lệnh: kết quả>\"`. 4) Không có đích thì làm MỘT nhịp theo .claude/loop.md của dự án cho vai {role} (thiếu file → lấy MỘT việc hợp vai từ su-code/STATE.md mục Next, tự chọn skill: code → /ship, ≤3 file → /do, R&D → /deep-research). Không merge/push main/tag/deploy khi owner chưa trả lời Ship."
    )
}

/// The cron part of the loop message: replace this room's `8sync-auto-loop` job with a recurring one.
pub(super) fn loop_setup(name: &str, every_min: u64) -> String {
    let cron = cron_expr(every_min);
    format!(
        "CronList trước: job cũ chứa `{LOOP_TAG}` → CronDelete nó (chạy lại lệnh = gia hạn 7 ngày, đổi nhịp). Rồi CronCreate lặp (recurring) cron `{cron}` (mỗi {every_min} phút, như `/loop {every_min}m`) với prompt:\n{}",
        tick_prompt(name)
    )
}

pub(super) fn loop_prompt(name: &str, every_min: u64, team: bool) -> String {
    let (role, duty) = super::room::role(name);
    let mut s = format!(
        "8sync auto --loop: owner bật chạy liên tục cho phòng `{name}` (vai {role}: {duty}). {}\nTạo xong thì chạy luôn nhịp đầu, không chờ.",
        loop_setup(name, every_min)
    );
    if team {
        s.push_str("\nCó tool tạo teammate (agent teams) thì lấp ghế trống ngay: rd, qa, reviewer; mỗi người giữ file riêng (`8sync ccc . goal --files`), báo về lead. Không có tool đó thì bỏ qua (cần mở phòng bằng `--team`).");
    }
    s
}

/// Queue `prompt(room name)` into every room's inbox. `(name, delivered now?)`: a room without the
/// `8sync-inbox` mod gets it at its next turn end.
fn queue_all(
    home: &Path,
    rooms: &[(String, String)],
    now: u64,
    prompt: impl Fn(&str) -> String,
) -> Vec<(String, bool)> {
    let at = std::time::UNIX_EPOCH + std::time::Duration::from_secs(now);
    let mut out = Vec::new();
    for (name, id) in rooms {
        if crate::verbs::hq::queue_inbox(home, id, &prompt(name), now * 1000).is_ok() {
            out.push((name.clone(), crate::verbs::hq::inbox_live(home, id, at)));
        }
    }
    out
}

/// Queue [`loop_prompt`] into every room's inbox.
pub(super) fn queue_loops(
    home: &Path,
    rooms: &[(String, String)],
    every_min: u64,
    team: bool,
    now: u64,
) -> Vec<(String, bool)> {
    queue_all(home, rooms, now, |name| loop_prompt(name, every_min, team))
}

fn delivery(live: bool) -> &'static str {
    if live {
        "vào ngay khi phòng rảnh"
    } else {
        "vào khi phòng xong lượt kế (chưa nạp mod inbox)"
    }
}

/// First line of a target, short enough for one terminal line.
fn short(text: &str) -> String {
    crate::verbs::session_view::truncate(text.lines().next().unwrap_or(""), 80)
}

/// A card for a terminal: the head line (id, label, text, check, holder, PR), then the last notes.
fn card_lines(t: &target::Target) -> Vec<String> {
    let mut head = format!("#{}", t.id);
    if let Some(l) = &t.label {
        head.push_str(&format!(" ({l})"));
    }
    head.push_str(&format!(" {}", short(&t.text)));
    if let Some(c) = &t.check {
        head.push_str(&format!("  [check: {c}]"));
    }
    if let Some(c) = &t.claim {
        head.push_str(&format!(" · {} giữ", c.room));
    }
    if let Some(p) = &t.pr {
        head.push_str(&format!(" · PR {p}"));
    }
    if let Some(s) = &t.sha {
        head.push_str(&format!(" · duyệt {s}"));
    }
    let mut v = vec![head];
    v.extend(t.notes.iter().rev().take(3).map(|n| format!("   {} {}", n.room.as_deref().unwrap_or("owner"), n.text)));
    v
}

/// What the owner must know once loops are queued. Usage-limit wait: Claude Code offers it only
/// in a room open in a terminal, never in a background session, `-p` run or a teammate on its own
/// (https://code.claude.com/docs/en/interactive-mode#wait-for-a-usage-limit-to-reset).
pub(super) fn loop_notes(subscription: bool) -> Vec<&'static str> {
    let mut v = vec![
        "Loop tự xoá ở nhịp kế khi auto off/pause; chạm trần thì nghỉ nhịp, giữ loop (subscription: cửa sổ 5 giờ/7 ngày ≥ 90%, tự mở khi reset; $/giờ chỉ tính session của dự án, trung bình, tự hạ). Claude Code tự xoá sau 7 ngày (chạy lại lệnh này để gia hạn).",
        "Loop chỉ chạy khi phòng còn mở: gõ /bg trong phòng để chạy nền không cần terminal, Ctrl+T trong agent view để ghim; tắt máy là dừng.",
        "Hết usage: phòng mở trong terminal tự chờ reset rồi chạy tiếp (autoContinueAtUsageLimit). Phòng /bg và teammate không tự chờ; nhịp loop kế sau giờ reset có thể chạy tiếp.",
    ];
    if subscription {
        v.push("Login subscription: loop là scheduler của Claude Code trong phòng anh mở, cho mức dùng thường. Chạy không người trông nhiều ngày hoặc 24/7 → Routines (/schedule, cloud; chạy không hỏi quyền và không có rail của 8sync, chỉ cấp repo/connector cần) hoặc Desktop scheduled task (local); tool khác → Console API key. N phòng tiêu quota nhanh gần N lần.");
    }
    v
}

/// The room this command runs in (its conversation id is this Claude Code session), if any.
/// None = the owner's own terminal.
fn me(rooms: &[(String, String)]) -> Option<String> {
    room_of(
        rooms,
        std::env::var("CLAUDE_CODE_SESSION_ID").ok().as_deref(),
    )
}

fn room_of(rooms: &[(String, String)], sid: Option<&str>) -> Option<String> {
    let sid = sid.filter(|s| !s.is_empty())?;
    rooms
        .iter()
        .find(|(_, s)| s == sid)
        .map(|(name, _)| name.clone())
}

/// `auto add|queue|done|drop` and the board verbs `claim|move|note|board|lint` ([`target`]).
fn run_target(
    verb: &str,
    args: &[String],
    home: &Path,
    root: &Path,
    rooms: impl FnOnce() -> Vec<(String, String)>,
    now: u64,
) -> Result<()> {
    let as_json = args.iter().any(|a| a == "--json");
    let takes: &[&str] = match verb {
        "add" => &["--check", "--label"],
        "done" => &["--evidence"],
        "claim" => &["--lane", "--as"],
        "move" => &["--note", "--check", "--pr", "--sha", "--as"],
        "note" => &["--as"],
        _ => &[],
    };
    let (mut words, mut flags, mut first) = (Vec::new(), std::collections::BTreeMap::new(), false);
    let mut it = args.iter();
    while let Some(a) = it.next() {
        match a.as_str() {
            "--json" => {}
            "--now" if verb == "add" => first = true,
            f if takes.contains(&f) => {
                let v = it
                    .next()
                    .filter(|v| !v.starts_with("--"))
                    .cloned()
                    .ok_or_else(|| anyhow::anyhow!("{f} cần một giá trị\n{USAGE}"))?;
                flags.insert(f.to_string(), v);
            }
            // After `--`, everything is text (a target may start with a dash).
            "--" => words.extend(it.by_ref().cloned()),
            f if f.starts_with("--") => bail!("không rõ `{f}`\n{USAGE}"),
            w => words.push(w.to_string()),
        }
    }
    let flag = |f: &str| flags.get(f).map(String::as_str);
    let parse_id = |w: &str| -> Result<u64> {
        w.trim_start_matches('#')
            .parse()
            .map_err(|_| anyhow::anyhow!("`{w}` không phải id (`8sync ccc auto board`)\n{USAGE}"))
    };
    let id = || -> Result<u64> {
        match words.as_slice() {
            [w] => parse_id(w),
            _ => bail!("cần đúng một id (`8sync ccc auto board`)\n{USAGE}"),
        }
    };
    let next_line = |next: &Option<target::Target>| match next {
        Some(t) => format!("kế: #{} {}", t.id, short(&t.text)),
        None => "hết đích: các phòng quay về .claude/loop.md (STATE.md Next)".into(),
    };
    let all = rooms();
    let who = flag("--as").map(str::to_string).or_else(|| me(&all));
    match verb {
        "claim" => {
            if !words.is_empty() {
                bail!("không rõ `{}`\n{USAGE}", words[0]);
            }
            let Some(room) = who else {
                bail!("claim chạy trong một phòng (`8sync ccc auto up`), hoặc thêm --as <phòng>\n{USAGE}");
            };
            let lane = match flag("--lane").or_else(|| super::room::find(&room).and_then(|r| r.lane)) {
                Some(l) => l.to_string(),
                None => bail!("phòng `{room}` (vai {}) không có cột riêng: thêm --lane backlog|ready|qa|review|blocked", super::room::role(&room).0),
            };
            let card = target::claim(home, root, &room, &lane, now)?;
            if as_json {
                println!("{}", json!({ "card": card, "lane": lane, "room": room }));
            } else {
                match &card {
                    Some(t) => println!("{}", card_lines(t).join("\n")),
                    None => println!("cột {lane}: không có card trống cho phòng {room}"),
                }
            }
        }
        "move" => {
            let [i, lane] = words.as_slice() else {
                bail!("move cần <id> <cột>\n{USAGE}");
            };
            let m = target::Move { note: flag("--note"), check: flag("--check"), pr: flag("--pr"), sha: flag("--sha") };
            let t = target::move_to(home, root, parse_id(i)?, lane, &m, who.as_deref(), now)?;
            if as_json {
                println!("{}", json!({ "card": t }));
            } else {
                println!("card #{} → {}: {}", t.id, t.lane, short(&t.text));
            }
        }
        "note" => {
            let Some((i, text)) = words.split_first() else {
                bail!("note cần <id> \"<ghi chú>\"\n{USAGE}");
            };
            let t = target::note(home, root, parse_id(i)?, &text.join(" "), who.as_deref(), now)?;
            if as_json {
                println!("{}", json!({ "card": t }));
            } else {
                println!("ghi chú vào card #{} ({})", t.id, t.lane);
            }
        }
        "board" | "lint" => {
            if !words.is_empty() {
                bail!("không rõ `{}`\n{USAGE}", words[0]);
            }
            let cards = target::list(home, root)?;
            let issues = target::lint(&cards, now);
            if as_json {
                let mut v = if verb == "board" { target::board_json(&cards) } else { json!({}) };
                v["issues"] = json!(issues);
                println!("{v}");
                return Ok(());
            }
            if verb == "board" {
                for lane in target::LANES {
                    let in_lane: Vec<_> = cards.iter().filter(|t| t.state == "open" && t.lane == lane).collect();
                    println!("── {lane} ({}) ──", in_lane.len());
                    for t in in_lane {
                        println!("{}", card_lines(t)[0]);
                    }
                }
                let done = cards.iter().filter(|t| t.state == "done").count();
                println!("── done: {done} gần nhất (`8sync ccc auto queue`) ──");
            }
            if issues.is_empty() {
                println!("lint: board sạch");
            }
            for i in issues {
                println!("lint: {i}");
            }
        }
        "add" => {
            let from = who;
            let text = words.join(" ");
            let (t, dup) = target::add(
                home,
                root,
                &text,
                flag("--check"),
                flag("--label"),
                first,
                from.as_deref(),
                now,
            )?;
            let (_, open) = target::current(home, root)?;
            let sent = if first {
                queue_all(home, &all, now, |name| target::now_prompt(&t, name))
            } else {
                Vec::new()
            };
            let pos = if first { 1 } else { open };
            if as_json {
                let sent: Vec<Value> = sent
                    .iter()
                    .map(|(n, live)| json!({ "name": n, "now": live }))
                    .collect();
                println!(
                    "{}",
                    json!({ "target": t, "position": pos, "open": open, "sent": sent, "dup": dup })
                );
                return Ok(());
            }
            if dup {
                println!("đã có card #{} ({}): ghi thêm một dòng, không tạo trùng", t.id, t.lane);
            } else {
                println!(
                    "đích #{} vào cột {}, vị trí {pos}/{open}: {}",
                    t.id,
                    t.lane,
                    short(&t.text)
                );
                if t.lane == "backlog" {
                    println!("chưa có --check: lead/ba viết AC + một lệnh check rồi chuyển sang ready.");
                }
            }
            if first && sent.is_empty() {
                println!("--now: dự án này chưa có phòng nào (`8sync ccc . <tên>` để mở).");
            }
            for (name, live) in &sent {
                println!("gửi ngay → {name}: {}", delivery(*live));
            }
            if !running(home) {
                println!("auto đang tắt: đích chờ trong hàng tới khi `8sync ccc auto on --here --loop` (hoặc gửi ngay bằng --now).");
            }
        }
        "queue" => {
            if !words.is_empty() {
                bail!("không rõ `{}`\n{USAGE}", words[0]);
            }
            let all = target::list(home, root)?;
            if as_json {
                println!("{}", json!({ "targets": all }));
                return Ok(());
            }
            // `queue` is the history view; `board` shows the lanes.
            if all.is_empty() {
                println!("hàng đích trống. Thêm: `8sync ccc auto add \"<việc>\"` (--now để gửi ngay mọi phòng).");
            }
            let mut first_open = true;
            for t in &all {
                let mark = match t.state.as_str() {
                    "open" if std::mem::take(&mut first_open) => "▶",
                    "open" => " ",
                    "done" => "✓",
                    _ => "✗",
                };
                let lane = if t.state == "open" { format!(" [{}]", t.lane) } else { String::new() };
                let mut line = format!("{mark} #{}{lane} {}", t.id, short(&t.text));
                if let Some(c) = &t.check {
                    line.push_str(&format!("  [check: {c}]"));
                }
                if let Some(e) = &t.evidence {
                    line.push_str(&format!(" — {e}"));
                }
                if let Some(b) = &t.by {
                    line.push_str(&format!(" ({b})"));
                }
                if let Some(f) = &t.from {
                    line.push_str(&format!(" · thêm bởi phòng {f}"));
                }
                println!("{line}");
            }
        }
        _ => {
            let id = id()?;
            let evidence = flag("--evidence");
            if verb == "done" && evidence.is_none() {
                bail!("done cần --evidence \"<lệnh: kết quả>\"\n{USAGE}");
            }
            let (t, next) = target::close(home, root, id, evidence, who.as_deref(), now)?;
            if as_json {
                println!("{}", json!({ "closed": t, "next": next }));
                return Ok(());
            }
            let who =
                t.by.as_deref()
                    .map(|b| format!(" ({b})"))
                    .unwrap_or_default();
            let what = if t.state == "done" {
                "xong"
            } else {
                "đã bỏ"
            };
            println!("đích #{} {what}{who}: {}", t.id, short(&t.text));
            println!("{}", next_line(&next));
        }
    }
    Ok(())
}

/// `auto wait`: a room with an empty lane blocks here (no tokens) until work arrives.
pub(super) const WAIT_DEFAULT_S: u64 = 540;
/// Under Claude Code's 10-minute Bash tool ceiling.
const WAIT_MAX_S: u64 = 590;
const WAIT_POLL_S: u64 = 2;

#[derive(Debug, PartialEq)]
struct Wait {
    room: String,
    lane: String,
    timeout: u64,
}

fn parse_wait(args: &[String], rooms: impl FnOnce() -> Vec<(String, String)>) -> Result<Wait> {
    let (mut lane, mut who, mut timeout) = (None, None, WAIT_DEFAULT_S);
    let mut it = args.iter();
    while let Some(a) = it.next() {
        let mut value = || it.next().filter(|v| !v.starts_with("--")).cloned().ok_or_else(|| anyhow::anyhow!("{a} cần một giá trị\n{USAGE}"));
        match a.as_str() {
            "--json" => {}
            "--lane" => lane = Some(value()?),
            "--as" => who = Some(value()?),
            "--timeout" => {
                timeout = value()?.parse::<u64>().ok().filter(|s| (1..=WAIT_MAX_S).contains(s)).ok_or_else(|| anyhow::anyhow!("--timeout: 1..{WAIT_MAX_S} giây\n{USAGE}"))?
            }
            x => bail!("không rõ `{x}`\n{USAGE}"),
        }
    }
    let Some(room) = who.or_else(|| me(&rooms())) else {
        bail!("wait chạy trong một phòng (`8sync ccc auto up`), hoặc thêm --as <phòng>\n{USAGE}");
    };
    let lane = match lane.or_else(|| super::room::find(&room).and_then(|r| r.lane).map(str::to_string)) {
        Some(l) if target::LANES.contains(&l.as_str()) && !matches!(l.as_str(), "building" | "approved") => l,
        Some(l) => bail!("cột `{l}` không chờ được: backlog, ready, qa, review, blocked"),
        None => bail!("phòng `{room}` không có cột riêng: thêm --lane"),
    };
    Ok(Wait { room, lane, timeout })
}

/// Block until the room has a card in its lane, auto stops (off, paused, cap) or the timeout ends.
/// Clock, sleep and reads are injected so the loop is tested without waiting.
fn wait_for(
    w: &Wait,
    cards: impl Fn() -> Result<Vec<target::Target>>,
    status: impl Fn(u64) -> Value,
    now: impl Fn() -> u64,
    sleep: impl Fn(),
) -> Result<Value> {
    let start = now();
    loop {
        let t = now();
        let st = status(t);
        // A subscription lease that ran out (or never started) ends the room's work like `off`: the
        // rail is "lease ≤ 4 h, while the owner is around" (idle::gate).
        let lease_over = st["gate"].as_str().is_some_and(|g| g.contains("lease"));
        let wake = if st["on"] != true || st["paused"] == true || lease_over {
            Some(("off", None))
        } else if !st["cap"].is_null() {
            Some(("cap", None))
        } else if let Some(id) = target::claimable(&cards()?, &w.room, &w.lane, t) {
            Some(("card", Some(id)))
        } else if t.saturating_sub(start) >= w.timeout {
            Some(("timeout", None))
        } else {
            None
        };
        if let Some((why, card)) = wake {
            return Ok(json!({ "wake": why, "card": card, "room": w.room, "lane": w.lane, "waited_s": t.saturating_sub(start), "cap": st["cap"] }));
        }
        sleep();
    }
}

fn wait_text(v: &Value) -> String {
    let lane = v["lane"].as_str().unwrap_or("?");
    match v["wake"].as_str() {
        Some("card") => format!("card #{} ở cột {lane}: `8sync ccc auto claim`", v["card"]),
        Some("off") => "auto đã tắt hoặc tạm dừng: dừng, không claim nữa".into(),
        Some("cap") => format!("chạm trần ({}): nghỉ, không claim", v["cap"].as_str().unwrap_or("")),
        _ => format!("cột {lane} vẫn trống sau {} giây: chờ tiếp (`8sync ccc auto wait`)", v["waited_s"]),
    }
}

pub(super) fn run(
    rest: &[String],
    home: &Path,
    subscription: bool,
    root: &Path,
    rooms: impl FnOnce() -> Vec<(String, String)>,
) -> Result<()> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs());
    let known = |allowed: &[&str]| -> Result<()> {
        let mut it = rest.iter().skip(1);
        while let Some(a) = it.next() {
            match a.as_str() {
                f @ ("--json" | "--here" | "--team") if allowed.contains(&f) => {}
                "--loop" if allowed.contains(&"--loop") => {
                    if it.clone().next().is_some_and(|v| !v.starts_with("--")) {
                        it.next();
                    }
                }
                f if allowed.contains(&f) => {
                    it.next();
                }
                x => bail!("không rõ `{x}`\n{USAGE}"),
            }
        }
        Ok(())
    };
    if let Some(verb @ ("add" | "queue" | "done" | "drop" | "claim" | "move" | "note" | "board" | "lint")) = rest.first().map(String::as_str) {
        return run_target(verb, &rest[1..], home, root, rooms, now);
    }
    if rest.first().map(String::as_str) == Some("wait") {
        let w = parse_wait(&rest[1..], rooms)?;
        let clock = || std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs());
        let v = wait_for(
            &w,
            || target::list(home, root),
            |t| status(home, subscription, t),
            clock,
            || std::thread::sleep(std::time::Duration::from_secs(WAIT_POLL_S)),
        )?;
        if rest.iter().any(|a| a == "--json") {
            println!("{v}");
        } else {
            println!("{}", wait_text(&v));
        }
        return Ok(());
    }
    let mut looped = None;
    let mut aim = None;
    let v = match rest.first().map(String::as_str) {
        Some("on") => {
            known(&[
                "--hours",
                "--after",
                "--usd-per-hour",
                "--here",
                "--loop",
                "--team",
                "--target",
                "--check",
            ])?;
            let goal = num(rest, "--target")?;
            let check = num(rest, "--check")?;
            if check.is_some() && goal.is_none() {
                bail!("--check đi cùng --target\n{USAGE}");
            }
            if let Some(g) = &goal {
                // Fail before auto turns on: an empty target or a broken queue file.
                if g.trim().is_empty() {
                    bail!("--target rỗng\n{USAGE}");
                }
                target::current(home, root)?;
            }
            aim = goal.map(|g| (g, check));
            let every = match rest.iter().position(|a| a == "--loop") {
                Some(i) => Some(match rest.get(i + 1).filter(|v| !v.starts_with("--")) {
                    Some(v) => parse_every(v)?,
                    None => DEFAULT_LOOP_MIN,
                }),
                None => None,
            };
            let team = rest.iter().any(|a| a == "--team");
            if team && every.is_none() {
                bail!("--team đi cùng --loop\n{USAGE}");
            }
            looped = every.map(|e| (e, team));
            let hours = match num(rest, "--hours")? {
                Some(h) => h
                    .parse::<f64>()
                    .map_err(|_| anyhow::anyhow!("--hours cần một số\n{USAGE}"))?,
                None => idle::DEFAULT_HOURS as f64,
            };
            let rate = match num(rest, "--usd-per-hour")? {
                Some(r) => Some(
                    r.parse::<f64>()
                        .map_err(|_| anyhow::anyhow!("--usd-per-hour cần một số\n{USAGE}"))?,
                ),
                None => None,
            };
            let after = match num(rest, "--after")? {
                Some(a) => delegate::parse_after(&a)?,
                None => DEFAULT_AFTER_S,
            };
            let repo = if rest.iter().any(|a| a == "--here") {
                let cwd = std::env::current_dir()?;
                Some(crate::verbs::here::detect_project_root(&cwd).unwrap_or(cwd))
            } else {
                None
            };
            set(
                home,
                Mode::On {
                    hours,
                    after,
                    rate,
                    repo,
                },
                subscription,
                now,
            )?
        }
        Some(x @ ("off" | "pause")) => {
            known(&[])?;
            set(
                home,
                if x == "pause" { Mode::Pause } else { Mode::Off },
                subscription,
                now,
            )?
        }
        Some("status") | None => {
            known(&["--json"])?;
            status(home, subscription, now)
        }
        Some(x) => bail!("không rõ `{x}`\n{USAGE}"),
    };
    let mut v = v;
    // `on --target` puts the target first, so the first tick of every room already works on it.
    let all = if aim.is_some() || looped.is_some() {
        rooms()
    } else {
        Vec::new()
    };
    if let (Some((goal, check)), Some(true)) = (&aim, v["on"].as_bool()) {
        target::add(
            home,
            root,
            goal,
            check.as_deref(),
            None,
            true,
            me(&all).as_deref(),
            now,
        )?;
    }
    // A broken targets.json must not break the stop check every tick runs on this output.
    match target::current(home, root) {
        Ok((t, open)) => {
            v["target"] = target::json(t.as_ref());
            v["queue"] = json!(open);
        }
        Err(e) => {
            v["target"] = Value::Null;
            v["target_error"] = json!(e.to_string());
        }
    }
    // Only once auto is really on: a loop queued while the rails hold would delete itself anyway.
    // loop.md first: the rooms read it on their first tick.
    let queued = match looped {
        Some((every, team)) if v["on"].as_bool() == Some(true) => {
            let md = write_loop_md(root)?;
            Some((every, md, queue_loops(home, &all, every, team, now)))
        }
        _ => None,
    };
    if rest.iter().any(|a| a == "--json") {
        if let Some((every, (md, written), q)) = &queued {
            v["loop"] = json!({
                "every_min": every,
                "cron": cron_expr(*every),
                "loop_md": md.to_string_lossy(),
                "loop_md_written": written,
                "rooms": q.iter().map(|(n, live)| json!({ "name": n, "now": live })).collect::<Vec<_>>(),
            });
        }
        println!("{v}");
    } else {
        println!("{}", text(&v));
        if let Some(id) = v["target"]["id"].as_u64() {
            println!(
                "đích: #{id} {} ({} trong hàng; `8sync ccc auto queue`)",
                short(v["target"]["text"].as_str().unwrap_or("")),
                v["queue"]
            );
        }
        if let Some(e) = v["target_error"].as_str() {
            println!("hàng đích: {e}");
        }
        if rest.first().map(String::as_str) == Some("on") {
            println!("Vẫn hỏi owner: Ship, secret/login, xoá/không hoàn tác, tiền, deploy prod, merge/release, high-risk. Cần hook mới: `8sync ccc kit` rồi mở session mới.");
            if v["repo"].is_null() {
                println!("Áp dụng cho mọi session ở mọi dự án trên máy này, kể cả session mở sau. Chỉ một dự án: chạy `8sync ccc auto on --here` trong thư mục dự án đó.");
            }
            if subscription && queued.is_none() {
                println!("Login subscription: lease ≤ 4 giờ, chỉ chạy khi owner có mặt. Chạy không người trông → Console API key.");
            }
        }
        if let Some((every, (md, written), q)) = &queued {
            let md = md.display();
            if *written {
                println!(
                    "đã ghi {md}: playbook mọi phòng đọc mỗi nhịp; sửa file là đổi việc từ nhịp kế"
                );
            } else {
                println!("giữ {md} đang có (không ghi đè)");
            }
            if q.is_empty() {
                println!("--loop: dự án này chưa có phòng nào (`8sync ccc . <tên>` để mở).");
            }
            for (name, live) in q {
                let when = if *live {
                    "vào ngay khi phòng rảnh"
                } else {
                    "vào khi phòng xong lượt kế (chưa nạp mod inbox)"
                };
                println!("loop {every} phút → {name}: {when}");
            }
            if !q.is_empty() {
                for l in loop_notes(subscription) {
                    println!("{l}");
                }
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn home(tag: &str) -> PathBuf {
        let h = std::env::temp_dir().join(format!("8sync-auto-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&h);
        std::fs::create_dir_all(&h).unwrap();
        h
    }
    fn on(hours: f64, after: u64) -> Mode {
        Mode::On {
            hours,
            after,
            rate: Some(5.0),
            repo: None,
        }
    }

    #[test]
    fn here_limits_auto_to_one_project_and_pause_clears_it() {
        let h = home("here");
        let repo = h.join("proj");
        let other = h.join("proj-2");
        for d in [repo.join("src"), other.clone()] {
            std::fs::create_dir_all(&d).unwrap();
        }
        let s = |p: &Path| p.to_string_lossy().into_owned();
        let here = |r: &Path| Mode::On {
            hours: 2.0,
            after: 60,
            rate: Some(5.0),
            repo: Some(r.to_path_buf()),
        };
        // nothing on, or on without --here: every project
        assert!(in_scope(&h, Some(&s(&other))) && in_scope(&h, None));
        set(&h, on(2.0, 60), false, 1).unwrap();
        assert!(in_scope(&h, Some(&s(&other))) && status(&h, false, 1)["repo"].is_null());
        assert!(text(&status(&h, false, 1)).contains("mọi dự án"));
        let v = set(&h, here(&repo), false, 2).unwrap();
        assert!(
            v["repo"].as_str().is_some_and(|r| r.ends_with("proj")),
            "{v}"
        );
        assert!(text(&v).contains("chỉ dự án") && !text(&v).contains(r"\\?\"));
        assert!(in_scope(&h, Some(&s(&repo))));
        assert!(
            in_scope(&h, Some(&s(&repo.join("src")))),
            "subfolder / worktree in the repo"
        );
        assert!(
            !in_scope(&h, Some(&s(&other))),
            "sibling sharing a name prefix"
        );
        assert!(!in_scope(&h, None) && !in_scope(&h, Some("relative/path")));
        // the critic answers only in the scoped project (after 60 s: owner silent for years)
        let tp = h.join("t.jsonl");
        std::fs::write(&tp, json!({ "type": "user", "timestamp": "2020-01-01T00:00:00Z", "message": { "role": "user", "content": "làm tiếp" } }).to_string() + "\n").unwrap();
        let ask = |cwd: &Path| {
            json!({ "tool_name": "AskUserQuestion", "cwd": cwd, "transcript_path": tp,
            "tool_input": { "questions": [{ "header": "UI", "question": "Màu nút?", "options": [{ "label": "Lime" }, { "label": "Blue" }] }] } }).to_string()
        };
        if std::env::var("EIGHTSYNC_DELEGATE").is_err() {
            assert!(
                delegate::hook(&ask(&repo), &h).is_some(),
                "inside the scoped project"
            );
        }
        assert!(
            delegate::hook(&ask(&other), &h).is_none(),
            "another project asks its owner"
        );
        // a real checkout, cwd written the way Claude Code sends it (no `\\?\`, native separators)
        let crate_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
        set(&h, here(crate_dir), false, 3).unwrap();
        assert!(
            in_scope(&h, Some(&s(&crate_dir.join("src")))),
            "{}",
            status(&h, false, 3)
        );
        assert!(!in_scope(&h, Some(&s(&repo))));
        // a plain `on` widens it again; `pause` drops it
        set(&h, on(2.0, 60), false, 3).unwrap();
        assert!(in_scope(&h, Some(&s(&other))));
        set(&h, here(&repo), false, 4).unwrap();
        set(&h, Mode::Pause, false, 5).unwrap();
        assert!(in_scope(&h, Some(&s(&other))) && status(&h, false, 5)["repo"].is_null());
        let _ = std::fs::remove_dir_all(&h);
    }

    #[test]
    fn on_writes_all_three_states_and_status_reports_on() {
        let h = home("on");
        let v = set(&h, on(2.0, 60), false, 1000).unwrap();
        assert_eq!(
            (
                v["on"].clone(),
                v["idle"].clone(),
                v["delegate"].clone(),
                v["paused"].clone()
            ),
            (json!(true), json!(true), json!(true), json!(false))
        );
        assert_eq!(v["after_s"], 60);
        assert!(v["lease_until"].as_u64().unwrap() > 0 && v["gate"].is_null());
        let m = idle::read_json(&marker(&h)).unwrap();
        assert_eq!(
            (
                m["schema"].clone(),
                m["on"].clone(),
                m["since"].clone(),
                m["hours"].clone(),
                m["after_s"].clone()
            ),
            (json!(1), json!(true), json!(1000), json!(2.0), json!(60))
        );
        assert!(idle::enabled(&h) && delegate::enabled(&h));
        assert_eq!(status(&h, false, 1000)["on"], true);
        assert!(
            text(&v).starts_with("auto: ĐANG CHẠY liên tục · lease tới ")
                && text(&v).contains("critic trả lời sau 60 s")
        );
        let _ = std::fs::remove_dir_all(&h);
    }

    #[test]
    fn hand_off_switch_counts_as_paused_and_hand_on_counts_as_manual() {
        let h = home("hand");
        set(&h, on(2.0, 60), false, 1).unwrap();
        idle::off(&h).unwrap();
        let v = status(&h, false, 2);
        assert_eq!(
            (v["on"].clone(), v["paused"].clone(), v["manual"].clone()),
            (json!(false), json!(true), json!(false))
        );
        assert_eq!(text(&v), "auto: TẠM DỪNG (owner)");
        set(&h, Mode::Off, false, 3).unwrap();
        delegate::on(&h, 300).unwrap();
        let v = status(&h, false, 4);
        assert_eq!(
            (v["on"].clone(), v["paused"].clone(), v["manual"].clone()),
            (json!(false), json!(false), json!(true))
        );
        assert!(text(&v).starts_with("auto: TẮT (idle/delegate đang bật tay"));
        mark_paused(&h, 5).unwrap();
        let v = status(&h, false, 6);
        assert_eq!(
            (v["paused"].clone(), v["manual"].clone()),
            (json!(true), json!(true))
        );
        let _ = std::fs::remove_dir_all(&h);
    }

    #[test]
    fn marker_write_failure_is_an_error_not_a_silent_success() {
        let h = home("ro");
        // The marker's parent path is a FILE, so create_dir_all / write must fail.
        let dir = marker(&h).parent().unwrap().to_path_buf();
        std::fs::create_dir_all(dir.parent().unwrap()).unwrap();
        std::fs::write(&dir, "not a dir").unwrap();
        assert!(mark_paused(&h, 1).is_err());
        assert!(set(&h, Mode::Pause, false, 1).is_err());
        let _ = std::fs::remove_dir_all(&h);
    }

    #[test]
    fn pause_turns_both_off_and_keeps_paused_off_clears_it() {
        let h = home("pause");
        set(&h, on(2.0, 60), false, 1).unwrap();
        for _ in 0..2 {
            let v = set(&h, Mode::Pause, false, 2).unwrap();
            assert_eq!(
                (
                    v["on"].clone(),
                    v["idle"].clone(),
                    v["delegate"].clone(),
                    v["paused"].clone()
                ),
                (json!(false), json!(false), json!(false), json!(true))
            );
            assert!(v["lease_until"].is_null());
            assert_eq!(text(&v), "auto: TẠM DỪNG (owner)");
        }
        let v = set(&h, Mode::Off, false, 3).unwrap();
        assert_eq!(
            (v["on"].clone(), v["paused"].clone()),
            (json!(false), json!(false))
        );
        assert_eq!(text(&v), "auto: TẮT");
        assert_eq!(
            set(&h, Mode::Off, false, 4).unwrap()["paused"],
            false,
            "idempotent"
        );
        let _ = std::fs::remove_dir_all(&h);
    }

    #[test]
    fn invalid_input_bails_and_leaves_nothing() {
        let h = home("bad");
        for (hours, after) in [(0.0, 60), (25.0, 60), (2.0, 0), (2.0, 90_000)] {
            assert!(
                set(&h, on(hours, after), false, 1).is_err(),
                "{hours} {after}"
            );
        }
        assert!(!marker(&h).exists() && !idle::state_dir(&h).join("lease.json").exists());
        assert!(!idle::enabled(&h) && !delegate::enabled(&h));
        assert!(delegate::parse_after("0").is_err() && delegate::parse_after("x").is_err());
        assert_eq!(delegate::parse_after("1m").unwrap(), 60);
        let _ = std::fs::remove_dir_all(&h);
    }

    #[test]
    fn subscription_caps_the_lease_at_four_hours() {
        let h = home("sub");
        let e = set(&h, on(8.0, 60), true, 1).unwrap_err().to_string();
        assert!(e.contains("tối đa"), "{e}");
        assert!(!marker(&h).exists() && !idle::enabled(&h) && !delegate::enabled(&h));
        let v = set(&h, on(4.0, 60), true, 1).unwrap();
        assert_eq!(
            (v["on"].clone(), v["subscription"].clone()),
            (json!(true), json!(true))
        );
        let _ = std::fs::remove_dir_all(&h);
    }

    #[test]
    fn json_shape_is_stable() {
        let h = home("shape");
        let v = status(&h, false, 1);
        let mut keys: Vec<_> = v.as_object().unwrap().keys().cloned().collect();
        keys.sort();
        assert_eq!(
            keys,
            [
                "after_s",
                "cap",
                "delegate",
                "five_hour_pct",
                "gate",
                "idle",
                "lease_until",
                "manual",
                "on",
                "paused",
                "repo",
                "schema",
                "seven_day_pct",
                "subscription"
            ]
        );
        assert_eq!(
            (
                v["schema"].clone(),
                v["on"].clone(),
                v["lease_until"].clone(),
                v["gate"].clone()
            ),
            (json!(1), json!(false), Value::Null, Value::Null)
        );
        // subscription without a lease reports the gate reason
        assert!(status(&h, true, 1)["gate"]
            .as_str()
            .unwrap()
            .contains("lease"));
        let _ = std::fs::remove_dir_all(&h);
    }

    #[test]
    fn run_rejects_unknown_arguments() {
        let h = home("args");
        let s = |a: &[&str]| a.iter().map(|x| x.to_string()).collect::<Vec<_>>();
        assert!(run(&s(&["on", "--bogus"]), &h, false, &h, Vec::new).is_err());
        assert!(run(&s(&["on", "--hours"]), &h, false, &h, Vec::new).is_err());
        assert!(run(&s(&["on", "--after", "0"]), &h, false, &h, Vec::new).is_err());
        assert!(run(&s(&["wat"]), &h, false, &h, Vec::new).is_err());
        assert!(run(&s(&["off", "--here"]), &h, false, &h, Vec::new).is_err());
        assert!(
            run(&s(&["on", "--team"]), &h, false, &h, Vec::new).is_err(),
            "--team needs --loop"
        );
        assert!(run(&s(&["on", "--loop", "0m"]), &h, false, &h, Vec::new).is_err());
        assert!(
            run(&s(&["on", "--check", "pnpm test"]), &h, false, &h, Vec::new).is_err(),
            "--check needs --target"
        );
        assert!(run(&s(&["on", "--target", " "]), &h, false, &h, Vec::new).is_err());
        assert!(run(&s(&["add"]), &h, false, &h, Vec::new).is_err());
        assert!(run(
            &s(&["add", "x", "--evidence", "y"]),
            &h,
            false,
            &h,
            Vec::new
        )
        .is_err());
        assert!(
            run(&s(&["done", "1"]), &h, false, &h, Vec::new).is_err(),
            "done needs evidence"
        );
        assert!(run(&s(&["drop", "abc"]), &h, false, &h, Vec::new).is_err());
        assert!(run(&s(&["queue", "x"]), &h, false, &h, Vec::new).is_err());
        assert!(!marker(&h).exists());
        let _ = std::fs::remove_dir_all(&h);
    }

    #[test]
    fn loop_interval_parses_minutes_and_hours() {
        assert_eq!(parse_every("10").unwrap(), 10);
        assert_eq!(parse_every("10m").unwrap(), 10);
        assert_eq!(parse_every("2h").unwrap(), 120);
        assert_eq!(parse_every("59m").unwrap(), 59);
        assert_eq!(parse_every("24h").unwrap(), 1440);
        // 90 minutes has no clean cron step.
        for bad in ["0", "0m", "25h", "x", "", "-5m", "90m", "90"] {
            assert!(parse_every(bad).is_err(), "{bad}");
        }
        assert_eq!(cron_expr(10), "*/10 * * * *");
        assert_eq!(cron_expr(120), "0 */2 * * *");
        assert_eq!(cron_expr(1440), "0 0 * * *");
    }

    #[test]
    fn loop_notes_tell_bg_from_a_terminal_and_name_the_unattended_route() {
        let api = loop_notes(false).join("\n");
        // Claude Code never waits out a usage limit in a background session or for a teammate.
        assert!(api.contains("Phòng /bg và teammate không tự chờ"), "{api}");
        assert!(
            api.contains("phòng mở trong terminal tự chờ reset"),
            "{api}"
        );
        // A /bg room picking up on the next tick after reset is inferred, not documented: no promise.
        assert!(api.contains("có thể chạy tiếp") && !api.contains("sẽ thử lại"), "{api}");
        assert!(!api.contains("Login subscription"), "{api}");
        let sub = loop_notes(true).join("\n");
        // The unattended routes Claude Code documents (scheduled-tasks#limitations); a routine runs
        // "without stopping for approval" and outside the 8sync rails (docs/en/routines).
        for want in [
            "Routines (/schedule",
            "không hỏi quyền",
            "Desktop scheduled task",
            "Console API key",
            "không người trông",
        ] {
            assert!(sub.contains(want), "missing {want}: {sub}");
        }
    }

    #[test]
    fn each_lane_room_claims_its_card_and_moves_it_on() {
        for (room, lane, next) in [
            ("lead", "backlog", "move <id> ready --check"),
            ("ba", "backlog", "--match-head-commit <sha>"),
            ("dev", "ready", "move <id> qa --pr <số>"),
            ("qc", "qa", "move <id> review"),
            ("critic", "review", "move <id> approved --sha"),
        ] {
            let p = loop_prompt(room, 10, false);
            assert!(p.contains(&format!("`8sync ccc auto claim --json` (cột {lane}")), "{room}: {p}");
            assert!(p.contains(next), "{room} misses {next}: {p}");
            assert!(p.find("auto claim").unwrap() < p.find("`target` khác null").unwrap(), "card before the queue head");
            assert!(!p.contains('\n') || p.lines().count() <= 3);
        }
        let rd = loop_prompt("rd", 10, false);
        assert!(rd.contains("Vai không giữ cột board") && !rd.contains("auto claim"));
        // merging stays behind the owner's Ship answer, in the cron prompt and in loop.md
        assert!(loop_prompt("lead", 10, false).contains("owner chưa trả lời Ship"));
        assert!(LOOP_MD.contains("MỘT câu hỏi Ship cho owner, duyệt rồi mới `gh pr merge"));
        assert!(LOOP_MD.contains("khi owner chưa trả lời Ship"));
    }

    #[test]
    fn wait_blocks_until_a_card_reaches_the_lane_or_auto_stops() {
        use std::cell::Cell;
        let a = |s: &[&str]| s.iter().map(|x| x.to_string()).collect::<Vec<_>>();
        let rooms = || vec![("dev".to_string(), "id".to_string())];
        // lane from the room's role; --as / --lane / --timeout override; bad values refused
        assert_eq!(parse_wait(&a(&["--as", "dev"]), rooms).unwrap(), Wait { room: "dev".into(), lane: "ready".into(), timeout: WAIT_DEFAULT_S });
        assert_eq!(parse_wait(&a(&["--as", "x", "--lane", "qa", "--timeout", "30"]), rooms).unwrap().lane, "qa");
        for bad in [&["--as", "dev", "--timeout", "0"][..], &["--as", "dev", "--timeout", "600"], &["--as", "dev", "--lane", "building"], &["--as", "rd"], &["--as"]] {
            assert!(parse_wait(&a(bad), rooms).is_err(), "{bad:?}");
        }
        let card = |id: u64, lane: &str| target::Target {
            id,
            text: "t".into(),
            check: Some("true".into()),
            added: 0,
            from: None,
            state: "open".into(),
            closed: None,
            evidence: None,
            by: None,
            lane: lane.into(),
            label: None,
            claim: None,
            notes: vec![],
            bounces: 0,
            pr: None,
            sha: None,
        };
        let w = Wait { room: "dev".into(), lane: "ready".into(), timeout: 60 };
        let on = json!({ "on": true, "paused": false, "cap": null });
        // the card shows up on the third poll; every poll sleeps once (no real waiting in the test)
        let (clock, polls) = (Cell::new(1_000u64), Cell::new(0));
        let cards = || {
            polls.set(polls.get() + 1);
            Ok(if polls.get() >= 3 { vec![card(4, "backlog"), card(7, "ready")] } else { vec![card(4, "backlog")] })
        };
        let v = wait_for(&w, cards, |_| on.clone(), || clock.get(), || clock.set(clock.get() + 2)).unwrap();
        assert_eq!((v["wake"].as_str(), v["card"].as_u64(), v["waited_s"].as_u64()), (Some("card"), Some(7), Some(4)));
        assert!(wait_text(&v).contains("card #7"));
        // auto paused or capped: wake at once, never claim
        let paused = json!({ "on": true, "paused": true, "cap": null });
        assert_eq!(wait_for(&w, || Ok(vec![card(7, "ready")]), |_| paused.clone(), || 5, || {}).unwrap()["wake"], "off");
        let expired = json!({ "on": true, "paused": false, "cap": null, "gate": "gói subscription: lease hết hạn (owner vắng) — gia hạn `8sync ccc idle on`" });
        assert_eq!(wait_for(&w, || Ok(vec![card(7, "ready")]), |_| expired.clone(), || 5, || {}).unwrap()["wake"], "off", "the 4 h lease ends the room's work");
        let away = json!({ "on": true, "paused": false, "cap": null, "gate": "owner vắng: không có prompt do người gõ trong session lead 20 phút qua" });
        assert_eq!(wait_for(&w, || Ok(vec![card(7, "ready")]), |_| away.clone(), || 5, || {}).unwrap()["wake"], "card", "owner typing is the idle hook's rail, not the room's");
        let capped = json!({ "on": true, "paused": false, "cap": "cửa sổ 5 giờ 92%" });
        assert_eq!(wait_for(&w, || Ok(vec![]), |_| capped.clone(), || 5, || {}).unwrap()["wake"], "cap");
        // nothing arrives: timeout
        let clock = Cell::new(0u64);
        let v = wait_for(&w, || Ok(vec![]), |_| on.clone(), || clock.get(), || clock.set(clock.get() + 2)).unwrap();
        assert_eq!((v["wake"].as_str(), v["waited_s"].as_u64()), (Some("timeout"), Some(60)));
        assert!(wait_text(&v).contains("chờ tiếp"));
    }

    #[test]
    fn loop_prompt_sets_one_self_stopping_loop_per_room() {
        let p = loop_prompt("rd-su-code", 15, false);
        for want in [
            LOOP_TAG,
            "CronList",
            "CronCreate",
            "*/15 * * * *",
            "15 phút",
            "auto status --json",
            "CronDelete",
            "Ship",
            "rd-su-code",
            ".claude/loop.md",
            "gia hạn 7 ngày",
        ] {
            assert!(p.contains(want), "missing {want}: {p}");
        }
        // The playbook every tick follows: skills picked by the job, gates before commit.
        for want in [
            "/ship <việc>",
            "karpathy-guidelines",
            "`/sec` + `/rules` + `/aup-audit`",
            "/deep-research",
            "chỉ owner gõ",
            "impeccable",
            "workflows/*.md",
            "8sync ccc meet --say",
            "auto status --json",
            "8sync-auto-loop",
            "Không bao giờ: merge, push main",
        ] {
            assert!(LOOP_MD.contains(want), "loop.md missing {want}");
        }
        // A scheduled fire cannot run owner-only skills (disable-model-invocation), so no route
        // line of the playbook may send a tick to one.
        for l in LOOP_MD.lines().filter(|l| l.contains('→')) {
            let route = l.split('→').nth(1).unwrap_or("");
            for owner_only in [
                "/ship-loop",
                "/ship-auto",
                "/autopilot",
                "/sprint",
                "/loop-me",
            ] {
                assert!(
                    !route.contains(&format!("`{owner_only}")),
                    "tick routed to {owner_only}: {l}"
                );
            }
        }
        assert!(!p.contains("teammate"));
        assert!(loop_prompt("lead", 10, true).contains("rd, qa, reviewer"));
        // Off/pause delete the loop; the $/hour cap only rests a tick (it is an average and clears).
        assert!(p.contains("on=false hoặc paused=true → CronDelete"));
        assert!(p.contains("`cap` khác null → nghỉ nhịp này"));
        assert!(LOOP_MD.contains("`cap` khác null"));
        assert!(!p.contains("gate bắt đầu bằng") && !LOOP_MD.contains("`gate`"));
        let h = home("cap");
        let lease = json!({ "on": 0, "until": 10_000, "usd_per_hour": 5.0, "baseline": {} });
        idle::write_json(&idle::state_dir(&h).join("lease.json"), &lease);
        let d = super::super::report::usage_dir(&h);
        std::fs::create_dir_all(&d).unwrap();
        let snap = json!({ "session_id": "s1", "cost_usd": 99.0, "ts": 1 });
        std::fs::write(d.join("s1.json"), snap.to_string()).unwrap();
        // Past the 4 h subscription lease the gate says "expired", yet the cap still holds.
        let v = status(&h, true, 20_000);
        assert!(v["gate"].as_str().unwrap().contains("lease hết hạn"));
        assert!(v["cap"].as_str().unwrap().starts_with("chạm trần"));
        // An average: with time and no new spend the cap clears by itself.
        assert!(status(&h, true, 99 * 3600)["cap"].is_null());
        assert!(idle::cap(&lease, &idle::Usage::default(), true, 3600).is_ok());
        // Subscription without a $ rate: the window reading decides, and status shows it.
        let sub = json!({ "on": 0, "until": 10_000, "usd_per_hour": null, "baseline": {} });
        idle::write_json(&idle::state_dir(&h).join("lease.json"), &sub);
        let t = 50_000;
        let reading = |pct: u64| json!({ "session_id": "s1", "cost_usd": 99.0, "ts": t - 60, "five_hour_pct": pct }).to_string();
        std::fs::write(d.join("s1.json"), reading(23)).unwrap();
        let v = status(&h, true, t);
        assert!(v["cap"].is_null(), "23% of the window: keep working whatever the $ estimate: {v}");
        assert_eq!(v["five_hour_pct"], json!(23.0));
        std::fs::write(d.join("s1.json"), reading(95)).unwrap();
        assert!(status(&h, true, t)["cap"].as_str().unwrap().contains("cửa sổ 5 giờ"));
        let _ = std::fs::remove_dir_all(&h);
    }

    #[test]
    fn auto_on_loop_queues_one_message_per_room() {
        let h = home("loop");
        let s = |a: &[&str]| a.iter().map(|x| x.to_string()).collect::<Vec<_>>();
        let ids = [
            "a2830544-0719-4d6f-aaa3-644783ddb0b3",
            "b2830544-0719-4d6f-aaa3-644783ddb0b4",
        ];
        let rooms = || {
            vec![
                ("lead".to_string(), ids[0].to_string()),
                ("rd".to_string(), ids[1].to_string()),
            ]
        };
        run(&s(&["on", "--loop", "5m", "--team"]), &h, false, &h, rooms).unwrap();
        for (id, name) in ids.iter().zip(["lead", "rd"]) {
            let f = crate::verbs::hq::inbox_file(&h, id).unwrap();
            let raw = std::fs::read_to_string(&f).unwrap();
            assert_eq!(raw.lines().count(), 1);
            let v: Value = serde_json::from_str(raw.trim()).unwrap();
            let t = v["text"].as_str().unwrap();
            assert!(
                t.contains(&format!("`{name}`"))
                    && t.contains("5 phút")
                    && t.contains("rd, qa, reviewer")
            );
        }
        assert_eq!(
            std::fs::read_to_string(h.join(".claude/loop.md")).unwrap(),
            LOOP_MD
        );
        // Off: no loop is queued (a queued loop would only delete itself) and no loop.md written.
        let h2 = home("loop-off");
        run(&s(&["off"]), &h2, false, &h2, rooms).unwrap();
        assert!(!crate::verbs::hq::inbox_file(&h2, ids[0]).unwrap().exists());
        assert!(!h2.join(".claude/loop.md").exists());
        for d in [h, h2] {
            let _ = std::fs::remove_dir_all(&d);
        }
    }

    #[test]
    fn targets_steer_every_tick_and_now_reaches_every_room() {
        let h = home("target");
        let s = |a: &[&str]| a.iter().map(|x| x.to_string()).collect::<Vec<_>>();
        let ids = [
            "c2830544-0719-4d6f-aaa3-644783ddb0b5",
            "d2830544-0719-4d6f-aaa3-644783ddb0b6",
        ];
        let rooms = || {
            vec![
                ("lead".to_string(), ids[0].to_string()),
                ("qa".to_string(), ids[1].to_string()),
            ]
        };
        let cur = || target::current(&h, &h).unwrap();
        // Queued while auto is off: it waits in line, no room is messaged.
        run(&s(&["add", "write", "docs"]), &h, false, &h, rooms).unwrap();
        assert!(!crate::verbs::hq::inbox_file(&h, ids[0]).unwrap().exists());
        // --now jumps the line and reaches every room's inbox, like ctrl+x ctrl+s.
        let now = ["add", "fix", "login", "--check", "pnpm test", "--now"];
        run(&s(&now), &h, false, &h, rooms).unwrap();
        let (first, open) = cur();
        assert_eq!((first.unwrap().text.as_str(), open), ("fix login", 2));
        for (id, name) in ids.iter().zip(["lead", "qa"]) {
            let f = crate::verbs::hq::inbox_file(&h, id).unwrap();
            let raw = std::fs::read_to_string(&f).unwrap();
            assert_eq!(raw.lines().count(), 1);
            let v: Value = serde_json::from_str(raw.trim()).unwrap();
            let t = v["text"].as_str().unwrap();
            for want in ["đích #2", "`pnpm test` exit 0", &format!("`{name}`")] {
                assert!(t.contains(want), "missing {want}: {t}");
            }
        }
        // `on --target` goes first too; every tick (cron prompt and loop.md) works on the target.
        run(&s(&["on", "--target", "ship v1"]), &h, false, &h, rooms).unwrap();
        let top = cur().0.unwrap();
        assert_eq!(top.text, "ship v1");
        assert!(loop_prompt("lead", 10, false).contains("`target` khác null"));
        assert!(LOOP_MD.contains("auto done <id> --evidence"));
        // done (with evidence) moves the team on; drop takes `#id` as well.
        let id = top.id.to_string();
        let done = ["done", id.as_str(), "--evidence", "cargo test: ok"];
        run(&s(&done), &h, false, &h, rooms).unwrap();
        assert_eq!(cur().0.unwrap().text, "fix login");
        run(&s(&["drop", "#2"]), &h, false, &h, rooms).unwrap();
        let (last, open) = cur();
        assert_eq!((last.unwrap().text.as_str(), open), ("write docs", 1));
        // A target a room queued itself is tagged with that room; the owner's terminal is none.
        assert_eq!(room_of(&rooms(), Some(ids[1])), Some("qa".into()));
        assert_eq!(room_of(&rooms(), Some("")), None);
        assert_eq!(room_of(&rooms(), Some("other")), None);
        let _ = std::fs::remove_dir_all(&h);
    }

    #[test]
    fn loop_md_is_written_once_and_never_overwrites_the_owners_edits() {
        let h = home("loopmd");
        let (p, written) = write_loop_md(&h).unwrap();
        assert!(written && p == h.join(".claude").join("loop.md"));
        std::fs::write(&p, "owner's own loop").unwrap();
        let (_, again) = write_loop_md(&h).unwrap();
        assert!(!again);
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "owner's own loop");
        let _ = std::fs::remove_dir_all(&h);
    }

    #[cfg(unix)]
    #[test]
    fn loop_md_never_follows_a_dangling_symlink() {
        let h = home("loopmd-link");
        std::fs::create_dir_all(h.join(".claude")).unwrap();
        let target = h.join("elsewhere.md");
        std::os::unix::fs::symlink(&target, h.join(".claude/loop.md")).unwrap();
        let (_, written) = write_loop_md(&h).unwrap();
        assert!(!written && !target.exists());
        let _ = std::fs::remove_dir_all(&h);
    }
}
