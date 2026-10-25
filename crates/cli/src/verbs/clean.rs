// `8sync clean` — reclaim disk/RAM + report CPU/GPU on CachyOS.
//
// Philosophy (Karpathy: no cargo-cult): only do things that genuinely help and
// are safe to re-run. We do NOT force the CPU governor (amd-pstate `powersave`
// IS the efficient dynamic mode — forcing `performance` just burns watts/heat),
// we do NOT kill processes, and "free RAM" is opt-in + honest (the kernel
// reclaims pagecache on demand; dropping it is mostly cosmetic).
//
//   8sync clean              safe reclaim: native package cache, journal,
//                            tmpfiles, thumbnails  + CPU/GPU/RAM report
//   8sync clean --deep       + orphan pkgs, regenerable dev caches, tighter journal
//   8sync clean --ram        + drop pagecache (light, cosmetic) + report
//   8sync clean --gpu        + NVIDIA persistence mode on + GPU report
//   8sync clean --dry-run    print the plan, change nothing
//   8sync clean --watch [S]  run forever, cleaning every S seconds (default 3600)
//   8sync clean --timer 1h   install a systemd USER timer (1h | 30min | …)
//   8sync clean --timer off  remove the timer
//   8sync clean --dev        dev junk on every project + Docker + models list (every OS;
//                            the default off Linux) — see clean_dev.rs

use anyhow::Result;
use clap::Args as ClapArgs;
use std::process::Command;

use crate::{pkg, platform, ui};

#[derive(ClapArgs, Debug)]
#[command(
    after_help = indoc::indoc! {"
        EXAMPLES
          8sync clean                safe reclaim + CPU/GPU/RAM report
          8sync clean --deep         + orphan pkgs + build caches (go-build/tsc/node-gyp)
          8sync clean --ram          also drop pagecache (light RAM reclaim)
          8sync clean --gpu          NVIDIA persistence mode + GPU report
          8sync clean --dry-run      preview, change nothing
          8sync clean --watch        loop forever, clean every 1h (Ctrl-C stops)
          8sync clean --watch 1800   loop, clean every 30 min
          8sync clean --timer 1h     install systemd user timer (every 1h)
          8sync clean --timer off    remove the timer
          8sync clean --dev          dev junk of every project Claude Code worked in, Docker,
                                     tool caches, old temp files; lists AI models (every OS;
                                     what `8sync clean` does on Windows/macOS)
          8sync clean --dev --deep   + go build cache, pip cache
          8sync clean --dev --timer 24h        every day (Windows: Scheduled Task)
          8sync clean --forget hf:org/name     remove one listed model

        NEVER auto-deleted (only reported + manual reclaim hint): AI models
        (huggingface/torch), Playwright/Puppeteer/Cypress/Electron browser binaries,
        and package download caches (uv/pip/yarn/pnpm/deno). Routine clean won't
        break a project or force a big re-download.

        NOTE: the CPU governor is reported, never changed — on amd-pstate the
        `powersave` governor IS the efficient dynamic mode; forcing `performance`
        only raises power/heat with no real-world win for bursty desktop work.
    "}
)]
pub struct Args {
    /// Deep clean: orphan packages + pure build caches (go-build/tsc/node-gyp) +
    /// tighter journal vacuum. Does NOT touch models, browser binaries, or
    /// package download caches (those are only reported).
    #[arg(long)]
    pub deep: bool,

    /// Also drop pagecache (light, cosmetic — kernel reclaims on demand anyway).
    #[arg(long)]
    pub ram: bool,

    /// Enable NVIDIA persistence mode + print a GPU summary.
    #[arg(long)]
    pub gpu: bool,

    /// Print the plan without changing anything.
    #[arg(long = "dry-run")]
    pub dry_run: bool,

    /// Run forever, cleaning every N seconds (default 3600 when flag given alone).
    #[arg(long, value_name = "SECS", num_args = 0..=1, default_missing_value = "3600")]
    pub watch: Option<u64>,

