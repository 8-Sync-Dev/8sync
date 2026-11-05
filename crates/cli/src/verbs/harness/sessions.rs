//! omp session directory naming (`~/.omp/agent/sessions/<slug>`), shared by
//! `harness toolstats` and the harness web dashboard.
//!
//! omp's encoding (observed on disk):
//! - project under home → `-<rel with every separator replaced by '-'>`
//!   (`C:\Users\Admin\Documents\test` with home `C:\Users\Admin` → `-Documents-test`)
//! - anywhere else → `--<abs path, leading separator dropped, '/' '\' ':' → '-'>--`
//!   (`C:\Users\Projects\su-code` → `--C--Users-Projects-su-code--`, `/tmp/x` → `--tmp-x--`)
//!
//! Works on the path *string* so Windows and Unix layouts are both testable on any host.

use std::path::{Path, PathBuf};

/// `\\?\C:\x` → `C:\x`; trailing separators trimmed.
fn norm(p: &Path) -> String {
    let s = p.to_string_lossy();
    let s = s.strip_prefix(r"\\?\").unwrap_or(&s);
    let t = s.trim_end_matches(['/', '\\']);
    if t.is_empty() { s.to_string() } else { t.to_string() }
}

fn is_windows_path(s: &str) -> bool {
    s.contains('\\') || s.as_bytes().get(1) == Some(&b':')
}

/// `root` relative to `home` as a string, or None when outside it.
/// Windows paths compare case-insensitively (the filesystem does).
fn rel_to_home<'a>(home: &str, root: &'a str) -> Option<&'a str> {
    let head = root.get(..home.len())?;
    let same = if is_windows_path(home) { head.eq_ignore_ascii_case(home) } else { head == home };
    if !same {
        return None;
    }
    let rest = &root[home.len()..];
    match rest.chars().next() {
        Some('/') | Some('\\') => Some(&rest[1..]),
        _ => None,
    }
}

/// The omp session directory name for a project root.
pub(crate) fn session_slug(home: &Path, root: &Path) -> String {
    let (home, root) = (norm(home), norm(root));
    match rel_to_home(&home, &root) {
        Some(rel) => format!("-{}", rel.replace(['/', '\\'], "-")),
        None => format!(
            "--{}--",
            root.trim_start_matches(['/', '\\']).replace(['/', '\\', ':'], "-")
        ),
    }
}

/// `~/.omp/agent/sessions/<slug>` for a project root.
pub(crate) fn session_dir(home: &Path, root: &Path) -> PathBuf {
    home.join(".omp").join("agent").join("sessions").join(session_slug(home, root))
}

#[cfg(test)]
mod tests {
    use super::session_slug;
    use std::path::Path;

    #[test]
    fn windows_paths_match_omp_layout() {
        let home = Path::new(r"C:\Users\Admin");
        assert_eq!(
            session_slug(home, Path::new(r"C:\Users\Projects\su-code")),
            "--C--Users-Projects-su-code--"
        );
        assert_eq!(session_slug(home, Path::new(r"C:\Users\Admin\Documents\test")), "-Documents-test");
        // Verbatim prefix + drive-letter case differences still resolve under home.
        assert_eq!(session_slug(home, Path::new(r"\\?\c:\users\admin\tmp\x")), "-tmp-x");
    }

    #[test]
    fn unix_paths_match_omp_layout() {
        let home = Path::new("/home/alex");
        assert_eq!(session_slug(home, Path::new("/home/alex/Projects/su-code")), "-Projects-su-code");
        assert_eq!(session_slug(home, Path::new("/tmp/smoke")), "--tmp-smoke--");
        // A sibling that merely shares the prefix is not under home.
        assert_eq!(session_slug(home, Path::new("/home/alexx/p")), "--home-alexx-p--");
    }
}
