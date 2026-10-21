//! `8sync ccc auto up [--roles lead,dev,qa,review,rd] [--loop 30m] [--hours N] [--usd-per-hour X] [--omp]`
//! and `auto down`: the whole team in one command, no terminal per room.
//!
//! `up` turns `auto on --here` for the project, then makes sure every role room runs as a Claude
//! Code background session (`claude --bg`, Claude Code 2.1.296: prints `backgrounded · <8-char id>
//! · <name>`; `claude agents --json` lists it; `attach`/`logs`/`stop` take the short id). A room:
//! - already live in `claude agents --json --cwd <root>` (by id, or a background session with the
//!   room's name) only gets the loop message in its inbox, like `auto on --loop`;
//! - stopped with a transcript resumes in the background (`--resume <id> --bg`), which Claude Code
//!   runs under a new forked id: the registry is rebound to it like a new room's;
//! - new starts with `--bg --name <room>`, the room's model ([`super::room::Role::model`]) and the
//!   loop prompt ([`super::auto::loop_prompt`]) as its first message. `--bg` ignores `--session-id`,
//!   so the registry is pointed at the id Claude Code picked ([`ccc_core::registry::Store::rebind`]);
//!   inbox, HQ and the room hook then find it.
//!
//! Auto mode needs a trusted workspace: Claude Code then prints "Workspace not trusted …" and `up`
//! stops and says to open `claude` there once. Rooms run with `--permission-mode auto`, never
//! bypass. `down` stops this project's background rooms (`claude stop`, the conversation is kept)
//! and pauses auto. Progress: `8sync hq ui`, `claude agents`, `8sync ccc auto board`.
//!
//! `up --clear-ss` first deletes this project's junk background sessions (`claude rm`, finished
//! ones included): every background session no team room keeps, i.e. duplicates of a room and
//! leftovers of old runs or dropped rooms, and their registry entries. Interactive sessions (the
//! owner's terminals) are never touched; `claude rm` keeps a worktree with unpushed commits.
//!
//! `up --omp` (or `up` while auto.json's teams has omp) also brings team omp up: one omp room
//! `omp-<role>` per role, detached ([`super::omp_team`]); `down` stops those too.
use std::path::{Path, PathBuf};

use anyhow::{bail, Result};
use ccc_core::registry::Store;
use serde_json::{json, Value};

use super::{auto, idle, room};

/// Rooms one `auto up` starts at most (the `boost` preset is the largest team).
const MAX_ROOMS: usize = 14;

pub(super) const USAGE: &str = "usage: 8sync ccc auto up [\"<việc>\" [--check \"<lệnh>\"]] [--roles lead,dev,qa,review,rd|full|boost] [--loop 30m] [--hours N] [--usd-per-hour X] [--clear-ss] [--omp [--omp-model <provider/model>]] | up --add <phòng> | down [--only <phòng>[,<phòng>…]] | close [--dry-run] [--json] | revive";

/// `auto up …` / `auto down` / `auto close` / `auto revive`: the verbs this module (and
/// [`super::close`]) owns.
pub(super) fn wants(rest: &[String]) -> bool {
    matches!(rest.first().map(String::as_str), Some("up" | "down" | "close" | "revive"))
}

/// Runs `claude <args>` in the project root and returns stdout + stderr.
pub(super) trait Claude {
    fn run(&self, args: &[String]) -> Result<String>;
}

/// The real `claude` binary.
pub(super) struct Bin<'a> {
    pub exe: std::path::PathBuf,
    pub root: &'a Path,
}

impl Claude for Bin<'_> {
    fn run(&self, args: &[String]) -> Result<String> {
        let mut c = std::process::Command::new(&self.exe);
        c.args(args).current_dir(self.root).stdin(std::process::Stdio::null());
        // A room starts below normal priority (its builds, servers and indexers inherit it where it
        // is our child; the resource guard lowers the rest every tick: super::pressure::lower).
        #[cfg(windows)]
        if args.iter().any(|a| a == "--bg") {
            use std::os::windows::process::CommandExt;
            c.creation_flags(0x0000_4000); // BELOW_NORMAL_PRIORITY_CLASS
        }
        let out = c.output()?;
        Ok(format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr)))
    }
}

/// What `up` needs from the outside world; [`Bin`] and the registry in production, fakes in tests.
pub(super) struct Team<'a> {
    pub home: &'a Path,
    pub root: &'a Path,
    pub store: &'a Store,
    pub subscription: bool,
    pub claude: &'a dyn Claude,
    /// Claude Code has a transcript for this conversation id.
    pub has_transcript: &'a dyn Fn(&str) -> bool,
    /// The display name a new room gets (machine-wide clash → `<name>-<repo>`).
    pub title: &'a dyn Fn(&str) -> String,
    /// When the kit last wrote Claude Code's settings (ms): a session reads its hooks once at start,
    /// so a room started before this runs the old hooks until it restarts.
    pub kit_at: Option<u64>,
}

/// A session from `claude agents --json`.
#[derive(Debug, Clone, PartialEq)]
pub(super) struct Live {
    pub id: String,
    pub name: String,
    pub background: bool,
    /// `startedAt` (ms), 0 when Claude Code did not say.
    pub started: u64,
    /// Not `status: idle` (mid-turn, on a prompt, unknown): `--clear-ss` never stops it to reload the kit.
    pub busy: bool,
    /// Where it runs; empty when Claude Code did not say.
    pub cwd: String,
    /// Its process, 0 when Claude Code did not say.
    pub pid: u32,
}

/// `l` runs in the git repo `root` (or one of its worktrees). `claude agents --cwd` also lists the
/// sessions of a repo nested inside it: without this, `auto up` in 8sync-startup took over
/// ai-game-studio's rooms (seen live 2026-10-18). A session that did not say where it runs counts.
pub(super) fn in_repo(l: &Live, root: &Path) -> bool {
    l.cwd.is_empty() || !Path::new(&l.cwd).is_absolute() || crate::verbs::here::repo_of(Path::new(&l.cwd)).is_some_and(|r| auto::canon(&r) == auto::canon(root))
}

/// Names of the live `claude agents --json` sessions running in `root` (rooms HQ reopened with
/// `--resume --fork-session` are not in the registry). A session with no cwd is not counted; a
/// failing `claude` gives none.
pub(super) fn live_names(claude: &dyn Claude, root: &Path) -> Vec<String> {
    let args = ["agents".to_string(), "--json".into(), "--cwd".into(), root.to_string_lossy().into_owned()];
    let all = claude.run(&args).ok().and_then(|j| live(&j).ok()).unwrap_or_default();
    all.into_iter().filter(|l| !l.cwd.is_empty() && !l.name.trim().is_empty() && in_repo(l, root)).map(|l| l.name).collect()
}

pub(super) fn live(json: &str) -> Result<Vec<Live>> {
    let v: Value = serde_json::from_str(json.trim()).map_err(|_| {
        anyhow::anyhow!("`claude agents --json` không trả JSON ({}): cần Claude Code ≥ 2.1.29x", crate::verbs::session_view::truncate(json.trim(), 120))
    })?;
    Ok(v.as_array()
        .into_iter()
        .flatten()
        .filter_map(|a| {
            // ids go back to `claude stop|rm` as an argument: only the UUID alphabet passes.
            let id = a["sessionId"].as_str().filter(|s| (8..=64).contains(&s.len()) && s.chars().all(|c| c.is_ascii_hexdigit() || c == '-'))?;
            Some(Live {
                id: id.to_string(),
                name: a["name"].as_str().unwrap_or_default().to_string(),
                background: a["kind"].as_str() == Some("background"),
                started: a["startedAt"].as_u64().unwrap_or(0),
                // Anything but a plain `idle` (mid-turn, waiting on a prompt, unknown): never stopped to reload.
                busy: a["status"].as_str() != Some("idle"),
                cwd: a["cwd"].as_str().unwrap_or_default().to_string(),
                pid: a["pid"].as_u64().and_then(|p| u32::try_from(p).ok()).unwrap_or(0),
            })
        })
        .collect())
}

/// The short id in `claude --bg` output (`backgrounded · 3698e3a6 · name`).
pub(super) fn short_id(out: &str) -> Option<String> {
    out.lines().filter(|l| l.contains("backgrounded")).find_map(|l| {
        let id = l.split('·').nth(1)?.trim();
        (6..=36).contains(&id.len()).then_some(())?;
        id.chars().all(|c| c.is_ascii_hexdigit() || c == '-').then(|| id.to_string())
    })
}

pub(super) fn untrusted(out: &str) -> bool {
    out.to_lowercase().contains("not trusted")
}

#[derive(Debug, Clone, PartialEq)]
pub(super) enum Plan {
    /// Live already: id of the live session (may differ from the registry's).
    Running(String),
    Resume,
    Start,
}

/// `here`: live sessions started in this project; `all`: every live session on the machine. The
/// room's own id counts wherever it runs (a terminal in another folder): resuming it would run
/// one conversation in two processes. A background session with the room's name only counts here.
pub(super) fn plan(reg_id: &str, title: &str, here: &[Live], all: &[Live], has_transcript: bool) -> Plan {
    if let Some(l) = all.iter().chain(here).find(|l| l.id == reg_id).or_else(|| here.iter().find(|l| l.background && l.name == title)) {
        return Plan::Running(l.id.clone());
    }
    if has_transcript {
        Plan::Resume
    } else {
        Plan::Start
    }
}

/// Claude Code caps a `/goal` condition at 4,000 characters (https://code.claude.com/docs/en/goal).
pub(super) const GOAL_MAX: usize = 4000;

