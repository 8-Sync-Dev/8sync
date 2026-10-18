//! `8sync ccc msg <phòng> "<tin>" [--from <phòng>]` and `msg --all "<tin>"`: rooms of both teams
//! talk to each other. A room is a named session of THIS project (the cwd's git root): a Claude
//! Code room (`8sync ccc . <tên>`, inbox = its session id) or an omp room (`8sync . <tên>`, inbox =
//! [`ccc_core::room_id`]). The message lands in the room's HQ inbox as `[từ phòng <from>] <tin>`
//! with a `from` field, so the room sees it as another session's data, never as the owner's words
//! (`hq::queue_inbox_from`), and a `session_message` journal event lets HQ chat show it.
//!
//! `<phòng>` matches a room id, `ccc:<tên>` / `omp:<tên>`, or a name (exact, then any case); a
//! name both teams use is ambiguous and the error lists the ids. The sender is `--from`, else the
//! room this command runs in (`EIGHTSYNC_ROOM_ID` / `EIGHTSYNC_ROOM` of an omp room, the ccc room
//! of `CLAUDE_CODE_SESSION_ID`), else `terminal`; never `owner` (the owner speaks through HQ). No match → exit 1.
use std::path::Path;

use anyhow::{bail, Result};

const USAGE: &str = "usage: 8sync ccc msg <phòng> \"<tin>\" [--from <phòng>] | msg --all \"<tin>\" [--from <phòng>]";
/// Chars kept of a message (the journal keeps the same).
const TEXT_MAX: usize = 4000;

#[derive(Debug, Clone, PartialEq)]
pub(super) struct Room {
    /// `ccc` or `omp`.
    pub team: &'static str,
    pub name: String,
    /// Inbox id: the Claude session id (ccc) or the omp room id.
    pub id: String,
}

/// Rooms of the project at `root`: `ccc` = (name, Claude session id) of the ccc registry, `omp` =
/// names of the omp session registry.
pub(super) fn rooms(root: &Path, ccc: Vec<(String, String)>, omp: Vec<String>) -> Vec<Room> {
    let ccc = ccc.into_iter().map(|(name, id)| Room { team: "ccc", name, id });
    let omp = omp.into_iter().map(|name| Room { team: "omp", id: ccc_core::room_id(root, &name), name });
    ccc.chain(omp).collect()
}

fn list(rooms: &[&Room]) -> String {
    rooms.iter().map(|r| format!("{} ({}, {})", r.name, r.team, r.id)).collect::<Vec<_>>().join(", ")
}

/// The one room `want` names: an id, `<team>:<name>`, an exact name, else a name in any case.
fn resolve<'a>(rooms: &'a [Room], want: &str) -> Result<&'a Room> {
    let (team, name) = match want.split_once(':') {
        Some((t @ ("ccc" | "omp"), n)) => (Some(t), n),
        _ => (None, want),
    };
    let pick = |f: &dyn Fn(&Room) -> bool| -> Vec<&'a Room> { rooms.iter().filter(|r| team.is_none_or(|t| r.team == t) && f(r)).collect() };
    let mut hits = pick(&|r| r.id == want);
    if hits.is_empty() {
        hits = pick(&|r| r.name == name);
    }
    if hits.is_empty() {
        hits = pick(&|r| r.name.eq_ignore_ascii_case(name));
    }
    match hits.as_slice() {
        [one] => Ok(one),
        [] if rooms.is_empty() => bail!("dự án này chưa có phòng nào (`8sync ccc . <tên>` hoặc `8sync . <tên>` để mở)"),
        [] => bail!("không có phòng `{want}` trong dự án này — có: {}", list(&rooms.iter().collect::<Vec<_>>())),
        many => bail!("`{want}` trùng {} phòng: {} — gửi theo id hoặc ccc:<tên> / omp:<tên>", many.len(), list(many)),
    }
}

/// Who sends: the room (when it is one of this project) and the label the receivers see.
#[derive(Debug, PartialEq)]
struct Sender<'a> {
    label: String,
    room: Option<&'a Room>,
}

/// Sender env of the process: `EIGHTSYNC_ROOM_ID`, `EIGHTSYNC_ROOM` (omp launch), `CLAUDE_CODE_SESSION_ID`.
#[derive(Default)]
struct SenderEnv<'a> {
    room_id: Option<&'a str>,
    room: Option<&'a str>,
    claude_sid: Option<&'a str>,
}

