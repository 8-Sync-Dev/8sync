//! Bounded-loop state for `/ship-loop` and `/autopilot`: `8sync ccc loop <init|tick|ev|status|done|ls>`.
//! State lives in `<repo>/su-code/ship/<slug>/loop.json` (no su-code/ ancestor →
//! `<cwd>/.claude/ship/<slug>/loop.json`). The skill reads stdout; the exit code is 0 for every
//! decision, so a `stop:*` line is the only stop signal.
use anyhow::{bail, Context, Result};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

fn now_s() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs())
}

/// Nearest ancestor holding `su-code/` → `su-code/ship`; otherwise `<cwd>/.claude/ship`.
pub(super) fn ship_dir(cwd: &Path) -> PathBuf {
    for d in cwd.ancestors() {
        if d.join("su-code").is_dir() {
            return d.join("su-code/ship");
        }
    }
    cwd.join(".claude/ship")
}

/// Letters, digits, `- _ .`, not starting with a dot: one path segment, never `..`.
pub(super) fn valid_slug(slug: &str) -> bool {
    !slug.is_empty() && !slug.starts_with('.') && slug.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

fn path(cwd: &Path, slug: &str) -> Result<PathBuf> {
    if !valid_slug(slug) {
        bail!("bad slug {slug:?}: use letters, digits, - _ .");
    }
    Ok(ship_dir(cwd).join(slug).join("loop.json"))
}

/// Every slug under `ship` that has a loop.json (live, stopped or corrupt), sorted: `cancel --all`
/// decides per file and reports the corrupt ones as FAILED.
pub(super) fn loop_slugs(ship: &Path) -> Vec<String> {
    let mut out: Vec<String> = std::fs::read_dir(ship)
        .map(|rd| rd.flatten().filter(|e| e.path().join("loop.json").exists()).map(|e| e.file_name().to_string_lossy().into_owned()).collect())
        .unwrap_or_default();
    out.sort();
    out
}

/// Stop a live loop with reason `cancelled` (`8sync ccc cancel`), then read the file back: it is
/// only "cancelled" when the saved file says so (a concurrent `tick` could write in between).
/// `Ok(false)`: no loop there or it had already stopped. `Err`: not verified stopped.
pub(super) fn cancel(p: &Path, now: u64) -> Result<bool> {
    if !p.exists() {
        return Ok(false);
    }
    let mut v = load(p)?;
    if !v["stopped"].is_null() {
        return Ok(false);
    }
    v["stopped"] = json!("cancelled");
    v["note"] = json!(format!("8sync ccc cancel at {now}"));
    save(p, &v)?;
    if load(p)?["stopped"].as_str() != Some("cancelled") {
        bail!("{} was rewritten while cancelling; run cancel again", p.display());
    }
    Ok(true)
}

fn load(p: &Path) -> Result<Value> {
    let s = std::fs::read_to_string(p).with_context(|| format!("no loop at {} (run `8sync ccc loop init <slug>`)", p.display()))?;
    serde_json::from_str(&s).with_context(|| format!("corrupt {}", p.display()))
}

fn save(p: &Path, v: &Value) -> Result<()> {
    std::fs::create_dir_all(p.parent().context("no parent")?)?;
    let tmp = p.with_file_name("loop.json.tmp");
    std::fs::write(&tmp, serde_json::to_string_pretty(v)? + "\n")?;
    std::fs::rename(&tmp, p)?;
    Ok(())
}

fn n(v: &Value, k: &str) -> u64 {
    v[k].as_u64().unwrap_or(0)
}

fn elapsed_min(v: &Value, now: u64) -> u64 {
    now.saturating_sub(n(v, "started")) / 60
}

/// Pure: apply one tick to `v`; returns the line to print. `digest` must be a content hash of the
/// work state (e.g. `git diff | sha256sum`), not a file list; an empty digest never counts as stuck.
pub(super) fn tick_state(v: &mut Value, changed: u64, digest: &str, now: u64) -> String {
    if let Some(r) = v["stopped"].as_str() {
        return format!("stop:{r}");
    }
    let iter = n(v, "iter") + 1;
    v["iter"] = json!(iter);
    let prev = v["digests"].as_array().and_then(|a| a.last()).and_then(Value::as_str).map(str::to_owned);
    let mut ds: Vec<Value> = v["digests"].as_array().cloned().unwrap_or_default();
    ds.push(json!(digest));
    if ds.len() > 3 {
        ds.drain(..ds.len() - 3);
    }
    v["digests"] = json!(ds);
    let (max_iter, max_min) = (n(v, "max_iter"), n(v, "max_min"));
    let reason = if iter >= max_iter {
        Some("max-iter")
    } else if now.saturating_sub(n(v, "started")) >= max_min.saturating_mul(60) {
        Some("max-min")
    } else if !digest.is_empty() && prev.as_deref() == Some(digest) {
        Some("stuck")
    } else if changed == 0 {
        Some("no-change")
    } else {
        None
    };
    match reason {
        Some(r) => {
            v["stopped"] = json!(r);
            format!("stop:{r}")
        }
        None => format!("continue {iter}/{max_iter} · {}/{max_min}min", elapsed_min(v, now)),
    }
}

fn status_line(v: &Value, now: u64) -> String {
    format!(
        "{} iter={}/{} min={}/{} state={}",
        v["slug"].as_str().unwrap_or("?"),
        n(v, "iter"),
        n(v, "max_iter"),
        elapsed_min(v, now),
        n(v, "max_min"),
        v["stopped"].as_str().map_or("running".to_owned(), |r| format!("stopped:{r}"))
    )
}

fn flag<'a>(rest: &'a [String], name: &str) -> Option<&'a str> {
    rest.iter().position(|a| a == name).and_then(|i| rest.get(i + 1)).map(String::as_str)
}

