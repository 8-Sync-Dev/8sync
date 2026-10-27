//! `8sync harness browser [fix|status|off]` — make omp's Puppeteer browser
//! control actually reach the internet by pointing it at a real system Chromium
//! (ungoogled-chromium) instead of the bundled `chrome-headless-shell`, which on
//! some setups renders but fails to load pages / reach the network.
//!
//! omp runs under Bun and honors `PUPPETEER_EXECUTABLE_PATH` / `BUN_CHROME_PATH`
//! for the browser binary (with `--no-sandbox`). `fix` (default) ensures a
//! system Chromium is installed (`ungoogled-chromium-bin` on Arch, `chromium`
//! on Fedora) and exports those vars in zsh/bash/fish so EVERY omp launch —
//! direct or via `8sync .`/`8sync ai` — uses it. Idempotent;
//! `off` reverts to omp's bundled chromium, `status` shows the current wiring.
//! `ego [install|status]` installs the official ego lite browser instead (see `ego.rs`).
use anyhow::{anyhow, Result};
use std::path::{Path, PathBuf};

use crate::{env_detect, pkg, ui};

/// Sentinel bounds for the managed export block in zsh/bash rc files.
const BLOCK_BEGIN: &str = "# >>> 8sync:browser >>>";
const BLOCK_END: &str = "# <<< 8sync:browser <<<";

pub(crate) fn harness_browser(env: &env_detect::Env, args: &[String]) -> Result<()> {
    match args.first().map(String::as_str) {
        Some("status") => {
            status();
            Ok(())
        }
        Some("off") | Some("unset") | Some("revert") => unset(),
        Some("ego") => super::ego::harness_ego(&args[1..]),
        _ => fix(env),
    }
}

/// Preferred system Chromium on PATH (both `ungoogled-chromium-bin` on Arch and
/// Fedora's `chromium` install the `chromium` binary).
fn find_chromium() -> Option<PathBuf> {
    for c in ["chromium", "chromium-browser", "google-chrome-stable", "google-chrome", "brave"] {
        if let Ok(p) = which::which(c) {
            return Some(p);
        }
    }
    None
}

/// Install a system Chromium using whatever this distro actually ships:
/// `ungoogled-chromium-bin` on the Arch family (CachyOS repo, else AUR), plain
/// `chromium` from the official repo on Fedora. Any other distro gets an
/// actionable skip instead of a `pacman` that does not exist there.
fn install_chromium(env: &env_detect::Env) -> Result<()> {
    match env.family() {
        env_detect::Family::Arch => {
            ui::step("install ungoogled-chromium-bin");
            // cachyos ships it in-repo (pacman); plain Arch has it in the AUR.
            if pkg::install("ungoogled-chromium-bin", &["ungoogled-chromium-bin"], true).is_err() {
                match env_detect::aur_helper() {
                    Some(h) => {
                        let _ = pkg::aur_install_safe(h, &["ungoogled-chromium-bin"], true);
                    }
                    None => ui::warn("no AUR helper (paru/yay) — install ungoogled-chromium-bin manually"),
                }
            }
        }
        // Fedora has no ungoogled build, but `chromium` in the official repo is
        // the same engine — all Puppeteer needs is a real Chromium binary.
        env_detect::Family::Fedora => {
            ui::step("install chromium (Fedora repo)");
            pkg::install("chromium", &["chromium"], true)?;
        }
        env_detect::Family::Other => ui::warn(&format!(
            "no supported package manager on `{}` — install a Chromium (e.g. `chromium`) with your package manager, then re-run",
            env.os_id
        )),
    }
    Ok(())
}

fn fix(env: &env_detect::Env) -> Result<()> {
    ui::header("8sync harness browser — point omp at system Chromium");

    // 1. Ensure a system Chromium exists (install the distro's build if none).
    let path = match find_chromium() {
        Some(p) => {
            ui::skip("chromium", &format!("present → {}", p.display()));
            p
        }
        None => {
            install_chromium(env)?;
            find_chromium().ok_or_else(|| {
                anyhow!("still no Chromium on PATH — install one (chromium / ungoogled-chromium / google-chrome), then re-run `8sync harness browser fix`")
            })?
        }
    };

    // 2. Export the executable path so omp (Bun/Puppeteer) uses it everywhere.
    write_shell_env(&path)?;

    ui::ok(&format!("omp browser → {}", path.display()));
    ui::info("exported PUPPETEER_EXECUTABLE_PATH + BUN_CHROME_PATH in zsh/bash/fish.");
    ui::info("open a NEW shell (or `source ~/.zshrc`) so the next omp launch sees it.");
    ui::info("verify: 8sync harness browser status  ·  revert: 8sync harness browser off");
    Ok(())
}