/// The first message of a room with a board lane: `/goal <condition>`. Setting a goal starts a turn
/// with the condition as the directive, and Claude Code's evaluator starts the next turn until the
/// condition holds (checked live: `claude --bg … "/goal …"` → "Goal set" … "Goal achieved"). An empty
/// lane is spent in `auto wait` (blocks ≤ 30 min without tokens: [`room_settings`] lifts the Bash
/// cap and `auto wait` reads it, [`auto::wait_default`]), so a turn on an empty lane costs one short
/// turn per 30 min. The goal holds only when auto stops: an "empty lane" exit ended the room's work
/// for good once the backup cron was gone. A card that wakes the wait is worked in the same turn; a
/// new approval (`merge`) sends the lead back to (1). The lead asks the Ship question before it
/// waits ([`auto::BACKLOG_FIRST`]).
pub(super) fn goal_prompt(name: &str, lane: &str, every_min: u64) -> String {
    let (role, duty) = room::role(name);
    let first = if lane == "backlog" { format!("(1b) {} ", auto::BACKLOG_FIRST) } else { String::new() };
    let g = format!(
        "/goal Phòng `{name}` (vai {role}: {duty}) làm việc liên tục cho dự án này qua board `8sync ccc auto`. \
         Lượt đầu, đặt loop dự phòng: {setup} \
         Mỗi lượt: (1) `8sync ccc auto status --json`; {first}(2) `8sync ccc auto claim --json` (cột {lane}); có card thì làm đúng việc cột đó: {playbook}; \
         (3) không có card → `8sync ccc auto wait --json` (Bash timeout {bash_ms}; chặn ≤ {wait_min} phút, không tốn token): `\"wake\":\"card\"` → claim (2) và làm card đó ngay lượt này; `\"wake\":\"merge\"` → quay lại (1); còn lại → kết thúc lượt. \
         Mọi lệnh `8sync ccc auto claim|move|note|wait|add` thêm `--as {name}` (trong worktree 8sync không tự nhận ra phòng). \
         Rail: không merge/push main/tag/deploy khi owner chưa trả lời câu Ship (hoặc chưa cho tự merge); giữ file trước khi sửa (`8sync ccc . goal \"…\" --files a,b`); \
         `8sync ccc meet --say \"done|doing|blocked: …\"` sau mỗi card. \
         `cap` khác null → không claim, chạy `auto wait`. \
         Điều kiện đạt (dừng): trong lượt gần nhất, `auto status --json` cho `on`/`here` false hoặc `paused` true \
         hoặc `gate` nhắc tới lease, hoặc `auto wait --json` trả `\"wake\":\"off\"`.",
        setup = auto::goal_loop_setup(name, every_min),
        playbook = auto::lane_playbook(lane),
        bash_ms = BASH_MAX_MS,
        wait_min = auto::WAIT_MAX_S / 60,
    );
    g.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// The first message of the "Soi ảnh" room ([`room::EYE`]): a `/goal` like a lane room's, but its
/// queue is its inbox. HQ's "Tự soi ảnh" switch sends one `[ảnh mới] card #N …` message per card
/// with new screenshots (apps/hq-ui lib/server/eye.ts); the room blocks in `auto wait --mail`
/// between them (no tokens), reads the card's current AC and notes on the board, looks at every
/// image and writes ONE objective `[soi ảnh]` note (a card note keeps 400 characters); a clear miss
/// also goes to the lead. No cron: [`revive`] brings an idle eye back on its goal like a lane room.
pub(super) fn eye_prompt(name: &str) -> String {
    let (role, duty) = room::role(name);
    let g = format!(
        "/goal Phòng `{name}` (vai {role}: {duty}) soi ảnh preview cho dự án này, thay owner đi comment. \
         Mỗi lượt: (1) `8sync ccc auto status --json`; (2) `8sync ccc auto wait --json --mail --as {name}` (Bash timeout {bash_ms}; chặn ≤ {wait_min} phút, không tốn token): \
         `\"wake\":\"msg\"` → làm từng tin trong `messages` rồi quay lại (1); `\"wake\":\"off\"` → dừng; còn lại → kết thúc lượt. \
         Chỉ làm tin CÓ `[ảnh mới] card #` (đứng sau nhãn người gửi như `[từ phòng terminal]`); tin khác bỏ qua, không trả lời. \
         Mỗi tin đó (card #N …): (a) `8sync ccc auto board --json` → đọc card #N HIỆN TẠI: text, AC/check, mọi note (note của owner mới hơn thắng AC cũ), cột; card đã đóng hoặc không còn trên board → bỏ tin; \
         (b) Read từng ảnh trong tin (đường dẫn tuyệt đối), không bỏ ảnh nào; \
         (c) so khách quan với AC + ý owner mới nhất: chỉ ghi điều THẤY trong ảnh, dẫn tên file ảnh, không khen, không đoán ngoài ảnh; ảnh không cho thấy được một ý → ghi \"không đủ để kết luận\" cho ý đó; \
         (d) ghi MỘT note (≤ 400 ký tự): `8sync ccc auto note N \"[soi ảnh] Đạt: … · Lệch AC: … · Đề xuất: …\" --as {name}`; \
         (e) lệch AC rõ hoặc lỗi hình thấy được (vỡ layout, chữ tràn/cắt, ảnh trắng, sai dữ liệu) → thêm `8sync ccc msg lead \"card #N: <một dòng lỗi> (xem note [soi ảnh])\" --from {name}`. \
         Rail: không sửa file, không git, không `auto claim|move|add|done`, không chạy server/test/build, không hỏi owner. \
         Điều kiện đạt (dừng): trong lượt gần nhất, `auto status --json` cho `on`/`here` false hoặc `paused` true \
         hoặc `gate` nhắc tới lease, hoặc `auto wait --json` trả `\"wake\":\"off\"`.",
        bash_ms = BASH_MAX_MS,
        wait_min = auto::WAIT_MAX_S / 60,
    );
    g.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Where the sweep remembers what it already told a room or the lead, inside the repo's git dir
/// (`git rev-parse --git-common-dir`): one per project, shared by its worktrees, never committed.
pub(super) const SWEEP_SENT: &str = "8sync-sweep-sent.txt";

/// The first message of the "Dọn máy" room ([`room::SWEEP`]): the project's machine and disk
/// cleaner. Event-driven like the eye: it blocks in `auto wait --mail` (no tokens) and a timeout or
/// a cap only ends the turn. It acts on three messages only: HQ's `[máy]` breach (processes only,
/// one `guard --dry-run`; lib/server/guard-trigger.ts), HQ's disk findings (only the items listed,
/// sizes already reclaimable; lib/server/cleanup-loop.ts) and the owner's. Strict rules: only
/// provably safe cleanups, never uncommitted or unpushed work, never another project, %TEMP%
/// copies reported only; each room and the lead hear a thing once ([`SWEEP_SENT`]), the lead only
/// when something was freed.
pub(super) fn sweep_prompt(name: &str) -> String {
    let (role, duty) = room::role(name);
    let g = format!(
        "/goal Phòng `{name}` (vai {role}: {duty}) giữ máy nhẹ cho RIÊNG dự án này: CPU không chạm 60%, RAM/GPU/điện thấp, đĩa không phình rác. \
         Chỉ làm khi có tin, không tự quét định kỳ. Cực nghiêm: chỉ làm điều chắc chắn an toàn; không chắc → để nguyên. \
         Mỗi lượt: (1) `8sync ccc auto status --json`; `cap` khác null → chỉ chạy (2); (2) `8sync ccc auto wait --json --mail --as {name}` (Bash timeout {bash_ms}; chặn ≤ {wait_min} phút, không tốn token): \
         `\"wake\":\"off\"` → dừng; `\"wake\":\"msg\"` → xử lý từng tin trong `messages` theo (3) rồi quay lại (1); còn lại (hết giờ, `\"wake\":\"cap\"`) → kết thúc lượt, không quét gì. \
         (3) Chỉ làm ba loại tin: \
         (a) `[máy] …` của HQ: chỉ xem tiến trình, `8sync ccc auto guard --dry-run` tối đa MỘT lần mỗi lần thức; không git fetch, không gh, không đo đĩa; tiến trình gây tải thuộc phòng/worktree dự án này → nhắn đúng phòng đó. \
         (b) `Dọn dung lượng dự án …` của HQ: chỉ xét đúng các mục tin liệt kê; số trong tin đã là phần xoá lấy lại được (HQ đo 6 giờ/lần), không tự du/đo lại node_modules/target; node_modules của pnpm/bun là hardlink vào store: xoá gần như không lấy lại chỗ → đừng xoá chỉ để lấy chỗ. \
         (c) tin của owner (không phải từ phòng khác): làm trong luật (4). \
         Tin khác (phòng trả lời tin của bạn…) → không quét, không trả lời. \
         (4) Luật: KHÔNG BAO GIỜ xoá việc chưa commit hoặc chưa push. \
         Worktree chỉ gỡ khi đủ cả ba: `git -C <wt> status --porcelain --ignored` không có gì ngoài target/.next/node_modules/dist; nhánh có commit riêng và HEAD = headRefOid của một PR đã MERGED (`gh pr list --state merged --head <nhánh> --json number,headRefOid`); không phòng nào chạy/giữ card trong đó → `git worktree remove <wt>` (không --force). \
         Thư mục build (target/.next/node_modules/dist) chỉ dọn bằng lệnh của công cụ (`cargo clean` đúng thư mục đó…) và chỉ khi không tiến trình phòng nào chạy trong worktree đó. \
         File đã commit lớn: không tự sửa, báo lead đề xuất card `git rm`. \
         Asset/bằng chứng dự án ghi chỉ owner được xoá → hỏi owner bằng AskUserQuestion, không tự xoá. \
         Bản sao trong %TEMP% (`qa-card-*`, `qa-fetch*`) không mang tên dự án: chỉ báo dung lượng, không xoá. \
         Không kill tiến trình, trừ server/watcher còn sót (vite, next dev, cargo watch…) chạy trong worktree của dự án này, sống > 5 phút, không phòng nào dùng: nhắn phòng đó trước; lần thức sau vẫn còn → ngay trước khi dừng kiểm lại cùng PID, tên ảnh, dòng lệnh, cwd trong worktree đó và giờ bắt đầu như lần trước → dừng đúng PID đó (không kill theo tên); khác → không dừng. \
         Không đụng dự án khác; không đổi cài đặt guard. \
         (5) Báo một lần: mỗi điều đã báo ghi một dòng `<phòng>|<mục>` vào `<git-common-dir>/{sent}` (`git rev-parse --git-common-dir`, không commit); dòng đã có → không báo lại. \
         Mỗi phòng bị ảnh hưởng MỘT tin ngắn `8sync ccc msg <phòng> \"…\" --from {name}` có đúng PID/port/đường dẫn + việc cần làm; \
         lead chỉ khi THẬT đã giải phóng chỗ, mỗi mục một lần: `8sync ccc msg lead \"[dọn máy] giải phóng <MB/GB>: …; giữ: … vì …\" --from {name}`; \
         `8sync ccc msg --all \"…\" --from {name}` chỉ cho luật cả team (không copy repo/node_modules ra %TEMP%, tắt vite/server khi xong card, `cargo build -j2`), mỗi luật một lần, nhắc lại chỉ khi tái phạm. \
         Rail: không viết code, không `auto claim|move|add|done`, không move card; không merge/push/tag/deploy; không `git commit|reset|clean -f|checkout|stash`; không chạy build/test. \
         Điều kiện đạt (dừng): trong lượt gần nhất, `auto status --json` cho `on`/`here` false hoặc `paused` true \
         hoặc `gate` nhắc tới lease, hoặc `auto wait --json` trả `\"wake\":\"off\"`.",
        sent = SWEEP_SENT,
        bash_ms = BASH_MAX_MS,
        wait_min = auto::WAIT_MAX_S / 60,
    );
    g.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// The first message a room starts or resumes with: a lane room's, the eye's or the sweep's
/// `/goal`, else the loop message ([`auto::loop_prompt`]).
fn first_prompt(name: &str, lane: Option<&str>, every: u64) -> String {
    match lane {
        Some(lane) => goal_prompt(name, lane, every),
        None if room::is_eye(name) => eye_prompt(name),
        None if room::is_sweep(name) => sweep_prompt(name),
        None => auto::loop_prompt(name, every, false),
    }
}

/// A room that lives on a `/goal`: every lane room, the eye and the sweep.
fn on_goal(name: &str) -> bool {
    room::find(name).is_some_and(|r| r.lane.is_some()) || room::mail_only(name)
}

/// Bash tool ceiling of a room (ms): Claude Code caps a command at 10 min unless
/// `BASH_MAX_TIMEOUT_MS` says more (https://code.claude.com/docs/en/settings#environment-variables),
/// and `auto wait` blocks up to [`auto::WAIT_MAX_S`].
pub(super) const BASH_MAX_MS: u64 = (auto::WAIT_MAX_S + 60) * 1000;

/// Auto-compact window of a team room (tokens). The kit compacts at 65% of the window, and on a 1M
/// model that let rooms grow to 650K: measured on ai-game-studio (2026-10-19, 36 h, 15K API calls)
/// the median call re-read 305K tokens of context, 64% of all input in calls over 300K. 300K moves
/// the trigger to ~195K for rooms only; the owner's own sessions keep the kit's window.
pub(super) const ROOM_WINDOW: u32 = 300_000;

/// The `--settings` file every team room starts with: env that beats the user settings' env for
/// that launch only (checked live: `claude --bg --settings <this>` → the room sees 300000). A `lean`
/// room ([`super::pressure::lean`]) also turns the user's LSP plugins off
/// ([`super::pressure::lean_plugins`]) and denies the indexing MCP servers
/// ([`super::pressure::lean_mcp`]): `room-settings-lean.json`.
pub(super) fn room_settings(home: &Path, lean: bool) -> Result<PathBuf> {
    let (plugins, mcp) = if lean { super::pressure::lean_of(home) } else { (Vec::new(), Vec::new()) };
    room_settings_with(home, &plugins, &mcp)
}

/// [`room_settings`] with the plugins to turn off and the MCP servers to deny given (none = the
/// plain file).
pub(super) fn room_settings_with(home: &Path, plugins: &[String], mcp: &[String]) -> Result<PathBuf> {
    let d = idle::state_dir(home);
    let name = if plugins.is_empty() && mcp.is_empty() { "room-settings.json" } else { "room-settings-lean.json" };
    let f = d.parent().unwrap_or(&d).join(name);
    let mut v = serde_json::json!({ "env": { (super::compact::WIN_VAR): ROOM_WINDOW.to_string(), "BASH_MAX_TIMEOUT_MS": BASH_MAX_MS.to_string() } });
    if !plugins.is_empty() {
        v["enabledPlugins"] = plugins.iter().map(|p| (p.clone(), Value::Bool(false))).collect::<serde_json::Map<_, _>>().into();
    }
    if !mcp.is_empty() {
        v["deniedMcpServers"] = mcp.iter().map(|m| json!({ "serverName": m })).collect::<Vec<_>>().into();
    }
    let body = format!("{v}\n");
    if std::fs::read_to_string(&f).ok().as_deref() != Some(body.as_str()) {
        if let Some(d) = f.parent() {
            std::fs::create_dir_all(d)?;
        }
        std::fs::write(&f, body)?;
    }
    Ok(f)
}

/// `claude` arguments for a room that is not live. One line: a `.cmd` shim cannot pass newlines.
pub(super) fn argv(plan: &Plan, id: &str, title: &str, model: Option<&str>, settings: &Path, prompt: &str) -> Vec<String> {
    // `--name` on a resume too: without it Claude Code titles the session after the prompt, and the
    // room showed up as "/goal Phòng `qa` (vai …" in HQ (seen live 2026-10-18).
    let mut a: Vec<String> = match plan {
        Plan::Resume => vec!["--resume".into(), id.into(), "--bg".into(), "--name".into(), title.into()],
        _ => vec!["--bg".into(), "--name".into(), title.into()],
    };
    a.extend(["--permission-mode".into(), "auto".into()]);
    // A file, not inline JSON: a `.cmd` shim mangles the quotes.
    a.extend(["--settings".into(), settings.to_string_lossy().into_owned()]);
    if let Some(m) = model {
        a.extend(["--model".into(), m.into()]);
    }
    a.push(prompt.split_whitespace().collect::<Vec<_>>().join(" "));
    a
}

/// One room in `up`'s report.
#[derive(Debug, Clone, PartialEq)]
pub(super) struct Row {
    pub name: String,
    pub role: String,
    pub model: String,
    pub state: String,
    pub short: String,
}

#[derive(Clone)]
pub(super) struct Opts {
    pub roles: Vec<String>,
    pub every: u64,
    pub hours: f64,
    pub rate: Option<f64>,
    /// `--clear-ss`: delete junk background sessions first.
    pub clear: bool,
    /// `auto up "<việc>" [--check "<lệnh>"]`: the first card, at the head of the queue.
    pub task: Option<String>,
    pub check: Option<String>,
    /// `--omp`: team omp too (also turns omp on in auto.json's teams).
    pub omp: bool,
    /// `--add <room>`: open one more room in a team already running here; auto's lease, hours and
    /// `$`/hour cap stay as they are and no other room is touched (HQ "Tự soi ảnh" adds `eye`).
    pub add: bool,
}

pub(super) fn parse(rest: &[String]) -> Result<Opts> {
    let mut o = Opts { roles: room::DEFAULT_TEAM.iter().map(|s| s.to_string()).collect(), every: auto::DEFAULT_LOOP_MIN, hours: idle::DEFAULT_HOURS as f64, rate: None, clear: false, task: None, check: None, omp: false, add: false };
    // `--add <room>` stands alone: the other options set up a whole team (lease, hours, cap, task).
    if rest.first().map(String::as_str) == Some("--add") {
        let [_, name] = rest else { bail!("--add <phòng> đi một mình, vd `8sync ccc auto up --add eye`\n{USAGE}") };
        if name.starts_with("--") {
            bail!("--add cần tên phòng\n{USAGE}");
        }
        o.roles = vec![name.clone()];
        o.add = true;
        return Ok(o);
    }
    let mut it = rest.iter();
    while let Some(a) = it.next() {
        let mut value = || it.next().filter(|v| !v.starts_with("--")).cloned().ok_or_else(|| anyhow::anyhow!("{a} cần một giá trị\n{USAGE}"));
        match a.as_str() {
            "--roles" => {
                let mut v: Vec<String> = Vec::new();
                let raw = value()?;
                // Presets: `small` = the default team, `full` = 6 rooms, 3 of them builders (~6× quota),
                // `boost` = 13 rooms: lead + BA, 7 builders, 2 QA, 2 review (HQ "⚡ Sấm Sét", ~13× quota).
                let list = match raw.trim() {
                    "small" => room::DEFAULT_TEAM.join(","),
                    "full" => room::FULL_TEAM.join(","),
                    "boost" => room::BOOST_TEAM.join(","),
                    _ => raw,
                };
                for r in list.split(',').map(str::trim).filter(|r| !r.is_empty()) {
                    if !v.iter().any(|x| x == r) {
                        v.push(r.to_string());
                    }
                }
                if v.is_empty() || v.len() > MAX_ROOMS {
                    bail!("--roles: 1..{MAX_ROOMS} phòng, vd lead,dev,qa,review\n{USAGE}");
                }
                o.roles = v;
            }
            "--loop" => o.every = auto::parse_every(&value()?)?,
            "--hours" => o.hours = value()?.parse().map_err(|_| anyhow::anyhow!("--hours cần một số\n{USAGE}"))?,
            "--usd-per-hour" => o.rate = Some(value()?.parse().map_err(|_| anyhow::anyhow!("--usd-per-hour cần một số\n{USAGE}"))?),
            "--clear-ss" | "--clean" => o.clear = true,
            "--omp" => o.omp = true,
            "--check" => o.check = Some(value()?),
            x if x.starts_with("--") => bail!("không rõ `{x}`\n{USAGE}"),
            w => {
                let t = o.task.get_or_insert_with(String::new);
                if !t.is_empty() {
                    t.push(' ');
                }
                t.push_str(w);
            }
        }
    }
    if o.check.is_some() && o.task.is_none() {
        bail!("--check đi cùng \"<việc>\"\n{USAGE}");
    }
    if o.task.as_deref().is_some_and(|t| t.trim().is_empty()) {
        bail!("việc rỗng\n{USAGE}");
    }
    Ok(o)
}

/// This project's sessions in `claude agents --json`; `all` adds finished background ones.
pub(super) fn agents(t: &Team, all: bool) -> Result<Vec<Live>> {
    let mut a: Vec<String> = vec!["agents".into(), "--json".into()];
    if all {
        a.push("--all".into());
    }
    a.extend(["--cwd".into(), t.root.to_string_lossy().into_owned()]);
    Ok(live(&t.claude.run(&a)?)?.into_iter().filter(|l| in_repo(l, t.root)).collect())
}

/// The background sessions no room keeps. `keep` is (registry id, title) per team room: a room keeps
/// its registry id, else the first background session with its title (`up` rebinds to it).
pub(super) fn junk<'a>(all: &'a [Live], keep: &[(String, String)]) -> Vec<&'a Live> {
    let mut kept: Vec<&str> = Vec::new();
    for (id, title) in keep {
        let hit = all.iter().find(|l| l.id == *id).or_else(|| all.iter().find(|l| l.background && l.name == *title && !kept.contains(&l.id.as_str())));
        if let Some(l) = hit {
            kept.push(&l.id);
        }
    }
    all.iter().filter(|l| l.background && !kept.contains(&l.id.as_str())).collect()
}

/// A junk session `--clear-ss` deleted, or kept with Claude Code's reason (unpushed worktree …).
#[derive(Debug, Clone, PartialEq)]
pub(super) struct Gone {
    pub name: String,
    pub short: String,
    pub kept: Option<String>,
}

/// `--clear-ss`: stop and `claude rm` every junk background session of the project, then drop the
/// registry rooms that pointed at the deleted ones. Gone or not is read back from `claude agents`.
fn clear(t: &Team, roles: &[String]) -> Result<Vec<Gone>> {
    let all = agents(t, true)?;
    let reg = t.store.load();
    let keep: Vec<(String, String)> = roles
        .iter()
        .map(|n| (reg.sessions.iter().find(|s| &s.name == n).map(|s| s.conversation_id.clone()).unwrap_or_default(), (t.title)(n)))
        .collect();
    let junk = junk(&all, &keep);
    if junk.is_empty() {
        return Ok(Vec::new());
    }
    let running = agents(t, false)?;
    let mut tried = Vec::new();
    for l in junk {
        let short: String = l.id.chars().take(8).collect();
        if running.iter().any(|r| r.id == l.id) {
            t.claude.run(&["stop".into(), short.clone()])?;
        }
        let out = t.claude.run(&["rm".into(), short.clone()])?;
        tried.push((l, short, out));
    }
    let left = agents(t, true)?;
    let mut gone = Vec::new();
    for (l, short, out) in tried {
        let kept = left.iter().any(|x| x.id == l.id).then(|| crate::verbs::session_view::truncate(out.trim().lines().next().unwrap_or("không rõ lý do"), 200));
        if kept.is_none() {
            for s in reg.sessions.iter().filter(|s| s.conversation_id == l.id) {
                t.store.remove(&s.name)?;
            }
        }
        gone.push(Gone { name: l.name.clone(), short, kept });
    }
    Ok(gone)
}

/// `--add` goes only into a team that runs here: auto on and scoped to this project, its team root.
pub(super) fn check_add(t: &Team) -> Result<()> {
    if !(auto::running(t.home) && auto::in_scope(t.home, Some(&t.root.to_string_lossy())) && team_roots(t.home).iter().any(|r| auto::canon(Path::new(r)) == auto::canon(t.root))) {
        bail!("team của dự án này chưa chạy: bật team trước (`8sync ccc auto up`), rồi mới thêm phòng");
    }
    Ok(())
}

/// `auto up` under the revive lock: `nested` stops the teams of repos around or inside this one,
/// then [`up`]. `--add` stops nothing: it refuses first unless this project's team runs here.
pub(super) fn up_locked(t: &Team, o: &Opts, now: u64, nested: impl FnOnce() -> Result<()>) -> Result<(Value, Vec<Gone>, Vec<Row>)> {
    if o.add {
        check_add(t)?;
    } else {
        nested()?;
    }
    up(t, o, now)
}

/// `auto up`: auto on for this project, then every room live. Fails on the first room Claude Code
/// refuses (untrusted workspace, not logged in): what started stays up, a re-run picks up the rest.
pub(super) fn up(t: &Team, o: &Opts, now: u64) -> Result<(Value, Vec<Gone>, Vec<Row>)> {
    // Validate every name before anything changes.
    for n in &o.roles {
        if n.is_empty() || n.len() > 64 || !n.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.')) || n.starts_with('.') {
            bail!("tên phòng không hợp lệ: `{n}` (chữ, số, '-', '_', '.')");
        }
    }
    let gone = if o.clear { clear(t, &o.roles)? } else { Vec::new() };
    if o.add {
        check_add(t)?;
    }
    let before = agents(t, false)?;
    let everywhere = live(&t.claude.run(&["agents".into(), "--json".into()])?)?;
    let status = if o.add {
        auto::status(t.home, t.subscription, now)
    } else {
        // On first: a room's first tick reads `auto status --json` and drops its loop while auto is off.
        let status = auto::set(t.home, auto::Mode::On { hours: o.hours, after: auto::DEFAULT_AFTER_S, rate: o.rate, repo: Some(t.root.to_path_buf()) }, t.subscription, now)?;
        set_team_root(t.home, t.root, true);
        auto::write_loop_md(t.root)?;
        // Before any room starts, so the lead's first turn already sees it at the head of the queue.
        if let Some(task) = &o.task {
            super::target::add(t.home, t.root, task, o.check.as_deref(), None, true, None, now)?;
        }
        status
    };
    let mut rows = Vec::new();
    let mut started = Vec::new();
    // The owner brings the whole team up: rooms the resource guard paused come back too. `--add`
    // (HQ "Tự soi ảnh" → `up --add eye`) brings back only what it adds.
    if o.add {
        super::pressure::unpause(t.home, t.root, &o.roles);
    } else {
        super::pressure::clear_paused(t.home, t.root);
    }
    // Staggered start: a room's first minutes index the repo (codebase-memory, tsserver); with the
    // guard on, each next room waits for the CPU to settle, this long at most in total — less what
    // this run already spent waiting for the lock ([`up_stagger`]).
    let mut stagger = up_stagger();
    for name in &o.roles {
        let s = t.store.touch(name, false)?;
        let title = (t.title)(name);
        let r = room::find(name);
        let (role, _) = room::role(name);
        let model = r.and_then(|r| r.model);
        // A room with a lane opens on Claude Code's own `/goal`: it keeps taking turns (claim → work →
        // move, `auto wait` while the lane is empty) until auto stops; so does the eye on its inbox;
        // the others get the loop prompt.
        let prompt = first_prompt(name, r.and_then(|r| r.lane), o.every);
        // The registry points at a session that runs in another repo (an older `up` took it over):
        // that conversation is not this room's, so it opens a new one instead of sharing it.
        let foreign = everywhere.iter().any(|l| l.id == s.conversation_id && !in_repo(l, t.root));
        let mut p = if foreign { Plan::Start } else { plan(&s.conversation_id, &title, &before, &everywhere, (t.has_transcript)(&s.conversation_id)) };
        // `--clear-ss` also brings running rooms up to the kit: Claude Code reads hooks once at start,
        // so a background room started before the kit's last write is stopped and resumed (same
        // conversation, its goal comes back). Interactive sessions are never touched.
        let mut reloaded = false;
        if let Plan::Running(id) = &p {
            let bg_idle = before.iter().chain(&everywhere).find(|l| l.id == *id).filter(|l| l.background && !l.busy);
            let on_old_kit = o.clear && t.kit_at.is_some_and(|k| bg_idle.is_some_and(|l| l.started > 0 && l.started < k));
            // A lane room (or the eye) idle in the background has lost its `/goal` ([`lost_goal`]): a
            // loop prompt would give it one turn, the goal keeps it claiming.
            let goal_gone = bg_idle.is_some_and(|l| lost_goal(on_goal(name), l)) && !pending_inbox(t.home, id);
            // Resume needs the conversation on disk; a room mid-turn is left for the next run.
            if (on_old_kit || goal_gone) && (t.has_transcript)(id) {
                if *id != s.conversation_id {
                    t.store.rebind(name, id)?;
                }
                t.claude.run(&["stop".into(), id.chars().take(8).collect()])?;
                p = Plan::Resume;
                reloaded = true;
            }
        }
        let conv = match &p {
            Plan::Resume if reloaded => t.store.load().sessions.iter().find(|x| &x.name == name).map_or(s.conversation_id.clone(), |x| x.conversation_id.clone()),
            _ => s.conversation_id.clone(),
        };
        let (state, short) = match &p {
            Plan::Running(id) => {
                if *id != s.conversation_id {
                    t.store.rebind(name, id)?;
                }
                // The eye and the sweep have no loop: a live one is already on its goal (an idle one was resumed above).
                if room::mail_only(name) {
                    ("đang chạy".to_string(), id.chars().take(8).collect())
                } else {
                    let sent = auto::queue_loops(t.home, &[(name.clone(), id.clone())], o.every, false, now);
                    let when = if sent.first().is_some_and(|(_, l)| *l) { "vào ngay" } else { "vào khi xong lượt" };
                    (format!("đang chạy · gửi loop ({when})"), id.chars().take(8).collect())
                }
            }
            _ => {
                if !started.is_empty() {
                    super::pressure::settle(t.home, &mut stagger);
                }
                let settings = room_settings(t.home, super::pressure::lean(t.home, t.root, name))?;
                let out = t.claude.run(&argv(&p, &conv, &title, model, &settings, &prompt))?;
                if untrusted(&out) {
                    bail!("Claude Code chưa trust thư mục {}: mở `claude` ở đó một lần, chấp nhận câu hỏi trust, rồi chạy lại `8sync ccc auto up` (phòng đã mở vẫn chạy)", t.root.display());
                }
                let Some(short) = short_id(&out) else {
                    bail!("`claude --bg` cho phòng {name} không mở được: {}", crate::verbs::session_view::truncate(out.trim(), 300));
                };
                // `--resume <id> --bg` forks a new session id too (seen live on 2.1.296: cd1ecaeb →
                // b1f0bf3e), so both get the registry pointed at what Claude Code runs.
                started.push((name.clone(), short.clone()));
                let state = if reloaded { "khởi động lại nền (nạp kit mới, chạy lại /goal)" } else if p == Plan::Resume { "chạy lại nền" } else { "mở nền" };
                (state.to_string(), short)
            }
        };
        rows.push(Row { name: name.clone(), role, model: model.unwrap_or("mặc định").into(), state, short });
    }
    // New rooms go under the CPU cap at once ([`super::pressure::cap_now`]).
    let opened = !started.is_empty();
    // Point the registry at the ids Claude Code picked for new rooms (the list can lag a moment).
    for attempt in 0..5 {
        if started.is_empty() {
            break;
        }
        if attempt > 0 {
            std::thread::sleep(std::time::Duration::from_millis(600));
        }
        let now_live = agents(t, false)?;
        started.retain(|(name, short)| match now_live.iter().find(|l| l.id.starts_with(short.as_str())) {
            Some(l) => t.store.rebind(name, &l.id).is_err(),
            None => true,
        });
    }
    for (name, _) in &started {
        if let Some(row) = rows.iter_mut().find(|r| &r.name == name) {
            row.state.push_str(" (chưa thấy trong `claude agents`: inbox/HQ chưa nối, chạy lại `auto up`)");
        }
    }
    if opened && !cfg!(test) {
        let registry: Vec<(String, String)> = t.store.load().sessions.into_iter().map(|s| (s.name, s.conversation_id)).collect();
        super::pressure::cap_now(t.home, t.root, t.claude, &registry, now);
    }
    Ok((status, gone, rows))
}

