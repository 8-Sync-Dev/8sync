//! `8sync ccc know add "<bài học>" [--repo <root>]` · `know ls [--all] [--json]`: one knowledge
//! tree for every project on this machine, one file per repo, so a room learns from the other
//! projects without mixing them up (owner 2026-10-22: "cây tri thức chung không bị nhầm lẫn tri
//! thức nhưng vẫn đọc của nhau được để học hỏi"; the model is omp's `memory.scoping:
//! per-project-tagged`). Files: `~/.local/state/<NS>/ccc/know/<repo-key>.md`, first line `# <root>`,
//! then one `- <YYYY-MM-DD> [<room>] <lesson>` per line. The SessionStart digest ([`digest`])
//! shows the room's own project first (its last lines), then the other projects' last few, so the
//! own repo's lessons are never confused with a neighbour's: every block is headed by its root.
//! `su-code/KNOWLEDGE.md` stays the repo's own, committed memory; this tree is per machine and
//! holds GENERAL lessons only (tools, hooks, guards, ways of working): a client's facts, secrets or
//! data never go in, since every project on the machine reads it (8 Sync rule: clients stay apart).
use std::path::{Path, PathBuf};

use anyhow::{bail, Result};
use serde_json::json;

const USAGE: &str = "usage: 8sync ccc know add \"<bài học>\" [--repo <root>] | ls [--all] [--json]";
/// Lines of the own project in the digest, and of each other project.
const OWN_LINES: usize = 10;
const OTHER_LINES: usize = 3;
/// What `ls` prints per project without `--all`.
const LS_LINES: usize = 30;
/// A lesson longer than this is cut (one line each; detail belongs in su-code/KNOWLEDGE.md).
const MAX_LEN: usize = 400;
/// The digest's share of the 10,000-char SessionStart hook output.
pub(super) const DIGEST_CAP: usize = 1_500;

pub(super) fn dir(home: &Path) -> PathBuf {
    home.join(".local/state").join(crate::brand::NS).join("ccc").join("know")
}

/// Pure: the file name of a repo root: its basename plus a short hash of the full, lowercased,
/// slash-normalised path, so two `app` repos never share a file and the name stays readable.
pub(super) fn key(root: &Path) -> String {
    let norm = root.to_string_lossy().replace('\\', "/").trim_end_matches('/').trim_start_matches("//?/").to_lowercase();
    let base: String = Path::new(&norm).file_name().map(|b| b.to_string_lossy().into_owned()).unwrap_or_else(|| "repo".into());
    let base: String = base.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '-' }).collect();
    // FNV-1a: stable across runs and platforms, no dependency.
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in norm.bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(0x0100_0000_01b3);
    }
    format!("{base}-{:08x}", (h >> 32) as u32 ^ h as u32)
}

fn file(home: &Path, root: &Path) -> PathBuf {
    dir(home).join(format!("{}.md", key(root)))
}

/// Pure: the line stored for a lesson; refused when empty. `room` = the session's registry name.
pub(super) fn line(day: &str, room: Option<&str>, lesson: &str) -> Result<String> {
    let l: String = lesson.split_whitespace().collect::<Vec<_>>().join(" ");
    if l.is_empty() {
        bail!("bài học rỗng\n{USAGE}");
    }
    let l: String = l.chars().take(MAX_LEN).collect();
    Ok(match room.filter(|r| !r.is_empty()) {
        Some(r) => format!("- {day} [{r}] {l}"),
        None => format!("- {day} {l}"),
    })
}

/// Append one lesson to the repo's file (created with its `# <root>` heading).
pub(super) fn add(home: &Path, root: &Path, day: &str, room: Option<&str>, lesson: &str) -> Result<PathBuf> {
    let p = file(home, root);
    let l = line(day, room, lesson)?;
    std::fs::create_dir_all(dir(home))?;
    let mut body = std::fs::read_to_string(&p).unwrap_or_default();
    if body.is_empty() {
        body = format!("# {}\n", root.to_string_lossy().replace('\\', "/"));
    }
    if !body.ends_with('\n') {
        body.push('\n');
    }
    body.push_str(&l);
    body.push('\n');
    std::fs::write(&p, body)?;
    Ok(p)
}

