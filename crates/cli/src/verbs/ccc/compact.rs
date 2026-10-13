//! `8sync ccc compact`: the auto-compact trigger of Claude Code sessions.
//! Claude Code reads `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` (1-100, percentage of the auto-compact window);
//! it can only LOWER the threshold, values above the default are ignored, and it needs a new session
//! (https://code.claude.com/docs/en/env-vars). We store it in `~/.claude/settings.json` `env`.
use anyhow::{bail, Context, Result};
use serde_json::{json, Value};
use std::path::Path;

pub(super) const VAR: &str = "CLAUDE_AUTOCOMPACT_PCT_OVERRIDE";
/// What `ccc kit` sets when the key is absent.
pub(super) const KIT_DEFAULT: u32 = 60;
const RANGE: std::ops::RangeInclusive<u32> = 10..=95;

fn current(v: &Value) -> Option<String> {
    match v.get("env")?.get(VAR)? {
        Value::String(s) => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

/// Set `env.<VAR>`; true when the file content changes.
fn set(v: &mut Value, n: u32) -> Result<bool> {
    let obj = v.as_object_mut().context("settings.json is not a JSON object")?;
    let Some(env) = obj.entry("env").or_insert_with(|| json!({})).as_object_mut() else {
        bail!("settings.json `env` is not an object");
    };
    let new = json!(n.to_string());
    if env.get(VAR) == Some(&new) {
        return Ok(false);
    }
    env.insert(VAR.into(), new);
    Ok(true)
}

/// Remove the key, and `env` when that leaves it empty.
fn reset(v: &mut Value) -> bool {
    let Some(obj) = v.as_object_mut() else { return false };
    let Some(env) = obj.get_mut("env").and_then(Value::as_object_mut) else { return false };
    let had = env.remove(VAR).is_some();
    if env.is_empty() {
        obj.remove("env");
    }
    had
}

/// `ccc kit`: default 60, only when the key is absent (an owner value is never touched).
pub(super) fn kit_default(v: &mut Value) -> Result<()> {
    let obj = v.as_object_mut().context("settings.json is not a JSON object")?;
    if let Some(env) = obj.entry("env").or_insert_with(|| json!({})).as_object_mut() {
        env.entry(VAR).or_insert_with(|| json!(KIT_DEFAULT.to_string()));
    }
    Ok(())
}

/// `ccc kit --remove`: drop the key only when it still equals the kit default.
pub(super) fn strip_kit_default(v: &mut Value) -> bool {
    if current(v).as_deref() == Some(&KIT_DEFAULT.to_string()) {
        return reset(v);
    }
    false
}

fn parse_at(s: &str) -> Result<u32> {
    let n: u32 = s.parse().map_err(|_| anyhow::anyhow!("--at cần số nguyên {}..={}, nhận {s:?}", RANGE.start(), RANGE.end()))?;
    if !RANGE.contains(&n) {
        bail!("--at {n} ngoài khoảng {}..={} (thấp hơn = nén sớm hơn)", RANGE.start(), RANGE.end());
    }
    Ok(n)
}

fn load(path: &Path) -> Result<(String, Value)> {
    let raw = std::fs::read_to_string(path).unwrap_or_default();
    let v = if raw.trim().is_empty() {
        json!({})
    } else {
        serde_json::from_str(&raw).with_context(|| format!("{} is not valid JSON", path.display()))?
    };
    Ok((raw, v))
}

fn save(path: &Path, raw: &str, v: &Value) -> Result<()> {
    if let Some(p) = path.parent() {
        std::fs::create_dir_all(p)?;
    }
    super::write_atomic_bak(path, raw, &(serde_json::to_string_pretty(v)? + "\n"))
}

/// Returns the lines to print (so tests can check them).
pub(super) fn run_at(rest: &[String], path: &Path) -> Result<String> {
    let has = |f: &str| rest.iter().any(|a| a == f);
    let (raw, mut v) = load(path)?;
    if let Some(i) = rest.iter().position(|a| a == "--at") {
        let n = parse_at(rest.get(i + 1).map(String::as_str).unwrap_or(""))?;
        if !set(&mut v, n)? {
            return Ok(format!("auto-compact đã ở mức {n}% — không đổi"));
        }
        save(path, &raw, &v)?;
        return Ok(format!("auto-compact = {n}% → {} (cần mở session mới để áp dụng)", path.display()));
    }
    if has("--reset") {
        if !reset(&mut v) {
            return Ok("không có mức tuỳ chỉnh — đang dùng mặc định của Claude Code".into());
        }
        save(path, &raw, &v)?;
        return Ok("đã xoá mức auto-compact — về mặc định của Claude Code (cần mở session mới)".into());
    }
    if let Some(bad) = rest.iter().find(|a| !matches!(a.as_str(), "--json" | "status")) {
        bail!("usage: 8sync ccc compact [--json | --at <10..95> | --reset]   (không hiểu {bad:?})");
    }
    let cur = current(&v);
    if has("--json") {
        return Ok(serde_json::to_string_pretty(&json!({ "schema": 1, "var": VAR, "percent": cur, "default": cur.is_none() }))?);
    }
    Ok(match cur {
        Some(p) => format!("auto-compact tại {p}% ({VAR} trong {}). Đổi: `8sync ccc compact --at <N>`", path.display()),
        None => "auto-compact: mặc định của Claude Code. Đặt mức: `8sync ccc compact --at 60`".into(),
    })
}

pub(super) fn run(rest: &[String], claude_dir: &Path) -> Result<()> {
    println!("{}", run_at(rest, &claude_dir.join("settings.json"))?);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn a(s: &[&str]) -> Vec<String> {
        s.iter().map(|x| x.to_string()).collect()
    }
    fn tmp() -> (std::path::PathBuf, std::path::PathBuf) {
        static N: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let d = std::env::temp_dir().join(format!("compact-{}-{}", std::process::id(), N.fetch_add(1, std::sync::atomic::Ordering::SeqCst)));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        let p = d.join("settings.json");
        (d, p)
    }
    fn read(p: &Path) -> Value {
        serde_json::from_str(&std::fs::read_to_string(p).unwrap()).unwrap()
    }

    #[test]
    fn set_preserves_keys_and_noop_does_not_rewrite() {
        let (_d, p) = tmp();
        std::fs::write(&p, r#"{"effortLevel":"medium","env":{"X":"1"}}"#).unwrap();
        run_at(&a(&["--at", "55"]), &p).unwrap();
        let v = read(&p);
        assert_eq!(v["env"][VAR], "55");
        assert_eq!(v["env"]["X"], "1");
        assert_eq!(v["effortLevel"], "medium");
        let bak = p.with_file_name("settings.json.bak-8sync");
        std::fs::remove_file(&bak).unwrap();
        let msg = run_at(&a(&["--at", "55"]), &p).unwrap();
        assert!(msg.contains("không đổi"));
        assert!(!bak.exists(), "no-op must not write a backup");
    }

    #[test]
    fn set_creates_file_and_validates_range() {
        let (_d, p) = tmp();
        run_at(&a(&["--at", "60"]), &p).unwrap();
        assert_eq!(read(&p)["env"][VAR], "60");
        for bad in ["9", "96", "abc", "-1", ""] {
            assert!(run_at(&a(&["--at", bad]), &p).is_err(), "{bad}");
        }
        assert!(run_at(&a(&["--at"]), &p).is_err());
        assert_eq!(read(&p)["env"][VAR], "60");
    }

    #[test]
    fn reset_removes_key_and_empty_env_only() {
        let (_d, p) = tmp();
        std::fs::write(&p, format!(r#"{{"a":1,"env":{{"{VAR}":"50"}}}}"#)).unwrap();
        run_at(&a(&["--reset"]), &p).unwrap();
        assert_eq!(read(&p), json!({"a":1}));
        std::fs::write(&p, format!(r#"{{"env":{{"{VAR}":"50","X":"1"}}}}"#)).unwrap();
        run_at(&a(&["--reset"]), &p).unwrap();
        assert_eq!(read(&p), json!({"env":{"X":"1"}}));
        assert!(run_at(&a(&["--reset"]), &p).unwrap().contains("mặc định"));
    }

    #[test]
    fn status_text_and_json() {
        let (_d, p) = tmp();
        assert!(run_at(&[], &p).unwrap().contains("mặc định"));
        assert!(!p.exists(), "status never writes");
        let j: Value = serde_json::from_str(&run_at(&a(&["--json"]), &p).unwrap()).unwrap();
        assert_eq!(j["percent"], Value::Null);
        run_at(&a(&["--at", "40"]), &p).unwrap();
        assert!(run_at(&[], &p).unwrap().contains("40%"));
        let j: Value = serde_json::from_str(&run_at(&a(&["--json"]), &p).unwrap()).unwrap();
        assert_eq!(j["percent"], "40");
        assert!(run_at(&a(&["--bogus"]), &p).is_err());
    }

    #[test]
    fn kit_default_only_when_absent_and_remove_only_if_default() {
        let mut v = json!({});
        kit_default(&mut v).unwrap();
        assert_eq!(v["env"][VAR], "60");
        let mut owner = json!({"env":{VAR:"45"}});
        kit_default(&mut owner).unwrap();
        assert_eq!(owner["env"][VAR], "45");
        assert!(!strip_kit_default(&mut owner));
        assert_eq!(owner["env"][VAR], "45");
        assert!(strip_kit_default(&mut v));
        assert_eq!(v, json!({}));
    }
}
