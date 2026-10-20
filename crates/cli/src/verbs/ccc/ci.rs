//! `8sync ccc auto ci [local|github] [--json]` and the `ci` field of `auto status --json`: is the
//! project's GitHub CI usable right now? `ok` · `failing` · `billing` · `local` · `unknown`. Measured on ai-game-studio
//! (2026-10-19): 375 of 379 runs failed in 3–7 s for 12 h on a billing hold ("The job was not
//! started because recent account payments have failed or your spending limit needs to be
//! increased") and no room told the owner; every room kept waiting on or re-running CI.
//!
//! `local`: the owner runs CI/CD on the release machine and GitHub only stores the code
//! (2026-10-20, after the billing hold on 3d-game and ai-game-studio). `auto ci local` turns GitHub
//! Actions off for the repo (`PUT repos/{owner}/{repo}/actions/permissions enabled=false`),
//! `auto ci github` back on; a repo with Actions off reads `local` before any run is looked at, so
//! old runs never make rooms wait on a CI that will not run.
//! Reading: `gh api repos/{owner}/{repo}/actions/permissions` (`enabled` false → `local`), then
//! `gh run list --limit 5 --json databaseId,status,conclusion` in the repo, then, for the
//! newest failed run, `gh run view <id> --json jobs` and the job annotations
//! `gh api repos/{owner}/{repo}/check-runs/<job id>/annotations` (`[].message`). GitHub puts the
//! billing reason only there: the run and job conclusions just say `failure`.
//!
//! `status` must stay cheap (HQ polls it with a 5 s timeout, `auto wait` every 2 s), so it only
//! reads the cached reading (`<state>/ccc/ci/<repo key>.json`, fresh for [`FRESH_S`]); a stale one
//! starts `8sync ccc auto ci --json` in the background (one at a time, [`LOCK_S`]). A billing
//! reading alerts the owner once per day per repo, on HQ's `#alerts` channel (owner mention).
use std::path::{Path, PathBuf};

use anyhow::Result;
use serde_json::{json, Value};

/// A reading younger than this is served as is.
pub(super) const FRESH_S: u64 = 600;
/// A background refresh started less than this long ago is still running (or died): no twin.
const LOCK_S: u64 = 120;
const DAY_S: u64 = 86_400;
/// What GitHub writes on a job it did not start for billing (lowercased): "The job was not started
/// because recent account payments have failed or your spending limit needs to be increased".
/// Whole clauses only: a test log that merely says "spending limit" is not a billing hold.
const BILLING: [&str; 3] = ["recent account payments have failed", "spending limit needs to be increased", "job was not started because"];
/// Every `gh` call is killed after this long: a hung one (network, auth prompt) never piles up.
const GH_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(20);
const PERMISSIONS: &str = "repos/{owner}/{repo}/actions/permissions";
const BAD: [&str; 4] = ["failure", "startup_failure", "timed_out", "action_required"];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Ci {
    Ok,
    Failing,
    Billing,
    Local,
    Unknown,
}

impl Ci {
    pub(super) fn key(self) -> &'static str {
        match self {
            Ci::Ok => "ok",
            Ci::Failing => "failing",
            Ci::Billing => "billing",
            Ci::Local => "local",
            Ci::Unknown => "unknown",
        }
    }

    fn parse(s: &str) -> Option<Ci> {
        [Ci::Ok, Ci::Failing, Ci::Billing, Ci::Local, Ci::Unknown].into_iter().find(|c| c.key() == s)
    }
}

/// One line for `auto status` (text) and HQ.
pub(super) fn line(ci: &str) -> String {
    match ci {
        "ok" => "CI: xanh (5 run gần nhất)".into(),
        "failing" => "CI: đỏ — có run fail trong 5 run gần nhất (`gh run list`)".into(),
        "billing" => "CI: DỪNG — GitHub không chạy job (thanh toán/spending limit của account); không chờ CI, gate local một lần mỗi head SHA; owner gỡ ở GitHub Billing, hoặc chạy CI/CD trên máy release: `8sync ccc auto ci local`".into(),
        "local" => "CI: local — GitHub chỉ lưu code (Actions tắt): gate local một lần mỗi head SHA là CI, build/release chạy trên máy release; bật lại Actions: `8sync ccc auto ci github`".into(),
        _ => "CI: chưa rõ (gh thiếu, chưa login hoặc offline)".into(),
    }
}

