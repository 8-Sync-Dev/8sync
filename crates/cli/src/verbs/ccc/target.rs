//! `8sync ccc auto add|queue|done|drop`: the project's target queue for `auto`. Like a prompt typed
//! while Claude is busy, a target waits in line; `--now` puts it first and pushes it into every
//! room's inbox (Claude Code's "ctrl+x ctrl+s to send now", for the whole project).
//!
//! Every loop tick reads `auto status --json`, which carries the first open target: each room does
//! its role's part of it, and a room that proves it met (the `check` command exits 0, or runnable
//! evidence) runs `auto done <id> --evidence`. The team then moves to the next target; with none
//! left the loop goes back to `.claude/loop.md` (STATE.md Next).
//!
//! File: `<state>/ccc/targets.json` (next to `auto.json`), schema 1:
//! `{ "projects": { "<root>": { "next_id", "items": [Target] } } }`. Per user, keyed by the
//! canonical project root; a room in a subfolder or worktree inside a stored root uses that root.
//! Writes take `targets.lock` and replace the file atomically; a corrupt file fails closed.
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};

use super::idle;

/// Chars kept of a target's text, its check command, and a done evidence line.
const TEXT_MAX: usize = 2000;
const CHECK_MAX: usize = 300;
const EVIDENCE_MAX: usize = 300;
/// Open targets per project, and finished ones kept for `auto queue`.
const OPEN_MAX: usize = 50;
const CLOSED_KEEP: usize = 20;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub(super) struct Target {
    pub id: u64,
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub check: Option<String>,
    pub added: u64,
    /// Room that queued it; none = the owner's terminal. Lets the owner spot a target an agent
    /// queued on its own.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from: Option<String>,
    /// `open`, `done` or `dropped`.
    pub state: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub closed: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub evidence: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub by: Option<String>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct Project {
    next_id: u64,
    items: Vec<Target>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct Book {
    #[serde(default)]
    projects: BTreeMap<String, Project>,
}

fn file(home: &Path) -> PathBuf {
    let d = idle::state_dir(home);
    d.parent().unwrap_or(&d).join("targets.json")
}

/// Lines kept, hidden characters dropped, secrets masked, at most `max` chars.
fn clean(s: &str, max: usize) -> String {
    let hidden = |c: char| {
        (c.is_control() && c != '\n')
            || matches!(c, '\u{200B}'..='\u{200F}' | '\u{202A}'..='\u{202E}' | '\u{2066}'..='\u{2069}' | '\u{2028}' | '\u{2029}' | '\u{FEFF}')
    };
    let t: String = s.chars().filter(|c| !hidden(*c)).collect();
    crate::verbs::session_view::truncate(&crate::verbs::session_view::mask_secrets(t.trim()), max)
}

fn read(home: &Path) -> Result<Book> {
    match std::fs::read_to_string(file(home)) {
        Ok(t) => serde_json::from_str(&t).with_context(|| {
            format!(
                "{} hỏng: sửa hoặc xoá file rồi chạy lại",
                file(home).display()
            )
        }),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Book::default()),
        Err(e) => Err(e.into()),
    }
}

/// The stored root `root` belongs to (longest one that contains it), else `root` itself.
fn key(book: &Book, root: &Path) -> String {
    let root = super::auto::canon(root);
    book.projects
        .keys()
        .filter(|k| root.starts_with(Path::new(k.as_str())))
        .max_by_key(|k| k.len())
        .cloned()
        .unwrap_or_else(|| root.to_string_lossy().into_owned())
}

/// Read, change and write the book under `targets.lock`. Another writer holds the lock for
/// milliseconds; a lock older than 10 s is a crashed writer's and is taken over.
fn edit<T>(home: &Path, root: &Path, f: impl FnOnce(&mut Project) -> Result<T>) -> Result<T> {
    let p = file(home);
    if let Some(d) = p.parent() {
        std::fs::create_dir_all(d)?;
    }
    let lock = p.with_extension("lock");
    let mut tries = 0;
    loop {
        match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&lock)
        {
            Ok(_) => break,
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists && tries < 100 => {
                let stale = std::fs::metadata(&lock)
                    .and_then(|m| m.modified())
                    .ok()
                    .and_then(|at| at.elapsed().ok())
                    .is_some_and(|age| age.as_secs() >= 10);
                if stale {
                    let _ = std::fs::remove_file(&lock);
                } else {
                    std::thread::sleep(std::time::Duration::from_millis(20));
                }
                tries += 1;
            }
            Err(e) => return Err(e).context("targets.lock đang bị giữ, thử lại sau"),
        }
    }
    let out = (|| {
        let mut book = read(home)?;
        let k = key(&book, root);
        let out = f(book.projects.entry(k).or_default())?;
        let tmp = p.with_extension(format!("{}.tmp", std::process::id()));
        std::fs::write(&tmp, format!("{}\n", serde_json::to_string(&book)?))?;
        if let Err(e) = std::fs::rename(&tmp, &p) {
            let _ = std::fs::remove_file(&tmp);
            return Err(e.into());
        }
        Ok(out)
    })();
    let _ = std::fs::remove_file(&lock);
    out
}