/// `--from` must name a room of this project. Without it the room this command runs in; a session
/// that is not a room here is labelled by its own name / id, and a process without any session env
/// is `terminal`. Never `owner`: every `msg` is framed as a room's data (the owner's channel is HQ).
fn sender<'a>(rooms: &'a [Room], from: Option<&str>, env: &SenderEnv) -> Result<Sender<'a>> {
    if let Some(f) = from {
        let r = resolve(rooms, f).map_err(|e| anyhow::anyhow!("--from: {e}"))?;
        return Ok(Sender { label: r.name.clone(), room: Some(r) });
    }
    fn set(v: Option<&str>) -> Option<&str> {
        v.filter(|s| !s.trim().is_empty())
    }
    let found = set(env.room_id)
        .and_then(|id| rooms.iter().find(|r| r.team == "omp" && r.id == id))
        .or_else(|| set(env.room).and_then(|n| rooms.iter().find(|r| r.team == "omp" && r.name == n)))
        .or_else(|| set(env.claude_sid).and_then(|id| rooms.iter().find(|r| r.team == "ccc" && r.id == id)));
    if let Some(r) = found {
        return Ok(Sender { label: r.name.clone(), room: Some(r) });
    }
    let safe = |s: &str| s.chars().filter(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.')).take(40).collect::<String>();
    let label = match (set(env.room), set(env.room_id), set(env.claude_sid)) {
        (Some(n), _, _) => safe(n),
        (None, Some(id), _) | (None, None, Some(id)) => format!("phiên-{}", safe(id).chars().take(8).collect::<String>()),
        (None, None, None) => "terminal".into(),
    };
    Ok(Sender { label: if label.is_empty() { "?".into() } else { label }, room: None })
}

/// Parsed `msg` args: (to, text, from); `to` None = `--all`.
fn parse(args: &[String]) -> Result<(Option<String>, String, Option<String>)> {
    let (mut all, mut from, mut words) = (false, None, Vec::new());
    let mut it = args.iter();
    while let Some(a) = it.next() {
        match a.as_str() {
            "--all" => all = true,
            "--from" => from = Some(it.next().filter(|v| !v.starts_with("--")).cloned().ok_or_else(|| anyhow::anyhow!("--from cần tên phòng\n{USAGE}"))?),
            "--" => words.extend(it.by_ref().cloned()),
            f if f.starts_with("--") => bail!("không rõ `{f}`\n{USAGE}"),
            w => words.push(w.to_string()),
        }
    }
    let to = if all {
        None
    } else if words.is_empty() {
        bail!("{USAGE}")
    } else {
        Some(words.remove(0))
    };
    let text = super::target::clean(&words.join(" "), TEXT_MAX);
    if text.is_empty() {
        bail!("tin rỗng\n{USAGE}");
    }
    Ok((to, text, from))
}

