//! Usage measurement for Claude Code sessions, from numbers Claude Code itself reports.
//!
//! The status line receives, every few seconds, the session's `cost.total_cost_usd`,
//! durations, lines added/removed, context and rate-limit use
//! (https://code.claude.com/docs/en/statusline). [`write_snapshot`] keeps the latest copy per
//! session in `~/.local/state/8sync/hq/usage/<session_id>.json` (atomic, only when a number
//! changed), so `8sync ccc . report` and `8sync hq ui` can show cost, cost per finished task and
//! weight without estimating prices or reading transcripts.
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use serde_json::{json, Value};

pub(crate) fn usage_dir(home: &Path) -> PathBuf {
    home.join(".local/state").join(crate::brand::NS).join("hq").join("usage")
}

/// A Claude session id or short name: safe as a file name.
pub(crate) fn safe_id(s: &str) -> bool {
    (1..=64).contains(&s.len()) && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// The fields kept from one status-line input (numbers only, plus model, cwd and session id).
pub(super) fn snapshot_of(v: &Value) -> Option<Value> {
    let sid = v["session_id"].as_str().filter(|s| safe_id(s))?;
    let c = &v["cost"];
    let cw = &v["context_window"];
    let pct = |x: &Value| x.as_f64().map(|p| p.round());
    Some(json!({
        "session_id": sid,
        "cwd": v["cwd"].as_str().or_else(|| v["workspace"]["current_dir"].as_str()),
        "model": v["model"]["id"].as_str().or_else(|| v["model"]["display_name"].as_str()),
        "cost_usd": c["total_cost_usd"].as_f64(),
        "duration_ms": c["total_duration_ms"].as_u64(),
        "api_duration_ms": c["total_api_duration_ms"].as_u64(),
        "lines_added": c["total_lines_added"].as_u64(),
        "lines_removed": c["total_lines_removed"].as_u64(),
        "input_tokens": cw["total_input_tokens"].as_u64(),
        "output_tokens": cw["total_output_tokens"].as_u64(),
        "context_pct": pct(&cw["used_percentage"]),
        "five_hour_pct": pct(&v["rate_limits"]["five_hour"]["used_percentage"]),
        "seven_day_pct": pct(&v["rate_limits"]["seven_day"]["used_percentage"]),
        "five_hour_resets_at": epoch(&v["rate_limits"]["five_hour"]["resets_at"]),
        "seven_day_resets_at": epoch(&v["rate_limits"]["seven_day"]["resets_at"]),
    }))
}

/// Epoch seconds as Claude Code reports them (integer; a float is truncated, junk is `None`).
fn epoch(x: &Value) -> Option<u64> {
    x.as_u64().or_else(|| x.as_f64().filter(|f| f.is_finite() && *f > 0.0).map(|f| f as u64))
}

/// Keep the latest snapshot for the session. Never fails the status line: errors are dropped.
pub(super) fn write_snapshot(home: &Path, v: &Value, now_secs: u64) {
    let Some(mut snap) = snapshot_of(v) else { return };
    let dir = usage_dir(home);
    let sid = snap["session_id"].as_str().unwrap_or_default().to_string();
    let file = dir.join(format!("{sid}.json"));
    if let Some(old) = std::fs::read_to_string(&file).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok()) {
        let mut o = old.clone();
        o.as_object_mut().map(|m| m.remove("ts"));
        if o == snap {
            return; // nothing moved: no write every few seconds
        }
    }
    snap["ts"] = json!(now_secs);
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    let tmp = dir.join(format!(".{sid}.{}.tmp", std::process::id()));
    if std::fs::write(&tmp, format!("{snap}\n")).is_ok() && std::fs::rename(&tmp, &file).is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
}

pub(crate) fn load_snapshots(home: &Path) -> Vec<Value> {
    let mut out: Vec<Value> = std::fs::read_dir(usage_dir(home))
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| e.file_name().to_string_lossy().ends_with(".json"))
        .filter_map(|e| std::fs::read_to_string(e.path()).ok())
        .filter_map(|t| serde_json::from_str::<Value>(&t).ok())
        .filter(|v| v["session_id"].is_string())
        .collect();
    out.sort_by_key(|v| std::cmp::Reverse(v["ts"].as_u64().unwrap_or(0)));
    out
}