pub(super) fn run(rest: &[String], cwd: &Path) -> Result<()> {
    run_at(rest, cwd, now_s())
}

fn run_at(rest: &[String], cwd: &Path, now: u64) -> Result<()> {
    let (sub, args) = rest.split_first().map(|(s, a)| (s.as_str(), a)).unwrap_or(("", &[][..]));
    if sub == "ls" {
        return ls(cwd, now, args.iter().any(|a| a == "--json"));
    }
    let slug = args.first().filter(|a| !a.starts_with('-')).context("usage: 8sync ccc loop <init|tick|ev|status|done|ls> <slug> …")?;
    let p = path(cwd, slug)?;
    let num = |name: &str, default: u64| -> Result<u64> { flag(args, name).map_or(Ok(default), |s| s.parse().with_context(|| format!("{name} needs a number"))) };
    match sub {
        "init" => {
            if !args.iter().any(|a| a == "--force") && p.exists() && load(&p).map_or(true, |v| v["stopped"].is_null()) {
                bail!("loop {slug} is still live ({}); finish it with `loop done` or pass --force", p.display());
            }
            let (max_iter, max_min) = (num("--max-iter", 12)?, num("--max-min", 90)?);
            if max_iter == 0 || max_min == 0 {
                bail!("--max-iter and --max-min must be at least 1");
            }
            let v = json!({"slug": slug, "started": now, "max_iter": max_iter, "max_min": max_min, "iter": 0, "digests": [], "stopped": null});
            save(&p, &v)?;
            println!("{}", p.display());
        }
        "tick" => {
            let mut v = match load(&p) {
                Ok(v) => v,
                Err(e) if p.exists() => {
                    eprintln!("{e:#}");
                    println!("stop:corrupt");
                    return Ok(());
                }
                Err(e) => return Err(e),
            };
            let line = tick_state(&mut v, num("--changed", 0)?, flag(args, "--digest").unwrap_or(""), now);
            save(&p, &v)?;
            println!("{line}");
        }
        "status" => {
            let v = load(&p)?;
            if args.iter().any(|a| a == "--json") {
                let mut o = v.clone();
                o["elapsed_min"] = json!(elapsed_min(&v, now));
                println!("{o}");
            } else {
                println!("{}", status_line(&v, now));
            }
        }
        // `ev <slug> <label> -- <cmd>`: run one acceptance check and append its evidence line
        // to LOOP.md. Replaces ad-hoc `r(){ bash -c "$2" …}` helpers, which the guard cannot read.
        "ev" => {
            let v = load(&p)?;
            let label = args.get(1).filter(|a| *a != "--").context("usage: 8sync ccc loop ev <slug> <label> -- <command>")?;
            let cmd = args.iter().position(|a| a == "--").map(|i| &args[i + 1..]).filter(|c| !c.is_empty()).context("usage: 8sync ccc loop ev <slug> <label> -- <command>")?;
            let mut c = if cmd.len() == 1 {
                let mut c = std::process::Command::new(shell()?);
                c.args(["-c", &cmd[0]]);
                c
            } else {
                let mut c = std::process::Command::new(&cmd[0]);
                c.args(&cmd[1..]);
                c
            };
            let out = c.current_dir(cwd).output().with_context(|| format!("cannot run {}", cmd[0]))?;
            let text = super::super::secret_mask::mask(&format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr)));
            let code = out.status.code().map_or("signal".to_string(), |c| c.to_string());
            let line = format!("iter {} | {label} | exit {code} | {}", v["iter"], evidence_tail(&text));
            let log = p.with_file_name("LOOP.md");
            let mut f = std::fs::OpenOptions::new().create(true).append(true).open(&log).with_context(|| format!("cannot write {}", log.display()))?;
            std::io::Write::write_all(&mut f, format!("{line}\n").as_bytes())?;
            let lines: Vec<&str> = text.lines().collect();
            for l in &lines[lines.len().saturating_sub(15)..] {
                println!("{l}");
            }
            println!("{line}");
        }
        "done" => {
            let mut v = load(&p)?;
            if v["stopped"].as_str().is_none_or(str::is_empty) {
                v["stopped"] = json!("done");
            }
            if let Some(r) = flag(args, "--reason") {
                v["note"] = json!(r);
            }
            save(&p, &v)?;
            println!("{}", status_line(&v, now));
        }
        _ => bail!("usage: 8sync ccc loop <init|tick|ev|status|done|ls> <slug> …"),
    }
    Ok(())
}

