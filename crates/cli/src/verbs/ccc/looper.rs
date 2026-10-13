//! Bounded-loop state for `/ship-loop` and `/autopilot`: `8sync ccc loop <init|tick|status|done|ls>`.
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
fn ship_dir(cwd: &Path) -> PathBuf {
    for d in cwd.ancestors() {
        if d.join("su-code").is_dir() {
            return d.join("su-code/ship");
        }
    }
    cwd.join(".claude/ship")
}

fn path(cwd: &Path, slug: &str) -> Result<PathBuf> {
    if slug.is_empty() || slug.starts_with('.') || !slug.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.')) {
        bail!("bad slug {slug:?}: use letters, digits, - _ .");
    }
    Ok(ship_dir(cwd).join(slug).join("loop.json"))
}

fn load(p: &Path) -> Result<Value> {
    let s = std::fs::read_to_string(p).with_context(|| format!("no loop at {} (run `8sync ccc loop init <slug>`)", p.display()))?;
    serde_json::from_str(&s).with_context(|| format!("corrupt {}", p.display()))
}

fn save(p: &Path, v: &Value) -> Result<()> {
    std::fs::create_dir_all(p.parent().context("no parent")?)?;
    std::fs::write(p, serde_json::to_string_pretty(v)? + "\n")?;
    Ok(())
}

fn n(v: &Value, k: &str) -> u64 {
    v[k].as_u64().unwrap_or(0)
}

fn elapsed_min(v: &Value, now: u64) -> u64 {
    now.saturating_sub(n(v, "started")) / 60
}

/// Pure: apply one tick to `v`; returns the line to print.
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
    let reason = if iter > max_iter {
        Some("max-iter")
    } else if now.saturating_sub(n(v, "started")) > max_min * 60 {
        Some("max-min")
    } else if prev.as_deref() == Some(digest) {
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
    let slug = args.first().filter(|a| !a.starts_with('-')).context("usage: 8sync ccc loop <init|tick|status|done|ls> <slug> …")?;
    let p = path(cwd, slug)?;
    let num = |name: &str, default: u64| -> Result<u64> { flag(args, name).map_or(Ok(default), |s| s.parse().with_context(|| format!("{name} needs a number"))) };
    match sub {
        "init" => {
            if !args.iter().any(|a| a == "--force") && p.exists() && load(&p).map_or(true, |v| v["stopped"].is_null()) {
                bail!("loop {slug} is still live ({}); finish it with `loop done` or pass --force", p.display());
            }
            let v = json!({"slug": slug, "started": now, "max_iter": num("--max-iter", 12)?, "max_min": num("--max-min", 90)?, "iter": 0, "digests": [], "stopped": null});
            save(&p, &v)?;
            println!("{}", p.display());
        }
        "tick" => {
            let mut v = load(&p)?;
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
        "done" => {
            let mut v = load(&p)?;
            v["stopped"] = json!("done");
            if let Some(r) = flag(args, "--reason") {
                v["reason"] = json!(r);
            }
            save(&p, &v)?;
            println!("{}", status_line(&v, now));
        }
        _ => bail!("usage: 8sync ccc loop <init|tick|status|done|ls> <slug> …"),
    }
    Ok(())
}

fn ls(cwd: &Path, now: u64, json_out: bool) -> Result<()> {
    let mut rows: Vec<Value> = Vec::new();
    if let Ok(rd) = std::fs::read_dir(ship_dir(cwd)) {
        for e in rd.flatten() {
            if let Ok(v) = load(&e.path().join("loop.json")) {
                rows.push(v);
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
    }

    #[test]
    fn tick_caps_iter_and_time() {
        let mut v = fresh(2, 90);
        assert!(tick_state(&mut v, 1, "a", 1000).starts_with("continue"));
        assert!(tick_state(&mut v, 1, "b", 1000).starts_with("continue"));
        assert_eq!(tick_state(&mut v, 1, "c", 1000), "stop:max-iter");
        assert_eq!(v["stopped"], "max-iter");
        let mut v = fresh(12, 1);
        assert_eq!(tick_state(&mut v, 1, "a", 1000 + 61), "stop:max-min");
        let mut v = fresh(12, 1);
        assert!(tick_state(&mut v, 1, "a", 1000 + 60).starts_with("continue")); // exactly at the cap is allowed
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
        assert_eq!(a["reason"], "ok");
        run_at(&s(&["status", "b", "--json"]), &d, 120).unwrap();
        run_at(&s(&["ls"]), &d, 120).unwrap();
        assert!(run_at(&s(&["tick", "nope", "--changed", "1"]), &d, 1).is_err());
    }
}