/// Append (or refresh) the managed `export` block in zsh/bash + a fish conf.d
/// snippet, so any shell that launches omp hands it the system Chromium path.
fn write_shell_env(chromium: &Path) -> Result<()> {
    let Some(home) = dirs::home_dir() else {
        return Ok(());
    };
    let cp = chromium.display();
    let block = format!(
        "{BLOCK_BEGIN}\n\
         # omp browser → system chromium (managed by `8sync harness browser`; edit via that command)\n\
         export PUPPETEER_EXECUTABLE_PATH=\"{cp}\"\n\
         export BUN_CHROME_PATH=\"{cp}\"\n\
         {BLOCK_END}\n"
    );
    for rc in [home.join(".zshrc"), home.join(".bashrc")] {
        if !rc.exists() {
            continue;
        }
        let existing = std::fs::read_to_string(&rc).unwrap_or_default();
        let mut out = strip_block(&existing).trim_end().to_string();
        out.push_str("\n\n");
        out.push_str(&block);
        if out != existing {
            std::fs::write(&rc, &out)?;
            ui::ok(&format!("patched {}", rc.display()));
        } else {
            ui::skip(&rc.display().to_string(), "unchanged");
        }
    }

    // fish — regenerated snippet under conf.d (sourced every interactive session).
    let fish_dir = home.join(".config/fish/conf.d");
    if std::fs::create_dir_all(&fish_dir).is_ok() {
        let fish_file = fish_dir.join("8sync-browser.fish");
        let fish_body = format!(
            "# 8sync: omp browser → system chromium. Regenerated by `8sync harness browser`.\n\
             set -gx PUPPETEER_EXECUTABLE_PATH \"{cp}\"\n\
             set -gx BUN_CHROME_PATH \"{cp}\"\n"
        );
        if std::fs::read_to_string(&fish_file).ok().as_deref() != Some(fish_body.as_str()) {
            let _ = std::fs::write(&fish_file, &fish_body);
            ui::ok(&format!("wrote {}", fish_file.display()));
        }
    }
    Ok(())
}

fn unset() -> Result<()> {
    ui::header("8sync harness browser off — revert to omp's bundled chromium");
    let Some(home) = dirs::home_dir() else {
        return Ok(());
    };
    for rc in [home.join(".zshrc"), home.join(".bashrc")] {
        if !rc.exists() {
            continue;
        }
        let existing = std::fs::read_to_string(&rc).unwrap_or_default();
        let stripped = strip_block(&existing);
        if stripped != existing {
            std::fs::write(&rc, stripped.trim_end().to_string() + "\n")?;
            ui::ok(&format!("cleaned {}", rc.display()));
        }
    }
    let fish_file = home.join(".config/fish/conf.d/8sync-browser.fish");
    if fish_file.exists() {
        let _ = std::fs::remove_file(&fish_file);
        ui::ok("removed fish snippet");
    }
    ui::info("open a new shell — omp falls back to its bundled chrome-headless-shell.");
    Ok(())
}

fn status() {
    ui::header("8sync harness browser — status");
    match find_chromium() {
        Some(p) => ui::ok(&format!("system chromium: {}", p.display())),
        None => ui::warn("no system chromium on PATH (install ungoogled-chromium-bin)"),
    }
    for v in ["PUPPETEER_EXECUTABLE_PATH", "BUN_CHROME_PATH"] {
        match std::env::var(v) {
            Ok(val) if !val.is_empty() => ui::ok(&format!("{v} = {val}")),
            _ => ui::info(&format!("{v} not set in THIS shell — run `8sync harness browser` then open a new shell")),
        }
    }
    if let Some(home) = dirs::home_dir() {
        let bundled = home.join(".omp/puppeteer");
        if bundled.exists() {
            ui::info(&format!("omp bundled chromium at {} (used only when the vars above are unset)", bundled.display()));
        }
    }
    ui::info("fix: 8sync harness browser   ·   revert: 8sync harness browser off");
}

/// Remove the managed sentinel block (BEGIN..=END inclusive) from an rc body.
fn strip_block(s: &str) -> String {
    let mut out = String::new();
    let mut skip = false;
    for line in s.lines() {
        let t = line.trim();
        if t == BLOCK_BEGIN {
            skip = true;
            continue;
        }
        if t == BLOCK_END {
            skip = false;
            continue;
        }
        if !skip {
            out.push_str(line);
            out.push('\n');
        }
    }
    out
}