/// The snapshot the stop-failure policy trusts for `session_id`: its own, else the newest one
/// (rate limits are per account). `snaps` is [`load_snapshots`] output (newest first).
pub(crate) fn freshest<'a>(snaps: &'a [Value], session_id: &str) -> Option<&'a Value> {
    snaps.iter().find(|s| s["session_id"].as_str() == Some(session_id)).or_else(|| snaps.first())
}

/// One report row: an `ls` row (name, model, branch, tokens, tasks) joined with its usage snapshot.
pub(super) fn row(ls: &Value, snap: Option<&Value>) -> Value {
    let n = |v: Option<&Value>, k: &str| v.and_then(|x| x[k].as_f64());
    let cost = n(snap, "cost_usd");
    let done = ls["tasks_done"].as_u64().unwrap_or(0);
    json!({
        "name": ls["name"].as_str().or_else(|| ls["title"].as_str()),
        "sid": ls["sid"].as_str().or_else(|| ls["id"].as_str()),
        "model": snap.and_then(|s| s["model"].as_str()).or_else(|| ls["model"].as_str()),
        "branch": ls["branch"],
        "status": ls["status"],
        "tokens": ls["tokens"],
        "cost_usd": cost,
        "duration_ms": snap.map_or(Value::Null, |s| s["duration_ms"].clone()),
        "lines_added": snap.map_or(Value::Null, |s| s["lines_added"].clone()),
        "lines_removed": snap.map_or(Value::Null, |s| s["lines_removed"].clone()),
        "tasks_done": done,
        "tasks_total": ls["tasks_total"].as_u64().unwrap_or(0),
        // Only when both are known: a cost with no finished task is not "per task".
        "cost_per_task_usd": cost.filter(|_| done > 0).map(|c| c / done as f64),
    })
}

/// `su-code/ship/*/loop.json` under the repo: slug, iteration, caps, stopped reason.
pub(super) fn loops(root: &Path) -> Vec<Value> {
    let mut out: Vec<Value> = std::fs::read_dir(root.join("su-code/ship"))
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| std::fs::read_to_string(e.path().join("loop.json")).ok())
        .filter_map(|t| serde_json::from_str::<Value>(&t).ok())
        .map(|v| json!({"slug": v["slug"], "iter": v["iter"], "max_iter": v["max_iter"], "max_min": v["max_min"], "started": v["started"], "stopped": v["stopped"]}))
        .collect();
    out.sort_by_key(|v| std::cmp::Reverse(v["started"].as_u64().unwrap_or(0)));
    out
}

pub(super) fn totals(rows: &[Value]) -> Value {
    let cost: f64 = rows.iter().filter_map(|r| r["cost_usd"].as_f64()).sum();
    let tokens: u64 = rows.iter().filter_map(|r| r["tokens"].as_u64()).sum();
    let done: u64 = rows.iter().filter_map(|r| r["tasks_done"].as_u64()).sum();
    let measured = rows.iter().filter(|r| r["cost_usd"].is_f64()).count();
    // $/task over sessions that measured cost only, so unmeasured sessions do not dilute it.
    let measured_done: u64 = rows.iter().filter(|r| r["cost_usd"].is_f64()).filter_map(|r| r["tasks_done"].as_u64()).sum();
    json!({
        "sessions": rows.len(),
        "measured": measured,
        // An empty f64 sum is -0.0: no measured session means no cost, not "$-0.00".
        "cost_usd": if measured > 0 { json!(cost) } else { Value::Null },
        "tokens": tokens,
        "tasks_done": done,
        "cost_per_task_usd": if measured_done > 0 { json!(cost / measured_done as f64) } else { Value::Null },
    })
}

fn money(v: &Value) -> String {
    v.as_f64().map_or("—".into(), |c| format!("${c:.2}"))
}

fn mins(v: &Value) -> String {
    v.as_u64().map_or("—".into(), |ms| format!("{}m", ms / 60_000))
}

