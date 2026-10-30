//! `8sync harness compaction [pct]` — view or set omp's auto-compaction threshold in
//! `~/.omp/agent/config.yml`: `compaction.thresholdPercent` (`N`, 1..=95, sets it) and
//! `compaction.thresholdTokens` (a fixed token limit that takes precedence over the percent).
//! No value prints both. `8sync harness global` seeds thresholdTokens 200000 when unset, so a
//! 1M-window model compacts at 200K instead of 500K (50 %).
use anyhow::{anyhow, Result};
use std::path::Path;

use crate::ui;

const PCT: &str = "thresholdPercent";
const TOKENS: &str = "thresholdTokens";

pub(crate) fn harness_compaction(home: &Path, value: Option<&str>) -> Result<()> {
    ui::header("8sync harness compaction");
    let cfg = home.join(".omp/agent/config.yml");

    let Some(raw) = value else {
        match current(&cfg, PCT) {
            Some(p) => ui::ok(&format!("compaction.{PCT} = {p} — omp auto-compacts at {p}% of the context window")),
            None => ui::info(&format!("compaction.{PCT} not set — omp uses its default; set it with `8sync harness compaction 50`")),
        }
        match current(&cfg, TOKENS) {
            Some(t) => ui::ok(&format!("compaction.{TOKENS} = {t} — fixed token limit, wins over the percent")),
            None => ui::info(&format!("compaction.{TOKENS} not set — `8sync harness global` seeds 200000")),
        }
        return Ok(());
    };

    let pct: u64 = raw
        .trim()
        .trim_end_matches('%')
        .parse()
        .map_err(|_| anyhow!("invalid percent `{raw}` — use a number 1..95"))?;
    if !(1..=95).contains(&pct) {
        return Err(anyhow!("percent {pct} out of range — use 1..95"));
    }
    set(&cfg, PCT, pct)?;
    ui::ok(&format!("compaction.{PCT} = {pct} → {}", cfg.display()));
    ui::info("takes effect on the next omp session");
    Ok(())
}

/// Current `compaction.<key>:` value from config.yml, if present.
fn current(cfg: &Path, key: &str) -> Option<i64> {
    let s = std::fs::read_to_string(cfg).ok()?;
    s.lines().find_map(|line| line.trim().strip_prefix(key)?.strip_prefix(':').map(|r| r.trim().parse().ok()))?
}

/// `8sync harness global`: `thresholdPercent` 50 and `thresholdTokens` 200000, each only when the
/// key is absent (a user value is never overridden). The token limit wins over the percent: compaction
/// at 200K cut input-side tokens by 53 % on a replay of real Claude Code sessions (vs 650K).
pub(crate) fn ensure_defaults(home: &Path) -> Result<()> {
    let cfg = home.join(".omp/agent/config.yml");
    for (key, n) in [(PCT, 50), (TOKENS, 200_000)] {
        if current(&cfg, key).is_none() {
            set(&cfg, key, n)?;
            ui::ok(&format!("compaction.{key} = {n} (default) → {}", cfg.display()));
        }
    }
    Ok(())
}

/// Set `compaction.<key>` in config.yml. Updates the line in place if present (indentation
/// preserved), inserts under an existing `compaction:` block, or appends a fresh block.
/// omp normalizes config.yml, so a line-level edit is safe.
fn set(cfg: &Path, key: &str, n: u64) -> Result<()> {
    if let Some(p) = cfg.parent() {
        std::fs::create_dir_all(p)?;
    }
    let mut s = std::fs::read_to_string(cfg).unwrap_or_default();
    let is_key = |l: &str| l.trim().strip_prefix(key).is_some_and(|r| r.starts_with(':'));

    if s.lines().any(is_key) {
        s = s
            .lines()
            .map(|l| {
                if is_key(l) {
                    let indent: String = l.chars().take_while(|c| c.is_whitespace()).collect();
                    format!("{indent}{key}: {n}")
                } else {
                    l.to_string()
                }
            })
            .collect::<Vec<_>>()
            .join("\n");
    } else if s.lines().any(|l| l.starts_with("compaction:")) {
        s = s
            .lines()
            .map(|l| if l.starts_with("compaction:") { format!("{l}\n  {key}: {n}") } else { l.to_string() })
            .collect::<Vec<_>>()
            .join("\n");
    } else {
        if !s.is_empty() && !s.ends_with('\n') {
            s.push('\n');
        }
        s.push_str(&format!("\ncompaction:\n  {key}: {n}\n  idleEnabled: true\n"));
    }
    if !s.ends_with('\n') {
        s.push('\n');
    }
    std::fs::write(cfg, s)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn home(cfg: Option<&str>) -> std::path::PathBuf {
        static N: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let h = std::env::temp_dir().join(format!("omp-compaction-{}-{}", std::process::id(), N.fetch_add(1, std::sync::atomic::Ordering::SeqCst)));
        let _ = std::fs::remove_dir_all(&h);
        std::fs::create_dir_all(h.join(".omp/agent")).unwrap();
        if let Some(c) = cfg {
            std::fs::write(h.join(".omp/agent/config.yml"), c).unwrap();
        }
        h
    }

    #[test]
    fn seeds_tokens_when_unset_and_keeps_user_values() {
        let h = home(None);
        ensure_defaults(&h).unwrap();
        let cfg = h.join(".omp/agent/config.yml");
        assert_eq!((current(&cfg, PCT), current(&cfg, TOKENS)), (Some(50), Some(200_000)));
        let once = std::fs::read_to_string(&cfg).unwrap();
        ensure_defaults(&h).unwrap();
        assert_eq!(std::fs::read_to_string(&cfg).unwrap(), once, "idempotent");

        let h = home(Some("model: x\ncompaction:\n  thresholdPercent: 70\n  idleEnabled: true\n"));
        ensure_defaults(&h).unwrap();
        let cfg = h.join(".omp/agent/config.yml");
        assert_eq!(std::fs::read_to_string(&cfg).unwrap(), "model: x\ncompaction:\n  thresholdTokens: 200000\n  thresholdPercent: 70\n  idleEnabled: true\n");

        let h = home(Some("compaction:\n  thresholdTokens: 300000\n  thresholdPercent: 50\n"));
        ensure_defaults(&h).unwrap();
        let cfg = h.join(".omp/agent/config.yml");
        assert_eq!(std::fs::read_to_string(&cfg).unwrap(), "compaction:\n  thresholdTokens: 300000\n  thresholdPercent: 50\n");
        set(&cfg, PCT, 40).unwrap();
        assert_eq!((current(&cfg, PCT), current(&cfg, TOKENS)), (Some(40), Some(300_000)));
        let _ = std::fs::remove_dir_all(&h);
    }
}