fn billing(msg: &str) -> bool {
    let m = msg.to_lowercase();
    BILLING.iter().any(|b| m.contains(b))
}

fn completed(runs: &Value) -> Vec<&Value> {
    runs.as_array().into_iter().flatten().filter(|r| r["status"] == "completed").collect()
}

fn failed(r: &Value) -> bool {
    r["conclusion"].as_str().is_some_and(|c| BAD.contains(&c))
}

/// Pure: `runs` = `gh run list --json databaseId,status,conclusion` (newest first), `notes` = the
/// annotation messages of the newest failed run's jobs. Runs still queued or running are not judged.
/// Billing counts only while no run succeeded after the annotated one (the hold was lifted).
pub(super) fn classify(runs: &Value, notes: &[String]) -> Ci {
    let done = completed(runs);
    let newest_failed = done.iter().position(|r| failed(r));
    let lifted = newest_failed.is_some_and(|f| done[..f].iter().any(|r| r["conclusion"] == "success"));
    if done.is_empty() {
        Ci::Unknown
    } else if !lifted && notes.iter().any(|n| billing(n)) {
        Ci::Billing
    } else if newest_failed.is_some() {
        Ci::Failing
    } else {
        Ci::Ok
    }
}

/// IO through `gh` (args → stdout, None on any error): the reading described in the module doc.
pub(super) fn read(gh: &dyn Fn(&[&str]) -> Option<String>) -> Ci {
    let actions = gh(&["api", PERMISSIONS]).and_then(|o| serde_json::from_str::<Value>(&o).ok());
    if actions.is_some_and(|a| a["enabled"] == false) {
        return Ci::Local;
    }
    let Some(runs) = gh(&["run", "list", "--limit", "5", "--json", "databaseId,status,conclusion"]).and_then(|o| serde_json::from_str::<Value>(&o).ok()) else {
        return Ci::Unknown;
    };
    let mut notes = Vec::new();
    if let Some(id) = completed(&runs).into_iter().find(|r| failed(r)).and_then(|r| r["databaseId"].as_u64()) {
        let id = id.to_string();
        let jobs = gh(&["run", "view", &id, "--json", "jobs"]).and_then(|o| serde_json::from_str::<Value>(&o).ok()).unwrap_or(Value::Null);
        // Every job of a billing-held run carries the same note: two are enough.
        for job in jobs["jobs"].as_array().into_iter().flatten().filter_map(|j| j["databaseId"].as_u64()).take(2) {
            let path = format!("repos/{{owner}}/{{repo}}/check-runs/{job}/annotations");
            let Some(a) = gh(&["api", &path]).and_then(|o| serde_json::from_str::<Value>(&o).ok()) else { continue };
            notes.extend(a.as_array().into_iter().flatten().filter_map(|n| n["message"].as_str()).map(String::from));
        }
    }
    classify(&runs, &notes)
}

fn dir(home: &Path) -> PathBuf {
    let d = super::idle::state_dir(home);
    d.parent().unwrap_or(&d).join("ci")
}

/// File-name key of a repo path (FNV-1a 64): stable, never user text in a path. The path is
/// normalized first (permit.rs `norm` rules: `/` separators, no `\\?\` verbatim prefix, no trailing
/// `/`, case folded on Windows), so the scoped root `auto status` reads (stored canonicalized, with
/// `\\?\`) and the root the background `auto ci` writes (plain) share one cache file.
fn key(repo: &Path) -> String {
    let s = repo.to_string_lossy().replace('\\', "/");
    let s = s.strip_prefix("//?/").unwrap_or(&s).trim_end_matches('/');
    let s = if cfg!(windows) { s.to_lowercase() } else { s.to_string() };
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in s.bytes() {
        h = (h ^ b as u64).wrapping_mul(0x0100_0000_01b3);
    }
    format!("{h:016x}")
}

