//! `8sync harness toolstats` — track omp tool-call usage for the current project,
//! exposing the **optimizer** (trail / headroom) vs **fallback** (grep / read / search / find / glob) ratio + per-tool
//! failures. The source of truth is omp's own session JSONL — what the agent
//! *actually* called — so you can see whether the token-optimization stack (STEP 0)
//! is being used, and catch failing tool calls (e.g. a dead MCP server).
//!
//! No database. Every run re-reads `~/.omp/agent/sessions/<slug>/*.jsonl` in full
//! and folds the calls in memory. This used to round-trip through a bundled
//! SQLite (`.cache/8sync/toolstats.db`) that opened its ingest with
//! `DELETE FROM calls` — so it never carried anything between runs and cost
//! 1 060 840 B of embedded C to answer `COUNT` and `GROUP BY` over a few
//! thousand rows the same process had just parsed.

use anyhow::{Context, Result};
use std::collections::HashMap;
use std::path::Path;

use crate::{env_detect, ui, verbs::skill::discover};

/// One tool call as recorded in a session transcript.
struct Call {
    category: &'static str,
    detail: String,
    ok: bool,
}

pub(crate) fn harness_toolstats(env: &env_detect::Env) -> Result<()> {
    ui::header("8sync harness toolstats");
    let root = discover::detect_current_project_root()
        .context("not inside a project — cd into your repo first")?;
    let slug = session_slug(&env.home, &root);
    let sess_dir = env.home.join(format!(".omp/agent/sessions/{}", slug));

    if !sess_dir.is_dir() {
        ui::warn(&format!(
            "no omp sessions yet for this project ({}). Run omp here, then re-run.",
            sess_dir.display()
        ));
        return Ok(());
    }
    let (calls, n_sessions) = ingest(&sess_dir)?;
    ui::ok(&format!(
        "tracked {} call(s) from {} session(s) ← {}",
        calls.len(),
        n_sessions,
        sess_dir.display()
    ));
    report(&calls, &root)
}

/// `~/.omp/agent/sessions/<slug>` for a project root (mirrors the web dashboard).
fn session_slug(home: &Path, root: &Path) -> String {
    match root.strip_prefix(home) {
        Ok(rel) => format!("-{}", rel.to_string_lossy().replace('/', "-")),
        Err(_) => format!("-{}", root.to_string_lossy().trim_start_matches('/').replace('/', "-")),
    }
}

/// Parse each `<slug>/*.jsonl` and fold its tool calls. Returns (calls, sessions).
fn ingest(sess_dir: &Path) -> Result<(Vec<Call>, usize)> {
    let mut out: Vec<Call> = Vec::new();
    let mut n_sessions = 0usize;
    let rd = std::fs::read_dir(sess_dir)?;
    for ent in rd.flatten() {
        let path = ent.path();
        if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
            continue;
        }
        let text = std::fs::read_to_string(&path).unwrap_or_default();
        n_sessions += 1;

        // First pass: collect tool calls (in order) + a toolCallId → isError map.
        let mut calls: Vec<(String, String, String)> = Vec::new(); // (id, name, command)
        let mut errors: HashMap<String, bool> = HashMap::new();
        for line in text.lines() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            let v: serde_json::Value = match serde_json::from_str(line) {
                Ok(v) => v,
                Err(_) => continue,
            };
            if v.get("type").and_then(|t| t.as_str()) != Some("message") {
                continue;
            }
            let m = match v.get("message") {
                Some(m) => m,
                None => continue,
            };
            let role = m.get("role").and_then(|r| r.as_str()).unwrap_or("");
            if role == "toolResult" {
                if let Some(id) = m.get("toolCallId").and_then(|i| i.as_str()) {
                    let is_err = m.get("isError").and_then(|e| e.as_bool()).unwrap_or(false);
                    errors.insert(id.to_string(), is_err);
                }
                continue;
            }
            if let Some(content) = m.get("content").and_then(|c| c.as_array()) {
                for c in content {
                    if c.get("type").and_then(|t| t.as_str()) != Some("toolCall") {
                        continue;
                    }
                    let id = c.get("id").and_then(|i| i.as_str()).unwrap_or("").to_string();
                    let name = c.get("name").and_then(|n| n.as_str()).unwrap_or("?").to_string();
                    let cmd = c
                        .get("arguments")
                        .and_then(|a| a.get("command").or_else(|| a.get("cmd")))
                        .and_then(|x| x.as_str())
                        .unwrap_or("")
                        .to_string();
                    calls.push((id, name, cmd));
                }
            }
        }

        // Second pass: categorize.
        for (id, name, cmd) in &calls {
            let (category, detail) = categorize(name, cmd);
            out.push(Call {
                category,
                detail,
                ok: !errors.get(id).copied().unwrap_or(false),
            });
        }
    }
    Ok((out, n_sessions))
}

/// True when the shell command runs the `trail` CLI (`trail ask …`, `cd x && trail callers y`).
fn runs_trail(cmd: &str) -> bool {
    cmd.replace([';', '&', '|', '(', ')', '`'], " ").split_whitespace().any(|w| w == "trail" || w.ends_with("/trail") || w.ends_with("\\trail"))
}

/// Map a tool call to (category, detail). trail runs via `bash`, so its command
/// string is inspected; headroom is an MCP tool.
fn categorize(name: &str, cmd: &str) -> (&'static str, String) {
    const SEARCH: &[&str] = &["grep", "glob", "search", "find"];
    let n = name.to_lowercase();
    if name == "bash" && runs_trail(cmd) {
        return ("optimizer", "trail".into());
    }
    if n.contains("headroom") {
        return ("compress", "headroom".into()); // auto-compression, not a lookup tool
    }
    if name == "read" {
        return ("read", "read".into()); // often legit read-before-edit
    }
    if SEARCH.contains(&name) {
        return ("search", name.to_string()); // raw search the optimizer should replace
    }
    if name == "edit" || name == "write" {
        return ("edit", name.to_string());
    }
    ("other", name.to_string())
}

