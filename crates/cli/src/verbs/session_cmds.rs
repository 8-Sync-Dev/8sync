//! `8sync ls`, `8sync show <name>`, `8sync guide` — one place to see every
//! engine's sessions (omp, Claude Code, Forge, Feynman) and what each is doing.
//! Rendering/parsing lives in `session_view.rs`.

use anyhow::{bail, Context, Result};
use clap::Args as ClapArgs;
use owo_colors::OwoColorize;
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use crate::{env_detect::Env, ui};

use super::session_view::{self as view, Row, Status, TaskState};
use super::{session, uuid_sessions};

/// (engine, registry dir under `~/.config/8sync/`, resume prefix for hints)
type Groups = Vec<(&'static str, Vec<Row>)>;

const ENGINES: [(&str, &str); 4] = [("omp", "sessions"), ("ccc", "claude-sessions"), ("forge", "forge-sessions"), ("feynman", "feynman-sessions")];

#[derive(ClapArgs, Debug)]
#[command(
    after_help = indoc::indoc! {"
        EXAMPLES
          8sync ls                    every engine's sessions in this repo, grouped (omp · ccc · forge · feynman)
          8sync ls --all              one line per session across ALL repos the registries know
          8sync ls --json             machine-readable (status, doing, tasks_done/total, current_task, ...)

        READING IT
          ★ last used · ● running (a live omp/claude has it open) · ● active (transcript written in the
          last 2 min) · ○ idle.  ask = latest request · now = latest assistant action · todo = task list.
          Branch shows only for --worktree sessions.  Details of one session: 8sync show <name>.
    "}
)]
pub struct LsArgs {
    /// Scan every repo known to the session registries (one compact line per session)
    #[arg(long)]
    pub all: bool,
    /// Emit JSON instead of text
    #[arg(long)]
    pub json: bool,
}

#[derive(ClapArgs, Debug)]
#[command(
    after_help = indoc::indoc! {"
        EXAMPLES
          8sync show core                   details of session 'core' in this repo
          8sync show core --engine ccc      pick the engine when a name exists in several
          8sync show core --json            machine-readable (schema 1)

        SHOWS
          status · repo/branch · last 5 requests · last assistant message (first ~15 lines) ·
          task list with checkboxes · files touched recently · how to resume.
    "}
)]
pub struct ShowArgs {
    /// Session name
    pub name: String,
    /// Restrict to one engine: omp | ccc | forge | feynman
    #[arg(long, short = 'e')]
    pub engine: Option<String>,
    /// Emit JSON (schema 1) instead of text
    #[arg(long)]
    pub json: bool,
}

fn root_and_env() -> Result<(Env, PathBuf)> {
    let env = Env::detect()?;
    let cwd = std::env::current_dir().context("no cwd")?;
    let root = super::here::detect_project_root(&cwd).unwrap_or(cwd);
    Ok((env, root))
}

fn kind_dir(env: &Env, kind: &str) -> PathBuf {
    env.xdg_config.join("8sync").join(kind)
}

fn read_json(p: &Path) -> Option<Value> {
    serde_json::from_str(&std::fs::read_to_string(p).ok()?).ok()
}

/// Rows of one engine for the registry dir `dir` (`<kind>/<project-key>`).
pub fn engine_rows(env: &Env, engine: &'static str, dir: &Path, procs: &[Vec<u8>], detail: bool, git: bool) -> Vec<Row> {
    let Some(v) = read_json(&dir.join("index.json")) else { return Vec::new() };
    match engine {
        "omp" => serde_json::from_value::<session::Registry>(v).map(|r| view::omp_rows(&r, procs, detail, git)).unwrap_or_default(),
        "feynman" => view::feynman_rows(&v),
        _ => serde_json::from_value::<uuid_sessions::Registry>(v).map(|r| view::uuid_rows(env, engine, &r, procs, detail)).unwrap_or_default(),
    }
}

/// Sessions of one repo, in engine order, skipping engines with none.
fn repo_rows(env: &Env, root: &Path, procs: &[Vec<u8>], detail: bool, git: bool) -> Groups {
    let key = session::project_key(root);
    ENGINES
        .iter()
        .map(|(e, kind)| (*e, engine_rows(env, e, &kind_dir(env, kind).join(&key), procs, detail, git)))
        .filter(|(_, r)| !r.is_empty())
        .collect()
}

fn engine_label(e: &str) -> &'static str {
    match e {
        "omp" => "omp        8sync . <name>",
        "ccc" => "Claude Code 8sync ccc . <name>",
        "forge" => "Forge      8sync forge <name>",
        _ => "Feynman    8sync feynman <name>",
    }
}