/// Every target of the project, open ones first in queue order, then the latest closed ones.
pub(super) fn list(home: &Path, root: &Path) -> Result<Vec<Target>> {
    let mut book = read(home)?;
    let k = key(&book, root);
    let mut items = book
        .projects
        .remove(&k)
        .map(|p| p.items)
        .unwrap_or_default();
    items.sort_by_key(|t| t.state != "open");
    Ok(items)
}

/// The target every room works on now, and how many are open in total.
pub(super) fn current(home: &Path, root: &Path) -> Result<(Option<Target>, usize)> {
    let open: Vec<Target> = list(home, root)?
        .into_iter()
        .filter(|t| t.state == "open")
        .collect();
    Ok((open.first().cloned(), open.len()))
}

/// Queue a target; `first` puts it ahead of every open one.
pub(super) fn add(
    home: &Path,
    root: &Path,
    text: &str,
    check: Option<&str>,
    first: bool,
    from: Option<&str>,
    now: u64,
) -> Result<Target> {
    let text = clean(text, TEXT_MAX);
    if text.is_empty() {
        bail!("đích rỗng");
    }
    let check = check.map(|c| clean(c, CHECK_MAX)).filter(|c| !c.is_empty());
    edit(home, root, |p| {
        if p.items.iter().filter(|t| t.state == "open").count() >= OPEN_MAX {
            bail!("hàng đã có {OPEN_MAX} đích mở: `auto done`/`auto drop` bớt trước");
        }
        p.next_id = p
            .next_id
            .max(p.items.iter().map(|t| t.id).max().unwrap_or(0))
            + 1;
        let t = Target {
            id: p.next_id,
            text,
            check,
            added: now,
            from: from.map(str::to_string),
            state: "open".into(),
            closed: None,
            evidence: None,
            by: None,
        };
        if first {
            p.items.insert(0, t.clone());
        } else {
            p.items.push(t.clone());
        }
        Ok(t)
    })
}

/// Close an open target as `done` (evidence required) or `dropped`; returns it and the next one.
pub(super) fn close(
    home: &Path,
    root: &Path,
    id: u64,
    done: Option<&str>,
    by: Option<&str>,
    now: u64,
) -> Result<(Target, Option<Target>)> {
    let evidence = done.map(|e| clean(e, EVIDENCE_MAX));
    if evidence.as_deref() == Some("") {
        bail!("--evidence rỗng: dán lệnh kiểm + kết quả");
    }
    edit(home, root, |p| {
        let Some(t) = p.items.iter_mut().find(|t| t.id == id) else {
            bail!("không có đích #{id} trong dự án này (`8sync ccc auto queue`)");
        };
        if t.state != "open" {
            bail!("đích #{id} đã {}", t.state);
        }
        t.state = if evidence.is_some() {
            "done"
        } else {
            "dropped"
        }
        .into();
        t.closed = Some(now);
        t.evidence = evidence;
        t.by = by.map(str::to_string);
        let closed = t.clone();
        // Closed targets go after the open ones, newest first; only the last CLOSED_KEEP stay.
        let (open, mut shut): (Vec<Target>, Vec<Target>) = std::mem::take(&mut p.items)
            .into_iter()
            .partition(|t| t.state == "open");
        shut.sort_by_key(|t| std::cmp::Reverse(t.closed.unwrap_or(0)));
        shut.truncate(CLOSED_KEEP);
        let next = open.first().cloned();
        p.items = open.into_iter().chain(shut).collect();
        Ok((closed, next))
    })
}

/// What `auto status --json` carries for the loop: the current target, without the history.
pub(super) fn json(t: Option<&Target>) -> serde_json::Value {
    t.map_or(
        serde_json::Value::Null,
        |t| serde_json::json!({ "id": t.id, "text": t.text, "check": t.check }),
    )
}