/// A lane room on its `/goal` is never idle: between cards it blocks in `auto wait` (the eye in
/// `auto wait --mail`). Idle in the background means the goal ended, which it does when the lease
/// gate shows (its stop condition), and a renewed lease does not bring it back: 3d-game 2026-10-20,
/// rooms re-armed after the lease worked only when their 30-minute backup cron fired (the lead sat
/// 28 min with nothing to do, then approved cards waited for it). `goal`: [`on_goal`].
fn lost_goal(goal: bool, l: &Live) -> bool {
    goal && l.background && !l.busy
}

/// A lane room must be seen idle at two `revive` runs at least this far apart (HQ runs it every
/// 2 min) before it is resumed with its goal: a room between two turns of its goal shows idle for a
/// moment. No sleep inside `revive`: HQ kills it after 120 s.
const IDLE_CONFIRM_S: u64 = 60;
/// A room resumed with its goal less than this long ago is left idle (a goal that keeps ending,
/// e.g. Claude Code's own usage limit before 8sync's gate, would otherwise fork it every 2 min).
const REGOAL_BACKOFF_S: u64 = 600;
/// The previous idle sighting counts only this long (a bit over two HQ revive intervals).
const IDLE_STALE_S: u64 = 300;
/// Backoff between re-arms of an idle room that has a card waiting in its lane.
const WORK_BACKOFF_S: u64 = 60;
/// Total wait `auto up` spends letting the CPU settle between room starts
/// ([`super::pressure::settle`]), at most.
const UP_STAGGER_S: u64 = 90;
/// HQ gives `up` 300 s (boost 660 s); this much of it stays for the launches and the rebind.
const UP_TOTAL_S: u64 = 300;
const UP_LAUNCH_S: u64 = 90;
/// One `revive` process (all team roots) stops opening, restarting and merging this long after it
/// started: HQ kills it at 120 s, and a killed run left its lock behind.
const REVIVE_DEADLINE_S: u64 = 90;
/// A room is opened only with at least this much of the deadline left (`claude --bg`, rebind).
const LAUNCH_RESERVE_S: u64 = 20;

static RUN_START: std::sync::OnceLock<std::time::Instant> = std::sync::OnceLock::new();

/// `8sync ccc auto revive` / `up` start their clock once, before the lock wait and the first root.
pub(super) fn run_clock_start() {
    RUN_START.get_or_init(std::time::Instant::now);
}

fn run_elapsed() -> std::time::Duration {
    RUN_START.get().map_or(std::time::Duration::ZERO, |s| s.elapsed())
}

/// What is left of this revive process's [`REVIVE_DEADLINE_S`] (all of it when no clock runs).
pub(super) fn revive_left() -> std::time::Duration {
    std::time::Duration::from_secs(REVIVE_DEADLINE_S).saturating_sub(run_elapsed())
}

/// `up`'s stagger budget: [`UP_STAGGER_S`], cut so the lock wait already spent plus the stagger
/// plus [`UP_LAUNCH_S`] stay inside HQ's [`UP_TOTAL_S`].
fn up_stagger() -> std::time::Duration {
    std::time::Duration::from_secs(UP_STAGGER_S).min(std::time::Duration::from_secs(UP_TOTAL_S - UP_LAUNCH_S).saturating_sub(run_elapsed()))
}

/// Messages queued for `sid` and not taken yet: the inbox mod hands them to an idle room by itself,
/// and a resume forks a new id that would never read this file.
pub(super) fn pending_inbox(home: &Path, sid: &str) -> bool {
    crate::verbs::hq::inbox_file(home, sid).and_then(|f| std::fs::metadata(f).ok()).is_some_and(|m| m.len() > 0)
}

fn regoal_file(home: &Path) -> PathBuf {
    idle::state_dir(home).join("regoal.json")
}

fn wake_file(home: &Path) -> PathBuf {
    idle::state_dir(home).join("wake-now.json")
}

fn wake_key(root: &Path, name: &str) -> String {
    format!("{}|{name}", auto::canon(root).to_string_lossy())
}

/// Read-modify-write of a small JSON state file two processes touch (`auto prio` and `revive`),
/// under `<file>.lock` (create-new, retried for about a second; a lock older than 10 s belongs to a
/// dead writer and is taken over). Past the retries it writes anyway: a lost mark costs one tick.
pub(super) fn update_json(file: &Path, f: impl FnOnce(&mut Value)) {
    let lock = file.with_extension("lock");
    if let Some(d) = file.parent() {
        let _ = std::fs::create_dir_all(d);
    }
    let mut held = false;
    for _ in 0..40 {
        if std::fs::OpenOptions::new().write(true).create_new(true).open(&lock).is_ok() {
            held = true;
            break;
        }
        let stale = std::fs::metadata(&lock).and_then(|m| m.modified()).ok().and_then(|t| t.elapsed().ok()).is_some_and(|a| a.as_secs() >= 10);
        if stale {
            let _ = std::fs::remove_file(&lock);
        } else {
            std::thread::sleep(std::time::Duration::from_millis(25));
        }
    }
    let mut v = idle::read_json(file).filter(Value::is_object).unwrap_or_else(|| json!({}));
    f(&mut v);
    idle::write_json(file, &v);
    if held {
        let _ = std::fs::remove_file(&lock);
    }
}

/// HQ "⚡ Làm ngay" (`auto prio <id> P0` from the owner): the rooms of `root` called to take the
/// card. The next `revive` re-arms each one it finds idle in the background with its goal ended
/// without the [`IDLE_CONFIRM_S`] wait or the backoff (a second fresh look [`WAKE_LOOK_GAP`] later
/// still has to show it idle, with an empty inbox); a mark older than [`IDLE_STALE_S`] says nothing.
pub(super) fn ask_wake(home: &Path, root: &Path, names: &[String], now: u64) {
    update_json(&wake_file(home), |v| {
        for n in names {
            v[wake_key(root, n)] = json!(now);
        }
    });
}

/// The rooms of `root` with a fresh [`ask_wake`] mark.
fn woken(home: &Path, root: &Path, names: impl Iterator<Item = String>, now: u64) -> Vec<String> {
    let v = idle::read_json(&wake_file(home)).unwrap_or_default();
    names.filter(|n| v[wake_key(root, n)].as_u64().is_some_and(|at| now.saturating_sub(at) <= IDLE_STALE_S)).collect()
}

/// Spends the marks of rooms re-armed for real; one deferred, busy or failed keeps its mark.
fn wake_done(home: &Path, root: &Path, names: &[String]) {
    if names.is_empty() {
        return;
    }
    update_json(&wake_file(home), |v| {
        if let Some(o) = v.as_object_mut() {
            for n in names {
                o.remove(&wake_key(root, n));
            }
        }
    });
}

/// Between the sighting of a called room and the fresh look right before its stop: a room between
/// two turns of its goal shows idle for a moment (the normal path waits [`IDLE_CONFIRM_S`]).
const WAKE_LOOK_GAP: std::time::Duration = std::time::Duration::from_secs(if cfg!(test) { 0 } else { 5 });
/// ⚡ Làm ngay mails the lead once per card this often (picking P0 again does not mail again).
const RUSH_MAIL_S: u64 = 600;
/// ⚡ Làm ngay starts a background `revive` at most this often.
const RUSH_SPAWN_S: u64 = 60;

fn rush_file(home: &Path) -> PathBuf {
    idle::state_dir(home).join("rush.json")
}

/// Whether ⚡ Làm ngay on card `id` of `root` mails the lead now (none in the last [`RUSH_MAIL_S`]);
/// true stamps it.
pub(super) fn rush_mail_due(home: &Path, root: &Path, id: u64, now: u64) -> bool {
    let key = format!("{}|{id}", auto::canon(root).to_string_lossy());
    let mut due = false;
    update_json(&rush_file(home), |v| {
        due = !v["lead"][&key].as_u64().is_some_and(|at| now.saturating_sub(at) < RUSH_MAIL_S);
        if due {
            if !v["lead"].is_object() {
                v["lead"] = json!({});
            }
            v["lead"][&key] = json!(now);
        }
    });
    due
}

/// Whether ⚡ Làm ngay starts a background `revive` now: not when one started less than
/// [`RUSH_SPAWN_S`] ago or a live revive / up holds the lock (its next run takes the marks). True stamps it.
pub(super) fn rush_spawn_due(home: &Path, now: u64) -> bool {
    if revive_running(home, now) {
        return false;
    }
    let mut due = false;
    update_json(&rush_file(home), |v| {
        due = !v["spawn"].as_u64().is_some_and(|at| now.saturating_sub(at) < RUSH_SPAWN_S);
        if due {
            v["spawn"] = json!(now);
        }
    });
    due
}

/// `auto revive`: bring back this project's team rooms whose background session died (machine
/// restarted, process killed) while auto still runs here. Owner (2026-10-19): "tắt máy chứ chưa tắt
/// ccc auto … mở máy lên hiển thị đang làm nhưng mà lại không có làm". A room counts when it is a
/// known role, its registry id is a background session in `claude agents --all` that is no longer
/// live, nothing live carries its title, and Claude Code still has the conversation. It resumes the
/// same way `up` does (same prompt, registry rebound), but never renews the lease, never starts a
/// room that never ran, and does nothing while auto is off, paused, out of scope or gated (on a
/// subscription the owner-present lease; usage window; `$`/hour cap). A live lane room idle
/// ([`lost_goal`]) at two runs [`IDLE_CONFIRM_S`] apart, with an empty inbox, not resumed in the last
/// [`REGOAL_BACKOFF_S`], and still idle right before the stop, is stopped and resumed with its goal;
/// one the owner called with ⚡ Làm ngay ([`ask_wake`]) at the first sighting.
/// The resource guard ([`super::pressure::tick`]) runs first (also while gated); a room it paused
/// is not revived, a room it asked to restart is stopped and resumed lean, and rooms open
/// staggered ([`super::pressure::settle`]).
pub(super) fn revive(t: &Team, every: u64, now: u64) -> Result<Vec<Row>> {
    let root = t.root.to_string_lossy();
    // One process listing for the reaper and the guard (never from a test build).
    let listing = super::reap::Listing::new(now);
    let mut rows = if cfg!(test) { Vec::new() } else { super::reap::tick(t.home, t.root, now, &listing) };
    if !auto::running(t.home) || !auto::in_scope(t.home, Some(&root)) {
        return Ok(rows);
    }
    let st = auto::status(t.home, t.subscription, now);
    // Tight usage with other projects pinned ([`super::lease::focus_rest`]): this project rests like
    // on any gate; with usage loose it runs (pinned roots come first in revive's order).
    let gated = !st["gate"].is_null() || super::lease::focus_rest(t.home, t.root, now).is_some();
    // The resource guard ([`super::pressure`]): cleans, warns rooms, pauses rooms that do not fit
    // (also while gated) and leaves the rooms to restart lean for the loop below.
    if !cfg!(test) {
        let registry: Vec<(String, String)> = t.store.load().sessions.into_iter().map(|s| (s.name, s.conversation_id)).collect();
        rows.extend(super::pressure::tick(t.home, t.root, t.claude, &registry, gated, now, super::pressure::TICK_S, &listing).0);
    }
    if gated {
        return Ok(rows);
    }
    let restarts = super::pressure::restarts(t.home, t.root);
    let paused = super::pressure::paused(t.home, t.root);
    // The auto-ship loop ([`super::ship_loop::tick`]): the lead gets the next round once the board
    // drained; it waits (never ends) while the $/hour cap rests or the guard holds the project.
    let registry: Vec<(String, String)> = t.store.load().sessions.into_iter().map(|s| (s.name, s.conversation_id)).collect();
    if let Some(line) = super::ship_loop::tick(t.home, t.root, &registry, !st["cap"].is_null(), super::pressure::holds(t.home, t.root), now) {
        rows.push(Row { name: "lead".into(), role: room::role("lead").0, model: String::new(), state: line, short: String::new() });
    }
    // Ship tốc độ cao: ends by itself when the team is done or time is up, and tells the owner once.
    if let Some(line) = super::ship_fast::tick(t.home, t.root, now) {
        rows.push(Row { name: "lead".into(), role: room::role("lead").0, model: String::new(), state: line, short: String::new() });
    }
    // Approved cards piling up: the lead asks the owner's one-tap Ship (debounced; owner
    // 2026-10-21: "lead agent nên xem board thường xuyên hơn, kẹt để còn approve").
    if let Some(line) = super::ship_fast::ask_ship(t.home, t.root, &registry, now) {
        rows.push(Row { name: "lead".into(), role: room::role("lead").0, model: String::new(), state: line, short: String::new() });
    }
    let all = agents(t, true)?;
    let running = agents(t, false)?;
    let listed_at = std::time::Instant::now();
    // A room's id live anywhere on the machine (a terminal in another folder) is never resumed a
    // second time, as in `up`.
    let everywhere = live(&t.claude.run(&["agents".into(), "--json".into()])?)?;
    let sessions = t.store.load().sessions;
    let file = regoal_file(t.home);
    let mut seen = idle::read_json(&file).filter(Value::is_object).unwrap_or_else(|| json!({}));
    let mut stalled = Vec::new();
    let wake = woken(t.home, t.root, sessions.iter().map(|s| s.name.clone()), now);
    let cards = target::list(t.home, t.root).unwrap_or_default();
    let mut called = Vec::new();
    let mut rearmed = Vec::new();
    for s in &sessions {
        let key = format!("{root}|{}", s.name);
        let idle = running.iter().any(|l| l.id == s.conversation_id && lost_goal(on_goal(&s.name), l));
        if !idle {
            if let Some(o) = seen.get_mut(&key).and_then(Value::as_object_mut) {
                o.remove("seen");
            }
            continue;
        }
        // The owner's ⚡ Làm ngay: no IDLE_CONFIRM_S wait and no backoff (the fresh look below, at
        // least WAKE_LOOK_GAP later, still has to show it idle). Never with messages waiting: the
        // inbox mod hands them over, and a resume forks an id that would never read them.
        if wake.contains(&s.name) {
            if !pending_inbox(t.home, &s.conversation_id) {
                stalled.push(s.conversation_id.clone());
                called.push(s.name.clone());
            }
            continue;
        }
        let e = &mut seen[&key];
        // A room with a card waiting in its lane is re-armed after a minute (owner 2026-10-21:
        // "thời gian nghỉ quá lâu, sau 1p phải swarm lại"); one with nothing to take keeps the long
        // backoff so idling costs no turns.
        let has_work = room::find(&s.name).and_then(|r| r.lane).is_some_and(|lane| target::claimable(&cards, &s.name, lane, now).is_some());
        let backoff = if has_work { WORK_BACKOFF_S } else { REGOAL_BACKOFF_S };
        if e["revived"].as_u64().is_some_and(|r| now.saturating_sub(r) < backoff) {
            continue;
        }
        // A sighting older than IDLE_STALE_S (HQ closed, lease gap) says nothing about now: count again.
        match e["seen"].as_u64().map(|at| now.saturating_sub(at)) {
            Some(age) if age < IDLE_CONFIRM_S => {}
            Some(age) if age <= IDLE_STALE_S => {
                if !pending_inbox(t.home, &s.conversation_id) {
                    stalled.push(s.conversation_id.clone());
                }
            }
            _ => e["seen"] = json!(now),
        }
    }
    let mut started = Vec::new();
    let reserve = std::time::Duration::from_secs(LAUNCH_RESERVE_S);
    for s in sessions {
        let Some(r) = room::find(&s.name) else { continue };
        let title = (t.title)(&s.name);
        // A room the guard paused stays down until the guard (or `auto up`) brings it back.
        let died = all.iter().any(|l| l.id == s.conversation_id && l.background)
            && !running.iter().any(|l| l.id == s.conversation_id || l.name == title)
            && !everywhere.iter().any(|l| l.id == s.conversation_id)
            && !paused.contains(&s.name);
        let idle = stalled.contains(&s.conversation_id);
        let queued = restarts.iter().find(|q| q.name == s.name);
        let lean_restart = !idle && queued.is_some() && running.iter().any(|l| l.id == s.conversation_id && l.background);
        if !(died || idle || lean_restart) || !(t.has_transcript)(&s.conversation_id) {
            continue;
        }
        // One deadline for this whole revive process ([`revive_left`]): rooms past it open on the
        // next tick (a lean restart stays queued), and between rooms the CPU settles ([`up`]).
        let defer = |rows: &mut Vec<Row>| rows.push(Row { name: s.name.clone(), role: room::role(&s.name).0, model: r.model.unwrap_or("mặc định").into(), state: "mở ở lượt revive sau (giãn khởi động cho CPU)".into(), short: String::new() });
        if !started.is_empty() && revive_left() > reserve {
            let mut wait = revive_left().saturating_sub(reserve);
            super::pressure::settle(t.home, &mut wait);
        }
        if revive_left() <= reserve {
            defer(&mut rows);
            continue;
        }
        if idle {
            let call = called.contains(&s.name);
            if call {
                std::thread::sleep(WAKE_LOOK_GAP.saturating_sub(listed_at.elapsed()));
            }
            // The list above is a few calls old: a room woken since (inbox, cron) is mid-turn now.
            if !agents(t, false)?.iter().any(|l| l.id == s.conversation_id && lost_goal(on_goal(&s.name), l)) || (call && pending_inbox(t.home, &s.conversation_id)) {
                continue;
            }
            t.claude.run(&["stop".into(), s.conversation_id.chars().take(8).collect()])?;
            seen[format!("{root}|{}", s.name)] = json!({ "revived": now });
        } else if let (true, Some(q)) = (lean_restart, queued) {
            // Right before the stop: still not mid-turn (idle, or blocked in `auto wait`) and no
            // message waiting (a resume forks an id that never reads the old inbox).
            let now_live = agents(t, false)?;
            // A room blocked in `auto wait` shows busy in `agents`: only a FRESH listing proves it is
            // still waiting (the shared one is up to ~70 s old; a card landing meanwhile starts a turn).
            let idle_now = now_live.iter().any(|l| l.id == s.conversation_id && l.background && !l.busy)
                || (q.waiting && revive_left() > reserve && super::pressure::still_waiting(&super::reap::list(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(now, |d| d.as_secs())), q.pid));
            if !idle_now || pending_inbox(t.home, &s.conversation_id) {
                rows.push(Row { name: s.name.clone(), role: room::role(&s.name).0, model: r.model.unwrap_or("mặc định").into(), state: "chưa khởi động lại gọn nhẹ: phòng đang làm hoặc còn tin chưa đọc (thử lượt sau)".into(), short: String::new() });
                continue;
            }
            t.claude.run(&["stop".into(), s.conversation_id.chars().take(8).collect()])?;
        }
        let settings = room_settings(t.home, super::pressure::lean(t.home, t.root, &s.name))?;
        let prompt = first_prompt(&s.name, r.lane, every);
        let out = t.claude.run(&argv(&Plan::Resume, &s.conversation_id, &title, r.model, &settings, &prompt))?;
        let Some(short) = short_id(&out).filter(|_| !untrusted(&out)) else {
            rows.push(Row { name: s.name.clone(), role: room::role(&s.name).0, model: r.model.unwrap_or("mặc định").into(), state: format!("không mở lại được: {}", crate::verbs::session_view::truncate(out.trim(), 200)), short: String::new() });
            continue;
        };
        started.push((s.name.clone(), short.clone()));
        if idle && called.contains(&s.name) {
            rearmed.push(s.name.clone());
        }
        if lean_restart {
            super::pressure::restart_done(t.home, t.root, &s.name, now);
        }
        let state = if lean_restart {
            "khởi động lại gọn nhẹ (máy quá tải: tắt LSP + MCP index, cùng hội thoại)"
        } else if idle {
            "chạy lại /goal (phòng đứng không việc)"
        } else {
            "chạy lại nền (phiên cũ đã chết)"
        };
        rows.push(Row { name: s.name.clone(), role: room::role(&s.name).0, model: r.model.unwrap_or("mặc định").into(), state: state.into(), short });
    }
    let opened = !started.is_empty();
    // Same as `up`: point the registry at the forked ids (the list can lag a moment).
    for attempt in 0..5 {
        // Past the deadline only the first look runs: the next revive rebinds what lags.
        if started.is_empty() || (attempt > 0 && revive_left() < std::time::Duration::from_secs(3)) {
            break;
        }
        if attempt > 0 {
            std::thread::sleep(std::time::Duration::from_millis(600));
        }
        let now_live = agents(t, false)?;
        started.retain(|(name, short)| match now_live.iter().find(|l| l.id.starts_with(short.as_str())) {
            Some(l) => t.store.rebind(name, &l.id).is_err(),
            None => true,
        });
    }
    idle::write_json(&file, &seen);
    wake_done(t.home, t.root, &rearmed);
    if opened && !cfg!(test) {
        let registry: Vec<(String, String)> = t.store.load().sessions.into_iter().map(|s| (s.name, s.conversation_id)).collect();
        super::pressure::cap_now(t.home, t.root, t.claude, &registry, now);
    }
    Ok(rows)
}

