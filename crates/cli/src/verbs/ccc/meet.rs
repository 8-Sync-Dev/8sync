//! `8sync ccc meet [--say "<done>|<doing>|<blocked>"] [--room <name>] [--json]`: the daily sprint
//! meeting of the rooms (sessions) of one repo. Each room appends one line to
//! `su-code/standup/<YYYY-MM-DD>.md` (UTC date):
//!
//! `| HH:MM | room | done | doing | blocked |`
//!
//! so the rooms see each other's status, and HQ can walk the characters to the meeting room. A room
//! that already spoke within the last 30 minutes gets its line replaced, not duplicated. Cells are
//! sanitised like the sprint board (`standup::clean_cell`: control chars, secrets, ≤100 chars,
//! `|` → `/`). Without `--say` it only reads. `su-code/` is searched from the cwd upwards.
use anyhow::{bail, Context, Result};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

use super::standup::{clean_cell, utc_stamp};
use crate::verbs::uuid_sessions::Store;

const USAGE: &str =
    "usage: 8sync ccc meet [--say \"<done>|<doing>|<blocked>\"] [--room <tên>] [--json]\n  --room là chữ tự do (tin cậy trong máy): trùng tên phòng khác sẽ thay dòng của phòng đó trong 30 phút";
const CELL_MAX: usize = 100;
/// A room speaking again inside this window replaces its own line.
const REPLACE_MIN: u32 = 30;
const HEADER: &str = "| giờ | phòng | done | doing | blocked |\n|---|---|---|---|---|\n";

#[derive(Debug, Clone, PartialEq)]
pub(super) struct Att {
    pub room: String,
    pub at: String,
    pub done: String,
    pub doing: String,
    pub blocked: String,
}

fn hhmm(s: &str) -> Option<u32> {
    let b = s.as_bytes();
    let ok = b.len() == 5 && b[2] == b':' && [0, 1, 3, 4].iter().all(|&i| b[i].is_ascii_digit());
    let (h, m) = (
        s.get(..2)?.parse::<u32>().ok()?,
        s.get(3..)?.parse::<u32>().ok()?,
    );
    (ok && h < 24 && m < 60).then_some(h * 60 + m)
}

fn row_of(line: &str) -> Option<Att> {
    let l = line.trim();
    if !l.starts_with('|') {
        return None;
    }
    let cells: Vec<&str> = l.trim_matches('|').split('|').map(str::trim).collect();
    if cells.len() != 5 || hhmm(cells[0]).is_none() || cells[1].is_empty() {
        return None;
    }
    Some(Att {
        at: cells[0].into(),
        room: cells[1].into(),
        done: cells[2].into(),
        doing: cells[3].into(),
        blocked: cells[4].into(),
    })
}

/// Pure: the rows of a day file; header, separator, prose and junk lines are skipped.
pub(super) fn parse_day(md: &str) -> Vec<Att> {
    md.lines().filter_map(row_of).collect()
}

/// `(date, "HH:MM")` in UTC.
fn stamp(now: u64) -> (String, String) {
    let s = utc_stamp(now);
    (s[..10].to_string(), s[11..16].to_string())
}

/// `su-code/` from `cwd` upwards.
fn repo_root(cwd: &Path) -> Result<PathBuf> {
    cwd.ancestors()
        .find(|d| d.join("su-code").is_dir())
        .map(Path::to_path_buf)
        .context("chưa có su-code/ (8sync init)")
}

pub(super) fn day_file(root: &Path, now: u64) -> PathBuf {
    root.join("su-code/standup")
        .join(format!("{}.md", stamp(now).0))
}

/// Write (when `say` is given) and report. Pure over the filesystem under `root`.
pub(super) fn meet(root: &Path, room: &str, say: Option<&str>, now: u64) -> Result<Value> {
    let file = day_file(root, now);
    let (date, at) = stamp(now);
    let room = clean_cell(room, 40);
    let room = if room.is_empty() {
        "?".to_string()
    } else {
        room
    };
    if let Some(say) = say {
        let mut parts = say.splitn(3, '|').map(|p| clean_cell(p, CELL_MAX));
        let (d, g, b) = (
            parts.next().unwrap_or_default(),
            parts.next().unwrap_or_default(),
            parts.next().unwrap_or_default(),
        );
        let line = format!("| {at} | {room} | {d} | {g} | {b} |");
        let dir = file.parent().context("no parent")?;
        std::fs::create_dir_all(dir)?;
        let lock = std::fs::OpenOptions::new()
            .create(true)
            .truncate(false)
            .write(true)
            .open(dir.join(".meet.lock"))
            .context("open meet lock")?;
        lock.lock().context("lock meet")?;
        let old = std::fs::read_to_string(&file).unwrap_or_default();
        let mut lines: Vec<String> = if old.is_empty() {
            format!("# Họp sprint {date}\n\n{HEADER}")
                .lines()
                .map(String::from)
                .collect()
        } else {
            old.lines().map(String::from).collect()
        };
        let now_min = hhmm(&at).unwrap_or(0);
        let mine = lines.iter().rposition(|l| {
            row_of(l).is_some_and(|r| {
                r.room == room
                    && hhmm(&r.at).is_some_and(|m| now_min >= m && now_min - m < REPLACE_MIN)
            })
        });
        match mine {
            Some(i) => lines[i] = line,
            None => lines.push(line),
        }
        let tmp = file.with_file_name(format!("{date}.md.tmp.{}", std::process::id()));
        std::fs::write(&tmp, lines.join("\n") + "\n")?;
        std::fs::rename(&tmp, &file)?;
    }
    let att = parse_day(&std::fs::read_to_string(&file).unwrap_or_default());
    // Blocked first (the actionable bit), else what the room is doing.
    let open: Vec<String> = att
        .iter()
        .filter(|a| a.room != room)
        .filter_map(|a| {
            let t = if a.blocked.is_empty() {
                &a.doing
            } else {
                &a.blocked
            };
            (!t.is_empty()).then(|| format!("{}: {t}", a.room))
        })
        .collect();
    Ok(json!({
        "schema": 1,
        "date": date,
        "file": file.to_string_lossy(),
        "attendees": att.iter().map(|a| json!({ "room": a.room, "at": a.at, "done": a.done, "doing": a.doing, "blocked": a.blocked })).collect::<Vec<_>>(),
        "mine": att.iter().any(|a| a.room == room),
        "open": open,
    }))
}