fn cache_file(home: &Path, repo: &Path) -> PathBuf {
    dir(home).join(format!("{}.json", key(repo)))
}

/// What `auto status` shows: the cached reading while fresh; otherwise the last one (or `unknown`)
/// and `refresh` is called, at most once per [`LOCK_S`].
pub(super) fn cached(home: &Path, repo: &Path, now: u64, refresh: impl FnOnce()) -> Ci {
    let f = cache_file(home, repo);
    let c = super::idle::read_json(&f);
    let at = c.as_ref().and_then(|c| c["at"].as_u64());
    let ci = c.as_ref().and_then(|c| c["ci"].as_str()).and_then(Ci::parse).unwrap_or(Ci::Unknown);
    if at.is_some_and(|a| now.saturating_sub(a) < FRESH_S) {
        return ci;
    }
    let lock = f.with_extension("lock");
    let busy = super::idle::read_json(&lock).and_then(|l| l["at"].as_u64()).is_some_and(|a| now.saturating_sub(a) < LOCK_S);
    if !busy {
        super::idle::write_json(&lock, &json!({ "at": now }));
        refresh();
    }
    ci
}

/// Read CI now, store it, alert the owner once a day on `billing`. `alert(title, text)` posts it.
pub(super) fn refresh(home: &Path, repo: &Path, now: u64, gh: &dyn Fn(&[&str]) -> Option<String>, alert: impl FnOnce(&str, &str) -> Result<()>) -> Ci {
    let ci = read(gh);
    let f = cache_file(home, repo);
    // A reading stored after this one started is newer (`auto ci local` while a background refresh
    // was still reading the old runs): keep it, and no alert from this stale reading.
    if let Some(newer) = super::idle::read_json(&f).filter(|c| c["at"].as_u64().is_some_and(|a| a > now)) {
        let _ = std::fs::remove_file(f.with_extension("lock"));
        return newer["ci"].as_str().and_then(Ci::parse).unwrap_or(ci);
    }
    super::idle::write_json(&f, &json!({ "schema": 1, "at": now, "ci": ci.key(), "repo": repo.to_string_lossy() }));
    let _ = std::fs::remove_file(f.with_extension("lock"));
    if ci == Ci::Billing {
        let stamp = dir(home).join(format!("{}.alert.json", key(repo)));
        let day = now / DAY_S;
        if super::idle::read_json(&stamp).and_then(|s| s["day"].as_u64()) != Some(day) {
            let name = repo.file_name().map_or_else(|| repo.to_string_lossy().into_owned(), |n| n.to_string_lossy().into_owned());
            let text = format!("{name}: GitHub Actions không chạy job (\"recent account payments have failed or your spending limit needs to be increased\"). Mọi PR đang chỉ dựa vào gate local. Gỡ: GitHub → Settings → Billing and plans (thanh toán / tăng spending limit Actions). Các phòng auto đã được báo không chờ CI.");
            if alert("CI dừng: GitHub billing", &text).is_ok() {
                super::idle::write_json(&stamp, &json!({ "day": day }));
            }
        }
    }
    ci
}

#[cfg(windows)]
fn quiet(c: &mut std::process::Command) {
    use std::os::windows::process::CommandExt;
    // No console window (a status call from HQ has none, so a child would open one) and its own group.
    c.creation_flags(0x0800_0000 | 0x0000_0200);
}

#[cfg(not(windows))]
fn quiet(_: &mut std::process::Command) {}

/// `gh <args>` in `repo`: stdout on exit 0, None otherwise (missing gh, no login, offline, or
/// still running after [`GH_TIMEOUT`]).
pub(super) fn gh_in(repo: &Path) -> impl Fn(&[&str]) -> Option<String> + '_ {
    move |args| {
        let mut c = std::process::Command::new("gh");
        c.args(args)
            .current_dir(repo)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .env("GH_PROMPT_DISABLED", "1")
            .env("NO_COLOR", "1");
        quiet(&mut c);
        let out = crate::verbs::hq_core::agents::run_bounded(c, GH_TIMEOUT)?;
        Some(String::from_utf8_lossy(&out).into_owned())
    }
}

