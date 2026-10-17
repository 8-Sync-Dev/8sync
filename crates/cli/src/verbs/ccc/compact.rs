//! `8sync ccc compact`: the auto-compact trigger of Claude Code sessions.
//! Claude Code reads `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` (1-100, percentage of the auto-compact window);
//! it can only LOWER the threshold, values above the default are ignored, and it needs a new session
//! (https://code.claude.com/docs/en/env-vars). We store it in `~/.claude/settings.json` `env`.
//! `CLAUDE_CODE_AUTO_COMPACT_WINDOW` (plain integer 100000..=1000000, capped at the model window, beats
//! `/autocompact`, `--autocompact` and the `autoCompactWindow` setting) is an absolute cap on that window:
//! trigger ≈ pct × min(window, model window). The model window comes from the status line
//! (`context_window.context_window_size`, https://code.claude.com/docs/en/statusline): the status
//! line shows each session's point (`ctx 22%→nén 65%`) and `compact` lists it per model seen.
use anyhow::{bail, Context, Result};
use serde_json::{json, Value};
use std::path::Path;

pub(super) const VAR: &str = "CLAUDE_AUTOCOMPACT_PCT_OVERRIDE";
/// What `ccc kit` sets when the key is absent (owner, 2026-10-17: compact at 60-70 % of the context, not ~22 %).
pub(super) const KIT_DEFAULT: u32 = 65;
const RANGE: std::ops::RangeInclusive<u32> = 10..=95;
pub(super) const WIN_VAR: &str = "CLAUDE_CODE_AUTO_COMPACT_WINDOW";
/// What `ccc kit` sets when the window is absent everywhere: the top of the range, which Claude Code caps at
/// the model window, so the trigger is pct x model window and the status line's `ctx` % at compaction is
/// the pct (65 % = 650K on 1M, 130K on 200K). Measured: override 60 with window 200K → 60.0 % (CHANGELOG 0.84.0).
pub(super) const KIT_WINDOW: u32 = 1_000_000;
/// The kit pair before 0.100 (60 % x 400K = 240K, ~24 % on a 1M status line): migrated by the next `ccc kit`.
const OLD_KIT: (&str, &str) = ("60", "400000");
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