    /// Install a systemd user timer (`1h`, `30min`, …) or remove it with `off`.
    #[arg(long, value_name = "DUR")]
    pub timer: Option<String>,

    /// Dev junk across every project Claude Code worked in, Docker, tool caches, old temp files;
    /// lists AI models and training output for the owner. Every OS; the default off Linux.
    #[arg(long)]
    pub dev: bool,

    /// Dev: a project's build output goes only after this many days without a commit or a
    /// Claude Code session there.
    #[arg(long, value_name = "DAYS", default_value_t = 14)]
    pub idle_days: u64,

    /// Dev: Docker images no container uses go when created this many days ago.
    #[arg(long, value_name = "DAYS", default_value_t = 30)]
    pub image_days: u64,

    /// Dev: also scan the git repos under this folder (repeatable).
    #[arg(long, value_name = "DIR")]
    pub root: Vec<std::path::PathBuf>,

    /// Remove one item the dev clean listed: `hf:org/name`, `ollama:name:tag`,
    /// `lmstudio:pub/name`, `torch:file`, or `docker-volumes` (repeatable).
    #[arg(long, value_name = "ID")]
    pub forget: Vec<String>,
}

/// The dev clean runs on `--dev`, on a `--forget`, and by default off Linux.
pub(crate) fn wants_dev(a: &Args, linux: bool) -> bool {
    a.dev || !a.forget.is_empty() || !linux
}

fn dev_opts(a: &Args) -> crate::verbs::clean_dev::Opts {
    crate::verbs::clean_dev::Opts {
        dry: a.dry_run,
        deep: a.deep,
        idle_days: a.idle_days,
        image_days: a.image_days,
        roots: a.root.clone(),
        forget: a.forget.clone(),
    }
}

pub fn run(a: Args) -> Result<()> {
    if let Some(spec) = a.timer.as_deref() {
        // Timer removal works anywhere; install too (harmless if clean is a
        // no-op on this OS). Only the reclaim body below is Linux-only.
        return manage_timer(spec, &timer_args(a.dev || !matches!(platform::os(), platform::Os::Linux), a.deep));
    }
    if wants_dev(&a, matches!(platform::os(), platform::Os::Linux)) {
        let o = dev_opts(&a);
        if let Some(secs) = a.watch.filter(|_| a.forget.is_empty()) {
            loop {
                crate::verbs::clean_dev::run(&o)?;
                std::thread::sleep(std::time::Duration::from_secs(secs.max(60)));
            }
        }
        return crate::verbs::clean_dev::run(&o);
    }
    if !platform::require_linux(
        "clean",
        "it reclaims package-manager/journal/tmpfiles + reports NVIDIA/amd-pstate",
    ) {
        return Ok(());
    }
    if let Some(secs) = a.watch {
        let secs = secs.max(60); // never busy-loop
        ui::header(&format!("8sync clean --watch ({}s interval)", secs));
        ui::info("Ctrl-C to stop. Each pass runs a safe clean.");
        loop {
            clean_once(&a);
            ui::step(&format!("sleeping {}s …", secs));
            std::thread::sleep(std::time::Duration::from_secs(secs));
        }
    }
    clean_once(&a);
    Ok(())
}

