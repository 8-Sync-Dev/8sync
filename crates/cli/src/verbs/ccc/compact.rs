//! `8sync ccc compact`: the auto-compact trigger of Claude Code sessions.
//! Claude Code reads `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` (1-100, percentage of the auto-compact window);
//! it can only LOWER the threshold, values above the default are ignored, and it needs a new session
//! (https://code.claude.com/docs/en/env-vars). We store it in `~/.claude/settings.json` `env`.
//! `CLAUDE_CODE_AUTO_COMPACT_WINDOW` (plain integer 100000..=1000000, capped at the model window, beats
//! `/autocompact`, `--autocompact` and the `autoCompactWindow` setting) is an absolute cap on that window:
//! trigger ≈ pct × min(window, model window). 8sync does not know the model window.
use anyhow::{bail, Context, Result};
use serde_json::{json, Value};
use std::path::Path;

pub(super) const VAR: &str = "CLAUDE_AUTOCOMPACT_PCT_OVERRIDE";
/// What `ccc kit` sets when the key is absent.
pub(super) const KIT_DEFAULT: u32 = 60;
const RANGE: std::ops::RangeInclusive<u32> = 10..=95;
pub(super) const WIN_VAR: &str = "CLAUDE_CODE_AUTO_COMPACT_WINDOW";
/// What `ccc kit` sets when the window is absent everywhere (Opus 1M: 60 % x 400K = 240K).
pub(super) const KIT_WINDOW: u32 = 400_000;
const WIN_RANGE: std::ops::RangeInclusive<u32> = 100_000..=1_000_000;

fn current(v: &Value) -> Option<String> {
    cur_var(v, VAR)
}