/// `ccc kit`: defaults only when absent (an owner value is never touched), except the old kit window
/// 400000, which only the kit wrote: it becomes the model window, and the 60 % paired with it 65 %.
pub(super) fn kit_default(v: &mut Value) -> Result<()> {
    let obj = v.as_object_mut().context("settings.json is not a JSON object")?;
    if let Some(env) = obj.entry("env").or_insert_with(|| json!({})).as_object_mut() {
        if env.get(WIN_VAR).and_then(Value::as_str) == Some(OLD_KIT.1) {
            env.remove(WIN_VAR);
            if env.get(VAR).and_then(Value::as_str) == Some(OLD_KIT.0) {
                env.remove(VAR);
            }
        }
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

/// `ccc kit --remove`: drop each key only when it still equals a kit default (this one or the old pair).
pub(super) fn strip_kit_default(v: &mut Value) -> bool {
    let mut changed = false;
    if current(v).is_some_and(|c| c == KIT_DEFAULT.to_string() || c == OLD_KIT.0) {
        changed |= reset(v);
    }
    if cur_var(v, WIN_VAR).is_some_and(|w| w == KIT_WINDOW.to_string() || w == OLD_KIT.1) {
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

/// Where a session auto-compacts, as a % of its context window `size` (the status line's
/// `context_window.context_window_size`: 200000, or 1000000 with extended context), the scale its
/// `ctx` % uses: pct × min(window, size) / size. `None` without the override (Claude Code's own
/// default point is not documented).
pub(super) fn point(size: u64, pct: Option<&str>, win: Option<&str>) -> Option<u64> {
    let p = pct?.trim().parse::<u64>().ok().filter(|p| (1..=100).contains(p))?;
    let w = win
        .filter(|w| !w.is_empty() && w.bytes().all(|b| b.is_ascii_digit()))
        .and_then(|w| w.parse::<u64>().ok())
        .filter(|w| (*WIN_RANGE.start() as u64..=*WIN_RANGE.end() as u64).contains(w))
        .unwrap_or(size);
    (size > 0).then(|| p * w.min(size) / size)
}

/// The newest context window the status line saw per model: (model, size), biggest first.
fn measured(home: &Path) -> Vec<(String, u64)> {
    let mut best: std::collections::BTreeMap<String, (u64, u64)> = Default::default();
    for e in std::fs::read_dir(super::report::usage_dir(home)).into_iter().flatten().flatten() {
        let Some(v) = std::fs::read_to_string(e.path()).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok()) else { continue };
        let (Some(m), Some(n)) = (v["model"].as_str(), v["context_size"].as_u64()) else { continue };
        let ts = v["ts"].as_u64().unwrap_or(0);
        if best.get(m).is_none_or(|(at, _)| ts >= *at) {
            best.insert(m.to_string(), (ts, n));
        }
    }
    let mut out: Vec<(String, u64)> = best.into_iter().map(|(m, (_, n))| (m, n)).collect();
    out.sort_by_key(|(_, n)| std::cmp::Reverse(*n));
    out
}

/// Lines for `compact` status: each measured window and where new sessions will compact in it.
fn measured_lines(seen: &[(String, u64)], pct: Option<&str>, win: Option<&str>) -> Vec<String> {
    if seen.is_empty() {
        return vec!["window của model: chưa đo (status line của 8sync ghi lại khi một session chạy)".into()];
    }
    seen.iter()
        .map(|(m, n)| match point(*n, pct, win) {
            Some(p) => format!("{m}: window {n} → nén ở ≈ {} token = {p}% ctx{}", n * p / 100, if p < 50 { "  ⚠ sớm: `8sync ccc compact --window 1000000`" } else { "" }),
            None => format!("{m}: window {n} → nén theo mặc định của Claude Code"),
        })
        .collect()
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
        Some(w) if *w == KIT_WINDOW.to_string() => {
            format!("window {w} ({WIN_VAR}) = window của model → nén khi ctx trên status line chạm {}%", cur.as_deref().unwrap_or("mặc định"))
        }
        Some(w) => format!("window {w} ({WIN_VAR})"),
        None => "window: mặc định của model (~967K trên 1M)".into(),
    };
    let tail = match eff {
        Some(t) => format!("≈ {t} token (≈ %×min(window, window của model); 8sync không biết window model)"),
        None => "trigger thực: chưa tính được (thiếu % hoặc window)".into(),
    };
    Ok(format!("{pct}\n{w}\n{tail}\nĐổi: `8sync ccc compact --at <N>` · `--window <N>` · `--window-reset`"))
}

pub(super) fn run(rest: &[String], claude_dir: &Path, home: &Path) -> Result<()> {
    let path = claude_dir.join("settings.json");
    println!("{}", run_at(rest, &path)?);
    if rest.iter().all(|a| a == "status") {
        let v = load(&path)?.1;
        for l in measured_lines(&measured(home), current(&v).as_deref(), cur_var(&v, WIN_VAR).as_deref()) {
            println!("{l}");
        }
        println!("Status line hiện `ctx N%→nén M%` theo env session đó đang thấy. Chắc chắn nhất: mở lại session (`/exit` rồi `claude --resume`; phòng nền: `8sync ccc auto down` → `auto up`).");
    }
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
        assert_eq!(v["env"][VAR], "65");
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
        assert_eq!(v["env"][WIN_VAR], "1000000");
        kit_default(&mut v).unwrap(); // idempotent
        assert_eq!(v["env"][WIN_VAR], "1000000");
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
        assert_eq!((KIT_WINDOW as u64) * (KIT_DEFAULT as u64) / 100, 650_000);
    }

    #[test]
    fn the_point_follows_the_window_the_status_line_reports() {
        // 1M model: old kit pair → 24 %, new kit → 65 %; 200K model: the 1M cap is the model window
        assert_eq!(point(1_000_000, Some("60"), Some("400000")), Some(24));
        assert_eq!(point(1_000_000, Some("65"), Some("1000000")), Some(65));
        assert_eq!(point(200_000, Some("65"), Some("1000000")), Some(65));
        assert_eq!(point(200_000, Some("60"), Some("400000")), Some(60));
        assert_eq!(point(1_000_000, Some("65"), None), Some(65), "no window: the model's");
        assert_eq!(point(1_000_000, Some("65"), Some("500k")), Some(65), "a value Claude Code would not take counts as none");
        assert_eq!(point(1_000_000, None, Some("400000")), None, "Claude Code's own default is not documented");
        assert_eq!(point(0, Some("65"), None), None);
        assert_eq!(point(1_000_000, Some("0"), None), None);

        let home = std::env::temp_dir().join(format!("compact-seen-{}", std::process::id()));
        let d = super::super::report::usage_dir(&home);
        std::fs::create_dir_all(&d).unwrap();
        for (sid, model, size, ts) in [("a", "claude-opus-5-5", 1_000_000, 5), ("b", "claude-haiku-5-5", 200_000, 6), ("c", "claude-opus-5-5", 1_000_000, 9)] {
            std::fs::write(d.join(format!("{sid}.json")), json!({"session_id": sid, "model": model, "context_size": size, "ts": ts}).to_string()).unwrap();
        }
        std::fs::write(d.join("old.json"), json!({"session_id": "old", "model": "x", "ts": 1}).to_string()).unwrap();
        let seen = measured(&home);
        assert_eq!(seen, [("claude-opus-5-5".to_string(), 1_000_000), ("claude-haiku-5-5".to_string(), 200_000)]);
        let l = measured_lines(&seen, Some("60"), Some("400000"));
        assert!(l[0].contains("window 1000000 → nén ở ≈ 240000 token = 24% ctx") && l[0].contains("⚠ sớm"), "{l:?}");
        assert!(l[1].contains("= 60% ctx") && !l[1].contains('⚠'));
        let l = measured_lines(&seen, Some("65"), Some("1000000"));
        assert!(l.iter().all(|x| x.contains("= 65% ctx")), "{l:?}");
        assert!(measured_lines(&[], None, None)[0].contains("chưa đo"));
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn the_old_kit_window_moves_to_the_model_window_and_owner_values_stay() {
        // the pair the kit wrote before: compacted at 240K, ~24 % of a 1M status line
        let mut old = json!({"env":{VAR:"60", WIN_VAR:"400000", "X":"1"}});
        kit_default(&mut old).unwrap();
        assert_eq!(old["env"], json!({VAR:"65", WIN_VAR:"1000000", "X":"1"}));
        // owner percent with the old kit window: the percent stays
        let mut pct = json!({"env":{VAR:"45", WIN_VAR:"400000"}});
        kit_default(&mut pct).unwrap();
        assert_eq!(pct["env"], json!({VAR:"45", WIN_VAR:"1000000"}));
        // 60 % with an owner window is the owner's: untouched
        let mut mine = json!({"env":{VAR:"60", WIN_VAR:"200000"}});
        kit_default(&mut mine).unwrap();
        assert_eq!(mine["env"], json!({VAR:"60", WIN_VAR:"200000"}));
        // remove takes the old pair too
        let mut gone = json!({"env":{VAR:"60", WIN_VAR:"400000"}});
        assert!(strip_kit_default(&mut gone));
        assert_eq!(gone, json!({}));
        // status says when the compaction lands on the status line
        let (_d, p) = tmp();
        std::fs::write(&p, old.to_string()).unwrap();
        assert!(run_at(&[], &p).unwrap().contains("chạm 65%"));
    }
}