fn clean_once(a: &Args) {
    let dry = a.dry_run;
    ui::header(if a.deep { "8sync clean --deep" } else { "8sync clean" });

    let ram0 = mem_available_mb();
    let disk0 = root_avail_mb();

    // ── disk: native package manager caches ─────────────────────────
    // Family-gated inside `pkg`: pacman/paccache/paru on Arch, `dnf clean all`
    // on Fedora, a printed skip on anything else.
    pkg::clean_cache(dry);

    // ── disk: journal ───────────────────────────────────────────────
    ui::step("systemd journal vacuum");
    let vac = if a.deep { "--vacuum-size=100M" } else { "--vacuum-size=200M" };
    sudo_run(dry, &["journalctl", vac]);

    // ── disk: tmpfiles (ages out /tmp, /var/tmp per system rules) ───
    ui::step("tmpfiles clean (/tmp, /var/tmp)");
    sudo_run(dry, &["systemd-tmpfiles", "--clean"]);

    // ── disk: user caches ───────────────────────────────────────────
    ui::step("user caches (~/.cache)");
    // ONLY pure junk / build artifacts with ZERO downloads, binaries, or models.
    // Expensive caches (AI models, Playwright/Puppeteer browser binaries, package
    // download caches) are NEVER auto-deleted — they are reported with a manual
    // reclaim command instead. See report_caches(). This is deliberate: deleting
    // them doesn't corrupt anything but forces slow re-downloads / breaks test
    // runs until re-fetched, which is not what a routine `clean` should do.
    let mut safe = vec!["thumbnails"]; // image thumbnails — regenerated on view
    if a.deep {
        // Pure compiler/build artifacts: recompiled on next build, nothing fetched.
        safe.extend(["go-build", "typescript", "node-gyp"]);
    }
    clean_cache_subdirs(dry, &safe);
    report_caches();

    // ── disk: orphan packages (deep only) ───────────────────────────
    if a.deep {
        ui::step("orphan packages");
        pkg::remove_orphans(dry);
    }

    // ── RAM (opt-in, honest) ────────────────────────────────────────
    if a.ram {
        ui::step("RAM: drop pagecache (light)");
        if dry {
            ui::info("would: sync && echo 1 > /proc/sys/vm/drop_caches");
        } else {
            let _ = Command::new("sync").status();
            let st = Command::new("sudo")
                .args(["sh", "-c", "echo 1 > /proc/sys/vm/drop_caches"])
                .status();
            match st {
                Ok(s) if s.success() => ui::ok("pagecache dropped (kernel will refill on demand)"),
                _ => ui::warn("could not drop pagecache (sudo?)"),
            }
        }
    }

    // ── GPU (opt-in) ────────────────────────────────────────────────
    if a.gpu {
        gpu_optimize(dry);
    }

    // ── report ──────────────────────────────────────────────────────
    ui::step("system status");
    report_cpu();
    report_gpu_brief();
    report_mem();

    let ram1 = mem_available_mb();
    let disk1 = root_avail_mb();
    if !dry {
        if let (Some(d0), Some(d1)) = (disk0, disk1) {
            let freed = d1 as i64 - d0 as i64;
            ui::ok(&format!("disk freed on /: {}", human_mb_delta(freed)));
        }
        if let (Some(r0), Some(r1)) = (ram0, ram1) {
            let freed = r1 as i64 - r0 as i64;
            ui::info(&format!("RAM available change: {}", human_mb_delta(freed)));
        }
    }
}

// ── cache helpers ───────────────────────────────────────────────────

fn clean_cache_subdirs(dry: bool, names: &[&str]) {
    let Some(home) = dirs::home_dir() else { return };
    let cache = home.join(".cache");
    for n in names {
        let p = cache.join(n);
        if !p.exists() {
            continue;
        }
        if dry {
            ui::info(&format!("would: rm -rf {}", p.display()));
        } else if std::fs::remove_dir_all(&p).is_ok() {
            ui::ok(&format!("cleared ~/.cache/{}", n));
        }
    }
}