pub fn run_ls(a: LsArgs) -> Result<()> {
    let (env, root) = root_and_env()?;
    let procs = view::agent_cmdlines();
    if a.all {
        return ls_all(&env, &procs, a.json);
    }
    let groups = repo_rows(&env, &root, &procs, false, true);
    if a.json {
        let arr: Vec<Value> = groups.iter().flat_map(|(_, rows)| rows.iter().map(view::row_json)).collect();
        println!("{}", serde_json::to_string_pretty(&arr)?);
        return Ok(());
    }
    if groups.is_empty() {
        ui::info("no sessions in this repo yet — start one: `8sync . new <name>` (omp) or `8sync ccc . new <name>` (Claude Code)");
        return Ok(());
    }
    ui::header(&format!("sessions · {}", root.display()));
    let (now, width, color) = (view::now_secs(), view::term_width(), view::use_color());
    for (engine, rows) in &groups {
        println!("{}", if color { engine_label(engine).bold().to_string() } else { engine_label(engine).to_string() });
        for r in rows {
            for l in view::render(r, width, now, color) {
                println!("  {l}");
            }
        }
        println!();
    }
    println!("  8sync . <name> resume  ·  8sync . new <name>  ·  8sync show <name>  ·  8sync ls --all");
    Ok(())
}

/// Every repo in every registry: `<kind>/<key>/index.json`. The repo path is
/// recovered from a transcript's cwd; the registry key is the fallback.
fn ls_all(env: &Env, procs: &[Vec<u8>], json: bool) -> Result<()> {
    let mut repos: BTreeMap<String, Groups> = BTreeMap::new();
    for (engine, kind) in ENGINES {
        for e in std::fs::read_dir(kind_dir(env, kind)).into_iter().flatten().flatten() {
            if !e.path().is_dir() {
                continue;
            }
            let rows = engine_rows(env, engine, &e.path(), procs, false, false);
            if !rows.is_empty() {
                repos.entry(e.file_name().to_string_lossy().into_owned()).or_default().push((engine, rows));
            }
        }
    }
    if json {
        let arr: Vec<Value> = repos
            .iter()
            .flat_map(|(key, g)| {
                g.iter().flat_map(move |(_, rows)| {
                    rows.iter().map(move |r| {
                        let mut v = view::row_json(r);
                        v["repo"] = Value::String(repo_label(key, g));
                        v
                    })
                })
            })
            .collect();
        println!("{}", serde_json::to_string_pretty(&arr)?);
        return Ok(());
    }
    if repos.is_empty() {
        ui::info("no sessions recorded on this machine yet");
        return Ok(());
    }
    let newest = |g: &Groups| g.iter().flat_map(|(_, r)| r.iter().map(|r| r.last_active)).max().unwrap_or(0);
    let mut order: Vec<(&String, &Groups)> = repos.iter().collect();
    order.sort_by_key(|(_, g)| std::cmp::Reverse(newest(g)));
    let (now, width, color) = (view::now_secs(), view::term_width(), view::use_color());
    ui::header("all sessions");
    for (key, g) in order {
        let label = repo_label(key, g);
        println!("{}", if color { label.bold().cyan().to_string() } else { label });
        for (engine, rows) in g {
            for r in rows {
                println!("{} {}", view::render_compact(r, width.saturating_sub(7), now, color), if color { format!("[{engine}]").dimmed().to_string() } else { format!("[{engine}]") });
            }
        }
    }
    println!("\n  8sync show <name> (in that repo) for details");
    Ok(())
}