fn text(v: &Value) -> String {
    let mut s = String::new();
    s.push_str(&format!(
        "# Họp sprint {}\n{HEADER}",
        v["date"].as_str().unwrap_or("")
    ));
    let mut rooms = std::collections::BTreeSet::new();
    for a in v["attendees"].as_array().into_iter().flatten() {
        let c = |k: &str| a[k].as_str().unwrap_or("");
        rooms.insert(c("room").to_string());
        s.push_str(&format!(
            "| {} | {} | {} | {} | {} |\n",
            c("at"),
            c("room"),
            c("done"),
            c("doing"),
            c("blocked")
        ));
    }
    s.push_str(&format!("{} phòng đã họp hôm nay\n", rooms.len()));
    for o in v["open"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
    {
        s.push_str(&format!("- {o}\n"));
    }
    s
}

/// The room name: `--room`, else the registry name of `env_id`, else `?`.
fn room_name(store: &Store, room: Option<&str>, env_id: Option<&str>) -> String {
    room.map(String::from)
        .or_else(|| {
            let id = env_id.filter(|s| !s.is_empty())?;
            store
                .load()
                .sessions
                .into_iter()
                .find(|s| s.conversation_id == id)
                .map(|s| s.name)
        })
        .unwrap_or_else(|| "?".into())
}

pub(super) fn run(
    store: &Store,
    rest: &[String],
    env_id: Option<&str>,
    cwd: &Path,
    now: u64,
) -> Result<()> {
    let (mut say, mut room, mut json_out) = (None, None, false);
    let mut it = rest.iter();
    while let Some(a) = it.next() {
        match a.as_str() {
            "--say" => say = Some(it.next().with_context(|| USAGE.to_string())?.clone()),
            "--room" => room = Some(it.next().with_context(|| USAGE.to_string())?.clone()),
            "--json" => json_out = true,
            "--help" | "-h" => bail!("{USAGE}"),
            x => bail!("không rõ `{x}`\n{USAGE}"),
        }
    }
    let root = repo_root(cwd)?;
    let v = meet(
        &root,
        &room_name(store, room.as_deref(), env_id),
        say.as_deref(),
        now,
    )?;
    if json_out {
        println!("{v}");
    } else {
        print!("{}", text(&v));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // 2026-10-16T09:00:00Z
    const T0: u64 = 1_792_141_200;

    fn repo(tag: &str) -> PathBuf {
        let r = std::env::temp_dir().join(format!("8sync-meet-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&r);
        std::fs::create_dir_all(r.join("su-code")).unwrap();
        r
    }

    #[test]
    fn stamp_matches_the_fixture() {
        assert_eq!(stamp(T0), ("2026-10-16".to_string(), "09:00".to_string()));
    }

    #[test]
    fn two_rooms_append_under_one_header() {
        let r = repo("two");
        meet(&r, "rd", Some("brief|đang nghiên cứu|"), T0).unwrap();
        let v = meet(&r, "qa", Some("|UAT 390px|chờ build"), T0 + 60).unwrap();
        let md = std::fs::read_to_string(day_file(&r, T0)).unwrap();
        assert_eq!(md.matches("# Họp sprint 2026-10-16").count(), 1);
        assert_eq!(md.matches("| giờ | phòng |").count(), 1);
        assert_eq!(parse_day(&md).len(), 2);
        assert!(
            md.contains("| 09:00 | rd | brief | đang nghiên cứu |  |")
                && md.contains("| 09:01 | qa |  | UAT 390px | chờ build |")
        );
        assert_eq!(v["mine"], true);
        assert_eq!(v["attendees"].as_array().unwrap().len(), 2);
        assert_eq!(v["open"], json!(["rd: đang nghiên cứu"]));
        let _ = std::fs::remove_dir_all(&r);
    }

    #[test]
    fn same_room_within_30_min_replaces_after_that_appends() {
        let r = repo("replace");
        meet(&r, "rd", Some("a|b|c"), T0).unwrap();
        meet(&r, "qa", Some("x|y|z"), T0 + 60).unwrap();
        let v = meet(&r, "rd", Some("a2|b2|"), T0 + 29 * 60).unwrap();
        let att = parse_day(&std::fs::read_to_string(day_file(&r, T0)).unwrap());
        assert_eq!(att.len(), 2, "{att:?}");
        assert_eq!(
            (
                att[0].room.as_str(),
                att[0].done.as_str(),
                att[0].at.as_str()
            ),
            ("rd", "a2", "09:29"),
            "replaced in place"
        );
        assert_eq!(v["attendees"].as_array().unwrap().len(), 2);
        meet(&r, "rd", Some("a3||"), T0 + 29 * 60 + 31 * 60).unwrap();
        assert_eq!(
            parse_day(&std::fs::read_to_string(day_file(&r, T0)).unwrap()).len(),
            3
        );
        let _ = std::fs::remove_dir_all(&r);
    }

    #[test]
    fn cells_are_sanitised() {
        let r = repo("clean");
        let long = "x".repeat(300);
        let say = format!("a|b\u{7}\u{202e}c|{long}");
        meet(&r, "r|d\u{1b}", Some(&say), T0).unwrap();
        let md = std::fs::read_to_string(day_file(&r, T0)).unwrap();
        let rows = parse_day(&md);
        assert_eq!(rows.len(), 1, "{md}");
        assert_eq!(rows[0].room, "r/d");
        assert!(!md.contains('\u{7}') && !md.contains('\u{202e}') && !md.contains('\u{1b}'));
        assert!(rows[0].blocked.chars().count() <= CELL_MAX);
        // a 4th `|` part stays in the third cell as `/`
        meet(&r, "qa", Some("a|b|c|d"), T0).unwrap();
        let q = parse_day(&std::fs::read_to_string(day_file(&r, T0)).unwrap());
        assert_eq!(q[1].blocked, "c/d");
        let _ = std::fs::remove_dir_all(&r);
    }

    #[test]
    fn read_without_say_writes_nothing_and_unknown_room_is_question_mark() {
        let r = repo("read");
        let v = meet(&r, "?", None, T0).unwrap();
        assert!(!day_file(&r, T0).exists());
        assert_eq!(
            (v["mine"].clone(), v["attendees"].clone()),
            (json!(false), json!([]))
        );
        let v = meet(&r, "", Some("a|b|c"), T0).unwrap();
        assert_eq!(v["attendees"][0]["room"], "?");
        let _ = std::fs::remove_dir_all(&r);
    }

    #[test]
    fn bails_outside_su_code() {
        let d = std::env::temp_dir().join(format!("8sync-meet-none-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        // no su-code/ in the temp dir or above it (the system temp dir)
        if d.ancestors().all(|a| !a.join("su-code").is_dir()) {
            let e = repo_root(&d).unwrap_err().to_string();
            assert!(e.contains("chưa có su-code/"), "{e}");
        }
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn json_shape() {
        let r = repo("json");
        let v = meet(&r, "rd", Some("d|g|b"), T0).unwrap();
        let mut keys: Vec<_> = v.as_object().unwrap().keys().cloned().collect();
        keys.sort();
        assert_eq!(
            keys,
            ["attendees", "date", "file", "mine", "open", "schema"]
        );
        assert_eq!(v["schema"], 1);
        // Windows paths use `\`: compare with the separators normalised.
        assert!(v["file"]
            .as_str()
            .unwrap()
            .replace('\\', "/")
            .ends_with("su-code/standup/2026-10-16.md"));
        assert_eq!(
            v["attendees"][0],
            json!({ "room": "rd", "at": "09:00", "done": "d", "doing": "g", "blocked": "b" })
        );
        assert_eq!(v["open"], json!([]), "own line is not 'open'");
        assert!(text(&v).contains("1 phòng đã họp hôm nay"));
        let _ = std::fs::remove_dir_all(&r);
    }

    #[test]
    fn parse_day_skips_junk() {
        let md = "# Họp sprint\n\n| giờ | phòng | done | doing | blocked |\n|---|---|---|---|---|\n| 09:00 | rd | a | b | c |\n|\n| | | |\n| 25:00 | x | | | |\n| 9:0 | x | | | |\n| 10:00 | | | | |\n| 10:00 | qa | 1 | 2 |\n| 10:00 | qa | 1 | 2 | 3 | 4 |\nprose | with | pipes\n| 11:30 | ui |  | doing it |  |\n\u{0}\u{1b}[31m| 12:00 | z | | | |\n";
        let rows = parse_day(md);
        assert_eq!(
            rows.iter().map(|r| r.room.as_str()).collect::<Vec<_>>(),
            ["rd", "ui"]
        );
        assert_eq!(parse_day(""), vec![]);
    }
}