/// Report ~/.cache usage. Explicitly lists EXPENSIVE caches we never auto-delete
/// (models, browser binaries, package downloads) with the manual command to
/// reclaim each — so the user decides, and a routine clean never breaks a project.
fn report_caches() {
    let Some(home) = dirs::home_dir() else { return };
    let cache = home.join(".cache");

    // (subdir, what it is, manual reclaim command) — kept, NEVER auto-deleted.
    let kept: &[(&str, &str, &str)] = &[
        ("huggingface",   "AI models (HF)",        "huggingface-cli delete-cache  # or rm -rf ~/.cache/huggingface"),
        ("torch",         "PyTorch model cache",   "rm -rf ~/.cache/torch"),
        ("ms-playwright", "Playwright browsers",   "npx playwright uninstall --all"),
        ("puppeteer",     "Puppeteer Chromium",    "rm -rf ~/.cache/puppeteer"),
        ("Cypress",       "Cypress binary",        "cypress cache clear"),
        ("electron",      "Electron binaries",     "rm -rf ~/.cache/electron"),
        ("uv",            "uv wheel/download cache","uv cache clean"),
        ("pip",           "pip download cache",    "pip cache purge"),
        ("yarn",          "yarn package cache",    "yarn cache clean"),
        ("pnpm",          "pnpm store",            "pnpm store prune"),
        ("deno",          "deno dep cache",        "deno clean"),
    ];

    if let Ok(o) = Command::new("du").args(["-sh", "--"]).arg(&cache).output() {
        if let Some(sz) = String::from_utf8_lossy(&o.stdout).split_whitespace().next() {
            ui::info(&format!("~/.cache total: {}", sz));
        }
    }

    let mut any = false;
    for (sub, what, cmd) in kept {
        let p = cache.join(sub);
        if !p.exists() {
            continue;
        }
        let sz = Command::new("du").args(["-sh", "--"]).arg(&p).output().ok()
            .map(|o| String::from_utf8_lossy(&o.stdout).split_whitespace().next().unwrap_or("?").to_string())
            .unwrap_or_else(|| "?".into());
        if !any {
            ui::info("kept (NOT deleted — models/binaries/downloads; reclaim yourself if needed):");
            any = true;
        }
        ui::info(&format!("  ~/.cache/{:<13} {:>6}  {} → {}", sub, sz, what, cmd));
    }
}

// ── CPU / GPU / RAM reporting ───────────────────────────────────────

fn report_cpu() {
    let gov = std::fs::read_to_string("/sys/devices/system/cpu/cpu0/cpufreq/scaling_governor")
        .ok()
        .map(|s| s.trim().to_string());
    match gov {
        Some(g) => {
            let note = if g == "powersave" {
                " (amd-pstate dynamic — efficient; not changed)"
            } else {
                ""
            };
            ui::info(&format!("cpu governor: {}{}", g, note));
        }
        None => {}
    }
    // Load average.
    if let Ok(la) = std::fs::read_to_string("/proc/loadavg") {
        if let Some(part) = la.split_whitespace().take(3).collect::<Vec<_>>().get(..3) {
            ui::info(&format!("load avg: {}", part.join(" ")));
        }
    }
    // Top 3 CPU hogs.
    if let Ok(o) = Command::new("sh")
        .arg("-c")
        .arg("ps -eo pid,comm,%cpu --sort=-%cpu | head -4 | tail -3")
        .output()
    {
        let s = String::from_utf8_lossy(&o.stdout);
        for line in s.lines() {
            ui::info(&format!("  cpu: {}", line.trim()));
        }
    }
}

fn report_mem() {
    if let Ok(o) = Command::new("free").args(["-h"]).output() {
        let s = String::from_utf8_lossy(&o.stdout);
        for line in s.lines().take(3) {
            ui::info(&format!("  {}", line.trim_end()));
        }
    }
}

fn report_gpu_brief() {
    if which::which("nvidia-smi").is_err() {
        return;
    }
    let out = Command::new("nvidia-smi")
        .args([
            "--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu",
            "--format=csv,noheader",
        ])
        .output();
    if let Ok(o) = out {
        let s = String::from_utf8_lossy(&o.stdout);
        let line = s.trim();
        if !line.is_empty() {
            ui::info(&format!("gpu: {}", line));
        }
    }
}