/// One project's file: (root as written in its heading, lesson lines in order).
pub(super) struct Book {
    pub root: String,
    pub lines: Vec<String>,
}

fn parse(body: &str) -> Option<Book> {
    let mut it = body.lines();
    let root = it.next()?.strip_prefix("# ")?.trim().to_string();
    let lines = it.filter(|l| l.starts_with("- ")).map(str::to_string).collect();
    Some(Book { root, lines })
}

/// Every project's book, the one at `root` first (None when it has no file), the rest by file name.
pub(super) fn books(home: &Path, root: &Path) -> (Option<Book>, Vec<Book>) {
    let own = std::fs::read_to_string(file(home, root)).ok().and_then(|b| parse(&b));
    let own_key = key(root);
    let mut names: Vec<PathBuf> = std::fs::read_dir(dir(home)).into_iter().flatten().flatten().map(|e| e.path()).filter(|p| p.extension().is_some_and(|e| e == "md")).collect();
    names.sort();
    let others = names
        .into_iter()
        .filter(|p| p.file_stem().is_none_or(|s| s != own_key.as_str()))
        .filter_map(|p| std::fs::read_to_string(p).ok())
        .filter_map(|b| parse(&b))
        .collect();
    (own, others)
}

/// Pure: the SessionStart block, at most `cap` chars, empty when nothing is known yet. Own project
/// first with its last [`OWN_LINES`], then each other project under its own root heading with its
/// last [`OTHER_LINES`]: a room reads its neighbours' lessons and always knows whose they are.
pub(super) fn digest_of(own: Option<&Book>, others: &[Book], cap: usize) -> String {
    let mut out = String::new();
    if let Some(b) = own.filter(|b| !b.lines.is_empty()) {
        out.push_str("## Tri thức máy này — dự án này\n");
        out.push_str(&b.lines[b.lines.len().saturating_sub(OWN_LINES)..].join("\n"));
    }
    let rest: Vec<String> = others.iter().filter(|b| !b.lines.is_empty()).map(|b| format!("### {}\n{}", b.root, b.lines[b.lines.len().saturating_sub(OTHER_LINES)..].join("\n"))).collect();
    if !rest.is_empty() {
        if !out.is_empty() {
            out.push_str("\n\n");
        }
        out.push_str("## Tri thức máy này — dự án khác (đọc để học, không áp dụng mù)\n");
        out.push_str(&rest.join("\n"));
    }
    if out.chars().count() > cap {
        let mut end = out.char_indices().nth(cap).map_or(out.len(), |(i, _)| i);
        while !out.is_char_boundary(end) {
            end -= 1;
        }
        out.truncate(end);
    }
    out
}

/// The SessionStart block for the room at `root` (`hook session-start`).
pub(super) fn digest(home: &Path, root: &Path, cap: usize) -> String {
    let (own, others) = books(home, root);
    digest_of(own.as_ref(), &others, cap)
}