/// The file that lists the roots `auto up` brought a team up in (`auto down` drops its root):
/// `auto revive` walks only these.
fn team_roots_file(home: &Path) -> PathBuf {
    idle::state_dir(home).join("team-roots.json")
}

/// Team roots (and auto's remembered projects) one inside `root` or holding it: `auto up` /
/// `auto on --here` in `root` stops their teams first — one team per folder tree.
pub(super) fn nested_teams(home: &Path, root: &Path) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();
    for r in team_roots(home).into_iter().chain(auto::remembered_roots(home)) {
        let p = PathBuf::from(r.trim_start_matches(r"\\?\"));
        if auto::nested(&p, root) && !out.iter().any(|o| auto::canon(o) == auto::canon(&p)) {
            out.push(p);
        }
    }
    out
}

/// The roots `auto revive` brings back, as `auto up` used them for the registry.
pub(super) fn team_roots(home: &Path) -> Vec<String> {
    idle::read_json(&team_roots_file(home)).and_then(|v| serde_json::from_value(v).ok()).unwrap_or_default()
}

pub(super) fn set_team_root(home: &Path, root: &Path, on: bool) {
    let r = root.to_string_lossy().into_owned();
    let mut roots = team_roots(home);
    roots.retain(|x| *x != r && !(on && auto::nested(Path::new(x), root)));
    if on {
        roots.push(r);
    }
    idle::write_json(&team_roots_file(home), &Value::from(roots));
}

/// Held while `auto revive` or `auto up` runs (HQ, a boot hook and the owner can all call them);
/// the file goes on drop, but only while it still holds this run's token (`<time>.<pid>`): a run
/// that replaced a stale lock is never unlocked by the stale run's late drop.
pub(super) struct ReviveLock(PathBuf, String);

impl Drop for ReviveLock {
    fn drop(&mut self) {
        if std::fs::read_to_string(&self.0).is_ok_and(|s| s == self.1) {
            let _ = std::fs::remove_file(&self.0);
        }
    }
}

/// A lock younger than this is a revive still running; an older one was left by a killed run.
const REVIVE_LOCK_S: u64 = 600;

/// Whether process `pid` runs; when that cannot be told, it does (a lock is kept, never stolen).
fn pid_alive(pid: u32) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let out = std::process::Command::new("tasklist")
            .args(["/FI", &format!("PID eq {pid}"), "/FO", "CSV", "/NH"])
            .stdin(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
            .output();
        out.map_or(true, |o| !o.status.success() || String::from_utf8_lossy(&o.stdout).contains(&format!("\"{pid}\"")))
    }
    #[cfg(target_os = "linux")]
    {
        Path::new("/proc").join(pid.to_string()).exists()
    }
    #[cfg(not(any(windows, target_os = "linux")))]
    {
        std::process::Command::new("kill").args(["-0", &pid.to_string()]).stderr(std::process::Stdio::null()).status().map_or(true, |s| s.success())
    }
}

/// The revive lock `p` with content `held` still stands: younger than [`REVIVE_LOCK_S`] (the time
/// written in it, else its mtime: a run killed before writing) and its holder is not gone (killed by
/// a timeout, 2026-10-21: the owner's `auto up` was refused for 10 min by a dead revive's lock).
fn lock_live(p: &Path, held: &str, now: u64) -> bool {
    let at = held.split('.').next().and_then(|s| s.trim().parse::<u64>().ok()).or_else(|| {
        std::fs::metadata(p).and_then(|m| m.modified()).ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs())
    });
    let gone = held.split('.').nth(1).and_then(|s| s.trim().parse::<u32>().ok()).is_some_and(|pid| pid != std::process::id() && !pid_alive(pid));
    !gone && at.is_some_and(|a| now.saturating_sub(a) < REVIVE_LOCK_S)
}

/// A revive / up holds the lock right now.
pub(super) fn revive_running(home: &Path, now: u64) -> bool {
    let p = idle::state_dir(home).join("revive.lock");
    std::fs::read_to_string(&p).is_ok_and(|held| lock_live(&p, &held, now))
}

/// `None`: another revive / up holds the lock, this one does nothing.
pub(super) fn revive_lock(home: &Path, now: u64) -> Result<Option<ReviveLock>> {
    let dir = idle::state_dir(home);
    std::fs::create_dir_all(&dir)?;
    let p = dir.join("revive.lock");
    let token = format!("{now}.{}", std::process::id());
    for _ in 0..2 {
        match std::fs::OpenOptions::new().write(true).create_new(true).open(&p) {
            Ok(mut f) => {
                use std::io::Write;
                let _ = write!(f, "{token}");
                return Ok(Some(ReviveLock(p, token)));
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                let held = std::fs::read_to_string(&p).unwrap_or_default();
                if lock_live(&p, &held, now) {
                    return Ok(None);
                }
                // Stale: take it over only if nobody replaced it meanwhile (same content).
                if std::fs::read_to_string(&p).unwrap_or_default() == held {
                    let _ = std::fs::remove_file(&p);
                }
            }
            Err(e) => return Err(e.into()),
        }
    }
    Ok(None)
}

/// The team rooms `auto down` stops, as (room name, its live background session): a room counts by
/// its registry id or, when `up` could not rebind yet, by its title.
pub(super) fn rooms<'a>(t: &Team, live: &'a [Live]) -> Vec<(String, &'a Live)> {
    let reg = t.store.load();
    let mut out: Vec<(String, &Live)> = Vec::new();
    for s in &reg.sessions {
        let title = (t.title)(&s.name);
        if let Some(l) = live.iter().find(|l| l.background && !out.iter().any(|(_, d)| d.id == l.id) && (l.id == s.conversation_id || l.name == title)) {
            out.push((s.name.clone(), l));
        }
    }
    out
}

/// `auto down`: stop this project's background rooms (`claude stop` keeps the conversation, `up`
/// resumes it; nothing is deleted) and take this project out of auto; other projects keep running.
/// Returns the stopped room names.
pub(super) fn down(t: &Team, now: u64) -> Result<Vec<String>> {
    let live = agents(t, false)?;
    let mut stopped = Vec::new();
    for (name, l) in rooms(t, &live) {
        t.claude.run(&["stop".into(), l.id.chars().take(8).collect()])?;
        stopped.push(name);
    }
    auto::leave(t.home, t.root, t.subscription, now)?;
    set_team_root(t.home, t.root, false);
    // No team, no rounds: a loop left on would mail a lead that is gone ([`super::ship_loop`]);
    // a sprint left on would hold builders off fresh cards.
    super::ship_loop::off(t.home, t.root);
    super::ship_fast::off(t.home, t.root);
    Ok(stopped)
}

/// The rooms of `--only a,b,c`: trimmed, empty and repeated names dropped, order kept.
pub(super) fn only_list(raw: &str) -> Vec<&str> {
    let mut out: Vec<&str> = Vec::new();
    for n in raw.split(',').map(str::trim).filter(|n| !n.is_empty()) {
        if !out.contains(&n) {
            out.push(n);
        }
    }
    out
}

/// How long `auto down --only` waits for a revive in flight.
const DOWN_ONLY_WAIT_S: u64 = 45;

/// What `auto down --only` did: per room whether a live session was stopped, and the cards whose
/// claims went back to the board (`(card, room, lane)`).
#[derive(Debug)]
pub(super) struct DownOnly {
    pub(super) rooms: Vec<(String, bool)>,
    pub(super) freed: Vec<(u64, String, String)>,
}

/// `auto down --only <room,room…>`: stop those background rooms and drop them from the registry, so
/// `auto revive` never brings them back; auto and every other room keep running (HQ "Tự soi ảnh"
/// off stops `eye`, "Tắt Sấm Sét" the boost-only rooms). Cards they held go back to the board now.
pub(super) fn down_only(t: &Team, names: &[&str], now: u64) -> Result<DownOnly> {
    if names.is_empty() {
        bail!("`--only` cần tên phòng, vd `--only eye` hoặc `--only dev3,dev4`");
    }
    // A room is a role row (dev3, qa2, eye…) or a room this project registered (a custom topic):
    // a typo is refused before anything stops.
    let registered = t.store.load();
    if let Some(bad) = names.iter().find(|n| room::find(n).is_none() && !registered.sessions.iter().any(|s| s.name == **n)) {
        bail!("không có phòng `{bad}` (vd: {})", room::BOOST_TEAM.join(", "));
    }
    let list = names.join(",");
    // Under the revive lock: a revive mid-run must not resume a room this drops, untracked.
    // HQ revives every 2 min: wait for one in flight (≤ 45 s, inside HQ's 60 s switch-off call).
    let mut waited = 0;
    let _lock = loop {
        if let Some(l) = revive_lock(t.home, now + waited)? {
            break l;
        }
        if waited >= DOWN_ONLY_WAIT_S {
            bail!("đang có `auto revive` / `auto up` khác mở phòng (HQ tự mở lại phòng chết) — chờ ít phút rồi chạy lại `8sync ccc auto down --only {list}`");
        }
        if cfg!(test) {
            waited = DOWN_ONLY_WAIT_S;
        } else {
            std::thread::sleep(std::time::Duration::from_secs(3));
            waited += 3;
        }
    };
    let reg = t.store.load();
    // Ask Claude Code for its sessions only when there is a room to stop.
    let live = if names.iter().any(|n| reg.sessions.iter().any(|s| s.name == *n)) { agents(t, false)? } else { Vec::new() };
    let mut rooms = Vec::new();
    // Rooms already stopped keep their release even when a later stop fails (cards never stranded
    // for CLAIM_SECS); the failure is reported after it.
    let mut failed = None;
    for &name in names {
        let Some(s) = reg.sessions.iter().find(|s| s.name == name) else {
            rooms.push((name.to_string(), false));
            continue;
        };
        let title = (t.title)(name);
        let hit = live.iter().find(|l| l.background && (l.id == s.conversation_id || l.name == title));
        if let Some(l) = hit {
            if let Err(e) = t.claude.run(&["stop".into(), l.id.chars().take(8).collect()]) {
                failed = Some(e.context(format!("không dừng được phòng {name}")));
                break;
            }
        }
        if let Err(e) = t.store.remove(name) {
            failed = Some(e);
            break;
        }
        rooms.push((name.to_string(), hit.is_some()));
    }
    let done: Vec<&str> = rooms.iter().map(|(n, _)| n.as_str()).collect();
    let freed = super::target::release(t.home, t.root, &done, "tắt (down --only)", now)?;
    // Dropped from the team: not the guard's paused rooms any more either.
    super::pressure::unpause(t.home, t.root, &rooms.iter().map(|(n, _)| n.clone()).collect::<Vec<_>>());
    if let Some(e) = failed {
        return Err(e);
    }
    Ok(DownOnly { rooms, freed })
}

/// A session name fit for one report line. Sessions started before rooms got `--name` on a resume are
/// titled after their prompt (`/goal Phòng `lead` …`, `8sync auto --loop: … phòng `rd` …`): show
/// the room, not 3 KB of prompt (seen live 2026-10-18).
pub(super) fn short_name(name: &str) -> String {
    let n = name.trim();
    if n.is_empty() {
        return "(không tên)".into();
    }
    if n.starts_with("/goal ") || n.starts_with("8sync auto --loop") || n.starts_with("8sync auto: phòng `") {
        if let Some(room) = n.split('`').nth(1).filter(|r| !r.is_empty() && r.len() <= 40) {
            return room.to_string();
        }
    }
    crate::verbs::session_view::truncate(n, 40)
}