fn gpu_optimize(dry: bool) {
    if which::which("nvidia-smi").is_err() {
        ui::skip("gpu", "no nvidia-smi");
        return;
    }
    ui::step("NVIDIA persistence mode");
    if dry {
        ui::info("would: sudo nvidia-smi -pm 1");
        return;
    }
    let st = Command::new("sudo").args(["nvidia-smi", "-pm", "1"]).status();
    match st {
        Ok(s) if s.success() => ui::ok("persistence mode ON (lower driver re-init latency)"),
        _ => ui::warn("could not set persistence mode (sudo?)"),
    }
}

// ── shell helpers ───────────────────────────────────────────────────

fn sudo_run(dry: bool, args: &[&str]) {
    if dry {
        ui::info(&format!("would: sudo {}", args.join(" ")));
        return;
    }
    ui::info(&format!("$ sudo {}", args.join(" ")));
    let _ = Command::new("sudo").args(args).status();
}

fn mem_available_mb() -> Option<u64> {
    let s = std::fs::read_to_string("/proc/meminfo").ok()?;
    for line in s.lines() {
        if let Some(rest) = line.strip_prefix("MemAvailable:") {
            let kb: u64 = rest.split_whitespace().next()?.parse().ok()?;
            return Some(kb / 1024);
        }
    }
    None
}

fn root_avail_mb() -> Option<u64> {
    let o = Command::new("df").args(["-BM", "--output=avail", "/"]).output().ok()?;
    let s = String::from_utf8_lossy(&o.stdout);
    let last = s.lines().nth(1)?.trim().trim_end_matches('M');
    last.parse().ok()
}

fn human_mb_delta(mb: i64) -> String {
    let sign = if mb >= 0 { "+" } else { "-" };
    let v = mb.unsigned_abs();
    if v >= 1024 {
        format!("{}{:.1} GB", sign, v as f64 / 1024.0)
    } else {
        format!("{}{} MB", sign, v)
    }
}

// ── periodic timer (systemd / launchd / schtasks via platform) ──────

/// What the timer runs: the dev clean where it is the point (Windows/macOS, or `--dev`).
pub(crate) fn timer_args(dev: bool, deep: bool) -> Vec<&'static str> {
    let mut v = vec!["clean"];
    if dev {
        v.push("--dev");
    }
    if deep {
        v.push("--deep");
    }
    v
}

fn manage_timer(spec: &str, args: &[&str]) -> Result<()> {
    if spec.eq_ignore_ascii_case("off") {
        ui::header("8sync clean --timer off");
        return platform::remove_timer("clean");
    }
    ui::header(&format!("8sync clean --timer {}", spec));
    platform::install_timer(&platform::TimerSpec {
        name: "clean",
        description: "8sync periodic clean",
        exec_args: args,
        workdir: None,
        every: spec,
        memory_bounded: false,
        timeout_secs: 300,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use clap::Parser;

    #[derive(Parser)]
    struct Cli {
        #[command(flatten)]
        a: Args,
    }

    fn args(v: &[&str]) -> Args {
        Cli::parse_from(std::iter::once("clean").chain(v.iter().copied())).a
    }

    #[test]
    fn dev_clean_is_the_default_off_linux_and_opt_in_on_linux() {
        assert!(wants_dev(&args(&[]), false), "Windows/macOS: `8sync clean` is the dev clean");
        assert!(!wants_dev(&args(&[]), true), "Linux keeps the system clean");
        assert!(wants_dev(&args(&["--dev"]), true));
        assert!(wants_dev(&args(&["--forget", "hf:a/b"]), true));
        let a = args(&["--dev", "--idle-days", "7", "--root", "C:/x", "--root", "D:/y"]);
        assert_eq!((a.idle_days, a.image_days, a.root.len()), (7, 30, 2));
    }

    #[test]
    fn the_timer_runs_the_dev_clean_where_it_matters() {
        assert_eq!(timer_args(true, false), ["clean", "--dev"]);
        assert_eq!(timer_args(true, true), ["clean", "--dev", "--deep"]);
        assert_eq!(timer_args(false, false), ["clean"]);
    }
}