/// `auto status`: the cached reading, a stale one refreshed by `8sync ccc auto ci --json` in the
/// background. Never from a test build: `current_exe` is the test runner there.
pub(super) fn status(home: &Path, repo: &Path, now: u64) -> Ci {
    cached(home, repo, now, || {
        if cfg!(test) {
            return;
        }
        if let Ok(exe) = std::env::current_exe() {
            let mut c = std::process::Command::new(exe);
            c.args(["ccc", "auto", "ci", "--json"]).current_dir(repo).stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null());
            quiet(&mut c);
            let _ = c.spawn();
        }
    })
}

/// Turn GitHub Actions of the repo off (`local`: CI/CD on the release machine, GitHub only stores
/// the code) or back on (`github`). PUT answers 204 with no body, so any exit 0 is done.
fn set_actions(gh: &dyn Fn(&[&str]) -> Option<String>, on: bool) -> Result<()> {
    let enabled = format!("enabled={on}");
    gh(&["api", "-X", "PUT", PERMISSIONS, "-F", &enabled])
        .map(drop)
        .ok_or_else(|| anyhow::anyhow!("gh không đổi được GitHub Actions của repo (cần `gh` đã login với quyền admin repo)"))
}

/// `8sync ccc auto ci [local|github] [--json]`: switch where CI runs (optional), then read CI of the
/// project at `root` now and store it under `repo`, the repo `auto status` reads ([`super::auto::ci_repo`]).
pub(super) fn run(rest: &[String], home: &Path, root: &Path, repo: &Path, now: u64) -> Result<()> {
    let mut set = None;
    for a in rest {
        match a.as_str() {
            "--json" => {}
            "local" if set.is_none() => set = Some(false),
            "github" if set.is_none() => set = Some(true),
            x => anyhow::bail!("không rõ `{x}`\nusage: 8sync ccc auto ci [local|github] [--json]"),
        }
    }
    let gh = gh_in(root);
    if let Some(on) = set {
        // Hold the refresh lock across the switch: a status call meanwhile must not start a
        // background reading that sees Actions still on and stores it as newer than this one.
        super::idle::write_json(&cache_file(home, repo).with_extension("lock"), &json!({ "at": now }));
        set_actions(&gh, on)?;
    }
    let ci = refresh(home, repo, now, &gh, crate::verbs::hq::alert_owner);
    if rest.iter().any(|a| a == "--json") {
        println!("{}", json!({ "schema": 1, "ci": ci.key(), "repo": root.to_string_lossy(), "at": now }));
    } else {
        println!("{}", line(ci.key()));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::{Cell, RefCell};

    fn runs(c: &[&str]) -> Value {
        Value::Array(c.iter().enumerate().map(|(i, c)| json!({ "databaseId": 100 + i, "status": "completed", "conclusion": c })).collect())
    }

    #[test]
    fn classifier_reads_billing_failures_success_and_errors() {
        let bill = vec!["The job was not started because recent account payments have failed or your spending limit needs to be increased. Please check the 'Billing & plans' section in your settings".to_string()];
        assert_eq!(classify(&runs(&["failure", "failure"]), &bill), Ci::Billing);
        assert_eq!(classify(&runs(&["success", "failure", "success"]), &[]), Ci::Failing, "mixed → failing");
        assert_eq!(classify(&runs(&["failure"]), &["Process completed with exit code 1.".into()]), Ci::Failing);
        assert_eq!(classify(&runs(&["success", "success", "skipped", "cancelled"]), &[]), Ci::Ok);
        assert_eq!(classify(&json!([{ "status": "in_progress", "conclusion": "" }]), &[]), Ci::Unknown, "nothing finished yet");
        assert_eq!(classify(&json!([]), &[]), Ci::Unknown);
        // Through gh: an error is unknown; a failed run's job annotations decide billing.
        assert_eq!(read(&|_: &[&str]| None), Ci::Unknown);
        assert_eq!(read(&|_: &[&str]| Some("not json".into())), Ci::Unknown);
        let calls = RefCell::new(Vec::<String>::new());
        let gh = |a: &[&str]| {
            calls.borrow_mut().push(a.join(" "));
            Some(match a[..2] {
                ["run", "list"] => runs(&["failure", "success"]).to_string(),
                ["run", "view"] => json!({ "jobs": [{ "databaseId": 7 }] }).to_string(),
                _ => json!([{ "message": bill[0] }]).to_string(),
            })
        };
        assert_eq!(read(&gh), Ci::Billing);
        assert_eq!(calls.borrow()[0], "api repos/{owner}/{repo}/actions/permissions");
        assert_eq!(calls.borrow()[2], "run view 100 --json jobs");
        assert_eq!(calls.borrow()[3], "api repos/{owner}/{repo}/check-runs/7/annotations");
        let green = |a: &[&str]| (a[..2] == ["run", "list"]).then(|| runs(&["success"]).to_string());
        assert_eq!(read(&green), Ci::Ok, "all green: no annotation call needed");
    }

    #[test]
    fn actions_off_reads_local_whatever_the_old_runs_say() {
        // 3d-game 2026-10-20: every run failed on a billing hold; the owner moved CI/CD to the
        // release machine. Old runs (red or green) must not make rooms wait on GitHub.
        for old in [runs(&["failure"]), runs(&["success"])] {
            let gh = |a: &[&str]| {
                Some(match a {
                    ["api", p] if *p == PERMISSIONS => json!({ "enabled": false }).to_string(),
                    ["run", "list", ..] => old.to_string(),
                    _ => panic!("no more calls once Actions is off: {a:?}"),
                })
            };
            assert_eq!(read(&gh), Ci::Local);
        }
        let on = |a: &[&str]| match a {
            ["api", p] if *p == PERMISSIONS => Some(json!({ "enabled": true, "allowed_actions": "all" }).to_string()),
            ["run", "list", ..] => Some(runs(&["success"]).to_string()),
            _ => None,
        };
        assert_eq!(read(&on), Ci::Ok);
        assert_eq!(Ci::parse(Ci::Local.key()), Some(Ci::Local), "the cached reading round-trips");
        assert!(line("local").contains("GitHub chỉ lưu code"));
        // The switch: one PUT, `-F` so GitHub gets a boolean; a failed gh call is an error.
        let calls = RefCell::new(Vec::<String>::new());
        let put = |a: &[&str]| {
            calls.borrow_mut().push(a.join(" "));
            Some(String::new())
        };
        set_actions(&put, false).unwrap();
        set_actions(&put, true).unwrap();
        assert_eq!(*calls.borrow(), ["api -X PUT repos/{owner}/{repo}/actions/permissions -F enabled=false", "api -X PUT repos/{owner}/{repo}/actions/permissions -F enabled=true"]);
        assert!(set_actions(&|_: &[&str]| None, false).is_err());
    }

    #[test]
    fn the_verbatim_and_plain_root_share_one_cache_key() {
        assert_eq!(key(Path::new(r"\\?\C:\x\repo")), key(Path::new(r"C:\x\repo")));
        assert_eq!(key(Path::new(r"C:\x\repo\")), key(Path::new("C:/x/repo")));
        assert_ne!(key(Path::new(r"C:\x\repo")), key(Path::new(r"C:\x\other")));
        // What status reads after the background refresh wrote it from the plain root.
        let h = std::env::temp_dir().join(format!("8sync-ci-key-{}", crate::verbs::uuid_sessions::new_uuid()));
        let green = |a: &[&str]| (a[..2] == ["run", "list"]).then(|| runs(&["success"]).to_string());
        refresh(&h, Path::new(r"C:\x\repo"), 100, &green, |_: &str, _: &str| Ok(()));
        assert_eq!(cached(&h, Path::new(r"\\?\C:\x\repo"), 101, || panic!("fresh: no refresh")), Ci::Ok);
        let _ = std::fs::remove_dir_all(&h);
    }

    #[test]
    fn billing_needs_the_full_phrase_and_a_later_success_lifts_it() {
        let bill = vec!["The job was not started because recent account payments have failed or your spending limit needs to be increased.".to_string()];
        // A success newer than the annotated (newest failed) run: the hold is over.
        assert_eq!(classify(&runs(&["success", "failure", "failure"]), &bill), Ci::Failing);
        assert_eq!(classify(&runs(&["success", "success", "failure"]), &bill), Ci::Failing, "an older failure is still in the window");
        assert_eq!(classify(&runs(&["failure", "success"]), &bill), Ci::Billing, "success only before the hold");
        // Close variants match; a bare "spending limit" does not.
        for n in ["Your spending limit needs to be increased", "The job was not started because recent account payments have failed"] {
            assert_eq!(classify(&runs(&["failure"]), &[n.to_string()]), Ci::Billing, "{n}");
        }
        assert_eq!(classify(&runs(&["failure"]), &["test: spending limit exceeded for user 42".into()]), Ci::Failing);
    }

    #[test]
    fn status_serves_the_cache_for_ten_minutes_and_alerts_once_a_day() {
        let h = std::env::temp_dir().join(format!("8sync-ci-{}-{}", std::process::id(), crate::verbs::uuid_sessions::new_uuid()));
        let repo = h.join("proj");
        let t = 1_000 * DAY_S + 3600;
        let refreshes = Cell::new(0);
        let bump = || refreshes.set(refreshes.get() + 1);
        // Nothing read yet: unknown, and one background refresh starts (not two while it runs).
        assert_eq!(cached(&h, &repo, t, bump), Ci::Unknown);
        assert_eq!(cached(&h, &repo, t + 5, bump), Ci::Unknown);
        assert_eq!(refreshes.get(), 1);
        let bill = |a: &[&str]| {
            Some(match a[..2] {
                ["run", "list"] => runs(&["failure"]).to_string(),
                ["run", "view"] => json!({ "jobs": [{ "databaseId": 1 }] }).to_string(),
                _ => json!([{ "message": "recent account payments have failed" }]).to_string(),
            })
        };
        let alerts = Cell::new(0);
        let alert = |_: &str, _: &str| {
            alerts.set(alerts.get() + 1);
            Ok(())
        };
        assert_eq!(refresh(&h, &repo, t, &bill, alert), Ci::Billing);
        // Fresh for 10 min: no refresh; at 10 min it refreshes again.
        assert_eq!(cached(&h, &repo, t + FRESH_S - 1, bump), Ci::Billing);
        assert_eq!(refreshes.get(), 1);
        assert_eq!(cached(&h, &repo, t + FRESH_S, bump), Ci::Billing, "stale: last reading while it refreshes");
        assert_eq!(refreshes.get(), 2);
        // Billing again the same day: no second alert; the next day: one more.
        assert_eq!(refresh(&h, &repo, t + FRESH_S, &bill, alert), Ci::Billing);
        assert_eq!(alerts.get(), 1);
        assert_eq!(refresh(&h, &repo, t + DAY_S, &bill, alert), Ci::Billing);
        assert_eq!(alerts.get(), 2);
        // An alert that could not be sent (HQ not set up) is tried again on the next reading.
        let other = h.join("other");
        let _ = refresh(&h, &other, t, &bill, |_: &str, _: &str| anyhow::bail!("HQ not configured"));
        let _ = refresh(&h, &other, t + FRESH_S, &bill, alert);
        assert_eq!(alerts.get(), 3);
        // `auto ci local` stored its reading while an older background refresh was still reading the
        // billing-held runs: the older one keeps the newer reading and sends no alert.
        let third = h.join("third");
        std::fs::write(cache_file(&h, &third), json!({ "schema": 1, "at": t + 5, "ci": "local" }).to_string()).unwrap();
        assert_eq!(refresh(&h, &third, t, &bill, alert), Ci::Local);
        assert_eq!(alerts.get(), 3, "no alert from the stale reading");
        assert_eq!(cached(&h, &third, t + 6, || panic!("fresh: no refresh")), Ci::Local);
        let _ = std::fs::remove_dir_all(&h);
    }
}
