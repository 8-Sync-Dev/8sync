//! `8sync harness eval` — quality probe for the engineering loop. Runs a fixed
//! task-suite through omp non-interactively, scores each task with a
//! deterministic self-check (`verify.sh` owns the assertion so the agent can't
//! game it), and writes a JSON scorecard (+ optional baseline diff). Model +
//! network, non-deterministic — a periodic quality SIGNAL, not a CI gate.
use std::collections::BTreeSet;
use std::process::Command;
use std::time::Instant;

use anyhow::Result;
use serde::{Deserialize, Serialize};

use crate::assets;
use crate::{env_detect, ui};

/// Per-task omp wall-clock cap (seconds). A stuck task fails on its verifier.
const MAX_TIME_SECS: &str = "300";

#[derive(Serialize, Deserialize)]
struct TaskResult {
    name: String,
    pass: bool,
    secs: u64,
}

#[derive(Serialize, Deserialize)]
struct EvalReport {
    stamp: String,
    passed: usize,
    total: usize,
    results: Vec<TaskResult>,
}

/// Unique fixture names = first path segment under the embedded `eval/` tree.
fn fixture_names() -> Vec<String> {
    let mut set: BTreeSet<String> = BTreeSet::new();
    for p in assets::iter_under("eval/") {
        if let Some(rest) = p.strip_prefix("eval/") {
            if let Some(name) = rest.split('/').next() {
                if !name.is_empty() {
                    set.insert(name.to_string());
                }
            }
        }
    }
    set.into_iter().collect()
}

pub(crate) fn harness_eval(env: &env_detect::Env, baseline: bool) -> Result<()> {
    ui::header("8sync harness eval — loop quality probe");
    if which::which("omp").is_err() {
        ui::warn("omp not found — eval needs omp on PATH");
        return Ok(());
    }
    let names = fixture_names();
    if names.is_empty() {
        ui::warn("no eval fixtures bundled");
        return Ok(());
    }
    let cache = env.home.join(".cache/8sync/eval");
    ui::info(&format!(
        "running {} task(s) through omp (model + network; non-deterministic)…",
        names.len()
    ));
    println!();

    let mut results: Vec<TaskResult> = Vec::new();
    for name in &names {
        let dir = cache.join(name);
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir)?;
        // Materialise the fixture's setup/ tree into the run dir.
        assets::install_tree(&format!("eval/{}/setup", name), &dir)?;
        // verify.sh sits beside setup/ → drop it into the run dir (hidden).
        if let Some(v) = assets::read(&format!("eval/{}/verify.sh", name)) {
            let vp = dir.join(".eval-verify.sh");
            std::fs::write(&vp, v)?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = std::fs::set_permissions(&vp, std::fs::Permissions::from_mode(0o755));
            }
        }
        let task = assets::read(&format!("eval/{}/task.md", name)).unwrap_or_default();

        let t0 = Instant::now();
        let out = Command::new("omp")
            .args(["-p", "--no-session", "--auto-approve", "--max-time", MAX_TIME_SECS])
            .arg(&task)
            .current_dir(&dir)
            .output();
        let secs = t0.elapsed().as_secs();

        let pass = match out {
            Ok(o) => {
                let _ = std::fs::write(dir.join(".omp-out.txt"), &o.stdout);
                Command::new("sh")
                    .arg(".eval-verify.sh")
                    .arg(".omp-out.txt")
                    .current_dir(&dir)
                    .status()
                    .map(|s| s.success())
                    .unwrap_or(false)
            }
            Err(_) => false,
        };
        println!("   {} {:<22} {:>4}s", if pass { "✓" } else { "✗" }, name, secs);
        results.push(TaskResult { name: name.clone(), pass, secs });
    }

    let passed = results.iter().filter(|r| r.pass).count();
    let total = results.len();
    println!();
    let pct = if total > 0 { passed * 100 / total } else { 0 };
    ui::info(&format!("score: {}/{} passed ({}%)", passed, total, pct));

    let report = EvalReport { stamp: super::memory::now_stamp(), passed, total, results };
    let json = serde_json::to_string_pretty(&report).unwrap_or_default();

    // Scorecards live in the gitignored cache (machine-local + model-dependent;
    // not committed repo state). The baseline is the reference future runs diff.
    let out_dir = cache.clone();
    let _ = std::fs::create_dir_all(&out_dir);
    let run_path = out_dir.join(format!("eval-{}.json", report.stamp.replace(':', "-")));
    if std::fs::write(&run_path, &json).is_ok() {
        ui::ok(&format!("scorecard → {}", run_path.display()));
    }

    let baseline_path = out_dir.join("eval-baseline.json");
    if baseline {
        if std::fs::write(&baseline_path, &json).is_ok() {
            ui::ok(&format!("baseline saved → {}", baseline_path.display()));
        }
    } else if let Ok(prev) = std::fs::read_to_string(&baseline_path) {
        if let Ok(base) = serde_json::from_str::<EvalReport>(&prev) {
            let delta = passed as i64 - base.passed as i64;
            ui::info(&format!(
                "vs baseline ({}): {}/{} → {}/{} ({}{})",
                base.stamp,
                base.passed,
                base.total,
                passed,
                total,
                if delta >= 0 { "+" } else { "" },
                delta
            ));
        }
    }
    Ok(())
}

/// `8sync harness eval --project` — agent-team READINESS scorecard for the
/// current repo: per-role capability coverage (%), computed from real checks
/// (engines on PATH, skills present, memory spine, stack signals). This is
/// "what is the team equipped with HERE", NOT output quality — that is the
/// model+network `harness eval` loop probe. Honest + deterministic + offline.
#[derive(serde::Serialize)]
pub(crate) struct RoleScore {
    pub role: String,
    pub pct: usize,
    pub detail: Vec<String>,
}
#[derive(serde::Serialize)]
pub(crate) struct EvalData {
    pub overall: usize,
    pub total: usize,
    pub present: usize,
    pub roles: Vec<RoleScore>,
}