/// `8sync ccc know …`. `room`: the caller's registry name; `day`: today as YYYY-MM-DD.
pub(super) fn run(rest: &[String], home: &Path, root: &Path, room: Option<&str>, day: &str) -> Result<()> {
    let mut it = rest.iter();
    match it.next().map(String::as_str) {
        Some("add") => {
            let (mut text, mut repo) = (Vec::new(), None);
            while let Some(a) = it.next() {
                match a.as_str() {
                    "--repo" => repo = Some(PathBuf::from(it.next().filter(|v| !v.starts_with("--")).ok_or_else(|| anyhow::anyhow!("--repo cần một đường dẫn\n{USAGE}"))?)),
                    x if x.starts_with("--") => bail!("không rõ `{x}`\n{USAGE}"),
                    w => text.push(w.to_string()),
                }
            }
            let root = match repo {
                Some(r) => crate::verbs::here::repo_of(&r).unwrap_or(r),
                None => root.to_path_buf(),
            };
            let p = add(home, &root, day, room, &text.join(" "))?;
            crate::ui::ok(&format!("đã ghi vào {}", p.display()));
            Ok(())
        }
        Some("ls") | None => {
            let (all, as_json) = (rest.iter().any(|a| a == "--all"), rest.iter().any(|a| a == "--json"));
            if let Some(x) = rest.iter().skip(1).find(|a| !matches!(a.as_str(), "--all" | "--json")) {
                bail!("không rõ `{x}`\n{USAGE}");
            }
            let (own, others) = books(home, root);
            let take = |b: &Book| -> Vec<String> { if all { b.lines.clone() } else { b.lines[b.lines.len().saturating_sub(LS_LINES)..].to_vec() } };
            if as_json {
                let o = own.as_ref().map(|b| json!({ "root": b.root, "lines": take(b) }));
                let rest: Vec<_> = others.iter().map(|b| json!({ "root": b.root, "lines": take(b) })).collect();
                println!("{}", json!({ "own": o, "others": rest, "dir": dir(home) }));
                return Ok(());
            }
            match &own {
                Some(b) if !b.lines.is_empty() => println!("# {}\n{}", b.root, take(b).join("\n")),
                _ => println!("# {}\n(chưa có bài học: `8sync ccc know add \"<bài học>\"`)", root.to_string_lossy().replace('\\', "/")),
            }
            for b in &others {
                if !b.lines.is_empty() {
                    println!("\n# {}\n{}", b.root, take(b).join("\n"));
                }
            }
            Ok(())
        }
        Some(x) => bail!("không rõ `{x}`\n{USAGE}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn home(tag: &str) -> PathBuf {
        let h = std::env::temp_dir().join(format!("8sync-know-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&h);
        std::fs::create_dir_all(&h).unwrap();
        h
    }

    #[test]
    fn a_lesson_lands_in_its_repo_file_and_the_digest_puts_the_own_project_first_then_the_others_by_root() {
        let h = home("tree");
        let (a, b) = (Path::new("C:/code/app"), Path::new("/srv/zus"));
        assert_ne!(key(a), key(b));
        assert_eq!(key(a), key(Path::new("c:\\code\\app\\")), "case and slashes do not split a repo");
        assert!(key(a).starts_with("app-"));
        assert!(line("2026-10-22", Some("dev"), "   ").is_err());
        assert_eq!(line("2026-10-22", Some("dev"), "  gitleaks  full history\nates 4 GB ").unwrap(), "- 2026-10-22 [dev] gitleaks full history ates 4 GB");
        assert_eq!(line("2026-10-22", None, "x").unwrap(), "- 2026-10-22 x");
        add(&h, a, "2026-10-22", Some("dev"), "a1").unwrap();
        add(&h, a, "2026-10-22", Some("qa"), "a2").unwrap();
        add(&h, b, "2026-10-22", Some("lead"), "b1").unwrap();
        let body = std::fs::read_to_string(file(&h, a)).unwrap();
        assert_eq!(body, "# C:/code/app\n- 2026-10-22 [dev] a1\n- 2026-10-22 [qa] a2\n");
        let (own, others) = books(&h, a);
        assert_eq!(own.as_ref().map(|o| o.lines.len()), Some(2));
        assert_eq!(others.iter().map(|o| o.root.as_str()).collect::<Vec<_>>(), ["/srv/zus"]);
        let d = digest(&h, a, 4000);
        assert!(d.starts_with("## Tri thức máy này — dự án này\n- 2026-10-22 [dev] a1\n- 2026-10-22 [qa] a2"), "{d}");
        assert!(d.contains("### /srv/zus\n- 2026-10-22 [lead] b1"), "{d}");
        // From zus's side the roles swap; a repo nobody wrote about reads only the others.
        let d = digest(&h, b, 4000);
        assert!(d.starts_with("## Tri thức máy này — dự án này\n- 2026-10-22 [lead] b1"), "{d}");
        assert!(d.contains("### C:/code/app"));
        let d = digest(&h, Path::new("/srv/new"), 4000);
        assert!(!d.contains("dự án này") && d.contains("### C:/code/app") && d.contains("### /srv/zus"), "{d}");
        assert_eq!(digest(&home("empty"), a, 4000), "");
        // The cap cuts on a char boundary; only the last lines of a long book show.
        for i in 0..30 {
            add(&h, a, "2026-10-22", None, &format!("bài {i} ở đây")).unwrap();
        }
        let d = digest(&h, a, 4000);
        assert!(!d.contains("[dev] a1") && d.contains("bài 29 ở đây"), "{d}");
        assert!(digest(&h, a, 50).chars().count() <= 50);
    }
}
