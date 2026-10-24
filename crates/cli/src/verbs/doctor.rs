use anyhow::Result;
use crate::{env_detect, pkg, ui, verbs::{profile, sec, bt, hz}};

pub fn run() -> Result<()> {
    ui::header("8sync doctor");
    let env = env_detect::Env::detect()?;
    crate::verbs::skill::deploy::migrate_namespace(&env.home);

    // Distro + resolved package backend. Deliberately a raw `println!`, not a
    // `ui::*` call: this line is the machine-checkable contract
    // `^distro: <id> \(<backend>\)$` that acceptance checks grep for, and every
    // ui:: helper prefixes a glyph that would break the anchor.
    println!(
        "distro: {} ({})",
        env.os_id,
        pkg::backend().map(|b| b.name()).unwrap_or("none")
    );
    if env_detect::is_hyde() {
        ui::ok("HyDE detected (Hyprland + wallbash theme engine)");
    }

    // AUR helper — an Arch-family concept, and pure noise everywhere else:
    // "AUR helper: none" on Fedora reads like a defect the user should fix.
    if env.family() == env_detect::Family::Arch {
        match env_detect::aur_helper() {
            Some(h) => ui::ok(&format!("AUR helper: {}", h)),
            None    => ui::info("AUR helper: none (paru or yay needed for AUR profiles: hardware-lianli, warp, ...)"),
        }
    }

    // Core harness
    check_cmd("git",     &["--version"]);
    check_cmd("omp",     &["--version"]);

    // gh is REQUIRED for `8sync ship`
    match env_detect::cmd_version("gh", &["--version"]) {
        Some(v) => ui::ok(&format!("gh: {}", v)),
        None    => ui::err("gh: MISSING — `8sync ship` needs github-cli (run `8sync setup`)"),
    }
    if let Some(out) = env_detect::cmd_version("gh", &["auth", "status"]) {
        ui::info(&format!("gh auth: {}", out));
    }

    // Terminal/editor stack — opt-in profile `terminal`, NOT part of the AI core.
    let term: Vec<&str> = ["kitty", "hx", "docker"]
        .into_iter()
        .filter(|c| which::which(c).is_ok())
        .collect();
    if term.is_empty() {
        ui::info("terminal stack (kitty/helix/docker): not installed — opt-in via `8sync setup --profile terminal` / dev-stack");
    } else {
        ui::ok(&format!("terminal stack: {}", term.join(", ")));
        let kitty_glass = env.xdg_config.join("kitty").join(format!("{}.conf", crate::brand::NS));
        if kitty_glass.exists() {
            ui::ok(&format!("kitty glass theme: {}", kitty_glass.display()));
        }
    }

    // AI engines — the token-optimization stack must be installed AND wired into
    // omp so the loop actually uses STEP 0 (else it silently falls back to grep).
    check_ai_engines(&env.home);

    // Configs present?
    for path in [
        env.xdg_config.join("8sync/global.toml"),
        env.xdg_config.join("8sync/skills.toml"),
        env.home.join(".omp/skills/00-force-load.md"),
    ] {
        if path.exists() {
            ui::ok(&format!("{}", path.display()));
        } else {
            ui::warn(&format!("missing: {}", path.display()));
        }
    }

    // Project portability: durable agent memory MUST be git-tracked so it
    // survives `git clone` to a new machine.
    check_portability();

    // Secret scanning for safe auto-commit (`harness up --commit`).
    if which::which("gitleaks").is_ok() {
        ui::ok("gitleaks present (`harness up --commit` scans staged memory before committing)");
    } else {
        ui::info("gitleaks not found — recommended for `harness up --commit` (pre-commit secret scan; GitGuardian 2026)");
    }

    // Anthropic's terms: a Claude subscription (OAuth, `sk-ant-oat…`) stays in
    // Claude Code / claude.ai; omp, Forge, Feynman need a Console API key.
    if which::which("omp").is_ok() {
        let token = std::process::Command::new("omp")
            .args(["token", "anthropic", "--raw"])
            .stdin(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .output()
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .unwrap_or_default();
        if token.starts_with("sk-ant-oat") {
            ui::warn("omp uses a Claude subscription login (OAuth) for `anthropic` — Anthropic's Usage Policy keeps subscriptions in Claude Code / claude.ai. Log out of anthropic in omp (`/logout`) and use a Console key (ANTHROPIC_API_KEY); for the subscription use `8sync ccc`.");
        } else if token.starts_with("sk-ant-") {
            ui::ok("omp anthropic: API key (Console)");
        }
    }

    // Fish PATH bootstrap (only relevant if fish is present)
    if which::which("fish").is_ok() {
        let fish_snippet = env.home.join(".config/fish/conf.d/8sync-path.fish");
        if fish_snippet.exists() {
            ui::ok(&format!("fish PATH bootstrap: {}", fish_snippet.display()));
        } else {
            ui::warn(&format!(
                "fish installed but missing {} — re-run `8sync setup`",
                fish_snippet.display()
            ));
        }
    }

    // Bluetooth (bluez) — compact status
    bt::status_quiet();

    // Display refresh — warns when the panel can beat what the driver offers
    hz::status_quiet();

    // Security (warp + ufw) — compact one-liners
    sec::status_quiet();

    // Profiles applied — self-heal stale entries (profile deleted from repo/override
    // since it was applied; state.applied is append-only otherwise, see profile.rs).
    if let Ok(all) = profile::load_all() {
        if let Ok(stale) = profile::prune_stale(&all) {
            for name in &stale {
                ui::warn(&format!(
                    "profile \"{}\" was applied but no longer exists — cleared from state",
                    name
                ));
            }
        }
        // Profiles whose package set has nothing installable on this distro
        // family are silent no-ops at apply time — surface them here instead.
        let fam_label = match env.family() {
            env_detect::Family::Fedora => "Fedora",
            env_detect::Family::Arch => "Arch",
            env_detect::Family::Other => "supported",
        };
        for name in profile::unsupported_on_family(&all, env.family()) {
            ui::warn(&format!("profile {} skipped: no {} packages", name, fam_label));
        }
    }
    let st = profile::load_state();
    if st.applied.is_empty() {
        ui::info("profiles: none applied (run `8sync setup`)");
    } else {
        ui::ok(&format!("profiles applied: {}", st.applied.join(", ")));
    }

    Ok(())
}

fn check_cmd(name: &str, args: &[&str]) {
    match env_detect::cmd_version(name, args) {
        Some(v) => ui::ok(&format!("{}: {}", name, v)),
        None => ui::warn(&format!("{}: missing", name)),
    }
}

/// Warn if any durable agent-memory file in the current project is gitignored
/// (learnings would be lost on a new machine). Silent when not in a project or
/// not a git repo.
fn check_portability() {
    let Some(root) = crate::verbs::skill::discover::detect_current_project_root() else {
        return;
    };
    let durable = [
        "AGENTS.md",
        "CHANGELOG.md",
        "su-code/PROJECT.md",
        "su-code/KNOWLEDGE.md",
        "su-code/DECISIONS.md",
        "su-code/STATE.md",
        "su-code/PREFERENCES.md",
        "su-code/NOTES.md",
    ];
    let mut present = false;
    let mut ignored_any = false;
    for rel in durable {
        if !root.join(rel).exists() {
            continue;
        }
        present = true;
        // `git check-ignore -q` exits 0 only when the path IS ignored.
        let ignored = std::process::Command::new("git")
            .arg("-C")
            .arg(&root)
            .args(["check-ignore", "-q", rel])
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        if ignored {
            ignored_any = true;
            ui::err(&format!(
                "MEMORY IGNORED: {} is gitignored — learnings won't persist or move to a new machine; remove it from .gitignore",
                rel
            ));
        }
    }
    if present && !ignored_any {
        ui::ok("project memory is git-tracked (portable)");
    }
    // Named sessions (cwd-scoped): surface count + any dirty worktree.
    if let Ok(env) = crate::env_detect::Env::detect() {
        if let Some((total, wt, dirty)) = crate::verbs::session::health(&env, &root) {
            let msg = format!("sessions (this repo): {total} · {wt} worktree(s) · {dirty} dirty");
            if dirty > 0 {
                ui::warn(&msg);
            } else {
                ui::ok(&msg);
            }
        }
    }
    // Context budget: the injected force-load block must stay lean (Gloaguen
    // 2026, arXiv 2602.11988 — bloated/auto context cuts success + ~20% cost).
    if let Ok(s) = std::fs::read_to_string(root.join("AGENTS.md")) {
        let (sb, se) = (crate::brand::sentinel_begin(), crate::brand::sentinel_end());
        if let (Some(b), Some(e)) = (
            s.find(sb.as_str()).or_else(|| s.find(crate::brand::LEGACY_SENTINEL_BEGIN)),
            s.find(se.as_str()).or_else(|| s.find(crate::brand::LEGACY_SENTINEL_END)),
        ) {
            if b < e {
                let lines = s[b..e].lines().count();
                if lines > 120 {
                    ui::warn(&format!(
                        "AGENTS.md force-load block is {} lines (>120) — trim on-demand entries; rely on progressive disclosure",
                        lines
                    ));
                }
            }
        }
    }
    // Doc-hygiene summary: stale path refs / oversized docs to fix or delete
    // (full report: `8sync harness audit`).
    let (stale, oversized) = crate::verbs::harness::audit::stale_summary(&root);
    if stale > 0 || oversized > 0 {
        ui::warn(&format!(
            "docs: {} stale path(s) / {} oversized — run `8sync harness audit`",
            stale, oversized
        ));
    }
}

/// Verify the token-optimization stack is installed AND registered with omp so
/// the loop actually uses it ("luôn xài"): trail (code map) + the omp MCP
/// engine headroom (output compression). A missing or unregistered engine silently defeats STEP 0 token
/// discipline — flag it with the one-command fix.
fn check_ai_engines(home: &std::path::Path) {
    ui::info("AI engines (token-optimization stack — STEP 0):");
    if which::which("trail").is_ok() {
        let ver = env_detect::cmd_version("trail", &["--version"]).unwrap_or_default();
        ui::ok(&format!("  trail {} (code map: ask/grep/skeleton/callers)", ver.trim()));
    } else {
        ui::warn("  trail MISSING — run `8sync trail` (STEP 0 falls back to slow grep/read)");
    }
    let mcp = std::fs::read_to_string(home.join(".omp/agent/mcp.json")).unwrap_or_default();
    for (bin, what) in [("headroom", "output compression (>50-line dumps)")] {
        let has_bin = which::which(bin).is_ok();
        let registered = mcp.contains(&format!("\"{}\"", bin));
        if has_bin && registered {
            ui::ok(&format!("  {} present + registered — {}", bin, what));
        } else if has_bin {
            ui::warn(&format!("  {} installed but NOT in ~/.omp/agent/mcp.json — run `8sync harness`, then `/mcp reload`", bin));
        } else {
            ui::warn(&format!("  {} MISSING — run `8sync harness` (auto-installs + registers)", bin));
        }
    }
    // Z.AI vision MCP — fallback for text-only GLM-5.2. GLM-5.3 reads images natively.
    let zai_registered = mcp.contains("\"zai-vision\"");
    let zai_bin = which::which("zai-mcp-server").is_ok() || which::which("bunx").is_ok();
    if zai_bin && zai_registered {
        ui::ok("  zai-vision MCP ON — fallback for text-only GLM-5.2 only; GLM-5.3 / 5.3-Flash read images natively (do not route through this MCP)");
    } else {
        ui::warn("  zai-vision MCP OFF — fallback for GLM-5.2; GLM-5.3 already sees images (`8sync harness` installs the sidecar if needed)");
    }
    let cfg = std::fs::read_to_string(home.join(".omp/agent/config.yml")).unwrap_or_default();
    if cfg.contains("backend: mnemopi") {
        ui::ok("  mnemopi memory ON — recall/retain across sessions (`/memory view`)");
    } else {
        ui::warn("  mnemopi memory OFF — `8sync harness` enables deep project recall (API-only)");
    }
    if env_detect::omp_major().is_some_and(|m| m >= 17) {
        ui::ok("  STEP-0 MCP tools mounted as xd:// devices (omp ≥17 tools.xdev) — headroom/zai callable");
    } else if cfg.contains("discoveryDefaultServers") {
        ui::ok("  STEP-0 MCP servers always visible (mcp.discoveryDefaultServers)");
    } else {
        ui::warn("  MCP tools HIDDEN behind search_tool_bm25 (fix: run `8sync harness global`) — headroom never gets called");
    }
    // STEP-0 is a deny-list overlay (`grep.enabled`/`glob.enabled` = false), so
    // it cannot rot into an unlaunchable state the way the old `--tools`
    // allowlist did. It can still stop BITING if omp renames those keys, and
    // that failure is silent — so ask omp whether the two names really are gone.
    match crate::models::step0_effective() {
        Some(true) => ui::ok("  STEP-0 in force: omp rejects grep/glob (code lookup → trail)"),
        Some(false) => ui::warn(
            "  STEP-0 NOT in force: omp still offers grep/glob — the `grep.enabled`/`glob.enabled` keys changed. Fix STEP0_OVERLAY in models.rs",
        ),
        None => {}
    }
    let hook = home.join(".omp/hooks/pre").join(crate::brand::ns_file("recall.ts")).exists();
    if hook && cfg.contains("thresholdPercent: 50") {
        ui::ok("  anti-forget: recall hook + compaction@50% ON");
    } else {
        ui::warn("  anti-forget OFF — run `8sync harness` (recall hook + compact@50%)");
    }
    let caps = home.join(".omp/capabilities.md");
    if caps.exists() {
        ui::ok("  omp capabilities snapshot present — advisor/inspect_image/vision surface captured (`~/.omp/capabilities.md`)");
    } else {
        ui::info("  omp capabilities snapshot: run `8sync harness` to capture omp's live surface");
    }
    let reg = crate::brand::config_dir(home).join("local-models.tsv");
    if let Ok(raw) = std::fs::read_to_string(&reg) {
        let n = raw.lines().filter(|l| !l.trim().is_empty()).count();
        if n > 0 {
            ui::ok(&format!(
                "  local GGUF models: {} registered (mistral.rs → omp) — `8sync harness add-local-model list`",
                n
            ));
        }
    }
}