/// Compute the agent-team READINESS scorecard for the current repo (per-role
/// capability coverage %). Deterministic, offline. None if not in a project.
/// Shared by the CLI (`harness eval --project`) and the web dashboard `/api/eval`.
pub(crate) fn eval_project_data(home: &std::path::Path) -> Option<EvalData> {
    use crate::verbs::skill::discover::detect_current_project_root;
    let root = detect_current_project_root()?;
    let skill = |n: &str| home.join(".omp/skills").join(n).exists() || root.join("su-code/skills").join(n).exists();
    let bin = |n: &str| which::which(n).is_ok();
    let has = |p: &str| root.join(p).exists();
    let pkg = std::fs::read_to_string(root.join("package.json")).unwrap_or_default();
    let cfg = std::fs::read_to_string(home.join(".omp/agent/config.yml")).unwrap_or_default();
    // Planning/spec/API/docs/e2e skills come from the global Claude Code plugin `ecc@ecc`
    // (8sync no longer installs the addyosmani pack that used to cover them).
    let claude = std::env::var_os("CLAUDE_CONFIG_DIR").map(std::path::PathBuf::from).unwrap_or_else(|| home.join(".claude"));
    let ecc = std::fs::read_to_string(claude.join("settings.json"))
        .ok()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .is_some_and(|v| v["enabledPlugins"]["ecc@ecc"] == true);
    let dep = |k: &str| pkg.contains(k);
    let frontend = dep("react") || dep("vue") || dep("next") || dep("svelte") || dep("\"vite\"");
    let backend = dep("encore.dev") || dep("express") || dep("fastify") || dep("@nestjs")
        || has("Cargo.toml") || has("go.mod") || has("requirements.txt") || has("pyproject.toml");
    let build_cmd = pkg.contains("\"build\"") || has("Cargo.toml") || has("Makefile") || has("go.mod");
    let test_cmd = pkg.contains("\"test\"") || has("Cargo.toml") || pkg.contains("vitest") || pkg.contains("jest");
    let roles_raw: Vec<(&str, Vec<(&str, bool)>)> = vec![
        ("dev", vec![("trail", has(".trail/hook.cjs")), ("build", build_cmd), ("karpathy+ponytail", skill("karpathy-guidelines") && skill("ponytail"))]),
        ("qa/testing", vec![("test", test_cmd), ("full-flow", skill("full-flow")), ("ECC e2e/browser", ecc), ("headroom", bin("headroom"))]),
        ("research", vec![("omp/web_search", bin("omp")), ("agent-reach|deep-research-web", skill("agent-reach") || skill("deep-research-web")), ("last30days", skill("last30days"))]),
        ("ba/po", vec![("ECC planning/spec", ecc), ("STATE+DECISIONS", has("su-code/STATE.md") && has("su-code/DECISIONS.md"))]),
        ("fe", vec![("frontend-stack", frontend), ("impeccable+taste", skill("impeccable") && skill("taste-skill")), ("senior-frontend", skill("senior-frontend"))]),
        ("be", vec![("backend-stack", backend), ("ECC api-design", ecc), ("security", skill("senior-security"))]),
        ("docs", vec![("ECC docs", ecc), ("AGENTS.md", has("AGENTS.md")), ("CHANGELOG", has("CHANGELOG.md"))]),
        ("memory/learn", vec![("Mnemopi-ON", cfg.contains("backend: mnemopi")), ("KNOWLEDGE+PLAYBOOKS", has("su-code/KNOWLEDGE.md") && has("su-code/PLAYBOOKS.md"))]),
        ("token-opt", vec![("trail", bin("trail")), ("headroom", bin("headroom"))]),
    ];
    let mut roles_out = Vec::new();
    let (mut tp, mut tn) = (0usize, 0usize);
    for (role, checks) in &roles_raw {
        let p = checks.iter().filter(|(_, ok)| *ok).count();
        let n = checks.len();
        tp += p; tn += n;
        let pct = 100 * p / n;
        let detail: Vec<String> = checks.iter().map(|(l, ok)| format!("{}{}", if *ok { "✓" } else { "·" }, l)).collect();
        roles_out.push(RoleScore { role: role.to_string(), pct, detail });
    }
    let overall = if tn > 0 { 100 * tp / tn } else { 0 };
    Some(EvalData { overall, total: tn, present: tp, roles: roles_out })
}

/// `8sync harness eval --project` — print the readiness scorecard (CLI view).
pub(crate) fn harness_eval_project(env: &env_detect::Env) -> Result<()> {
    ui::header("8sync harness eval --project — agent-team readiness scorecard");
    let Some(data) = eval_project_data(&env.home) else {
        ui::warn("not inside a project — cd into a repo first");
        return Ok(());
    };
    ui::info("readiness = capabilities the team HAS here (not output quality — that's `harness eval`)");
    println!();
    for r in &data.roles {
        let line = format!("  {:<13} {:>3}%  {}", r.role, r.pct, r.detail.join("  "));
        if r.pct == 100 { ui::ok(&line); } else if r.pct >= 50 { ui::info(&line); } else { ui::warn(&line); }
    }
    println!();
    ui::info(&format!("OVERALL team readiness: {}%  ({}/{} capabilities present)", data.overall, data.present, data.total));
    ui::info("close gaps (·): `8sync harness` (engines+skills) · enable Mnemopi · add a stack skill · seed su-code/*");
    Ok(())
}