fn cur_var(v: &Value, var: &str) -> Option<String> {
    match v.get("env")?.get(var)? {
        Value::String(s) => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

/// Set `env.<VAR>`; true when the file content changes.
fn set(v: &mut Value, n: u32) -> Result<bool> {
    set_var(v, VAR, n)
}

fn set_var(v: &mut Value, var: &str, n: u32) -> Result<bool> {
    let obj = v.as_object_mut().context("settings.json is not a JSON object")?;
    let Some(env) = obj.entry("env").or_insert_with(|| json!({})).as_object_mut() else {
        bail!("settings.json `env` is not an object");
    };
    let new = json!(n.to_string());
    if env.get(var) == Some(&new) {
        return Ok(false);
    }
    env.insert(var.into(), new);
    Ok(true)
}

/// Remove the key, and `env` when that leaves it empty.
fn reset(v: &mut Value) -> bool {
    reset_var(v, VAR)
}

fn reset_var(v: &mut Value, var: &str) -> bool {
    let Some(obj) = v.as_object_mut() else { return false };
    let Some(env) = obj.get_mut("env").and_then(Value::as_object_mut) else { return false };
    let had = env.remove(var).is_some();
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
    if !owner_window(v) {
        if let Some(env) = v["env"].as_object_mut() {
            env.insert(WIN_VAR.into(), json!(KIT_WINDOW.to_string()));
        }
    }
    Ok(())
}

/// True when the owner already chose a window: the env var, `autoCompactWindow`, or any
/// `autoCompactWindow` under `modelSettings` (written by `/autocompact`, per model).
fn owner_window(v: &Value) -> bool {
    fn has_key(v: &Value) -> bool {
        match v {
            Value::Object(m) => m.contains_key("autoCompactWindow") || m.values().any(has_key),
            Value::Array(a) => a.iter().any(has_key),
            _ => false,
        }
    }
    cur_var(v, WIN_VAR).is_some() || v.get("autoCompactWindow").is_some() || v.get("modelSettings").is_some_and(has_key)
}

/// `ccc kit --remove`: drop the key only when it still equals the kit default.
pub(super) fn strip_kit_default(v: &mut Value) -> bool {
    let mut changed = false;
    if current(v).as_deref() == Some(&KIT_DEFAULT.to_string()) {
        changed |= reset(v);
    }
    if cur_var(v, WIN_VAR).as_deref() == Some(&KIT_WINDOW.to_string()) {
        changed |= reset_var(v, WIN_VAR);
    }
    changed
}

fn parse_window(s: &str) -> Result<u32> {
    let (lo, hi) = (WIN_RANGE.start(), WIN_RANGE.end());
    // plain digits only: the env var reads "500k" as 500 and clamps it.
    let n: u32 = s.parse().ok().filter(|_| s.bytes().all(|b| b.is_ascii_digit())).ok_or_else(|| anyhow::anyhow!("--window cần số nguyên thường {lo}..={hi} (không dùng 500k), nhận {s:?}"))?;
    if !WIN_RANGE.contains(&n) {
        bail!("--window {n} ngoài khoảng {lo}..={hi}");
    }
    Ok(n)
}

/// Effective trigger ≈ pct × min(window, model window); the model window is not known to 8sync.
fn effective(pct: Option<&str>, win: Option<&str>) -> Option<u64> {
    let (p, w) = (pct?.parse::<u64>().ok()?, win?.parse::<u64>().ok()?);
    Some(w * p / 100)
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
    if let Some(i) = rest.iter().position(|a| a == "--window") {
        let n = parse_window(rest.get(i + 1).map(String::as_str).unwrap_or(""))?;
        if !set_var(&mut v, WIN_VAR, n)? {
            return Ok(format!("auto-compact window đã là {n} — không đổi"));
        }
        save(path, &raw, &v)?;
        return Ok(format!("auto-compact window = {n} → {} (cần session mới; Claude Code giới hạn theo window của model)", path.display()));
    }
    if has("--window-reset") {
        if !reset_var(&mut v, WIN_VAR) {
            return Ok("không có window tuỳ chỉnh trong env".into());
        }
        save(path, &raw, &v)?;
        return Ok("đã xoá window — về mặc định của Claude Code (cần session mới)".into());
    }
    if has("--reset") {
        if !reset(&mut v) {
            return Ok("không có mức tuỳ chỉnh — đang dùng mặc định của Claude Code".into());
        }
        save(path, &raw, &v)?;
        return Ok("đã xoá mức auto-compact — về mặc định của Claude Code (cần mở session mới)".into());
    }
    if let Some(bad) = rest.iter().find(|a| !matches!(a.as_str(), "--json" | "status")) {
        bail!("usage: 8sync ccc compact [--json | --at <10..95> | --reset | --window <100000..1000000> | --window-reset]   (không hiểu {bad:?})");
    }
    let (cur, win) = (current(&v), cur_var(&v, WIN_VAR));
    let eff = effective(cur.as_deref(), win.as_deref());
    if has("--json") {
        return Ok(serde_json::to_string_pretty(&json!({
            "schema": 2, "var": VAR, "percent": cur, "default": cur.is_none(),
            "window_var": WIN_VAR, "window": win, "window_default": win.is_none(),
            "effective_trigger_tokens": eff,
            "effective_note": "approx: pct x min(window, model window); model window not known to 8sync",
        }))?);
    }
    let pct = match &cur {
        Some(p) => format!("auto-compact tại {p}% ({VAR} trong {})", path.display()),
        None => "auto-compact %: mặc định của Claude Code".into(),
    };
    let w = match &win {
        Some(w) => format!("window {w} ({WIN_VAR})"),
        None => "window: mặc định của model (~967K trên 1M)".into(),
    };
    let tail = match eff {
        Some(t) => format!("≈ {t} token (≈ %×min(window, window của model); 8sync không biết window model)"),
        None => "trigger thực: chưa tính được (thiếu % hoặc window)".into(),
    };
    Ok(format!("{pct}\n{w}\n{tail}\nĐổi: `8sync ccc compact --at <N>` · `--window <N>` · `--window-reset`"))
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
        assert!(strip_kit_default(&mut owner), "removes the kit window only");
        assert_eq!(owner["env"][VAR], "45");
        assert!(cur_var(&owner, WIN_VAR).is_none());
        assert!(strip_kit_default(&mut v));
        assert_eq!(v, json!({}));
    }

    #[test]
    fn window_set_reset_idempotent_and_validated() {
        let (_d, p) = tmp();
        std::fs::write(&p, r#"{"env":{"X":"1"}}"#).unwrap();
        run_at(&a(&["--window", "250000"]), &p).unwrap();
        assert_eq!(read(&p)["env"][WIN_VAR], "250000");
        assert_eq!(read(&p)["env"]["X"], "1");
        assert!(run_at(&a(&["--window", "250000"]), &p).unwrap().contains("không đổi"));
        for bad in ["99999", "1000001", "500k", "1M", "200", "-5", "1e5", "", "+250000"] {
            assert!(run_at(&a(&["--window", bad]), &p).is_err(), "{bad}");
        }
        assert!(run_at(&a(&["--window"]), &p).is_err());
        assert_eq!(read(&p)["env"][WIN_VAR], "250000");
        for ok in ["100000", "1000000"] {
            run_at(&a(&["--window", ok]), &p).unwrap();
        }
        run_at(&a(&["--window-reset"]), &p).unwrap();
        assert_eq!(read(&p), json!({"env":{"X":"1"}}));
        assert!(run_at(&a(&["--window-reset"]), &p).unwrap().contains("không có"));
    }

    #[test]
    fn status_shows_pct_window_and_effective_trigger() {
        let (_d, p) = tmp();
        let none = run_at(&[], &p).unwrap();
        assert!(none.contains("chưa tính được"));
        run_at(&a(&["--at", "60"]), &p).unwrap();
        run_at(&a(&["--window", "400000"]), &p).unwrap();
        let t = run_at(&[], &p).unwrap();
        assert!(t.contains("60%") && t.contains("window 400000") && t.contains("≈ 240000"), "{t}");
        let j: Value = serde_json::from_str(&run_at(&a(&["--json"]), &p).unwrap()).unwrap();
        assert_eq!((j["percent"].clone(), j["window"].clone(), j["effective_trigger_tokens"].clone()), (json!("60"), json!("400000"), json!(240000)));
        assert_eq!(j["window_default"], false);
    }

    #[test]
    fn kit_window_only_when_owner_has_none() {
        let mut v = json!({});
        kit_default(&mut v).unwrap();
        assert_eq!(v["env"][WIN_VAR], "400000");
        kit_default(&mut v).unwrap(); // idempotent
        assert_eq!(v["env"][WIN_VAR], "400000");
        for owner in [
            json!({"env":{WIN_VAR:"200000"}}),
            json!({"autoCompactWindow":300000}),
            json!({"modelSettings":{"claude-opus-5-5":{"autoCompactWindow":500000}}}),
        ] {
            let mut o = owner.clone();
            kit_default(&mut o).unwrap();
            assert!(cur_var(&o, WIN_VAR) == cur_var(&owner, WIN_VAR), "{owner}");
            strip_kit_default(&mut o); // owner window values are never kit-owned unless == 400000
            assert_eq!(cur_var(&o, WIN_VAR), cur_var(&owner, WIN_VAR));
        }
        // remove: only the unchanged kit value goes
        let mut changed = json!({"env":{WIN_VAR:"350000", VAR:"60"}});
        assert!(strip_kit_default(&mut changed));
        assert_eq!(changed["env"][WIN_VAR], "350000");
        assert!(strip_kit_default(&mut v));
        assert_eq!(v, json!({}));
    }

    #[test]
    fn precedence_note_env_window_documented_values() {
        // effective trigger = pct x window; window var wins over autoCompactWindow, so the kit leaves both alone.
        assert_eq!(effective(Some("60"), Some("400000")), Some(240_000));
        assert_eq!(effective(Some("60"), Some("120000")), Some(72_000));
        assert_eq!(effective(None, Some("120000")), None);
        assert_eq!((KIT_WINDOW as u64) * (KIT_DEFAULT as u64) / 100, 240_000);
    }
}