fn report(calls: &[Call], root: &Path) -> Result<()> {
    let total = calls.len();
    if total == 0 {
        ui::info("no tool calls tracked yet.");
        return Ok(());
    }

    // One pass produces every number the report needs: per-category
    // (count, failures), per-detail counts, and per-detail failures.
    let mut by_cat: HashMap<&str, (i64, i64)> = HashMap::new();
    let mut by_detail: HashMap<&str, i64> = HashMap::new();
    let mut by_cat_detail: HashMap<(&str, &str), i64> = HashMap::new();
    let mut fail_detail: HashMap<&str, i64> = HashMap::new();
    let mut first_seen: HashMap<&str, usize> = HashMap::new();
    for (i, c) in calls.iter().enumerate() {
        let e = by_cat.entry(c.category).or_default();
        e.0 += 1;
        e.1 += !c.ok as i64;
        *by_detail.entry(c.detail.as_str()).or_default() += 1;
        *by_cat_detail.entry((c.category, c.detail.as_str())).or_default() += 1;
        first_seen.entry(c.detail.as_str()).or_insert(i);
        if !c.ok {
            *fail_detail.entry(c.detail.as_str()).or_default() += 1;
        }
    }
    let cat = |c: &str| -> (i64, i64) { by_cat.get(c).copied().unwrap_or((0, 0)) };
    let (opt, opt_fail) = cat("optimizer");
    let (search, search_fail) = cat("search");
    let (read, _) = cat("read");
    let (compress, _) = cat("compress");
    let (edit, _) = cat("edit");
    let (other, _) = cat("other");

    // The actionable ratio: of code-LOOKUP calls (optimizer + raw search), how many
    // used the token-optimized engines? read/edit/bash aren't lookups → excluded.
    let lookup = opt + search;
    let lookup_pct = if lookup > 0 { 100.0 * opt as f64 / lookup as f64 } else { 0.0 };

    ui::step(&format!("project: {}  ·  {} tracked tool calls", root.display(), total));
    println!();
    println!("  CODE-LOOKUP calls (optimizer + raw-search) = {}", lookup);
    println!("  ┌ OPTIMIZER  (trail)                  {:>6}   {:>5.1}% of lookups   {} fail", opt, lookup_pct, opt_fail);
    for d in ["trail"] {
        let n = by_detail.get(d).copied().unwrap_or(0);
        let flag = if n == 0 { "  ← never called" } else { "" };
        println!("  │    {:<10} {:>6}{}", d, n, flag);
    }
    println!("  └ RAW SEARCH (grep·search·find·glob)  {:>6}   {:>5.1}% of lookups   {} fail", search, 100.0 - lookup_pct, search_fail);
    for (d, n) in ranked(by_cat_detail.iter().filter(|((c, _), _)| *c == "search").map(|((_, d), n)| (*d, *n)), &first_seen) {
        println!("       {:<10} {:>6}", d, n);
    }
    println!();
    println!("  read (read-before-edit, ranges)  {:>6}   (often legit — not shamed)", read);
    println!("  edit / write                     {:>6}", edit);
    println!("  headroom (auto-compress)         {:>6}   (background, not agent-called)", compress);
    println!("  other (bash/todo/job/…)          {:>6}", other);
    println!();

    // Failing tools (any category) — fix these (e.g. a dead MCP server).
    let frows = ranked(fail_detail.iter().map(|(d, n)| (*d, *n)), &first_seen);
    if !frows.is_empty() {
        let list: Vec<String> =
            frows.iter().take(8).map(|(t, n)| format!("{}×{}", t, n)).collect();
        ui::info(&format!("failing calls: {}", list.join(", ")));
    }

    // Verdict on the code-lookup ratio (the actionable number).
    if lookup == 0 {
        ui::info("no code-lookup calls yet.");
    } else if opt == 0 {
        ui::warn("0% of code-lookups used the optimizer — every where-is/who-calls went through raw grep/search.");
        ui::info("check `8sync doctor` (trail installed? `8sync trail status`) — re-measure after omp usage.");
    } else if lookup_pct < 50.0 {
        ui::warn(&format!("optimizer = {:.0}% of code-lookups — STEP-0 under-used; agent still defaults to raw search.", lookup_pct));
    } else {
        ui::ok(&format!("optimizer = {:.0}% of code-lookups — STEP-0 is working.", lookup_pct));
    }
    Ok(())
}

/// Count-descending ranking. SQLite's `ORDER BY 2 DESC` left ties in table-scan
/// order, i.e. first appearance — reproduced here so the report is byte-stable
/// across the SQLite removal and deterministic run to run.
fn ranked<'a>(
    it: impl Iterator<Item = (&'a str, i64)>,
    first_seen: &HashMap<&'a str, usize>,
) -> Vec<(&'a str, i64)> {
    let mut v: Vec<(&str, i64)> = it.collect();
    v.sort_by(|a, b| {
        b.1.cmp(&a.1)
            .then_with(|| first_seen.get(a.0).cmp(&first_seen.get(b.0)))
    });
    v
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trail_calls_are_optimizer_calls() {
        for c in ["trail ask \"where is x\"", "cd repo && trail callers foo", "(trail map)", "npx trail grep x", "C:/n/trail skeleton a.rs"] {
            assert_eq!(categorize("bash", c), ("optimizer", "trail".into()), "{c}");
        }
        assert_eq!(categorize("bash", "cargo test trailing").0, "other");
        assert_eq!(categorize("grep", "").0, "search");
    }
}