/// `~/x/y` from a transcript cwd, else the registry key.
fn repo_label(key: &str, g: &[(&'static str, Vec<Row>)]) -> String {
    let cwd = g.iter().flat_map(|(_, r)| r.iter()).find_map(|r| r.digest.cwd.clone());
    match cwd {
        Some(c) => match dirs::home_dir().and_then(|h| c.strip_prefix(h.to_string_lossy().as_ref()).map(str::to_string)) {
            Some(rest) => format!("~{rest}"),
            None => c,
        },
        None => key.to_string(),
    }
}

pub fn run_show(a: ShowArgs) -> Result<()> {
    let (env, root) = root_and_env()?;
    let procs = view::agent_cmdlines();
    let groups = repo_rows(&env, &root, &procs, true, true);
    let wanted = a.engine.as_deref();
    if let Some(e) = wanted {
        if !ENGINES.iter().any(|(n, _)| *n == e) {
            bail!("unknown engine '{e}' (use omp | ccc | forge | feynman)");
        }
    }
    let hits: Vec<&Row> = groups
        .iter()
        .filter(|(e, _)| wanted.is_none_or(|w| w == *e))
        .flat_map(|(_, rows)| rows.iter())
        .filter(|r| r.name == a.name)
        .collect();
    let Some(r) = hits.first() else {
        let names: Vec<String> = groups.iter().flat_map(|(e, rows)| rows.iter().map(move |r| format!("{} ({e})", r.name))).collect();
        bail!(
            "no session '{}' in {}{}",
            a.name,
            root.display(),
            if names.is_empty() { String::new() } else { format!(" — have: {}", names.join(", ")) }
        );
    };
    if a.json {
        println!("{}", serde_json::to_string_pretty(&view::show_json(r))?);
        return Ok(());
    }
    print_show(r, &hits[1..], &root);
    Ok(())
}

fn print_show(r: &Row, others: &[&Row], root: &Path) {
    let d = &r.digest;
    let (now, width, color) = (view::now_secs(), view::term_width(), view::use_color());
    let dim = |s: &str| if color { s.dimmed().to_string() } else { s.to_string() };
    ui::header(&format!("{} · {}", r.name, r.engine));
    let badge = match r.status {
        Status::Running => "● running (a live process has it open)",
        Status::Active => "● active (transcript written in the last 2 min)",
        Status::Idle => "○ idle",
    };
    println!("  status    {badge} · last active {}", view::ago(r.last_active, now));
    if let Some(t) = &d.title {
        println!("  title     {}", view::clean(t, width.saturating_sub(14)));
    }
    println!("  repo      {}", d.cwd.clone().unwrap_or_else(|| root.display().to_string()));
    match &r.branch {
        Some(b) => println!("  worktree  branch {b}{}", if r.dirty { " (uncommitted changes)" } else { "" }),
        None => {
            if let Some(b) = &d.branch {
                println!("  branch    {b}");
            }
        }
    }
    let mut meta = Vec::new();
    if d.user_msgs > 0 {
        meta.push(format!("{}{} requests", d.user_msgs, if d.partial { "+" } else { "" }));
    }
    if let Some(m) = &d.model {
        meta.push(m.clone());
    }
    if let Some(t) = d.tokens {
        meta.push(format!("{t} tokens in context"));
    }
    if !meta.is_empty() {
        println!("  info      {}", meta.join(" · "));
    }
    if let Some(p) = &r.transcript {
        println!("  {}", dim(&format!("transcript {}", p.display())));
    }
    if r.transcript.is_none() {
        println!("  {}", dim("(no transcript on disk yet — or this engine keeps none we can read)"));
    }

    if !d.last_users.is_empty() {
        println!("\n{}", if color { "Last requests".bold().to_string() } else { "Last requests".into() });
        for (i, u) in d.last_users.iter().enumerate() {
            println!("  {}. {}", i + 1, view::truncate(&view::clean(u, 600), width.saturating_sub(6)));
        }
    }
    if let Some(t) = &d.last_text {
        println!("\n{}", if color { "Last assistant message".bold().to_string() } else { "Last assistant message".into() });
        let lines: Vec<&str> = t.lines().collect();
        for l in lines.iter().take(15) {
            println!("  {}", view::truncate(l, width.saturating_sub(4)));
        }
        if lines.len() > 15 {
            println!("  {}", dim(&format!("… {} more lines", lines.len() - 15)));
        }
    }
    if let Some(a) = d.last_activity().filter(|_| d.last_text.is_none() || d.last_tool.is_some()) {
        println!("\n  last action  {}", view::truncate(&view::clean(&a, 300), width.saturating_sub(16)));
    }
    if !d.tasks.is_empty() {
        println!("\n{} ({}/{})", if color { "Tasks".bold().to_string() } else { "Tasks".into() }, d.tasks_done(), d.tasks.len());
        for t in &d.tasks {
            let mark = match t.state {
                TaskState::Done => "[x]",
                TaskState::InProgress => "[~]",
                TaskState::Pending => "[ ]",
            };
            println!("  {mark} {}", view::truncate(&view::clean(&t.title, 300), width.saturating_sub(8)));
        }
    }
    if !d.files.is_empty() {
        println!("\n{}", if color { "Files touched recently".bold().to_string() } else { "Files touched recently".into() });
        for f in &d.files {
            println!("  {}", view::truncate(f, width.saturating_sub(4)));
        }
    }
    println!("\n  resume: {}", r.resume);
    if let Some(o) = others.first() {
        println!("  {}", dim(&format!("also exists in engine {} — use --engine", o.engine)));
    }
}

// ── guide ───────────────────────────────────────────────────────────────────

pub fn run_guide() -> Result<()> {
    let h = |t: &str| println!("\n{}", t.bold().cyan());
    let row = |cmd: &str, what: &str| println!("  {:<30} {}", cmd.green(), what);
    println!("{}", "8 Sync — hướng dẫn nhanh (Claude Code chính chủ + kit 8sync)".bold());
    println!("{}", "Chi tiết: docs/huong-dan.md trong repo su-code. Mỗi lệnh có `-h` để xem ví dụ.".dimmed());

    h("1. Làm việc hằng ngày với Claude Code (ccc)");
    row("8sync ccc . <tên>", "mở hoặc tạo session theo tên trong repo này (vd core, fix-login)");
    row("8sync ccc .", "mở lại session dùng gần nhất");
    row("8sync ccc . ls", "từng session: ● đang chạy/○ rảnh, đang làm gì, task x/y");
    row("8sync show <tên>", "chi tiết: 5 yêu cầu gần nhất, câu trả lời cuối, checklist, file đã sửa");
    row("8sync ccc . <tên> --team", "bật agent teams: lead + teammate (thêm --panes để chia pane tmux)");
    row("8sync ccc . rm <tên>", "xoá session và transcript");

    h("2. Nhìn toàn cảnh");
    row("8sync ls", "mọi session của repo này (ccc, omp, forge, feynman)");
    row("8sync ls --all", "mọi repo trên máy, mỗi session một dòng");

    h("3. Team trên web local (127.0.0.1, không lên mạng)");
    row("8sync hq ui", "mở web: thêm dự án, start session, giao task, xem team chat + board");
    println!("  {}", "Session nhắn nhau bằng SendMessage; tin của anh gõ vào terminal session (hoặc qua Channels nếu org bật).".dimmed());

    h("4. Kit và bảo mật");
    row("8sync ccc kit", "cài/cập nhật kit: agents, /ship, hook verify, guard, stop gate");
    row("8sync ccc status", "kiểm claude, login, kit, managed settings, MCP");
    row("8sync ccc policy --out f.json", "managed-settings khoá cho org (anh tự cài bằng sudo)");
    row("8sync ccc kit --remove", "gỡ hook 8sync trước khi gỡ 8sync (guard chặn khi lỗi)");

    h("5. Trong Claude Code");
    row("/ship <việc> [--release]", "plan → R&D → code → test → UAT → review → docs → commit (→ release + monitor)");
    row("/planning <việc>", "chỉ lập plan: acceptance criteria, task, rủi ro, câu hỏi gom 1 lần");
    row("/remember · /consolidate", "ghi bài học có bằng chứng vào KNOWLEDGE · dọn memory");
    row("/rules <việc>", "việc này có được phép không (Anthropic + quy tắc 8 Sync)");
    row("/sec · /harden · /aup-audit", "quét secret/lỗ hổng · siết cấu hình · quét Usage Policy");

    h("6. Khác");
    row("8sync . <tên>", "session omp (engine phụ) — cùng cách đặt tên");
    row("8sync hq setup --guild <id>", "Discord (làm sau): token qua --token-stdin");
    row("8sync run test", "build/test/lint theo recipe của repo");

    h("Mẹo");
    println!("  · Mỗi việc một session tên ngắn; xem `ccc . ls` trước khi mở thêm.");
    println!("  · Không dán secret vào chat. Lỡ dán: rotate ngay.\n");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn guide_stays_short() {
        // The text is in run_guide; keep the visible output under the 80-line cap.
        let src = include_str!("session_cmds.rs");
        let body = src.split("pub fn run_guide").nth(1).unwrap().split("#[cfg(test)]").next().unwrap();
        let printed = body.matches("println!(").count() + body.matches("row(\"").count() + body.matches("h(\"").count() * 2;
        assert!(printed <= 70, "guide prints ~{printed} lines");
    }

    #[test]
    fn repo_label_prefers_cwd() {
        let r = Row {
            engine: "omp",
            name: "a".into(),
            is_last: false,
            status: Status::Idle,
            last_active: 0,
            branch: None,
            dirty: false,
            digest: view::Digest { cwd: Some("/srv/app".into()), ..Default::default() },
            resume: String::new(),
            transcript: None,
        };
        assert_eq!(repo_label("-srv-app", &[("omp", vec![r])]), "/srv/app");
        assert_eq!(repo_label("-srv-app", &[]), "-srv-app");
    }
}