pub(super) fn print_up(status: &Value, gone: &[Gone], rows: &[Row], every: u64, subscription: bool) {
    println!("{}", auto::text(status));
    let (kept, deleted): (Vec<&Gone>, Vec<&Gone>) = gone.iter().partition(|g| g.kept.is_some());
    if !deleted.is_empty() {
        let names: Vec<String> = deleted.iter().map(|g| format!("{} {}", short_name(&g.name), g.short)).collect();
        println!("đã xoá {} session nền rác: {}", deleted.len(), names.join(", "));
    }
    for g in &kept {
        println!("  giữ {} {}: {}", short_name(&g.name), g.short, g.kept.as_deref().unwrap_or_default());
    }
    if !kept.is_empty() {
        // `claude rm` refuses while a worktree holds commits that are not pushed: that is the work.
        println!("  → giữ vì worktree còn commit chưa push: push nhánh đó (hoặc gỡ worktree nếu bỏ hẳn) rồi chạy lại `--clear-ss`. Phòng có tên của team không bao giờ bị xoá.");
    }
    println!("team: {} phòng · loop {every} phút mỗi phòng", rows.len());
    for r in rows {
        println!("  {:<10} {:<12} {:<9} {:<9} {}", r.name, r.role, r.model, r.short, r.state);
    }
    println!("Xem tiến độ: `8sync hq ui` (web) · `8sync ccc auto board` (card theo cột) · `claude agents`.");
    println!("Vào một phòng: `claude attach <id>` · log: `claude logs <id>` · dừng cả team: `8sync ccc auto down`.");
    println!("Giao việc: `8sync ccc auto add \"<việc>\" [--check \"<lệnh>\"]` → lead viết AC, dev/qa/review kéo card theo cột.");
    for l in auto::loop_notes(subscription).into_iter().skip(1) {
        println!("{l}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::path::PathBuf;

    /// Records every call; answers `agents --json` from `agents` (one entry per call, last one
    /// repeats) and `--bg` with `bg`.
    struct Fake {
        calls: RefCell<Vec<Vec<String>>>,
        agents: RefCell<Vec<String>>,
        bg: String,
    }

    impl Claude for Fake {
        fn run(&self, args: &[String]) -> Result<String> {
            self.calls.borrow_mut().push(args.to_vec());
            if args.first().map(String::as_str) == Some("agents") {
                let mut a = self.agents.borrow_mut();
                return Ok(if a.len() > 1 { a.remove(0) } else { a[0].clone() });
            }
            if args.iter().any(|a| a == "--bg") {
                let name = args.iter().position(|a| a == "--name").map(|i| args[i + 1].clone()).unwrap_or_else(|| "resumed".into());
                // a resumed room gets its own forked id, as Claude Code does (a resume carries --name too)
                let short = if args.iter().any(|a| a == "--resume") { "5a5a5a5a" } else { "3698e3a6" };
                return Ok(self.bg.replace("{name}", &name).replace("3698e3a6", short));
            }
            if args[0] == "rm" {
                return Ok(format!("cannot remove {}: worktree has unpushed commits\npass --discard-unpushed x@w", args[1]));
            }
            Ok(String::new())
        }
    }

    fn tmp(tag: &str) -> (PathBuf, PathBuf) {
        let h = std::env::temp_dir().join(format!("8sync-team-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&h);
        let root = h.join("proj");
        std::fs::create_dir_all(root.join(".git")).unwrap();
        (h, root)
    }

    fn agent(id: &str, name: &str, kind: &str) -> String {
        format!(r#"{{"pid":1,"cwd":"x","kind":"{kind}","sessionId":"{id}","name":"{name}","status":"idle","startedAt":1}}"#)
    }

    const DEV_BG: &str = "3698e3a6-9b73-4b37-ab3a-368b169d0508";

    #[test]
    fn parses_claude_code_output() {
        assert_eq!(short_id("\u{1b}[2mbackgrounded · 3698e3a6 · 8sync-bgprobe\u{1b}[0m\n").as_deref(), Some("3698e3a6"));
        assert_eq!(short_id("Workspace not trusted. Run `claude` in C:\\x once"), None);
        assert!(untrusted("Workspace not trusted. Run `claude` in C:\\x once and accept the trust prompt"));
        let l = live(&format!("[{},{}]", agent(DEV_BG, "dev", "background"), agent("11111111-1111-4111-8111-111111111111", "core", "interactive"))).unwrap();
        assert_eq!(l[0], Live { id: DEV_BG.into(), name: "dev".into(), background: true, started: 1, busy: false, cwd: "x".into(), pid: 1 });
        assert!(!l[1].background);
        assert!(live("error: unknown option '--json'").unwrap_err().to_string().contains("không trả JSON"));
        assert!(live(&format!("[{}]", agent("--discard-unpushed", "x", "background"))).unwrap().is_empty(), "never an id that reads as a flag");
    }

    #[test]
    fn plan_skips_live_rooms_and_resumes_stopped_ones() {
        let l = vec![Live { id: DEV_BG.into(), name: "dev".into(), background: true, started: 0, busy: false, cwd: String::new(), pid: 0 }, Live { id: "x".into(), name: "qa".into(), background: false, started: 0, busy: false, cwd: String::new(), pid: 0 }];
        assert_eq!(plan(DEV_BG, "dev", &l, &l, true), Plan::Running(DEV_BG.into()));
        assert_eq!(plan("other", "dev", &l, &l, false), Plan::Running(DEV_BG.into()), "a background room with the name counts");
        assert_eq!(plan("other", "qa", &l, &l, true), Plan::Resume, "an interactive session elsewhere with the same name does not");
        assert_eq!(plan("other", "qa", &l, &l, false), Plan::Start);
        // the room's id open in a terminal in another folder: never resumed a second time
        let rd = "ff3e2a54-0000-4000-8000-000000000001";
        let elsewhere = vec![Live { id: rd.into(), name: "rd-game".into(), background: false, started: 0, busy: false, cwd: String::new(), pid: 0 }];
        assert_eq!(plan(rd, "rd", &[], &elsewhere, true), Plan::Running(rd.into()));
        let bg_elsewhere = vec![Live { id: "e1".into(), name: "dev".into(), background: true, started: 0, busy: false, cwd: String::new(), pid: 0 }];
        assert_eq!(plan("other", "dev", &[], &bg_elsewhere, false), Plan::Start, "a same-named room of another project is not ours");
        let s = Path::new("/st/room-settings.json");
        let a = argv(&Plan::Start, "id-1", "dev", Some("sonnet"), s, "line one\nline  two");
        assert_eq!(a, ["--bg", "--name", "dev", "--permission-mode", "auto", "--settings", "/st/room-settings.json", "--model", "sonnet", "line one line two"]);
        let a = argv(&Plan::Resume, "id-1", "dev", None, s, "p");
        // The room keeps its name on a resume (else Claude Code titles it after the /goal prompt), and
        // its bounded compaction window.
        assert_eq!(a, ["--resume", "id-1", "--bg", "--name", "dev", "--permission-mode", "auto", "--settings", "/st/room-settings.json", "p"]);
        assert!(!a.iter().any(|x| x.contains("dangerously") || x == "bypassPermissions"));
    }

    #[test]
    fn options_default_to_the_five_room_team_and_full_opens_six_builder_heavy() {
        let o = parse(&[]).unwrap();
        assert_eq!((o.roles.join(","), o.every, o.rate), ("lead,dev,qa,review,rd".into(), 30, None));
        let v = |a: &[&str]| a.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(parse(&v(&["--roles", "full"])).unwrap().roles.join(","), "lead,dev,dev2,ui,qa,review");
        let boost = parse(&v(&["--roles", "boost"])).unwrap().roles;
        assert!(boost.len() == room::BOOST_TEAM.len() && boost.iter().all(|n| room::find(n).is_some()), "{boost:?}");
        assert_eq!(boost.iter().filter(|n| room::find(n).and_then(|r| r.lane) == Some("qa")).count(), 2, "two rooms gate");
        assert_eq!(parse(&v(&["--roles", "small"])).unwrap().roles.len(), 5);
        // Every room of the full team has a role.
        assert!(room::FULL_TEAM.iter().all(|n| room::find(n).is_some()), "{:?}", room::FULL_TEAM);
        let o = parse(&v(&["--roles", "lead, ba,dev,dev2,qc,dev", "--loop", "45m", "--usd-per-hour", "3"])).unwrap();
        assert_eq!((o.roles.join(","), o.every, o.rate), ("lead,ba,dev,dev2,qc".into(), 45, Some(3.0)));
        assert!(parse(&v(&["--loop", "10m"])).is_err(), "backup cron under 30 min is refused");
        assert!(parse(&v(&["--roles"])).is_err());
        assert!(parse(&v(&["--roles", ","])).is_err());
        assert!(parse(&v(&["--loop", "90m"])).is_err());
        assert!(parse(&v(&["--team"])).is_err());
        assert!(!o.clear);
        assert!(parse(&v(&["--clear-ss"])).unwrap().clear && parse(&v(&["--clean"])).unwrap().clear);
        assert!(!o.omp && parse(&v(&["--omp", "--roles", "lead,dev"])).unwrap().omp);
    }

    #[test]
    fn lane_rooms_open_on_a_goal_that_ends_only_when_auto_stops() {
        for name in ["lead", "ba", "dev", "dev2", "qa", "qc", "review", "critic", "ui", "api", "core"] {
            let lane = room::find(name).and_then(|r| r.lane).unwrap_or_else(|| panic!("{name} has a lane"));
            let g = goal_prompt(name, lane, auto::DEFAULT_LOOP_MIN);
            assert!(g.starts_with(&format!("/goal Phòng `{name}`")), "{g}");
            assert!(g.chars().count() <= GOAL_MAX, "{name}: {} chars over Claude Code's /goal cap", g.chars().count());
            assert!(!g.contains('\n'), "one line through a .cmd shim");
            for want in ["auto claim --json", "auto wait --json", "\"wake\":\"off\"", "`cap` khác null", "CronCreate", "câu Ship", &format!("cột {lane}"), &format!("--as {name}")] {
                assert!(g.contains(want), "{name} misses {want}: {g}");
            }
            // No empty-lane exit: the goal stays live while auto is on. A card from the wait is
            // worked in the same turn, a new approval loops the lead back to (1) (`auto merge`).
            // Team rooms wait the full 30 min: the Bash call (room_settings) outlives it.
            let cond = &g[g.find("Điều kiện đạt").expect("condition")..];
            assert!(!cond.contains("không có card") && !cond.contains("chờ xong"), "{name}: {cond}");
            assert!(g.contains("`\"wake\":\"card\"` → claim (2) và làm card đó ngay lượt này; `\"wake\":\"merge\"` → quay lại (1)"), "{g}");
            assert!(g.contains("auto wait --json` (Bash timeout") && !g.contains("--timeout"), "{g}");
            if lane == "backlog" {
                // the lead asks the Ship question in the turn auto merge refuses, before it waits
                let ship = g.find("NGAY lượt này, trước mọi `auto wait`, hỏi MỘT câu AskUserQuestion Ship").unwrap_or_else(|| panic!("{name}: {g}"));
                assert!(ship < g.find("(3) không có card").unwrap(), "{name}: {g}");
            }
            assert!(g.contains(&format!("Bash timeout {BASH_MAX_MS}")) && BASH_MAX_MS > auto::WAIT_MAX_S * 1000 && auto::WAIT_MAX_S >= 1800);
            assert!(g.contains("cron `*/30 * * * *`"), "{g}");
        }
        // rooms without a lane get no goal (and no cron: auto::events_only)
        assert!(room::find("rd").and_then(|r| r.lane).is_none());
    }

    #[test]
    fn room_settings_lift_the_bash_ceiling_over_auto_wait() {
        let h = std::env::temp_dir().join(format!("8sync-room-settings-{}", crate::verbs::uuid_sessions::new_uuid()));
        let v: Value = serde_json::from_str(&std::fs::read_to_string(room_settings(&h, false).unwrap()).unwrap()).unwrap();
        assert_eq!(v["env"]["BASH_MAX_TIMEOUT_MS"], BASH_MAX_MS.to_string());
        assert_eq!(v["env"][super::super::compact::WIN_VAR], ROOM_WINDOW.to_string());
        assert!(v.get("enabledPlugins").is_none());
        // A lean room: same env, the user's LSP plugins off (the rest of the user's plugins stay on).
        let off = ["typescript-lsp@claude-plugins-official".to_string()];
        let deny = ["codebase-memory-mcp".to_string(), "serena".to_string()];
        let lean = room_settings_with(&h, &off, &deny).unwrap();
        assert!(lean.ends_with("room-settings-lean.json"));
        let v: Value = serde_json::from_str(&std::fs::read_to_string(lean).unwrap()).unwrap();
        assert_eq!(v["env"]["BASH_MAX_TIMEOUT_MS"], BASH_MAX_MS.to_string());
        assert_eq!(v["enabledPlugins"], json!({ "typescript-lsp@claude-plugins-official": false }));
        assert_eq!(v["deniedMcpServers"], json!([{ "serverName": "codebase-memory-mcp" }, { "serverName": "serena" }]));
        assert!(room_settings_with(&h, &[], &[]).unwrap().ends_with("room-settings.json"), "nothing to turn off: the plain file");
        // A lean room always denies the indexers, so it always gets the lean file.
        assert!(room_settings(&h, true).unwrap().ends_with("room-settings-lean.json"));
        let _ = std::fs::remove_dir_all(&h);
    }

    #[test]
    fn junk_is_every_background_session_no_room_keeps() {
        let bg = |id: &str, name: &str| Live { id: id.into(), name: name.into(), background: true, started: 0, busy: false, cwd: String::new(), pid: 0 };
        let all = vec![
            bg("d1", "dev"),
            bg("d2", "dev"),
            Live { id: "l1".into(), name: "lead".into(), background: false, started: 0, busy: false, cwd: String::new(), pid: 0 },
            bg("l2", "lead"),
            bg("q1", "qa"),
            bg("u1", "ui"),
            Live { id: "n1".into(), name: "notes".into(), background: false, started: 0, busy: false, cwd: String::new(), pid: 0 },
        ];
        // dev: registry id gone → first background "dev" kept; lead: registry id is the terminal;
        // qa: registry id itself. Duplicates, other names and nothing interactive are junk.
        let keep = [("old".to_string(), "dev".to_string()), ("l1".into(), "lead".into()), ("q1".into(), "qa".into())];
        let ids: Vec<&str> = junk(&all, &keep).iter().map(|l| l.id.as_str()).collect();
        assert_eq!(ids, ["d2", "l2", "u1"]);
        assert!(junk(&all[..1], &keep).is_empty());
    }

    #[test]
    fn clear_ss_reloads_a_background_room_that_runs_an_older_kit() {
        // Owner 2026-10-17: after an update, `auto up --clear-ss` should bring the running team onto it.
        let (h, root) = tmp("reload");
        let store = Store::new(&h.join("cfg"), &root, "claude-sessions", "ccc .");
        let lead = store.touch("lead", false).unwrap();
        store.touch("dev", false).unwrap();
        store.rebind("dev", DEV_BG).unwrap();
        let (l, d) = (agent(&lead.conversation_id, "lead", "interactive"), agent(DEV_BG, "dev", "background"));
        let forked = agent("5a5a5a5a-0000-4000-8000-000000000009", "dev", "background");
        let fake = Fake { calls: RefCell::new(vec![]), agents: RefCell::new(vec![format!("[{l},{d}]"), format!("[{l},{d}]"), format!("[{l},{d}]"), format!("[{l},{d}]"), format!("[{l},{forked}]")]), bg: "backgrounded · 3698e3a6 · {name}".into() };
        // Both sessions started at 1 ms; the kit wrote settings at 1000 ms.
        let t = Team { home: &h, root: &root, store: &store, subscription: true, claude: &fake, has_transcript: &|_: &str| true, title: &|n: &str| n.to_string(), kit_at: Some(1000) };
        let o = Opts { roles: vec!["lead".into(), "dev".into()], every: 10, hours: 2.0, rate: None, clear: true, task: None, check: None, omp: false, add: false };
        let (_, _, rows) = up(&t, &o, 1).unwrap();
        let calls = fake.calls.borrow();
        let stops: Vec<_> = calls.iter().filter(|c| c[0] == "stop").map(|c| c[1].clone()).collect();
        assert_eq!(stops, [DEV_BG[..8].to_string()], "only the background room; the owner's interactive lead is never touched");
        assert!(calls.iter().any(|c| c[0] == "--resume" && c[1] == DEV_BG), "same conversation, resumed");
        assert!(rows[1].state.starts_with("khởi động lại nền"), "{:?}", rows[1]);
        assert!(rows[0].state.starts_with("đang chạy"));
        assert_eq!(store.load().sessions.iter().find(|s| s.name == "dev").unwrap().conversation_id, "5a5a5a5a-0000-4000-8000-000000000009", "registry follows the fork");
        // Without --clear-ss an idle background lane room is resumed too: idle means its /goal ended
        // (3d-game 2026-10-20, rooms re-armed after the lease ran only on their 30-min cron).
        drop(calls);
        fake.calls.borrow_mut().clear();
        *fake.agents.borrow_mut() = vec![format!("[{l},{forked}]")];
        let o2 = Opts { clear: false, ..o.clone() };
        up(&t, &o2, 2).unwrap();
        let stops: Vec<_> = fake.calls.borrow().iter().filter(|c| c[0] == "stop").map(|c| c[1].clone()).collect();
        assert_eq!(stops, ["5a5a5a5a"], "the idle dev room; the owner's interactive lead is never touched");
        fake.calls.borrow_mut().clear();
        // Review 2026-10-18: a room mid-turn, or one whose transcript is gone, is never stopped to reload.
        let busy = agent("5a5a5a5a-0000-4000-8000-000000000009", "dev", "background").replace("\"idle\"", "\"running\"");
        *fake.agents.borrow_mut() = vec![format!("[{l},{busy}]")];
        up(&t, &o, 3).unwrap();
        assert!(!fake.calls.borrow().iter().any(|c| c[0] == "stop"), "busy room left running");
        *fake.agents.borrow_mut() = vec![format!("[{l},{forked}]")];
        let gone = Team { has_transcript: &|_: &str| false, ..t };
        up(&gone, &o, 4).unwrap();
        assert!(!fake.calls.borrow().iter().any(|c| c[0] == "stop"), "no transcript: no resume possible, left running");
        let _ = std::fs::remove_dir_all(&h);
    }

    #[test]
    fn revive_resumes_only_team_rooms_whose_background_session_died() {
        // Owner 2026-10-19: the machine was shut down with auto on; after boot HQ said "Đang làm"
        // but nothing ran until a terminal was opened.
        let (h, root) = tmp("revive");
        let store = Store::new(&h.join("cfg"), &root, "claude-sessions", "ccc .");
        let qa = store.touch("qa", false).unwrap(); // died with the machine
        let lead = store.touch("lead", false).unwrap(); // died, but the owner already reopened it under a new id
        let notes = store.touch("notes", false).unwrap(); // not a role: the owner's own room
        store.touch("dev", false).unwrap(); // never ran in the background: `up` starts it, revive does not
        let review = store.touch("review", false).unwrap(); // died here, but the owner opened it in a terminal elsewhere
        let reopened = "e1056947-0000-4000-8000-000000000001";
        let forked = "5a5a5a5a-0000-4000-8000-000000000009";
        let all = format!(
            "[{},{},{},{},{}]",
            agent(&qa.conversation_id, "qa", "background"),
            agent(&lead.conversation_id, "lead", "background"),
            agent(reopened, "lead", "background"),
            agent(&notes.conversation_id, "notes", "background"),
            agent(&review.conversation_id, "review", "background")
        );
        let live = format!("[{}]", agent(reopened, "lead", "background"));
        // Machine-wide: review's own id runs in another folder's terminal.
        let everywhere = format!("[{},{}]", agent(reopened, "lead", "background"), agent(&review.conversation_id, "notes-elsewhere", "interactive"));
        let after = format!("[{},{}]", agent(reopened, "lead", "background"), agent(forked, "qa", "background"));
        let fake = Fake { calls: RefCell::new(vec![]), agents: RefCell::new(vec![all.clone(), live.clone(), everywhere.clone(), after]), bg: "backgrounded · 3698e3a6 · {name}".into() };
        let t = Team { home: &h, root: &root, store: &store, subscription: false, claude: &fake, has_transcript: &|_: &str| true, title: &|n: &str| n.to_string(), kit_at: None };
        assert!(revive(&t, 10, 1).unwrap().is_empty(), "auto off: nothing");
        assert!(fake.calls.borrow().is_empty(), "not even a `claude agents` call");

        auto::set(&h, auto::Mode::On { hours: 2.0, after: 60, rate: None, repo: Some(root.clone()) }, false, 1).unwrap();
        let rows = revive(&t, 10, 2).unwrap();
        assert_eq!(rows.iter().map(|r| r.name.as_str()).collect::<Vec<_>>(), ["qa"]);
        let calls = fake.calls.borrow();
        let bg: Vec<_> = calls.iter().filter(|c| c.iter().any(|a| a == "--bg")).collect();
        assert_eq!(bg.len(), 1, "{bg:?}");
        assert_eq!(&bg[0][..5], ["--resume", qa.conversation_id.as_str(), "--bg", "--name", "qa"]);
        assert!(bg[0].iter().any(|a| a == "auto") && !bg[0].iter().any(|a| a.contains("bypass")));
        assert_eq!(store.load().sessions.iter().find(|s| s.name == "qa").unwrap().conversation_id, forked, "registry follows the fork");
        drop(calls);

        // Once it runs again (busy: on its goal) a second pass does nothing; and nothing while paused or out of scope.
        fake.calls.borrow_mut().clear();
        let running = format!("[{},{}]", agent(reopened, "lead", "background"), agent(forked, "qa", "background").replace("\"idle\"", "\"running\""));
        *fake.agents.borrow_mut() = vec![all.replace(&qa.conversation_id, forked), running, everywhere.clone()];
        assert!(revive(&t, 10, 3).unwrap().is_empty());
        // Live but idle: its goal ended with the last lease. Resumed with its goal only when idle at two
        // runs ≥ IDLE_CONFIRM_S apart, its inbox is empty, and it is still idle right before the stop.
        let idle_qa = format!("[{},{}]", agent(reopened, "lead", "background"), agent(forked, "qa", "background"));
        let busy_qa = format!("[{},{}]", agent(reopened, "lead", "background"), agent(forked, "qa", "background").replace("\"idle\"", "\"running\""));
        let base = vec![all.replace(&qa.conversation_id, forked), idle_qa.clone(), everywhere.clone()];
        let pass = |at: u64, extra: Option<&String>| {
            fake.calls.borrow_mut().clear();
            *fake.agents.borrow_mut() = base.iter().chain(extra).cloned().collect();
            revive(&t, 10, at).unwrap()
        };
        let stopped = || fake.calls.borrow().iter().any(|c| c[0] == "stop");
        assert!(pass(10, None).is_empty() && !stopped(), "first sighting");
        assert!(pass(30, None).is_empty() && !stopped(), "20 s later: too soon");
        let inbox = crate::verbs::hq::inbox_file(&h, forked).unwrap();
        std::fs::create_dir_all(inbox.parent().unwrap()).unwrap();
        std::fs::write(&inbox, "{\"ts\":1,\"text\":\"owner\"}\n").unwrap();
        assert!(pass(80, Some(&idle_qa)).is_empty() && !stopped(), "a queued message: the inbox mod wakes it, a fork would lose it");
        std::fs::remove_file(&inbox).unwrap();
        assert!(pass(85, Some(&busy_qa)).is_empty() && !stopped(), "woken since the list: mid-turn, not stopped");
        let rows = pass(90, Some(&idle_qa));
        assert_eq!(rows.iter().map(|r| (r.name.as_str(), r.state.as_str())).collect::<Vec<_>>(), [("qa", "chạy lại /goal (phòng đứng không việc)")]);
        let calls = fake.calls.borrow();
        assert!(calls.iter().any(|c| c[..] == ["stop".to_string(), forked[..8].to_string()]), "{calls:?}");
        let bg: Vec<_> = calls.iter().filter(|c| c.iter().any(|a| a == "--bg")).collect();
        assert_eq!(&bg[0][..2], ["--resume", forked]);
        assert!(bg[0].iter().any(|a| a.starts_with("/goal")), "resumed with its goal: {:?}", bg[0]);
        drop(calls);
        assert!(pass(100, Some(&idle_qa)).is_empty() && !stopped(), "resumed 10 s ago: backed off");
        // After the backoff: a first sighting again; one far older than IDLE_STALE_S restarts the count.
        assert!(pass(700, Some(&idle_qa)).is_empty() && !stopped(), "first sighting after the backoff");
        assert!(pass(1100, Some(&idle_qa)).is_empty() && !stopped(), "400 s old sighting: stale, counted again");
        assert_eq!(pass(1170, Some(&idle_qa)).len(), 1, "70 s after a fresh sighting: resumed");
        // The owner's ⚡ Làm ngay called qa: no 60 s wait and no backoff, but never with a message
        // waiting and only when the fresh look right before the stop still shows it idle. The mark
        // is spent by a real re-arm only.
        ask_wake(&h, &root, &["qa".to_string()], 1180);
        let marked = || woken(&h, &root, ["qa".to_string()].into_iter(), 1186) == ["qa"];
        std::fs::write(&inbox, "{\"ts\":1,\"text\":\"owner\"}\n").unwrap();
        assert!(pass(1182, Some(&idle_qa)).is_empty() && !stopped(), "a message waiting: the inbox mod hands it over first");
        assert!(marked(), "kept while a message waits");
        std::fs::remove_file(&inbox).unwrap();
        assert!(pass(1183, Some(&busy_qa)).is_empty() && !stopped(), "between two turns: the fresh look shows it busy");
        assert!(marked(), "kept when the room was busy");
        assert_eq!(pass(1185, Some(&idle_qa)).len(), 1, "idle at both looks: resumed with its goal at once");
        assert!(!marked(), "spent by the re-arm");
        assert!(pass(1190, Some(&idle_qa)).is_empty() && !stopped(), "the call is spent: backed off again");
        auto::mark_paused(&h, 4).unwrap();
        *fake.agents.borrow_mut() = vec![all, live];
        fake.calls.borrow_mut().clear();
        assert!(revive(&t, 10, 5).unwrap().is_empty());
        assert!(fake.calls.borrow().is_empty());
        let _ = std::fs::remove_dir_all(&h);
    }

    /// ⚡ Làm ngay starts at most one background revive a minute, none while one holds the lock,
    /// and mails the lead once per card per 10 min.
    #[test]
    fn rush_spawns_revive_and_mails_the_lead_with_a_debounce() {
        let (h, root) = tmp("rush-debounce");
        assert!(rush_spawn_due(&h, 100));
        assert!(!rush_spawn_due(&h, 159), "spawned 59 s ago");
        assert!(rush_spawn_due(&h, 160));
        let lock = revive_lock(&h, 300).unwrap().unwrap();
        assert!(!rush_spawn_due(&h, 300), "a live revive holds the lock: its next run takes the marks");
        drop(lock);
        assert!(rush_spawn_due(&h, 300));
        assert!(rush_mail_due(&h, &root, 21, 1000));
        assert!(!rush_mail_due(&h, &root, 21, 1599));
        assert!(rush_mail_due(&h, &root, 20, 1599), "per card");
        assert!(rush_mail_due(&h, &root, 21, 1600));
        // Marks written while another writer holds the file lock still land (it waits, then writes).
        let lock = wake_file(&h).with_extension("lock");
        std::fs::write(&lock, "").unwrap();
        let t0 = std::time::Instant::now();
        ask_wake(&h, &root, &["dev".to_string()], 5);
        assert!(t0.elapsed() >= std::time::Duration::from_millis(500), "waited for the holder");
        assert_eq!(woken(&h, &root, ["dev".to_string()].into_iter(), 5), ["dev"]);
        let _ = std::fs::remove_dir_all(&h);
    }

    #[test]
    fn revive_keeps_guard_paused_rooms_down_and_restarts_heavy_rooms_lean() {
        let (h, root) = tmp("guard");
        let store = Store::new(&h.join("cfg"), &root, "claude-sessions", "ccc .");
        let qa = store.touch("qa", false).unwrap(); // died: resumed
        let review2 = store.touch("review2", false).unwrap(); // paused by the guard: stays down
        let dev = store.touch("dev", false).unwrap(); // live, idle, heavy: the guard asked for a lean restart
        auto::set(&h, auto::Mode::On { hours: 2.0, after: 60, rate: None, repo: Some(root.clone()) }, false, 1).unwrap();
        let k = root.to_string_lossy().into_owned();
        idle::write_json(&idle::state_dir(&h).join("guard.json"), &json!({ k: { "level": 2, "paused": ["review2"], "restart": [{ "name": "dev", "waiting": false, "pid": 1 }] } }));
        let all = format!("[{},{},{}]", agent(&qa.conversation_id, "qa", "background"), agent(&review2.conversation_id, "review2", "background"), agent(&dev.conversation_id, "dev", "background"));
        let running = format!("[{}]", agent(&dev.conversation_id, "dev", "background"));
        let after = format!("[{}]", agent("5a5a5a5a-0000-4000-8000-000000000009", "qa", "background"));
        // all, running, everywhere, dev's re-check right before its stop, then the rebind.
        let fake = Fake { calls: RefCell::new(vec![]), agents: RefCell::new(vec![all, running.clone(), running.clone(), running, after]), bg: "backgrounded · 3698e3a6 · {name}".into() };
        let t = Team { home: &h, root: &root, store: &store, subscription: false, claude: &fake, has_transcript: &|_: &str| true, title: &|n: &str| n.to_string(), kit_at: None };
        let rows = revive(&t, 10, 2).unwrap();
        let mut got: Vec<(&str, &str)> = rows.iter().map(|r| (r.name.as_str(), r.state.as_str())).collect();
        got.sort();
        assert_eq!(got, [("dev", "khởi động lại gọn nhẹ (máy quá tải: tắt LSP + MCP index, cùng hội thoại)"), ("qa", "chạy lại nền (phiên cũ đã chết)")]);
        let calls = fake.calls.borrow();
        let stops: Vec<_> = calls.iter().filter(|c| c[0] == "stop").map(|c| c[1].clone()).collect();
        assert_eq!(stops, [dev.conversation_id[..8].to_string()], "only the room to restart is stopped");
        let bg: Vec<_> = calls.iter().filter(|c| c.iter().any(|a| a == "--bg")).collect();
        assert!(!bg.iter().any(|c| c[1] == review2.conversation_id), "a paused room is not revived");
        let lean = "room-settings-lean.json";
        for c in &bg {
            let s = c.iter().position(|a| a == "--settings").map(|i| c[i + 1].clone()).unwrap();
            assert!(s.ends_with(lean), "dev at L2 and qa (no builder) start lean: {s}");
        }
        drop(calls);
        assert_eq!(super::super::pressure::paused(&h, &root), ["review2"]);
        assert!(super::super::pressure::restarts(&h, &root).is_empty(), "done: no longer asked");
        let _ = std::fs::remove_dir_all(&h);
    }

    #[test]
    fn a_lean_restart_waits_while_the_room_works_or_has_mail() {
        let (h, root) = tmp("guard-busy");
        let store = Store::new(&h.join("cfg"), &root, "claude-sessions", "ccc .");
        let dev = store.touch("dev", false).unwrap();
        auto::set(&h, auto::Mode::On { hours: 2.0, after: 60, rate: None, repo: Some(root.clone()) }, false, 1).unwrap();
        let k = root.to_string_lossy().into_owned();
        let ask = || idle::write_json(&idle::state_dir(&h).join("guard.json"), &json!({ k.clone(): { "level": 2, "restart": [{ "name": "dev", "waiting": false, "pid": 1 }] } }));
        let t_with = |fake: &Fake| -> Vec<(String, String)> {
            let t = Team { home: &h, root: &root, store: &store, subscription: false, claude: fake, has_transcript: &|_: &str| true, title: &|n: &str| n.to_string(), kit_at: None };
            revive(&t, 10, 2).unwrap().into_iter().map(|r| (r.name, r.state)).collect()
        };
        let idle_dev = format!("[{}]", agent(&dev.conversation_id, "dev", "background"));
        let busy_dev = idle_dev.replace("\"idle\"", "\"running\"");
        // Idle when the guard picked it, mid-turn by the stop: not stopped, still asked.
        ask();
        let fake = Fake { calls: RefCell::new(vec![]), agents: RefCell::new(vec![idle_dev.clone(), idle_dev.clone(), idle_dev.clone(), busy_dev]), bg: "backgrounded · 3698e3a6 · {name}".into() };
        let rows = t_with(&fake);
        assert_eq!(rows, [("dev".to_string(), "chưa khởi động lại gọn nhẹ: phòng đang làm hoặc còn tin chưa đọc (thử lượt sau)".to_string())]);
        assert!(!fake.calls.borrow().iter().any(|c| c[0] == "stop" || c.iter().any(|a| a == "--bg")));
        assert_eq!(super::super::pressure::restarts(&h, &root).len(), 1, "retried next tick");
        // Idle but a message waits in its inbox: a resume would fork an id that never reads it.
        let inbox = crate::verbs::hq::inbox_file(&h, &dev.conversation_id).unwrap();
        std::fs::create_dir_all(inbox.parent().unwrap()).unwrap();
        std::fs::write(&inbox, "{\"text\":\"x\"}\n").unwrap();
        let fake = Fake { calls: RefCell::new(vec![]), agents: RefCell::new(vec![idle_dev]), bg: "backgrounded · 3698e3a6 · {name}".into() };
        let rows = t_with(&fake);
        assert_eq!(rows.len(), 1);
        assert!(!fake.calls.borrow().iter().any(|c| c[0] == "stop"), "never stopped with mail waiting");
        let _ = std::fs::remove_dir_all(&h);
    }

    #[test]
    fn clear_ss_deletes_junk_then_opens_the_team() {
        let (h, root) = tmp("clear");
        let store = Store::new(&h.join("cfg"), &root, "claude-sessions", "ccc .");
        let lead = store.touch("lead", false).unwrap();
        let ui = store.touch("ui", false).unwrap();
        let (dup, stuck, notes) = ("aaaaaaaa-0000-4000-8000-000000000001", "bbbbbbbb-0000-4000-8000-000000000002", "cccccccc-0000-4000-8000-000000000003");
        let row = |id: &str, n: &str, k: &str| agent(id, n, k);
        let (l, d, x, o, s, i) = (
            row(&lead.conversation_id, "lead", "interactive"),
            row(DEV_BG, "dev", "background"),
            row(dup, "dev", "background"),
            row(&ui.conversation_id, "ui", "background"),
            row(stuck, "x", "background"),
            row(notes, "notes", "interactive"),
        );
        let fake = Fake {
            calls: RefCell::new(vec![]),
            agents: RefCell::new(vec![
                format!("[{l},{d},{x},{o},{s},{i}]"), // --all: finished ones too
                format!("[{l},{d},{x},{i}]"),         // running
                format!("[{l},{d},{s},{i}]"),         // --all after rm: `x` refused
                format!("[{l},{d},{i}]"),
            ]),
            bg: String::new(),
        };
        let t = Team { home: &h, root: &root, store: &store, subscription: true, claude: &fake, has_transcript: &|_: &str| false, title: &|n: &str| n.to_string(), kit_at: None };
        let o = Opts { roles: vec!["lead".into(), "dev".into()], every: 10, hours: 2.0, rate: None, clear: true, task: None, check: None, omp: false, add: false };
        let (_, gone, rows) = up(&t, &o, 1).unwrap();
        let g: Vec<_> = gone.iter().map(|g| (g.name.as_str(), g.short.as_str(), g.kept.is_some())).collect();
        assert_eq!(g, [("dev", "aaaaaaaa", false), ("ui", &ui.conversation_id[..8], false), ("x", "bbbbbbbb", true)]);
        assert!(gone[2].kept.as_deref().unwrap().contains("unpushed"));
        let calls = fake.calls.borrow();
        let did = |verb: &str| calls.iter().filter(|c| c[0] == verb).map(|c| c[1].clone()).collect::<Vec<_>>();
        assert_eq!(did("stop"), ["aaaaaaaa"], "only the running junk is stopped first");
        assert_eq!(did("rm"), ["aaaaaaaa", &ui.conversation_id[..8], "bbbbbbbb"]);
        assert!(!calls.iter().any(|c| c.iter().any(|a| a == "--bg")), "both rooms were live");
        let reg = store.load();
        let names: Vec<_> = reg.sessions.iter().map(|s| s.name.as_str()).collect();
        assert!(!names.contains(&"ui"), "the deleted room left the registry: {names:?}");
        assert_eq!(reg.sessions.iter().find(|s| s.name == "dev").unwrap().conversation_id, DEV_BG);
        assert!(rows.iter().all(|r| r.state.starts_with("đang chạy")));
        let _ = std::fs::remove_dir_all(&h);
    }

    #[test]
    fn up_opens_missing_rooms_in_the_background_and_rebinds_the_registry() {
        let (h, root) = tmp("up");
        let store = Store::new(&h.join("cfg"), &root, "claude-sessions", "ccc .");
        let lead = store.touch("lead", false).unwrap();
        let qa = store.touch("qa", false).unwrap();
        // lead is live (interactive, owner's terminal); qa stopped with a transcript; dev, review new.
        let first = format!("[{}]", agent(&lead.conversation_id, "lead", "interactive"));
        let qa_fork = "5a5a5a5a-1111-4111-8111-111111111111";
        let after = format!(
            "[{},{},{}]",
            agent(&lead.conversation_id, "lead", "interactive"),
            agent(DEV_BG, "dev", "background"),
            agent(qa_fork, "qa", "background")
        );
        let fake = Fake { calls: RefCell::new(vec![]), agents: RefCell::new(vec![first, after]), bg: "backgrounded · 3698e3a6 · {name}\n".into() };
        let qa_id = qa.conversation_id.clone();
        let has = move |id: &str| id == qa_id;
        let t = Team { home: &h, root: &root, store: &store, subscription: true, claude: &fake, has_transcript: &has, title: &|n: &str| n.to_string(), kit_at: None };
        let o = Opts { roles: vec!["lead".into(), "dev".into(), "qa".into()], every: 10, hours: 2.0, rate: None, clear: false, task: None, check: None, omp: false, add: false };
        let (status, _, rows) = up(&t, &o, 1_000).unwrap();
        assert_eq!(status["on"], true);
        assert!(status["repo"].as_str().is_some(), "auto is scoped to the project");
        assert!(root.join(".claude/loop.md").is_file());
        let states: Vec<_> = rows.iter().map(|r| (r.name.as_str(), r.model.as_str(), r.state.split(' ').next().unwrap())).collect();
        assert_eq!(states, [("lead", "opus", "đang"), ("dev", "sonnet", "mở"), ("qa", "sonnet", "chạy")]);
        let calls = fake.calls.borrow();
        let bg: Vec<_> = calls.iter().filter(|c| c.iter().any(|a| a == "--bg")).collect();
        assert_eq!(bg.len(), 2, "lead is live: no second session");
        assert_eq!(&bg[0][..6], ["--bg", "--name", "dev", "--permission-mode", "auto", "--settings"]);
        assert!(bg[0][6].ends_with("room-settings.json") && std::fs::read_to_string(&bg[0][6]).unwrap().contains("\"CLAUDE_CODE_AUTO_COMPACT_WINDOW\":\"300000\""), "{}", bg[0][6]);
        assert_eq!(&bg[0][7..9], ["--model", "sonnet"]);
        assert!(bg[0][9].starts_with("/goal Phòng `dev`"), "a lane room opens on /goal: {}", bg[0][9]);
        assert!(bg[0][9].contains("8sync-auto-loop dev (vai Dev/Builder)"), "{}", bg[0][9]);
        assert!(bg[1].iter().any(|a| a == "--settings"), "a resumed room gets the window too");
        assert_eq!(&bg[1][..3], ["--resume", qa.conversation_id.as_str(), "--bg"]);
        let reg = store.load();
        let id_of = |n: &str| reg.sessions.iter().find(|s| s.name == n).unwrap().conversation_id.clone();
        assert_eq!(id_of("dev"), DEV_BG, "registry follows the id Claude Code picked");
        assert_eq!(id_of("lead"), lead.conversation_id);
        assert_eq!(id_of("qa"), qa_fork, "a resumed room runs under a forked id: the registry follows it");
        let _ = std::fs::remove_dir_all(&h);
    }

    #[test]
    fn up_stops_on_an_untrusted_workspace_and_down_stops_only_background_rooms() {
        let (h, root) = tmp("trust");
        let store = Store::new(&h.join("cfg"), &root, "claude-sessions", "ccc .");
        let fake = Fake { calls: RefCell::new(vec![]), agents: RefCell::new(vec!["[]".into()]), bg: "Workspace not trusted. Run `claude` in C:\\proj once and accept the trust prompt".into() };
        let t = Team { home: &h, root: &root, store: &store, subscription: false, claude: &fake, has_transcript: &|_: &str| false, title: &|n: &str| n.to_string(), kit_at: None };
        let o = Opts { roles: vec!["dev".into(), "qa".into()], every: 10, hours: 2.0, rate: None, clear: false, task: None, check: None, omp: false, add: false };
        let e = up(&t, &o, 1).unwrap_err().to_string();
        assert!(e.contains("chưa trust") && e.contains("8sync ccc auto up"), "{e}");
        assert_eq!(fake.calls.borrow().iter().filter(|c| c.iter().any(|a| a == "--bg")).count(), 1, "stops at the first room");
        assert!(up(&t, &Opts { roles: vec!["../x".into()], every: 10, hours: 2.0, rate: None, clear: false, task: None, check: None, omp: false, add: false }, 1).is_err());
        // `auto revive` walks exactly the roots `up` brought a team up in (here only this one, once).
        assert_eq!(team_roots(&h), [root.to_string_lossy().into_owned()]);

        let dev = store.touch("dev", false).unwrap();
        let mine = store.touch("lead", false).unwrap();
        let other = "22222222-2222-4222-8222-222222222222";
        let list = format!("[{},{},{}]", agent(&dev.conversation_id, "dev", "background"), agent(&mine.conversation_id, "lead", "interactive"), agent(other, "x", "background"));
        let fake = Fake { calls: RefCell::new(vec![]), agents: RefCell::new(vec![list]), bg: String::new() };
        let t = Team { claude: &fake, ..t };
        assert_eq!(down(&t, 2).unwrap(), ["dev"]);
        let stops: Vec<_> = fake.calls.borrow().iter().filter(|c| c[0] == "stop").cloned().collect();
        assert_eq!(stops, [vec!["stop".to_string(), dev.conversation_id[..8].to_string()]]);
        assert_eq!(auto::status(&h, false, 3)["paused"], true);
        assert!(team_roots(&h).is_empty(), "down takes the root out of revive's list");
        let _ = std::fs::remove_dir_all(&h);
    }

    #[test]
    fn a_team_root_never_sits_in_another() {
        let (h, root) = tmp("nested-roots");
        let child = root.join("game").join("3d-game");
        std::fs::create_dir_all(&child).unwrap();
        set_team_root(&h, &root, true);
        set_team_root(&h, &child, true);
        assert_eq!(team_roots(&h), vec![child.to_string_lossy().into_owned()], "the parent's team is not revived beside the child's");
        // auto's remembered projects count too: `up` here stops the team of the repo it sits in.
        auto::set(&h, auto::Mode::On { hours: 2.0, after: 60, rate: None, repo: Some(root.clone()) }, false, 1).unwrap();
        let found: Vec<PathBuf> = nested_teams(&h, &child).iter().map(|p| auto::canon(p)).collect();
        assert_eq!(found, vec![auto::canon(&root)]);
        assert!(nested_teams(&h, &h.join("elsewhere")).is_empty());
    }

    #[test]
    fn one_revive_at_a_time_and_a_stale_lock_is_replaced() {
        let (h, _) = tmp("revlock");
        let held = revive_lock(&h, 1_000).unwrap().expect("first run takes the lock");
        assert!(revive_lock(&h, 1_100).unwrap().is_none(), "a second revive does nothing");
        drop(held);
        assert!(!idle::state_dir(&h).join("revive.lock").exists(), "dropped with the guard");
        let _left = revive_lock(&h, 2_000).unwrap().expect("free again");
        std::mem::forget(_left); // a killed run leaves the file behind
        assert!(revive_lock(&h, 2_000 + REVIVE_LOCK_S - 1).unwrap().is_none());
        let again = revive_lock(&h, 2_000 + REVIVE_LOCK_S).unwrap();
        assert!(again.is_some(), "a lock older than {REVIVE_LOCK_S}s is stale");
        drop(again);
        // A fresh lock whose process is gone is free at once.
        let mut done = if cfg!(windows) { std::process::Command::new("cmd").args(["/c", "exit"]).spawn().unwrap() } else { std::process::Command::new("true").spawn().unwrap() };
        let dead = done.id();
        done.wait().unwrap();
        assert!(!pid_alive(dead) && pid_alive(std::process::id()));
        std::fs::write(idle::state_dir(&h).join("revive.lock"), format!("3000.{dead}")).unwrap();
        assert!(revive_lock(&h, 3_001).unwrap().is_some(), "its holder died: taken over");
        let _ = std::fs::remove_dir_all(&h);
    }

    fn agent_in(id: &str, name: &str, kind: &str, cwd: &Path) -> String {
        format!(r#"{{"pid":1,"cwd":{},"kind":"{kind}","sessionId":"{id}","name":"{name}","status":"idle","startedAt":1}}"#, serde_json::json!(cwd.to_string_lossy()))
    }

    #[test]
    fn a_nested_repo_and_a_subfolder_are_told_apart() {
        // Live 2026-10-18: ai-game-studio is a git repo inside 8sync-startup; `auto up` in the outer
        // one took over the game's rooms, and `auto up` in apps/hq-ui opened a second team.
        let (h, root) = tmp("nested");
        let game = root.join("game/ai");
        std::fs::create_dir_all(game.join(".git")).unwrap();
        std::fs::create_dir_all(root.join("apps/hq-ui")).unwrap();
        std::fs::write(root.join("apps/hq-ui/package.json"), "{}").unwrap();
        let wt = game.join(".claude/worktrees/card-26");
        std::fs::create_dir_all(&wt).unwrap();
        std::fs::write(wt.join(".git"), "gitdir: x").unwrap();
        let repo = |p: &Path| auto::canon(&crate::verbs::here::repo_of(p).unwrap());
        assert_eq!(repo(&root.join("apps/hq-ui")), auto::canon(&root), "a package.json subfolder is the same repo");
        assert_eq!(repo(&game), auto::canon(&game), "a nested repo is its own");
        assert_eq!(repo(&wt), auto::canon(&game), "a Claude Code worktree belongs to its repo");
        let at = |cwd: &Path| Live { id: "a".into(), name: "lead".into(), background: true, started: 0, busy: false, cwd: cwd.to_string_lossy().into_owned(), pid: 0 };
        assert!(in_repo(&at(&root.join("apps/hq-ui")), &root));
        assert!(!in_repo(&at(&game), &root));
        assert!(!in_repo(&at(&wt), &root));
        assert!(in_repo(&at(&wt), &game));
        let _ = std::fs::remove_dir_all(&h);
    }

    #[test]
    fn up_never_takes_a_nested_repos_room_and_starts_its_own() {
        let (h, root) = tmp("takeover");
        let game = root.join("game/ai");
        std::fs::create_dir_all(game.join(".git")).unwrap();
        let store = Store::new(&h.join("cfg"), &root, "claude-sessions", "ccc .");
        // An older `up` bound this repo's lead to the game's running lead.
        let game_lead = "e1a4e6de-0000-4000-8000-000000000001";
        store.touch("lead", false).unwrap();
        store.rebind("lead", game_lead).unwrap();
        let list = format!("[{},{}]", agent_in(game_lead, "lead", "background", &game), agent_in(DEV_BG, "dev", "background", &game));
        let fake = Fake { calls: RefCell::new(vec![]), agents: RefCell::new(vec![list]), bg: "backgrounded · 3698e3a6 · {name}\n".into() };
        let t = Team { home: &h, root: &root, store: &store, subscription: true, claude: &fake, has_transcript: &|id: &str| id == game_lead, title: &|n: &str| n.to_string(), kit_at: None };
        let o = Opts { roles: vec!["lead".into(), "dev".into()], every: 10, hours: 2.0, rate: None, clear: false, task: Some("BE AI zus".into()), check: None, omp: false, add: false };
        let (status, _, rows) = up(&t, &o, 1_000).unwrap();
        let states: Vec<_> = rows.iter().map(|r| r.state.split(' ').next().unwrap()).collect();
        assert_eq!(states, ["mở", "mở"], "neither the game's lead nor its dev is ours: {rows:?}");
        let bg: Vec<_> = fake.calls.borrow().iter().filter(|c| c.iter().any(|a| a == "--bg")).cloned().collect();
        assert!(bg.iter().all(|c| !c.iter().any(|a| a == "--resume")), "never resumes the game's conversation: {bg:?}");
        assert!(fake.calls.borrow().iter().all(|c| c[0] != "stop"), "the game's rooms are left alone");
        // The task given to `up` is the head of this repo's queue before any room starts.
        let (head, _) = super::super::target::current(&h, &root).unwrap();
        assert_eq!(head.unwrap().text, "BE AI zus");
        assert!(super::super::target::list(&h, &game).unwrap().is_empty(), "not on the game's board");
        assert_eq!(status["on"], true);
        let _ = std::fs::remove_dir_all(&h);
    }

    #[test]
    fn down_stops_rooms_by_title_too_and_leaves_other_projects_on() {
        let (h, root) = tmp("down2");
        let other = h.join("other");
        std::fs::create_dir_all(other.join(".git")).unwrap();
        // Two projects run teams at once.
        auto::set(&h, auto::Mode::On { hours: 2.0, after: 60, rate: None, repo: Some(other.clone()) }, false, 1).unwrap();
        auto::set(&h, auto::Mode::On { hours: 2.0, after: 60, rate: None, repo: Some(root.clone()) }, false, 1).unwrap();
        assert_eq!(auto::status(&h, false, 2)["repos"].as_array().unwrap().len(), 2);
        let store = Store::new(&h.join("cfg"), &root, "claude-sessions", "ccc .");
        store.touch("lead", false).unwrap();
        // Both run an auto-ship loop: `down` ends this project's only.
        for r in [&root, &other] {
            set_team_root(&h, r, true);
            super::super::ship_loop::on(&h, r, None, 1).unwrap();
        }
        // `up` could not rebind yet: the room runs under an id the registry does not know.
        let list = format!("[{},{}]", agent_in(DEV_BG, "lead", "background", &root), agent_in("33333333-3333-4333-8333-333333333333", "lead", "background", &other));
        let fake = Fake { calls: RefCell::new(vec![]), agents: RefCell::new(vec![list]), bg: String::new() };
        let t = Team { home: &h, root: &root, store: &store, subscription: false, claude: &fake, has_transcript: &|_: &str| false, title: &|n: &str| n.to_string(), kit_at: None };
        assert_eq!(down(&t, 3).unwrap(), ["lead"]);
        assert!(super::super::ship_loop::get(&h, &root).is_none() && super::super::ship_loop::get(&h, &other).is_some(), "only this project's loop ends");
        let stops: Vec<_> = fake.calls.borrow().iter().filter(|c| c[0] == "stop").map(|c| c[1].clone()).collect();
        assert_eq!(stops, [DEV_BG[..8].to_string()], "only this project's lead");
        let st = auto::status(&h, false, 4);
        assert_eq!((st["on"].as_bool(), st["paused"].as_bool()), (Some(true), Some(false)), "the other project keeps running");
        assert!(auto::in_scope(&h, Some(&other.to_string_lossy())));
        assert!(!auto::in_scope(&h, Some(&root.to_string_lossy())), "this one is out of auto");
        // The last project out pauses auto, as before.
        let t2 = Team { root: &other, ..t };
        down(&t2, 5).unwrap();
        assert_eq!(auto::status(&h, false, 6)["paused"], true);
        let _ = std::fs::remove_dir_all(&h);
    }

    #[test]
    fn junk_sessions_titled_after_their_prompt_show_the_room_name() {
        assert_eq!(short_name("/goal Phòng `lead` (vai Lead/PM: điều phối board …) làm việc liên tục"), "lead");
        assert_eq!(short_name("8sync auto --loop: owner bật chạy liên tục cho phòng `rd` (vai R&D …"), "rd");
        assert_eq!(short_name("8sync auto: phòng `arch` (vai Architect: …) không giữ cột board"), "arch");
        assert_eq!(short_name("dev"), "dev");
        assert_eq!(short_name(""), "(không tên)");
        assert!(short_name(&"x".repeat(300)).chars().count() <= 41);
    }

    #[test]
    fn up_takes_a_task_and_its_check() {
        let o = parse(&["fix".into(), "login".into(), "--check".into(), "pnpm test".into(), "--roles".into(), "full".into()]).unwrap();
        assert_eq!((o.task.as_deref(), o.check.as_deref(), o.roles.len()), (Some("fix login"), Some("pnpm test"), 6));
        assert!(parse(&["--check".into(), "x".into()]).is_err(), "a check needs a task");
        assert!(parse(&["--bogus".into()]).is_err());
        assert_eq!(parse(&[]).unwrap().task, None);
    }

    #[test]
    fn the_eye_opens_on_a_goal_that_waits_for_image_messages_only() {
        let g = first_prompt("eye", None, auto::DEFAULT_LOOP_MIN);
        assert_eq!(g, eye_prompt("eye"));
        assert!(g.starts_with("/goal Phòng `eye` (vai Soi ảnh"), "{g}");
        assert!(g.chars().count() <= GOAL_MAX, "eye: {} chars over Claude Code's /goal cap", g.chars().count());
        assert!(!g.contains('\n'), "one line through a .cmd shim");
        for want in [
            "CÓ `[ảnh mới] card #`",
            "`[từ phòng terminal]`",
            "tin khác bỏ qua",
            "`8sync ccc auto board --json`",
            "card #N HIỆN TẠI",
            "note của owner mới hơn thắng AC cũ",
            "Read từng ảnh",
            "dẫn tên file ảnh",
            "không khen",
            "\"không đủ để kết luận\"",
            "`8sync ccc auto note N \"[soi ảnh] Đạt: … · Lệch AC: … · Đề xuất: …\" --as eye`",
            "≤ 400 ký tự",
            "`8sync ccc msg lead",
            "--from eye",
            "`8sync ccc auto wait --json --mail --as eye`",
            "\"wake\":\"off\"",
            "không sửa file",
            "không `auto claim|move|add|done`",
        ] {
            assert!(g.contains(want), "eye misses {want}: {g}");
        }
        assert!(!g.contains("auto claim --json") && !g.contains("CronCreate"), "no lane, no cron: {g}");
        assert!(g.contains(&format!("Bash timeout {BASH_MAX_MS}")));
        // Revive and up treat an idle eye like an idle lane room (its goal ended); rd stays events-only.
        let idle = Live { id: "e".into(), name: "eye".into(), background: true, started: 0, busy: false, cwd: String::new(), pid: 0 };
        assert!(lost_goal(on_goal("eye"), &idle) && !lost_goal(on_goal("rd"), &idle));
        assert!(first_prompt("rd", None, 30).starts_with("8sync auto: phòng `rd`"));
    }

    #[test]
    fn the_sweep_opens_on_a_strict_event_driven_goal() {
        let g = first_prompt("sweep", None, auto::DEFAULT_LOOP_MIN);
        assert_eq!(g, sweep_prompt("sweep"));
        assert!(g.starts_with("/goal Phòng `sweep` (vai Dọn máy"), "{g}");
        assert!(g.chars().count() <= GOAL_MAX, "sweep: {} chars over Claude Code's /goal cap", g.chars().count());
        assert!(!g.contains('\n'), "one line through a .cmd shim");
        for want in [
            // Events only: a timeout or a cap ends the turn, other rooms' replies never start a scan.
            "`8sync ccc auto wait --json --mail --as sweep`",
            "không tự quét định kỳ",
            "còn lại (hết giờ, `\"wake\":\"cap\"`) → kết thúc lượt, không quét gì",
            "`cap` khác null → chỉ chạy (2)",
            "Tin khác (phòng trả lời tin của bạn…) → không quét, không trả lời",
            "\"wake\":\"off\"",
            // `[máy]`: processes only, one dry run, no network or disk.
            "`[máy] …` của HQ: chỉ xem tiến trình, `8sync ccc auto guard --dry-run` tối đa MỘT lần mỗi lần thức; không git fetch, không gh, không đo đĩa",
            // Disk: HQ's listed items, sizes already reclaimable.
            "chỉ xét đúng các mục tin liệt kê",
            "không tự du/đo lại node_modules/target",
            "node_modules của pnpm/bun là hardlink vào store: xoá gần như không lấy lại chỗ",
            "KHÔNG BAO GIỜ xoá việc chưa commit hoặc chưa push",
            "`git -C <wt> status --porcelain --ignored` không có gì ngoài target/.next/node_modules/dist",
            "nhánh có commit riêng và HEAD = headRefOid của một PR đã MERGED",
            "`gh pr list --state merged --head <nhánh>",
            "`git worktree remove <wt>` (không --force)",
            "chỉ dọn bằng lệnh của công cụ",
            "không tiến trình phòng nào chạy trong worktree đó",
            "File đã commit lớn: không tự sửa, báo lead",
            "AskUserQuestion",
            "chỉ báo dung lượng, không xoá",
            "sống > 5 phút",
            "nhắn phòng đó trước",
            "kiểm lại cùng PID, tên ảnh, dòng lệnh, cwd trong worktree đó và giờ bắt đầu",
            "không kill theo tên",
            "Không đụng dự án khác",
            // Told once; the lead only when something was freed.
            "`<git-common-dir>/8sync-sweep-sent.txt`",
            "dòng đã có → không báo lại",
            "`8sync ccc msg <phòng> \"…\" --from sweep`",
            "PID/port/đường dẫn",
            "lead chỉ khi THẬT đã giải phóng chỗ, mỗi mục một lần",
            "`8sync ccc msg lead \"[dọn máy] giải phóng <MB/GB>",
            "`8sync ccc msg --all \"…\" --from sweep`",
            "không copy repo/node_modules ra %TEMP%",
            "tắt vite/server khi xong card",
            "`cargo build -j2`",
            "không viết code",
            "không `auto claim|move|add|done`, không move card",
            "không `git commit|reset|clean -f|checkout|stash`",
        ] {
            assert!(g.contains(want), "sweep misses {want}: {g}");
        }
        for gone in ["--timeout", "git fetch origin`", "--is-ancestor", "trả claim", "PR riêng", "trừ bản sao %TEMP%"] {
            assert!(!g.contains(gone), "sweep still has {gone}: {g}");
        }
        assert!(!g.contains("auto claim --json") && !g.contains("CronCreate"), "no lane, no cron: {g}");
        assert!(g.contains(&format!("Bash timeout {BASH_MAX_MS}")));
        let idle = Live { id: "s".into(), name: "sweep".into(), background: true, started: 0, busy: false, cwd: String::new(), pid: 0 };
        assert!(lost_goal(on_goal("sweep"), &idle), "an idle sweep is brought back on its goal");
    }

    #[test]
    fn add_sweep_opens_it_lean_on_sonnet_and_down_only_sweep_stops_just_it() {
        let v = |a: &[&str]| a.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        let o = parse(&v(&["--add", "sweep"])).unwrap();
        assert_eq!((o.roles.join(","), o.add), ("sweep".to_string(), true));
        let (h, root) = tmp("add-sweep");
        let store = Store::new(&h.join("cfg"), &root, "claude-sessions", "ccc .");
        let lead = store.touch("lead", false).unwrap();
        let team = format!("[{}]", agent_in(&lead.conversation_id, "lead", "background", &root));
        let sweep_id = "3698e3a6-0000-4000-8000-000000005eef";
        let with_sweep = format!("[{},{}]", agent_in(&lead.conversation_id, "lead", "background", &root), agent_in(sweep_id, "sweep", "background", &root));
        let fake = Fake { calls: RefCell::new(vec![]), agents: RefCell::new(vec![team.clone(), team, with_sweep.clone()]), bg: "backgrounded · 3698e3a6 · {name}\n".into() };
        let t = Team { home: &h, root: &root, store: &store, subscription: false, claude: &fake, has_transcript: &|_: &str| false, title: &|n: &str| n.to_string(), kit_at: None };
        assert!(up_locked(&t, &o, 1_000, || Ok(())).unwrap_err().to_string().contains("chưa chạy"), "only into a running team");
        auto::set(&h, auto::Mode::On { hours: 8.0, after: 60, rate: None, repo: Some(root.clone()) }, false, 900).unwrap();
        set_team_root(&h, &root, true);
        let (_, _, rows) = up_locked(&t, &o, 1_000, || panic!("`--add` never stops a nested team")).unwrap();
        assert_eq!(rows.iter().map(|r| (r.name.as_str(), r.model.as_str())).collect::<Vec<_>>(), [("sweep", "sonnet")]);
        let calls = fake.calls.borrow();
        let bg: Vec<_> = calls.iter().filter(|c| c.iter().any(|a| a == "--bg")).collect();
        assert_eq!(bg.len(), 1, "only the sweep opens: {bg:?}");
        assert_eq!(&bg[0][..3], ["--bg", "--name", "sweep"]);
        let settings = bg[0].windows(2).find(|w| w[0] == "--settings").map(|w| w[1].clone()).unwrap();
        assert!(settings.ends_with("room-settings-lean.json"), "lean: no LSP plugins, no indexing MCP: {settings}");
        assert!(bg[0].last().unwrap().starts_with("/goal Phòng `sweep`"), "{:?}", bg[0].last());
        drop(calls);
        // Running already: a second `--add sweep` sends nothing (no loop message to a /goal room).
        fake.calls.borrow_mut().clear();
        *fake.agents.borrow_mut() = vec![with_sweep.replace(r#""name":"sweep","status":"idle""#, r#""name":"sweep","status":"running""#)];
        let (_, _, rows) = up(&t, &o, 1_001).unwrap();
        assert_eq!(rows[0].state, "đang chạy");
        assert!(!fake.calls.borrow().iter().any(|c| c[0] == "stop" || c.iter().any(|a| a == "--bg")));
        // Off: only the sweep stops and leaves the registry; the lead and auto run on.
        fake.calls.borrow_mut().clear();
        *fake.agents.borrow_mut() = vec![with_sweep];
        let r = down_only(&t, &["sweep"], 1_004).unwrap();
        assert_eq!(r.rooms, vec![("sweep".to_string(), true)]);
        let stops: Vec<_> = fake.calls.borrow().iter().filter(|c| c[0] == "stop").map(|c| c[1].clone()).collect();
        assert_eq!(stops, [sweep_id[..8].to_string()]);
        assert_eq!(store.load().sessions.iter().map(|s| s.name.clone()).collect::<Vec<_>>(), ["lead"]);
        assert!(auto::running(&h));
        let _ = std::fs::remove_dir_all(&h);
    }

    #[test]
    fn add_opens_one_room_in_a_running_team_and_down_only_stops_just_that_room() {
        let v = |a: &[&str]| a.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        let o = parse(&v(&["--add", "eye"])).unwrap();
        assert_eq!((o.roles.join(","), o.add, o.clear, o.omp, o.task.clone()), ("eye".to_string(), true, false, false, None));
        for bad in [&["--add"][..], &["--add", "eye", "--roles", "full"], &["--add", "--roles"], &["--roles", "lead", "--add", "eye"], &["--add", "eye", "--hours", "8"]] {
            assert!(parse(&v(bad)).is_err(), "{bad:?}");
        }

        let (h, root) = tmp("add");
        let store = Store::new(&h.join("cfg"), &root, "claude-sessions", "ccc .");
        let lead = store.touch("lead", false).unwrap();
        store.touch("dev", false).unwrap();
        // The fake opens rooms as 3698e3a6: the dev must not share that prefix with the new eye.
        let dev_id = "bbbbbbbb-9b73-4b37-ab3a-368b169d0508";
        store.rebind("dev", dev_id).unwrap();
        let team = format!("[{},{}]", agent_in(&lead.conversation_id, "lead", "background", &root), agent_in(dev_id, "dev", "background", &root));
        let eye_id = "3698e3a6-0000-4000-8000-00000000e7e0";
        let with_eye = format!("[{},{},{}]", agent_in(&lead.conversation_id, "lead", "background", &root), agent_in(dev_id, "dev", "background", &root), agent_in(eye_id, "eye", "background", &root));
        let fake = Fake { calls: RefCell::new(vec![]), agents: RefCell::new(vec![team.clone(), team, with_eye.clone()]), bg: "backgrounded · 3698e3a6 · {name}\n".into() };
        let t = Team { home: &h, root: &root, store: &store, subscription: false, claude: &fake, has_transcript: &|_: &str| false, title: &|n: &str| n.to_string(), kit_at: None };

        // No team here yet: refused before nested teams are stopped or any `claude` call, nothing on.
        let nested = std::cell::Cell::new(0);
        let e = up_locked(&t, &o, 1_000, || Ok(nested.set(nested.get() + 1))).unwrap_err().to_string();
        assert!(e.contains("chưa chạy"), "{e}");
        assert_eq!(nested.get(), 0, "`--add` never stops a nested team");
        assert!(fake.calls.borrow().is_empty());
        assert!(!auto::running(&h));
        // A whole-team `up` does stop them first (and here stops at that error, nothing started).
        let whole = Opts { add: false, ..parse(&[]).unwrap() };
        assert!(up_locked(&t, &whole, 1_000, || anyhow::bail!("nested down failed")).is_err());
        assert!(fake.calls.borrow().is_empty() && !auto::running(&h));

        // The team runs here with the owner's own lease and cap: `--add eye` leaves both as they are.
        auto::set(&h, auto::Mode::On { hours: 8.0, after: 60, rate: Some(3.0), repo: Some(root.clone()) }, false, 900).unwrap();
        set_team_root(&h, &root, true);
        let before = auto::status(&h, false, 1_000);
        // The guard paused review2 (and an older eye): `--add eye` ends only the eye's pause.
        let guard = idle::state_dir(&h).join("guard.json");
        let k = root.to_string_lossy().into_owned();
        idle::write_json(&guard, &json!({ k.clone(): { "paused": ["review2", "eye"] } }));
        let (status, gone, rows) = up_locked(&t, &o, 1_000, || panic!("`--add` never stops a nested team")).unwrap();
        assert_eq!(super::super::pressure::paused(&h, &root), ["review2"], "`up --add` is not a whole-team up");
        let strip = |mut v: Value| {
            v.as_object_mut().map(|o| o.remove("guard"));
            v
        };
        assert_eq!(strip(status), strip(before.clone()), "auto untouched");
        assert_eq!(strip(auto::status(&h, false, 1_000)), strip(before));
        assert!(gone.is_empty());
        assert_eq!(rows.iter().map(|r| (r.name.as_str(), r.model.as_str(), r.state.as_str())).collect::<Vec<_>>(), [("eye", "sonnet", "mở nền")]);
        let calls = fake.calls.borrow();
        assert!(!calls.iter().any(|c| c[0] == "stop"), "no other room is stopped or restarted: {calls:?}");
        let bg: Vec<_> = calls.iter().filter(|c| c.iter().any(|a| a == "--bg")).collect();
        assert_eq!(bg.len(), 1, "only the eye opens: {bg:?}");
        assert_eq!(&bg[0][..3], ["--bg", "--name", "eye"]);
        assert!(bg[0].windows(2).any(|w| w[0] == "--model" && w[1] == "sonnet"));
        assert!(bg[0].last().unwrap().starts_with("/goal Phòng `eye`"), "{:?}", bg[0].last());
        drop(calls);
        assert_eq!(store.load().sessions.iter().find(|s| s.name == "eye").unwrap().conversation_id, eye_id, "registry follows the id Claude Code picked");
        assert_eq!(team_roots(&h).len(), 1);

        // Running already: a second `--add eye` sends nothing (no loop message to a /goal room).
        fake.calls.borrow_mut().clear();
        *fake.agents.borrow_mut() = vec![with_eye.replace(r#""name":"eye","status":"idle""#, r#""name":"eye","status":"running""#)];
        let (_, _, rows) = up(&t, &o, 1_001).unwrap();
        assert_eq!(rows[0].state, "đang chạy");
        assert!(!fake.calls.borrow().iter().any(|c| c[0] == "stop" || c.iter().any(|a| a == "--bg")));

        // Off: refused while a revive holds the lock (it could resume the eye it drops, untracked).
        fake.calls.borrow_mut().clear();
        *fake.agents.borrow_mut() = vec![with_eye];
        let held = revive_lock(&h, 1_002).unwrap().unwrap();
        let e = down_only(&t, &["eye"], 1_003).unwrap_err().to_string();
        assert!(e.contains("auto revive") && e.contains("down --only eye"), "{e}");
        assert!(fake.calls.borrow().is_empty() && store.load().sessions.iter().any(|s| s.name == "eye"), "nothing stopped, nothing dropped");
        drop(held);
        // Free: only the eye stops and leaves the registry (revive never brings it back); auto runs on.
        idle::write_json(&guard, &json!({ k.clone(): { "paused": ["review2", "eye"] } }));
        let r = down_only(&t, &["eye"], 1_004).unwrap();
        assert_eq!((r.rooms, r.freed), (vec![("eye".to_string(), true)], vec![]));
        assert_eq!(super::super::pressure::paused(&h, &root), ["review2"], "a dropped room leaves the paused list");
        let stops: Vec<_> = fake.calls.borrow().iter().filter(|c| c[0] == "stop").map(|c| c[1].clone()).collect();
        assert_eq!(stops, [eye_id[..8].to_string()]);
        let names: Vec<_> = store.load().sessions.iter().map(|s| s.name.clone()).collect();
        assert_eq!(names, ["lead", "dev"]);
        assert!(auto::running(&h) && auto::in_scope(&h, Some(&root.to_string_lossy())) && team_roots(&h).len() == 1);
        assert!(revive_lock(&h, 1_005).unwrap().is_some(), "the lock is released");
        fake.calls.borrow_mut().clear();
        assert_eq!(down_only(&t, &["eye"], 1_006).unwrap().rooms, [("eye".to_string(), false)], "already gone: nothing to stop");
        assert!(fake.calls.borrow().is_empty());
        let _ = std::fs::remove_dir_all(&h);
    }

    #[test]
    fn down_only_a_room_list_stops_them_under_one_lock_and_frees_only_their_cards() {
        assert_eq!(only_list(" ba, dev3,,dev3 ,qa2"), ["ba", "dev3", "qa2"]);
        assert!(only_list(" , ").is_empty());

        let (h, root) = tmp("down-only-list");
        let store = Store::new(&h.join("cfg"), &root, "claude-sessions", "ccc .");
        let ids = ["aaaaaaaa-0000-4000-8000-000000000001", "bbbbbbbb-0000-4000-8000-000000000002", "cccccccc-0000-4000-8000-000000000003"];
        for (n, id) in ["dev", "dev3", "qa2"].iter().zip(ids) {
            store.touch(n, false).unwrap();
            store.rebind(n, id).unwrap();
        }
        let live = format!("[{},{},{}]", agent_in(ids[0], "dev", "background", &root), agent_in(ids[1], "dev3", "background", &root), agent_in(ids[2], "qa2", "background", &root));
        let fake = Fake { calls: RefCell::new(vec![]), agents: RefCell::new(vec![live]), bg: String::new() };
        let t = Team { home: &h, root: &root, store: &store, subscription: false, claude: &fake, has_transcript: &|_: &str| false, title: &|n: &str| n.to_string(), kit_at: None };

        // dev3 and dev each build a card; qa2 holds a qa card.
        use super::super::target;
        let a = target::add(&h, &root, "a", Some("true"), None, false, None, 0).unwrap().0;
        let b = target::add(&h, &root, "b", Some("true"), None, false, None, 0).unwrap().0;
        let q = target::add(&h, &root, "uat", Some("true"), Some("qa"), false, None, 0).unwrap().0;
        assert_eq!(target::claim(&h, &root, "dev3", "ready", 10).unwrap().map(|c| c.id), Some(a.id));
        assert_eq!(target::claim(&h, &root, "dev", "ready", 10).unwrap().map(|c| c.id), Some(b.id));
        assert_eq!(target::claim(&h, &root, "qa2", "qa", 10).unwrap().map(|c| c.id), Some(q.id));

        // A typo (no role row, not registered) is refused before the lock or any `claude` call.
        let e = down_only(&t, &["dev3", "dve3"], 20).unwrap_err().to_string();
        assert!(e.contains("dve3"), "{e}");
        assert!(fake.calls.borrow().is_empty() && store.load().sessions.len() == 3);

        // Held lock: refused as a whole, the retry names the whole list.
        let held = revive_lock(&h, 20).unwrap().unwrap();
        let e = down_only(&t, &["dev3", "qa2"], 21).unwrap_err().to_string();
        assert!(e.contains("down --only dev3,qa2"), "{e}");
        assert!(fake.calls.borrow().is_empty());
        drop(held);

        let r = down_only(&t, &["dev3", "qa2"], 30).unwrap();
        assert_eq!(r.rooms, [("dev3".to_string(), true), ("qa2".to_string(), true)]);
        let stops: Vec<_> = fake.calls.borrow().iter().filter(|c| c[0] == "stop").map(|c| c[1].clone()).collect();
        assert_eq!(stops, [ids[1][..8].to_string(), ids[2][..8].to_string()]);
        assert_eq!(fake.calls.borrow().iter().filter(|c| c[0] == "agents").count(), 1, "one look at the live rooms");
        assert_eq!(store.load().sessions.iter().map(|s| s.name.as_str()).collect::<Vec<_>>(), ["dev"]);
        assert!(revive_lock(&h, 31).unwrap().is_some(), "the lock is released");
        assert_eq!(r.freed, [(a.id, "dev3".to_string(), "ready".to_string()), (q.id, "qa2".to_string(), "qa".to_string())]);
        let cards = target::list(&h, &root).unwrap();
        let card = |id| cards.iter().find(|c| c.id == id).unwrap();
        assert_eq!((card(a.id).lane.as_str(), card(a.id).claim.is_none()), ("ready", true), "building → ready");
        assert!(card(a.id).notes.iter().any(|n| n.text == "↩ dev3 tắt (down --only): trả về ready"));
        assert_eq!((card(q.id).lane.as_str(), card(q.id).claim.is_none()), ("qa", true), "qa stays in qa, unclaimed");
        assert!(card(q.id).notes.iter().any(|n| n.text == "↩ qa2 tắt (down --only): trả về qa"));
        assert_eq!((card(b.id).lane.as_str(), card(b.id).claim.as_ref().map(|c| c.room.as_str())), ("building", Some("dev")), "the staying room keeps its card");
        let _ = std::fs::remove_dir_all(&h);
    }

    fn usage_snap(home: &Path, five: f64, ts: u64) {
        let d = super::super::report::usage_dir(home);
        std::fs::create_dir_all(&d).unwrap();
        std::fs::write(d.join("s.json"), json!({ "session_id": "s", "ts": ts, "five_hour_pct": five }).to_string()).unwrap();
    }

    /// One project with a `qa` room whose background session died; `revive` either resumes it or not.
    fn died_qa(h: &Path, root: &Path) -> Store {
        let store = Store::new(&h.join("cfg").join(root.file_name().unwrap()), root, "claude-sessions", "ccc .");
        store.touch("qa", false).unwrap();
        store
    }

    fn resumed(t_home: &Path, root: &Path, store: &Store, subscription: bool, now: u64) -> bool {
        let qa = store.load().sessions.into_iter().find(|s| s.name == "qa").unwrap().conversation_id;
        let all = format!("[{}]", agent(&qa, "qa", "background"));
        let fake = Fake { calls: RefCell::new(vec![]), agents: RefCell::new(vec![all, "[]".into(), "[]".into(), "[]".into()]), bg: "backgrounded · 3698e3a6 · {name}".into() };
        let t = Team { home: t_home, root, store, subscription, claude: &fake, has_transcript: &|_: &str| true, title: &|n: &str| n.to_string(), kit_at: None };
        revive(&t, 10, now).unwrap();
        let n = fake.calls.borrow().iter().filter(|c| c.iter().any(|a| a == "--bg")).count();
        n == 1
    }

    #[test]
    fn revive_rests_at_the_usage_window_and_wakes_by_itself_when_it_drops() {
        let (h, root) = tmp("window");
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs();
        let store = died_qa(&h, &root);
        auto::set(&h, auto::Mode::On { hours: 2.0, after: 60, rate: None, repo: Some(root.clone()) }, true, now).unwrap();
        usage_snap(&h, 91.0, now);
        assert!(!resumed(&h, &root, &store, true, now), "5-hour window at 91%: the team rests");
        assert_eq!(auto::status(&h, true, now)["lease_rest"]["kind"], "usage");
        usage_snap(&h, 40.0, now + 60);
        assert!(resumed(&h, &root, &store, true, now + 60), "the window dropped while the lease holds: woken without the owner");
        let _ = std::fs::remove_dir_all(&h);
    }

    #[test]
    fn tight_usage_wakes_only_pinned_projects_and_no_pins_changes_nothing() {
        let (h, a) = tmp("focus");
        let b = h.join("other");
        std::fs::create_dir_all(b.join(".git")).unwrap();
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs();
        let (sa, sb) = (died_qa(&h, &a), died_qa(&h, &b));
        for r in [&a, &b] {
            auto::set(&h, auto::Mode::On { hours: 2.0, after: 60, rate: None, repo: Some(r.clone()) }, false, now).unwrap();
        }
        usage_snap(&h, 75.0, now);
        // Nothing pinned: tight usage changes nothing.
        assert!(resumed(&h, &b, &sb, false, now));
        super::super::lease::set_pin(&h, &a, true, now);
        assert!(!resumed(&h, &b, &sb, false, now), "tight: the unpinned project rests");
        assert!(super::super::lease::focus_rest(&h, &b, now).unwrap().contains("nhường usage cho dự án ghim"));
        assert!(resumed(&h, &a, &sa, false, now), "the pinned one wakes");
        usage_snap(&h, 30.0, now);
        assert!(resumed(&h, &b, &sb, false, now), "usage loose: everything runs");
        let _ = std::fs::remove_dir_all(&h);
    }
}
