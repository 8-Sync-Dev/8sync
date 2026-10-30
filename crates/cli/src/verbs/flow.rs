use anyhow::Result;
use owo_colors::OwoColorize;

pub fn run() -> Result<()> {
    println!("{}\n", crate::brand::render("8sync flow — commands in the order you'll actually use them").bold().cyan());

    section("1. FIRST-TIME INSTALL (new machine)", &[
        ("curl -fsSL https://raw.githubusercontent.com/8-Sync-Dev/8sync/main/install.sh | sh", "download the prebuilt binary into ~/.local/bin (no git/rust needed)"),
        ("8sync setup", "harness (gh + omp + skills + PATH bootstrap) then curated y/N menu (community profiles)"),
        ("# or  8sync setup --community", "unattended: dev-stack + bluetooth"),
        ("# or  8sync setup --profile dev-stack", "just dev-stack (Docker + Node/Bun + Encore)"),
        ("gh auth login", "log into GitHub (required by `8sync ship`)"),
        ("8sync doctor", "verify everything is in place"),
    ]);

    section("1b. AI TEAM — harness + /auto (the autonomous engine)", &[
        ("8sync harness", "(bare) ONE idempotent command: skills + memory loop + /auto + trail + MCP (headroom)"),
        ("8sync . then /auto <goal>", "in omp: research → plan → slices/tasks → verify each → QA/closeout → done"),
        ("/auto status | resume", "report · continue the saved plan to Definition-of-Done"),
        ("8sync harness audit|bench|eval", "doc-hygiene · token budget · loop-quality probe"),
        ("8sync trail [dir|--all ROOT]",   "STEP 0 code map: install trail-code, telemetry off, wire repo(s); `trail ask` before grep"),
        ("8sync harness web",              "(bare) local dashboard — manage skills/memory/engines/team/submodules"),
        ("8sync feature new <slug>",       "large multi-phase scope (GSD): planning tree + AC gates; then /feature plan|go|ship in omp"),
    ]);

    section("2. VIBE LOOP — open a project, code with AI, ship a PR", &[
        ("cd ~/code/my-app", ""),
        ("8sync .", "seed su-code/* memory + run `omp --continue` (omp manages its own session)"),
        ("8sync ai \"explain this codebase\"", "AI reads AGENTS.md + su-code/* automatically for memory"),
        ("8sync ai \"add login form with email + password\"", "vibe code — omp edits files directly"),
        ("8sync run dev", "start the dev server"),
        ("8sync shot http://localhost:3000/login", "screenshot the UI so omp can review it visually (cheap on tokens)"),
        ("8sync ai \"fix the z-index on the header\"", "iterate"),
        ("8sync find \"useAuth\"", "search the codebase (rg + fzf preview), pick a match to open at file:line"),
        ("8sync note --tag idea \"switch to zustand for global state\"", "save a thought without breaking flow"),
        ("8sync ship \"feat: login form\"", "git add -A + commit + push + open a GitHub PR"),
    ]);

    section("3. RESUME later (next day, after reboot)", &[
        ("cd ~/code/my-app", ""),
        ("8sync .", "omp re-reads AGENTS.md + su-code/* and picks up where you left off"),
    ]);

    section("4. BLUETOOTH (bluez)", &[
        ("8sync bt",         "status: rfkill / service / controller power / paired"),
        ("8sync bt on",      "unblock rfkill + enable service + power on"),
        ("8sync bt fix",     "troubleshoot a dead adapter (unblock + reload btusb + restart + power on)"),
        ("8sync bt restart", "restart bluetooth.service + power on"),
    ]);

    section("5. DISPLAY (monitor refresh + Lian Li screens)", &[
        ("8sync hz",     "current vs highest available Hz per output — and why it is capped"),
        ("8sync hz max", "raise every output to its highest refresh (resolution untouched)"),
        ("8sync hz 144", "set one specific rate (--output DP-4 to narrow, --dry-run to preview)"),
        ("8sync lcd",    "Lian Li fan/AIO screens found by lianli-daemon"),
        ("8sync lcd photo.png", "draw an image/GIF/mp4 on them (--device N, `off` to blank)"),
        ("8sync lcd gui", "open the upstream GUI with the WebKit/Wayland fix"),
    ]);

    section("6. SECURITY (VPN + firewall)", &[
        ("8sync sec",                   "show current status of WARP and ufw"),
        ("8sync sec on",                "enable WARP VPN + ufw firewall (going to a cafe)"),
        ("8sync sec off",               "disable both (back home)"),
        ("8sync sec toggle",            "flip both based on their current state"),
        ("8sync sec warp on",           "control WARP only"),
        ("8sync sec ufw status",        "show ufw status only"),
    ]);

    section("7. MAINTENANCE", &[
        ("8sync up",                       "self-update 8sync only (omp: `omp update`; no `paru -Syu`)"),
        ("8sync clean",                    "reclaim disk + tidy caches + CPU/GPU/RAM report (--deep/--timer 1h)"),
        ("8sync doctor",                   "full health check"),
        ("8sync skill",                    "list installed skills + project-local skills"),
        ("8sync skill add <url>",          "clone a skill repo into ~/.omp/skills/"),
        ("8sync harness",                  "(bare) refresh skills + memory + /gs + MCP + reindex"),
        ("8sync setup profile list",       "show all profiles and which are applied"),
        ("8sync setup profile show warp",  "show resolved content of a profile"),
        ("8sync setup profile apply warp", "(re-)apply a profile idempotently"),
    ]);

    section("8. TERMINAL (kitty palette + wallpaper)", &[
        ("8sync theme",            "list color palettes (★ = active)"),
        ("8sync theme set dracula", "switch palette + reload kitty live (tokyo-night · catppuccin-mocha · gruvbox-dark · nord · rose-pine · dracula)"),
        ("8sync bg",               "show the current wallpaper (rendered inline in kitty)"),
        ("8sync bg set <file>",    "swap wallpaper live; no arg → fzf picker with live image preview"),
        ("8sync bg add <url>",     "download a wallpaper into the collection (-s to also set)"),
        ("8sync bg search \"dark anime\"", "search wallhaven.cc (no key) → fzf live preview → set"),
    ]);

    println!("Every verb supports {} and {} for detailed help.", "-h".bold().green(), "--help".bold().green());
    println!("Show this page anytime: {} or {}.", crate::brand::render("8sync flow").bold().cyan(), crate::brand::render("8sync").bold().cyan());
    Ok(())
}

fn section(title: &str, rows: &[(&str, &str)]) {
    println!("{}", crate::brand::render(title).bold().yellow());
    let w = rows.iter().map(|(k, _)| crate::brand::render(k).len()).max().unwrap_or(20).min(45);
    for (cmd, desc) in rows {
        if desc.is_empty() {
            println!("  {}", crate::brand::render(cmd).cyan());
        } else {
            println!("  {:<w$}  {}", crate::brand::render(cmd).cyan(), crate::brand::render(desc).dimmed(), w = w);
        }
    }
    println!();
}
