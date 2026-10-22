use anyhow::{Context, Result};
use clap::Args as ClapArgs;
use std::path::PathBuf;
use std::process::Command;
use std::time::{Duration, Instant};

use crate::ui;

#[derive(ClapArgs, Debug)]
#[command(after_help = indoc::indoc! {"
    EXAMPLES
      8sync shot http://localhost:3000/dashboard
      8sync shot 'http://127.0.0.1:8731/codegraph?shot=1' -o /tmp/cg.png   # ?shot=1 = graph canvas only
      8sync shot http://localhost:5173/login -o /tmp/login.png
      8sync shot ./docs/index.html
      8sync shot <url> --width 1400 --height 2200 --wait 4000

    USE CASE
      Render a URL or local HTML file to PNG so a VISION-capable model (Opus-class)
      can read it as ONE image instead of parsing the DOM/text. Anthropic bills
      ceil(w/28)*ceil(h/28) vision tokens (28x28 patch, pay-per-pixel; Opus 4.7+
      dropped the cheap-resize cap). Image WINS for STRUCTURE — a graph/dashboard/
      diagram carries spatial relations that cost far more as text (a 12k-edge graph
      ~25x). It LOSES for prose/code — plain text is cheaper AND lossless. See the
      image-routing skill for the decision table (and the DeepSeek-OCR caveat: the
      10x/90% figure needs a dedicated encoder, not a screenshot).

    REQUIREMENTS
      · a headless Chromium: system `chromium` (pacman -S chromium), else omp's
        bundled copy (~/.omp/puppeteer/chrome/<ver>/chrome-linux64/chrome).
"})]
pub struct Args {
    /// URL (http/https/file) or local HTML file to render.
    pub target: String,
    /// Output PNG path.
    #[arg(short, long, default_value = "/tmp/8sync-shot.png")]
    pub output: String,
    /// Viewport width in px.
    #[arg(long, default_value_t = 1280)]
    pub width: u32,
    /// Viewport height in px (taller = more content in one image).
    #[arg(long, default_value_t = 1600)]
    pub height: u32,
    /// Milliseconds to let JS/SPA render before capturing.
    #[arg(long, default_value_t = 3000)]
    pub wait: u32,
}

/// Locate a headless-capable Chromium: system install first, then omp's bundled
/// copy under `~/.omp/puppeteer/chrome/<version>/chrome-linux64/chrome`.
fn find_chromium() -> Option<PathBuf> {
    for bin in [
        "chromium",
        "chromium-browser",
        "google-chrome-stable",
        "google-chrome",
        "chrome",
    ] {
        if let Ok(p) = which::which(bin) {
            return Some(unshim(p));
        }
    }
    let base = dirs::home_dir()?.join(".omp/puppeteer/chrome");
    for entry in std::fs::read_dir(&base).ok()?.flatten() {
        let cand = entry.path().join("chrome-linux64/chrome");
        if cand.is_file() {
            return Some(cand);
        }
    }
    None
}

/// The program behind a scoop shim (`chromium.exe` + `chromium.shim`: `path = "…\chrome.exe"`). The
/// shim also adds scoop's shared `--user-data-dir`, which Chromium takes over a later one, so a
/// second shot exited 21 (profile in use) while another ran (3d-game QA, 2026-10-20).
fn unshim(p: PathBuf) -> PathBuf {
    let real = std::fs::read_to_string(p.with_extension("shim")).ok().and_then(|s| {
        s.lines()
            .find_map(|l| l.trim().strip_prefix("path").map(|r| r.trim_start().trim_start_matches('=').trim().trim_matches('"').to_string()))
            .map(PathBuf::from)
            .filter(|r| r.is_file())
    });
    real.unwrap_or(p)
}

pub fn run(a: Args) -> Result<()> {
    let Some(chrome) = find_chromium() else {
        ui::err(
            "no Chromium found — install `chromium` (pacman -S chromium), \
             or run `8sync setup` so omp's bundled copy is present",
        );
        return Ok(());
    };

    // http/https/file pass through; a bare local path becomes a file:// URL.
    let target = if a.target.starts_with("http://")
        || a.target.starts_with("https://")
        || a.target.starts_with("file://")
    {
        a.target.clone()
    } else {
        let abs = std::fs::canonicalize(&a.target)
            .with_context(|| format!("local target not found: {}", a.target))?;
        format!("file://{}", abs.display())
    };

    ui::info(&format!(
        "shot {} → {} ({}×{})",
        a.target, a.output, a.width, a.height
    ));
    // No `--disable-gpu`: it put WebGL on WARP/SwiftShader, so a 3D game page burned ~14 of 32
    // threads for minutes per shot (3d-game QA, 2026-10-20). Measured on the same box, a WebGL
    // shader page: 28 CPU-s with the flag, 3.6 CPU-s without.
    // Its own profile: a second shot on a shared one (scoop's shim passes one) hands its job to the
    // Chromium already running and exits without a PNG, so two rooms could not shoot at once. A
    // `--user-data-dir` given later on the command line wins over the shim's.
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.subsec_nanos());
    let profile = std::env::temp_dir().join(format!("8sync-shot-{}-{nanos}", std::process::id()));
    // Shots whose 8sync died mid-render leave Chromium burning GPU (see [`sweep_zombies`]).
    sweep_zombies(&profile);
    let mut cmd = low_priority(&chrome);
    cmd.args([
        "--headless".into(),
        "--no-sandbox".into(),
        "--hide-scrollbars".into(),
        "--no-first-run".into(),
        format!("--user-data-dir={}", profile.display()),
        format!("--screenshot={}", a.output),
        format!("--window-size={},{}", a.width, a.height),
        format!("--virtual-time-budget={}", a.wait),
        target,
    ]);
    let mut child = cmd.spawn().context("failed to launch Chromium")?;
    // A page that never settles must not keep Chromium busy: the render budget plus a minute.
    let end = Instant::now() + Duration::from_millis(u64::from(a.wait)) + Duration::from_secs(60);
    let status = loop {
        if let Some(s) = child.try_wait()? {
            break Some(s);
        }
        if Instant::now() >= end {
            kill_tree(&mut child);
            break None;
        }
        std::thread::sleep(Duration::from_millis(100));
    };
    match status {
        Some(s) if !s.success() => ui::warn("Chromium exited non-zero — screenshot may be incomplete"),
        None => ui::warn(&format!("Chromium did not finish within --wait + 60 s: killed (target {})", a.output)),
        _ => {}
    }
    // Helpers that outlived the browser (or an 8sync killed mid-render) must not keep rendering.
    sweep_zombies(&profile);
    // Chromium's helpers may hold the profile a moment after the browser exits.
    for _ in 0..10 {
        if std::fs::remove_dir_all(&profile).is_ok() || !profile.exists() {
            break;
        }
        std::thread::sleep(Duration::from_millis(300));
    }

    match std::fs::metadata(&a.output) {
        Ok(m) if m.len() > 0 => {
            // Anthropic vision cost = ceil(w/28)*ceil(h/28) tokens (28x28 patch,
            // pay-per-pixel; Opus 4.7+ dropped the ~1.15 MP cheap-resize cap).
            let est = a.width.div_ceil(28) as u64 * a.height.div_ceil(28) as u64;
            ui::ok(&format!(
                "wrote {} ({} KB, ~{} vision tokens)",
                a.output,
                m.len() / 1024,
                est
            ));
        }
        _ => ui::err("screenshot not produced — does the target render headless?"),
    }
    Ok(())
}