pub(super) fn render(rows: &[Value], tot: &Value, loops: &[Value]) -> Vec<String> {
    let mut out = vec![format!("{:<22} {:<16} {:>9} {:>8} {:>6} {:>11} {:>7} {:>9}", "session", "model", "tokens", "cost", "time", "+/-", "tasks", "$/task")];
    for r in rows {
        let model = r["model"].as_str().unwrap_or("—").trim_start_matches("claude-");
        let lines = match (r["lines_added"].as_u64(), r["lines_removed"].as_u64()) {
            (Some(a), Some(d)) => format!("+{a}/-{d}"),
            _ => "—".into(),
        };
        out.push(format!(
            "{:<22} {:<16} {:>9} {:>8} {:>6} {:>11} {:>7} {:>9}",
            r["name"].as_str().unwrap_or("?").chars().take(22).collect::<String>(),
            model.chars().take(16).collect::<String>(),
            r["tokens"].as_u64().map_or("—".into(), |t| t.to_string()),
            money(&r["cost_usd"]),
            mins(&r["duration_ms"]),
            lines,
            format!("{}/{}", r["tasks_done"], r["tasks_total"]),
            money(&r["cost_per_task_usd"]),
        ));
    }
    out.push(format!(
        "total: {} session(s), {} measured · cost {} · tokens {} · tasks done {} · cost/task {}",
        tot["sessions"], tot["measured"], money(&tot["cost_usd"]), tot["tokens"], tot["tasks_done"], money(&tot["cost_per_task_usd"])
    ));
    for l in loops {
        let state = l["stopped"].as_str().map_or("running".to_string(), |s| format!("stopped: {s}"));
        out.push(format!("loop {}: iter {}/{} · cap {} min · {state}", l["slug"].as_str().unwrap_or("?"), l["iter"], l["max_iter"], l["max_min"]));
    }
    out.push("cost/time/lines: what Claude Code reports to the status line (\"—\" = not seen yet; needs the 8sync status line)".into());
    out
}

