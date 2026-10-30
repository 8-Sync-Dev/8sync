//! `8sync harness bench` — deterministic benchmark of the loop-engineering
//! context budget. Measures the token cost an agent pays EVERY session from the
//! repo (the 8sync block + the memory spine), plus a KV-cache stable-prefix
//! gate. Skills come from the global ECC plugin and load on demand, so they are
//! not part of the repo's upfront budget. No model calls → fully reproducible.
use std::path::Path;

use anyhow::Result;

use crate::verbs::skill::discover::detect_current_project_root;
use crate::verbs::skill::inject::harness_block;
use crate::ui;

/// Rough token estimate (~chars/4, the standard heuristic). Deterministic; for
/// RELATIVE comparison across phases, not billing accuracy.
fn tok(chars: usize) -> usize {
    chars.div_ceil(4)
}

/// Char count of the memory-spine files the agent reads at session start
/// (part of the per-session upfront budget alongside the block).
fn spine_chars(root: &Path) -> usize {
    ["PROJECT.md", "KNOWLEDGE.md", "STATE.md", "DECISIONS.md", "PREFERENCES.md", "PLAYBOOKS.md"]
        .iter()
        .map(|f| {
            std::fs::read_to_string(root.join("su-code").join(f))
                .map(|s| s.chars().count())
                .unwrap_or(0)
        })
        .sum()
}

pub(crate) fn harness_bench() -> Result<()> {
    ui::header("8sync harness bench — loop-engineering context budget");
    let Some(root) = detect_current_project_root() else {
        ui::warn("not inside a project — cd into a repo root and re-run");
        return Ok(());
    };

    let block = harness_block();
    let block_tok = tok(block.chars().count());
    // Memory spine (PROJECT/KNOWLEDGE/STATE/DECISIONS/PREFERENCES/PLAYBOOKS) — read at
    // session start, so it counts toward the per-session upfront budget.
    let spine_tok = tok(spine_chars(&root));
    let upfront = block_tok + spine_tok;
    // A1 gate: rebuilding the block must be byte-identical (no volatile content
    // → KV-cache safe). Regression guard if a timestamp ever leaks back in.
    let stable = harness_block() == block;

    println!();
    println!("  project: {}", root.display());
    println!();
    println!("  ── UPFRONT — context paid EVERY session ─────────────────────");
    println!("   8sync block              ~{:>6} tok", block_tok);
    println!("   memory spine (6 files)   ~{:>6} tok", spine_tok);
    println!("   ─────────────────────────────────────────");
    println!("   UPFRONT TOTAL            ~{:>6} tok", upfront);
    println!("   skills: ECC plugin `ecc@ecc` (global, loaded on demand — not in the repo budget)");
    println!();

    if stable {
        ui::ok("A1 stable-prefix: 8sync block byte-identical on rebuild (KV-cache safe)");
    } else {
        ui::err("A1 stable-prefix: block DIFFERS on rebuild — volatile content in the prefix");
    }
    if let Some(advice) = spine_advice(spine_tok, upfront) {
        ui::warn(&advice);
    }
    ui::info(&format!("scorecard: upfront ~{} tok · A1 {}", upfront, if stable { "PASS" } else { "FAIL" }));
    Ok(())
}

/// Advisory shown when the memory spine eats more than half the upfront
/// budget — the single biggest lever bench exposes (spine grows unbounded
/// between consolidations; the block is fixed by design).
pub(crate) fn spine_advice(spine_tok: usize, upfront: usize) -> Option<String> {
    if upfront == 0 || spine_tok * 2 <= upfront {
        return None;
    }
    Some(format!(
        "memory spine ~{} tok = {}% of upfront — trim su-code/STATE.md (archive finished phases) · KNOWLEDGE >200 lines auto-archives on next `8sync harness`",
        spine_tok,
        spine_tok * 100 / upfront
    ))
}

// Dashboard-only surface (`/api/bench`) — the CLI path prints instead.
#[cfg(feature = "web")]
#[derive(serde::Serialize)]
pub(crate) struct BenchMetrics {
    pub upfront: usize,
    pub force_load_prefix: usize,
    pub spine_tok: usize,
    pub a1_pass: bool,
    /// Set when the spine dominates the upfront budget (>50%).
    pub spine_advice: Option<String>,
}

/// Summary metrics for the web dashboard (`/api/bench`). Same compute as the
/// CLI `harness_bench` but returns a serializable struct instead of printing.
/// None if not inside a project.
#[cfg(feature = "web")]
pub(crate) fn bench_metrics() -> Option<BenchMetrics> {
    let root = detect_current_project_root()?;
    let block = harness_block();
    let block_tok = tok(block.chars().count());
    let spine_tok = tok(spine_chars(&root));
    let upfront = block_tok + spine_tok;
    Some(BenchMetrics {
        upfront,
        force_load_prefix: block_tok,
        spine_tok,
        a1_pass: harness_block() == block,
        spine_advice: spine_advice(spine_tok, upfront),
    })
}