/// The message `auto add --now` puts in a room's inbox.
pub(super) fn now_prompt(t: &Target, room: &str) -> String {
    let (role, _) = super::room::role(room);
    let check = t
        .check
        .as_deref()
        .map(|c| format!("Đạt khi `{c}` exit 0.\n"))
        .unwrap_or_default();
    format!(
        "8sync auto --now: owner gửi việc làm NGAY cho cả dự án (đích #{id}, đứng đầu hàng):\n{text}\n{check}\
         Xong lượt đang làm thì chuyển sang đích này: phần hợp vai phòng `{room}` (vai {role}); giữ file trước bằng `8sync ccc . goal \"…\" --files a,b`. \
         Đạt (lệnh kiểm + kết quả) → `8sync ccc auto done {id} --evidence \"<lệnh: kết quả>\"`. Không merge/push main/tag/deploy; câu hỏi Ship vẫn chờ owner.",
        id = t.id,
        text = t.text,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A fresh home with a project `proj` (and `proj/apps/ui`) inside it.
    fn tmp(tag: &str) -> (PathBuf, PathBuf) {
        let h = std::env::temp_dir().join(format!("8sync-target-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&h);
        let root = h.join("proj");
        std::fs::create_dir_all(root.join("apps/ui")).unwrap();
        (h, root)
    }

    #[test]
    fn targets_queue_in_order_and_now_jumps_the_line() {
        let (d, root) = tmp("queue");
        let h = d.as_path();
        assert_eq!(current(h, &root).unwrap(), (None, 0));
        let a = add(
            h,
            &root,
            "  login page\n",
            Some("pnpm test"),
            false,
            None,
            10,
        )
        .unwrap();
        let b = add(h, &root, "docs", None, false, None, 11).unwrap();
        assert_eq!(
            (a.id, b.id, a.text.as_str(), a.check.as_deref()),
            (1, 2, "login page", Some("pnpm test"))
        );
        assert_eq!(current(h, &root).unwrap().0.unwrap().id, 1);
        let c = add(h, &root, "hotfix crash", None, true, Some("qa"), 12).unwrap();
        let (cur, n) = current(h, &root).unwrap();
        let cur = cur.unwrap();
        assert_eq!(
            (cur.id, n, c.id, cur.from.as_deref()),
            (3, 3, 3, Some("qa"))
        );
        assert_eq!(a.from, None);
        // A room in a subfolder of the project sees the same queue.
        assert_eq!(current(h, &root.join("apps/ui")).unwrap().0.unwrap().id, 3);
        // Another project has its own.
        let other = d.join("proj-2");
        std::fs::create_dir_all(&other).unwrap();
        assert_eq!(current(h, &other).unwrap(), (None, 0));
        assert!(add(h, &root, " \u{200B} ", None, false, None, 13).is_err());
    }

    #[test]
    fn done_needs_evidence_moves_the_team_on_and_keeps_history() {
        let (d, root) = tmp("done");
        let h = d.as_path();
        add(h, &root, "a", None, false, None, 1).unwrap();
        add(h, &root, "b", None, false, None, 2).unwrap();
        assert!(close(h, &root, 1, Some("  "), None, 3).is_err());
        let (done, next) =
            close(h, &root, 1, Some("cargo test: 12 passed"), Some("dev"), 3).unwrap();
        assert_eq!(
            (done.state.as_str(), done.by.as_deref(), next.unwrap().id),
            ("done", Some("dev"), 2)
        );
        assert!(close(h, &root, 1, Some("again"), None, 4)
            .unwrap_err()
            .to_string()
            .contains("đã done"));
        assert!(close(h, &root, 9, None, None, 4).is_err());
        let (dropped, next) = close(h, &root, 2, None, None, 5).unwrap();
        assert_eq!((dropped.state.as_str(), next), ("dropped", None));
        assert_eq!(current(h, &root).unwrap(), (None, 0));
        let all = list(h, &root).unwrap();
        assert_eq!(all.iter().map(|t| t.id).collect::<Vec<_>>(), vec![2, 1]);
        // Ids never repeat after targets close.
        assert_eq!(add(h, &root, "c", None, false, None, 6).unwrap().id, 3);
    }

    #[test]
    fn a_corrupt_file_fails_closed_and_a_stale_lock_is_taken_over() {
        let (d, root) = tmp("lock");
        let h = d.as_path();
        add(h, &root, "a", None, false, None, 1).unwrap();
        let f = file(h);
        let lock = f.with_extension("lock");
        std::fs::write(&lock, "").unwrap();
        let old = std::time::SystemTime::now() - std::time::Duration::from_secs(60);
        std::fs::File::options()
            .write(true)
            .open(&lock)
            .unwrap()
            .set_modified(old)
            .unwrap();
        assert_eq!(add(h, &root, "b", None, false, None, 2).unwrap().id, 2);
        assert!(!lock.exists());
        std::fs::write(&f, "{not json").unwrap();
        assert!(add(h, &root, "c", None, false, None, 3)
            .unwrap_err()
            .to_string()
            .contains("hỏng"));
        assert!(current(h, &root).is_err());
        assert_eq!(std::fs::read_to_string(&f).unwrap(), "{not json");
    }

    #[test]
    fn now_prompt_names_the_room_role_check_and_rails() {
        let t = Target {
            id: 7,
            text: "fix login".into(),
            check: Some("pnpm test".into()),
            added: 0,
            from: None,
            state: "open".into(),
            closed: None,
            evidence: None,
            by: None,
        };
        let p = now_prompt(&t, "qa-su-code");
        for want in [
            "đích #7",
            "fix login",
            "`pnpm test` exit 0",
            "qa-su-code",
            "auto done 7 --evidence",
            "Ship vẫn chờ owner",
        ] {
            assert!(p.contains(want), "missing {want}: {p}");
        }
        assert_eq!(json(Some(&t))["id"], 7);
        assert!(json(None).is_null());
    }
}