/// The shell for a one-string `ev` command. On Windows, Git Bash: `System32\bash.exe` (and the
/// WindowsApps alias) is the WSL launcher, which runs nothing without a distro (seen on CI).
fn shell() -> Result<PathBuf> {
    if !cfg!(windows) {
        return Ok(PathBuf::from("sh"));
    }
    which::which_all("bash")
        .into_iter()
        .flatten()
        .find(|p| {
            let s = p.to_string_lossy().to_ascii_lowercase();
            !s.contains("\\system32\\") && !s.contains("\\windowsapps\\")
        })
        .context("no Git Bash on PATH (System32 bash is WSL); pass the command as separate words after --")
}

/// The last non-empty output line, one line and at most 160 chars (`|` would break the table).
fn evidence_tail(text: &str) -> String {
    let last = text.lines().rev().map(str::trim).find(|l| !l.is_empty()).unwrap_or("(no output)");
    last.replace('|', "/").chars().take(160).collect()
}

fn ls(cwd: &Path, now: u64, json_out: bool) -> Result<()> {
    let mut rows: Vec<Value> = Vec::new();
    if let Ok(rd) = std::fs::read_dir(ship_dir(cwd)) {
        for e in rd.flatten() {
            let lp = e.path().join("loop.json");
            if !lp.exists() {
                continue;
            }
            match load(&lp) {
                Ok(v) => rows.push(v),
                Err(_) => rows.push(json!({"slug": e.file_name().to_string_lossy(), "stopped": "corrupt"})),
            }
        }
    }
    rows.sort_by_key(|v| v["slug"].as_str().unwrap_or("").to_owned());
    if json_out {
        println!("{}", Value::Array(rows));
    } else if rows.is_empty() {
        println!("no loops");
    } else {
        for v in &rows {
            println!("{}", status_line(v, now));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("8sync-loop-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(d.join("su-code")).unwrap();
        d
    }
    fn s(a: &[&str]) -> Vec<String> {
        a.iter().map(|x| x.to_string()).collect()
    }
    fn fresh(max_iter: u64, max_min: u64) -> Value {
        json!({"slug":"x","started":1000,"max_iter":max_iter,"max_min":max_min,"iter":0,"digests":[],"stopped":null})
    }

    #[test]
    fn ev_runs_the_check_and_appends_one_evidence_line() {
        let d = tmp("ev");
        run_at(&s(&["init", "hq"]), &d, 1000).unwrap();
        run_at(&s(&["ev", "hq", "C1", "--", "echo first; echo 'Tests  3 passed | ok'"]), &d, 1001).unwrap();
        assert!(run_at(&s(&["ev", "hq", "C2", "--", "exit 3"]), &d, 1002).is_ok(), "a failing check is evidence, not an error");
        assert!(run_at(&s(&["ev", "hq", "C3"]), &d, 1003).is_err(), "no command");
        let log = std::fs::read_to_string(d.join("su-code/ship/hq/LOOP.md")).unwrap();
        let lines: Vec<&str> = log.lines().collect();
        assert_eq!(lines, ["iter 0 | C1 | exit 0 | Tests  3 passed / ok", "iter 0 | C2 | exit 3 | (no output)"]);
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn init_refuses_overwrite_live_loop() {
        let d = tmp("init");
        run_at(&s(&["init", "a"]), &d, 100).unwrap();
        assert!(run_at(&s(&["init", "a"]), &d, 101).is_err());
        run_at(&s(&["init", "a", "--force", "--max-iter", "3"]), &d, 102).unwrap();
        let v = load(&d.join("su-code/ship/a/loop.json")).unwrap();
        assert_eq!((n(&v, "max_iter"), n(&v, "max_min"), n(&v, "started")), (3, 90, 102));
        run_at(&s(&["done", "a"]), &d, 103).unwrap();
        run_at(&s(&["init", "a"]), &d, 104).unwrap(); // stopped loop may be re-initialised
        assert!(path(&d, "../x").is_err());
        assert!(run_at(&s(&["init", "z", "--max-iter", "0"]), &d, 1).is_err());
        assert!(run_at(&s(&["init", "z", "--max-min", "0"]), &d, 1).is_err());
    }

    #[test]
    fn bad_slugs_rejected() {
        let d = tmp("slug");
        for bad in ["a/b", ".x", ""] {
            assert!(path(&d, bad).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn empty_digest_is_not_stuck() {
        let mut v = fresh(12, 90);
        assert!(tick_state(&mut v, 1, "", 1000).starts_with("continue"));
        assert!(tick_state(&mut v, 1, "", 1000).starts_with("continue"));
    }

    #[test]
    fn done_keeps_existing_reason_and_corrupt_is_reported() {
        let d = tmp("corrupt");
        run_at(&s(&["init", "c"]), &d, 0).unwrap();
        let mut v = load(&d.join("su-code/ship/c/loop.json")).unwrap();
        v["stopped"] = json!("stuck");
        save(&d.join("su-code/ship/c/loop.json"), &v).unwrap();
        run_at(&s(&["done", "c", "--reason", "why"]), &d, 1).unwrap();
        let v = load(&d.join("su-code/ship/c/loop.json")).unwrap();
        assert_eq!((v["stopped"].as_str(), v["note"].as_str()), (Some("stuck"), Some("why")));
        std::fs::write(d.join("su-code/ship/c/loop.json"), "{nope").unwrap();
        run_at(&s(&["tick", "c", "--changed", "1"]), &d, 2).unwrap(); // prints stop:corrupt, exit 0
        assert!(run_at(&s(&["ls"]), &d, 2).is_ok());
    }

    #[test]
    fn tick_caps_iter_and_time() {
        let mut v = fresh(2, 90);
        assert!(tick_state(&mut v, 1, "a", 1000).starts_with("continue"));
        assert_eq!(tick_state(&mut v, 1, "b", 1000), "stop:max-iter"); // inclusive: 2nd tick stops
        assert_eq!(v["stopped"], "max-iter");
        let mut v = fresh(12, 1);
        assert_eq!(tick_state(&mut v, 1, "a", 1000 + 60), "stop:max-min");
        let mut v = fresh(12, 1);
        assert!(tick_state(&mut v, 1, "a", 1000 + 59).starts_with("continue"));
    }

    #[test]
    fn tick_stuck_and_no_change_and_text() {
        let mut v = fresh(12, 90);
        assert_eq!(tick_state(&mut v, 2, "same", 1000 + 300), "continue 1/12 · 5/90min");
        assert_eq!(tick_state(&mut v, 2, "same", 1000 + 360), "stop:stuck");
        let mut v = fresh(12, 90);
        assert_eq!(tick_state(&mut v, 0, "x", 1000), "stop:no-change");
        assert_eq!(tick_state(&mut v, 5, "y", 1000), "stop:no-change"); // already stopped stays stopped
        let mut v = fresh(12, 90);
        for i in 0..5 {
            tick_state(&mut v, 1, &format!("d{i}"), 1000);
        }
        assert_eq!(v["digests"].as_array().unwrap().len(), 3);
    }

    #[test]
    fn status_json_and_ls() {
        let d = tmp("ls");
        run_at(&s(&["init", "b", "--max-iter", "4"]), &d, 0).unwrap();
        run_at(&s(&["init", "a"]), &d, 0).unwrap();
        run_at(&s(&["tick", "b", "--changed", "3", "--digest", "one"]), &d, 120).unwrap();
        run_at(&s(&["done", "a", "--reason", "ok"]), &d, 120).unwrap();
        let v = load(&d.join("su-code/ship/b/loop.json")).unwrap();
        assert_eq!(status_line(&v, 120), "b iter=1/4 min=2/90 state=running");
        let a = load(&d.join("su-code/ship/a/loop.json")).unwrap();
        assert_eq!(status_line(&a, 120), "a iter=0/12 min=2/90 state=stopped:done");
        assert_eq!(a["note"], "ok");
        run_at(&s(&["status", "b", "--json"]), &d, 120).unwrap();
        run_at(&s(&["ls"]), &d, 120).unwrap();
        assert!(run_at(&s(&["tick", "nope", "--changed", "1"]), &d, 1).is_err());
    }
}