/// `8sync ccc . report [--json]`: `ls_rows` are this repo's `ls --json` rows.
pub(super) fn run(home: &Path, root: &Path, ls_rows: &[Value], json_out: bool) -> Result<()> {
    let snaps = load_snapshots(home);
    let rows: Vec<Value> = ls_rows
        .iter()
        .map(|r| {
            let sid = r["sid"].as_str().or_else(|| r["id"].as_str());
            row(r, sid.and_then(|s| snaps.iter().find(|x| x["session_id"] == s)))
        })
        .collect();
    let tot = totals(&rows);
    let lp = loops(root);
    if json_out {
        let v = json!({"schema": 1, "repo": root.display().to_string(), "sessions": rows, "totals": tot, "loops": lp});
        println!("{}", serde_json::to_string_pretty(&v).context("report json")?);
        return Ok(());
    }
    for l in render(&rows, &tot, &lp) {
        println!("{l}");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("8sync-report-{tag}-{}", crate::verbs::uuid_sessions::new_uuid()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn sl(cost: f64) -> Value {
        json!({"session_id": "1eb79553-8369-4a90-b428-2dedb50e18db", "cwd": "/w/app", "model": {"id": "claude-opus-5-5", "display_name": "Opus 5.5"},
               "cost": {"total_cost_usd": cost, "total_duration_ms": 600_000, "total_lines_added": 10, "total_lines_removed": 2},
               "context_window": {"used_percentage": 41.6, "total_input_tokens": 1200, "total_output_tokens": 300},
               "rate_limits": {"five_hour": {"used_percentage": 12.2}}})
    }

    #[test]
    fn usage_snapshot_keeps_numbers_and_rejects_unsafe_ids() {
        let s = snapshot_of(&sl(1.5)).unwrap();
        assert_eq!((s["cost_usd"].as_f64(), s["context_pct"].as_f64(), s["model"].as_str()), (Some(1.5), Some(42.0), Some("claude-opus-5-5")));
        assert_eq!(s["input_tokens"], 1200);
        assert!(s["five_hour_resets_at"].is_null(), "no reset time reported: null, not 0");
        let mut with = sl(1.0);
        with["rate_limits"] = json!({"five_hour": {"used_percentage": 91.0, "resets_at": 1_800_000_000u64}, "seven_day": {"resets_at": 1_800_400_000u64}});
        let s = snapshot_of(&with).unwrap();
        assert_eq!((s["five_hour_resets_at"].as_u64(), s["seven_day_resets_at"].as_u64()), (Some(1_800_000_000), Some(1_800_400_000)));
        assert!(snapshot_of(&json!({"session_id": "../../etc/passwd"})).is_none());
        assert!(snapshot_of(&json!({})).is_none());
    }

    #[test]
    fn usage_snapshot_written_atomically_only_when_numbers_move() {
        let home = tmp("snap");
        write_snapshot(&home, &sl(1.0), 100);
        let f = usage_dir(&home).join("1eb79553-8369-4a90-b428-2dedb50e18db.json");
        let first = std::fs::read_to_string(&f).unwrap();
        write_snapshot(&home, &sl(1.0), 200);
        assert_eq!(std::fs::read_to_string(&f).unwrap(), first, "same numbers: file untouched (ts stays 100)");
        write_snapshot(&home, &sl(2.0), 300);
        let v: Value = serde_json::from_str(&std::fs::read_to_string(&f).unwrap()).unwrap();
        assert_eq!((v["cost_usd"].as_f64(), v["ts"].as_u64()), (Some(2.0), Some(300)));
        assert_eq!(load_snapshots(&home).len(), 1);
        let snaps = [json!({"session_id": "new", "ts": 9}), json!({"session_id": "own", "ts": 5})];
        assert_eq!(freshest(&snaps, "own").unwrap()["ts"], 5, "own session first");
        assert_eq!(freshest(&snaps, "gone").unwrap()["ts"], 9, "else the newest");
        assert!(freshest(&[], "own").is_none());
        assert!(std::fs::read_dir(usage_dir(&home)).unwrap().flatten().all(|e| !e.file_name().to_string_lossy().ends_with(".tmp")));
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn usage_report_cost_per_task_only_when_both_known() {
        let ls = json!({"name": "core", "sid": "s1", "tokens": 5000, "tasks_done": 4, "tasks_total": 5, "model": "claude-sonnet-5-5"});
        let r = row(&ls, Some(&json!({"session_id": "s1", "cost_usd": 2.0, "duration_ms": 120_000, "lines_added": 5, "lines_removed": 1})));
        assert_eq!(r["cost_per_task_usd"].as_f64(), Some(0.5));
        assert!(row(&ls, None)["cost_per_task_usd"].is_null(), "no snapshot: no invented cost");
        let zero = row(&json!({"name": "x", "tasks_done": 0}), Some(&json!({"cost_usd": 1.0})));
        assert!(zero["cost_per_task_usd"].is_null());
        let t = totals(&[r.clone(), row(&ls, None)]);
        assert_eq!((t["sessions"].as_u64(), t["measured"].as_u64(), t["tasks_done"].as_u64()), (Some(2), Some(1), Some(8)));
        assert_eq!(t["cost_per_task_usd"].as_f64(), Some(0.5), "the unmeasured session's tasks do not dilute $/task");
        let none = totals(&[row(&ls, None)]);
        assert!(none["cost_usd"].is_null() && none["cost_per_task_usd"].is_null(), "nothing measured: no $-0.00");
        let text = render(&[r], &t, &[json!({"slug": "hq", "iter": 3, "max_iter": 12, "max_min": 90, "stopped": null})]).join("\n");
        assert!(text.contains("$2.00") && text.contains("$0.50") && text.contains("loop hq: iter 3/12"), "{text}");
    }

    #[test]
    fn usage_loops_read_from_ship_dir() {
        let root = tmp("loops");
        std::fs::create_dir_all(root.join("su-code/ship/a")).unwrap();
        std::fs::write(root.join("su-code/ship/a/loop.json"), r#"{"slug":"a","iter":2,"max_iter":12,"max_min":90,"started":5,"stopped":"stuck"}"#).unwrap();
        let l = loops(&root);
        assert_eq!((l[0]["slug"].as_str(), l[0]["stopped"].as_str()), (Some("a"), Some("stuck")));
        let _ = std::fs::remove_dir_all(&root);
    }
}