/// Chromium below normal priority, so a heavy page never starves the rooms and the desktop.
/// Windows: its children (GPU, renderer) inherit the class; elsewhere: `nice -n 10` when present.
fn low_priority(chrome: &std::path::Path) -> Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const BELOW_NORMAL_PRIORITY_CLASS: u32 = 0x0000_4000;
        let mut c = Command::new(chrome);
        c.creation_flags(BELOW_NORMAL_PRIORITY_CLASS);
        c
    }
    #[cfg(not(windows))]
    match which::which("nice") {
        Ok(nice) => {
            let mut c = Command::new(nice);
            c.args(["-n", "10"]).arg(chrome);
            c
        }
        Err(_) => Command::new(chrome),
    }
}

/// Kill Chromium with its helper processes (GPU, renderers), so none keeps rendering.
fn kill_tree(child: &mut std::process::Child) {
    #[cfg(windows)]
    {
        let _ = Command::new("taskkill")
            .args(["/T", "/F", "/PID", &child.id().to_string()])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();
    }
    let _ = child.kill();
    let _ = child.wait();
}

/// The marker every shot's throwaway profile carries (`--user-data-dir=…8sync-shot-…`).
const SHOT_MARK: &str = "8sync-shot-";

/// Kill Chromium processes left over from earlier shots whose `8sync` died mid-render (the auto
/// guard pausing a room kills the room's shell tree; Chromium's children survive it and a stuck one
/// burned ~20% GPU for hours, 2026-10-22). Ours (`keep`) is spared. Best effort, never fails a shot.
fn sweep_zombies(_keep: &std::path::Path) {
    // Only true orphans: a marker Chromium whose parent pid is gone (the `8sync shot` that spawned
    // it died — e.g. the RAM guard paused the room mid-render). A LIVE shot's Chromium keeps its
    // parent chain, so concurrent shots (two rooms shooting at once, 2026-10-22) never kill each
    // other — the v0.110.64 sweep matched every marker and did exactly that.
    #[cfg(windows)]
    {
        let script = format!(
            "$p = Get-CimInstance Win32_Process; $alive = @({{ }} + $p.ProcessId); $p | Where-Object {{ $_.Name -eq 'chrome.exe' -and $_.CommandLine -like '*{SHOT_MARK}*' -and -not $alive.Contains($_.ParentProcessId) }} | ForEach-Object {{ Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }}"
        );
        let _ = Command::new("powershell")
            .args(["-NoProfile", "-Command", &script])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();
    }
    #[cfg(not(windows))]
    {
        // Kill a marker Chromium only when its parent pid is gone (a live shot keeps its parent
        // chain; concurrent shots never touch each other).
        let _ = Command::new("sh")
            .arg("-c")
            .arg(format!("ps -eo pid=,ppid=,args= | grep '[c]hrome.*{SHOT_MARK}' | while read pid ppid rest; do kill -0 \"$ppid\" 2>/dev/null || kill \"$pid\" 2>/dev/null || true; done"))
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_scoop_shim_resolves_to_the_program_it_wraps() {
        let d = std::env::temp_dir().join(format!("8sync-unshim-{}", std::process::id()));
        std::fs::create_dir_all(d.join("app")).unwrap();
        let real = d.join("app").join("chrome.exe");
        std::fs::write(&real, b"").unwrap();
        let shim = d.join("chromium.exe");
        std::fs::write(d.join("chromium.shim"), format!("path = \"{}\"\nargs = --user-data-dir=\"x\"\n", real.display())).unwrap();
        assert_eq!(unshim(shim.clone()), real);
        // no shim file, or one naming a missing program: the binary found on PATH stays
        assert_eq!(unshim(d.join("chrome.exe")), d.join("chrome.exe"));
        std::fs::write(d.join("chromium.shim"), "path = \"C:\\nope\\chrome.exe\"\n").unwrap();
        assert_eq!(unshim(shim.clone()), shim);
        let _ = std::fs::remove_dir_all(&d);
    }
}