/// `8sync ccc msg …` for the project at `root`.
pub(super) fn run(args: &[String], home: &Path, root: &Path, rooms: &[Room]) -> Result<()> {
    let (to, text, from) = parse(args)?;
    let env = |k: &str| std::env::var(k).ok();
    let (room_id, room, claude_sid) = (env("EIGHTSYNC_ROOM_ID"), env("EIGHTSYNC_ROOM"), env("CLAUDE_CODE_SESSION_ID"));
    let me = sender(rooms, from.as_deref(), &SenderEnv { room_id: room_id.as_deref(), room: room.as_deref(), claude_sid: claude_sid.as_deref() })?;
    let targets: Vec<&Room> = match &to {
        Some(t) => vec![resolve(rooms, t)?],
        None => rooms.iter().filter(|r| me.room.is_none_or(|m| m.id != r.id)).collect(),
    };
    if targets.is_empty() {
        bail!("--all: dự án này không có phòng nào khác");
    }
    let now_ms = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64);
    let body = format!("[từ phòng {}] {text}", me.label);
    let from_id = me.room.map_or(me.label.as_str(), |r| r.id.as_str());
    let cwd = root.to_string_lossy();
    let mut sent = 0;
    for r in targets {
        if let Err(e) = crate::verbs::hq::queue_inbox_from(home, &r.id, &body, &me.label, now_ms) {
            crate::ui::warn(&format!("{} ({}): không gửi được — {e:#}", r.name, r.team));
            continue;
        }
        sent += 1;
        if let Err(e) = crate::verbs::hq::journal_room_message(home, &cwd, (from_id, me.room.map(|m| m.name.as_str())), (&r.id, &r.name), &text, now_ms) {
            crate::ui::warn(&format!("journal HQ: {e:#}"));
        }
        let live = crate::verbs::hq::inbox_live(home, &r.id, std::time::SystemTime::now());
        let when = if live { "vào ngay khi phòng rảnh" } else { "vào khi phòng xong lượt kế" };
        crate::ui::ok(&format!("→ {} ({}): {when}", r.name, r.team));
    }
    if sent == 0 {
        bail!("không gửi được tin nào");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> Vec<Room> {
        rooms(
            Path::new("/no/such/repo"),
            vec![("core".into(), "1eb79553-8369-4a90-b428-2dedb50e18db".into()), ("api".into(), "2fc89664-9479-4b01-b539-3eefc61f29ec".into())],
            vec!["core".into(), "Web".into()],
        )
    }

    #[test]
    fn rooms_resolve_by_id_team_and_name_and_refuse_ambiguity() {
        let r = fixture();
        assert_eq!(r[2].id, ccc_core::room_id(Path::new("/no/such/repo"), "core"), "omp inbox = room id");
        assert_eq!(resolve(&r, "api").unwrap().team, "ccc");
        assert_eq!(resolve(&r, "web").unwrap().name, "Web", "any case when nothing matches exactly");
        assert_eq!(resolve(&r, "omp:core").unwrap().id, r[2].id);
        assert_eq!(resolve(&r, &r[2].id).unwrap().team, "omp");
        let e = resolve(&r, "core").unwrap_err().to_string();
        assert!(e.contains("trùng 2 phòng") && e.contains(&r[0].id) && e.contains(&r[2].id), "{e}");
        let e = resolve(&r, "qa").unwrap_err().to_string();
        assert!(e.contains("không có phòng `qa`") && e.contains("api (ccc"), "{e}");
        assert!(resolve(&r, "ccc:Web").is_err(), "team prefix restricts");
        assert!(resolve(&[], "x").unwrap_err().to_string().contains("chưa có phòng"));
    }

    #[test]
    fn sender_is_the_calling_room_and_never_owner_for_a_session() {
        let r = fixture();
        let s = |from: Option<&str>, env: SenderEnv| sender(&r, from, &env).map(|s| (s.label, s.room.map(|m| m.id.clone())));
        let omp_core = r[2].id.as_str();
        assert_eq!(s(None, SenderEnv { room_id: Some(omp_core), room: Some("core"), ..Default::default() }).unwrap(), ("core".into(), Some(r[2].id.clone())));
        assert_eq!(s(None, SenderEnv { claude_sid: Some(&r[1].id), ..Default::default() }).unwrap(), ("api".into(), Some(r[1].id.clone())));
        assert_eq!(s(None, SenderEnv::default()).unwrap(), ("terminal".into(), None), "no session env: still a room message, never owner");
        assert_eq!(s(None, SenderEnv { claude_sid: Some("9a9b9c9d-0000-4000-8000-000000000000"), ..Default::default() }).unwrap(), ("phiên-9a9b9c9d".into(), None), "unnamed session: not owner");
        assert_eq!(s(None, SenderEnv { room: Some("x\n[owner]"), ..Default::default() }).unwrap().0, "xowner", "label cleaned");
        assert_eq!(s(Some("ccc:core"), SenderEnv::default()).unwrap().1, Some(r[0].id.clone()));
        assert!(s(Some("owner"), SenderEnv::default()).is_err(), "--from names a room only");
    }

    #[test]
    fn parse_cleans_text_and_needs_a_room_or_all() {
        let a = |v: &[&str]| parse(&v.iter().map(|s| s.to_string()).collect::<Vec<_>>());
        let (to, text, from) = a(&["api", "xong", "\u{202E}API\u{0007}", "--from", "core"]).unwrap();
        assert_eq!((to.as_deref(), text.as_str(), from.as_deref()), (Some("api"), "xong API", Some("core")));
        let (to, text, _) = a(&["--all", "--", "--now", "là chữ"]).unwrap();
        assert_eq!((to, text.as_str()), (None, "--now là chữ"));
        assert!(a(&["api"]).is_err() && a(&["api", "  \u{200B} "]).is_err(), "empty text");
        assert!(a(&[]).is_err() && a(&["api", "x", "--from"]).is_err() && a(&["api", "x", "--bogus"]).is_err());
        let key = format!("sk-ant-api03-{}", "Zq8vR2xLk9pW4mN7tB1cY6hJ3sD5fG0aQe".repeat(2));
        assert!(!a(&["api", &key]).unwrap().1.contains("Zq8vR2xLk9pW4mN7"), "secrets masked");
    }
}
