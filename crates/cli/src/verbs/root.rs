use owo_colors::OwoColorize;

pub fn print_cheatsheet() {
    println!(
        "{}",
        crate::brand::render("8sync — vibe coding harness for CachyOS + omp").bold().cyan()
    );
    println!("{}", "Single Rust binary. Embeds configs, profiles, skills. Every verb is idempotent.".dimmed());
    println!("{}\n", "Run any verb with `-h` for detailed help and examples.".dimmed());
    println!("{}", "AI TEAM — START HERE (the harness + the /auto engine)".bold().green());
    rows(&[
        ("8sync harness",                  "ONE command: skills + memory loop + /auto + MCP (codegraph/cbm/headroom). Run in any project."),
        ("8sync harness up --timer 30m",   "run the team loop in the background (periodic refresh + work)"),
        ("8sync harness audit|bench|eval", "doc-hygiene · token budget · loop-quality probe"),
        ("8sync harness web",              "local dashboard (axum+Vite): skills/memory/engines/readiness/team"),
    ]);
    println!("  {}", crate::brand::render("Inside omp (after `8sync .`) — drive the autonomous engine:").dimmed());
    rows(&[
        ("/auto <goal>",  "research → plan → slices → tasks → verify each → QA/closeout → done"),
        ("/auto status",  "report progress from the saved plan"),
        ("/auto resume",  "continue the saved plan, unattended to Definition-of-Done"),
    ]);
    println!();


    println!("{}", "FIRST TIME (new machine)".bold().green());
    println!("  {}", "1. clone + bootstrap — installs rustup if missing, builds binary into ~/.local/bin".dimmed());
    println!("     {}", "git clone https://github.com/8-Sync-Dev/su-code && cd su-code && bash scripts/bootstrap.sh".cyan());
    println!("  {}", "2. install harness + pick community profiles (asks y/N for each)".dimmed());
    println!("     {}", crate::brand::render("8sync setup").cyan());
    println!("  {}", crate::brand::render("3. log in to GitHub (so `8sync ship` can open PRs)").dimmed());
    println!("     {}", "gh auth login".cyan());
    println!("  {}", "4. verify".dimmed());
    println!("     {}\n", crate::brand::render("8sync doctor").cyan());

    println!("{}", "DAILY VIBE LOOP (inside a project)".bold().yellow());
    rows(&[
        ("8sync .",                "seed su-code/* (PROJECT, KNOWLEDGE, DECISIONS, …) + run `omp --continue`"),
        ("8sync ai \"<prompt>\"",  "one-shot AI prompt (resume last chat if no prompt)"),
        ("8sync find <kw>",        "rg over code (or fd over filenames) → fzf preview → open at file:line"),
        ("8sync note \"<msg>\"",   "append timestamped line to su-code/NOTES.md"),
        ("8sync run dev|build|test|fmt|lint", "project runner via per-stack recipe"),
        ("8sync ship \"<msg>\"",   "git add -A + commit + push + `gh pr create` in one shot"),
        ("8sync feynman auth-omp", "reuse omp's Claude OAuth + keys in Feynman (Pi research agent)"),
        ("8sync forge <name>",     "zsh shell bound to a named Forge session (`: <prompt>` asks Forge; --tui for the TUI)"),
    ]);
    println!("  {}", crate::brand::render("→ each project gets an AGENTS.md (managed) + su-code/ folder (memory) on first `8sync .`").dimmed());

    println!("\n{}", "BLUETOOTH (bluez)".bold().yellow());
    rows(&[
        ("8sync bt",         "status: rfkill / service / controller power / paired"),
        ("8sync bt on|off",  "unblock + enable + power on  /  power off + stop service"),
        ("8sync bt fix",     "troubleshoot a dead adapter (rfkill, btusb reload, restart, power on)"),
        ("8sync bt restart", "restart bluetooth.service + power on"),
    ]);
    println!("  {}", crate::brand::render("→ requires `bluetooth` profile applied (8sync setup --profile bluetooth)").dimmed());

    println!("\n{}", "DISPLAY".bold().yellow());
    rows(&[
        ("8sync hz",          "per output: current vs highest available refresh (+ why it is capped)"),
        ("8sync hz max",      "raise every output to its highest refresh — resolution unchanged"),
        ("8sync hz 144",      "set a specific rate where the output offers it"),
        ("8sync hz max --output DP-4", "one connector only (add --dry-run to preview)"),
    ]);
    println!("  {}", crate::brand::render("→ GNOME/Mutter · Hyprland · KDE · X11; a panel that beats its driver is diagnosed, not ignored").dimmed());

    println!("\n{}", "LIAN LI SCREENS".bold().yellow());
    rows(&[
        ("8sync lcd",            "daemon status + every fan/AIO screen it found"),
        ("8sync lcd photo.png",  "show an image / GIF / mp4 on every screen (--device N for one)"),
        ("8sync lcd '#ff0055'",  "solid colour; `8sync lcd off` blanks them"),
        ("8sync lcd bright 60",  "brightness 0-100 (live + persisted)"),
        ("8sync lcd gui",        "open the upstream GUI with the WebKit/Wayland fix applied"),
    ]);
    println!("  {}", crate::brand::render("→ talks to lianli-daemon directly; no GUI needed (8sync setup --profile hardware-lianli)").dimmed());

    println!("\n{}", "CLEAN / OPTIMIZE".bold().yellow());
    rows(&[
        ("8sync clean",          "reclaim disk (pacman/AUR/journal/tmp/thumbnails) + CPU/GPU/RAM report"),
        ("8sync clean --deep",   "+ orphan pkgs + build caches (go-build/tsc/node-gyp) — NOT models/playwright"),
        ("8sync clean --ram",    "also drop pagecache (light, cosmetic)"),
        ("8sync clean --gpu",    "NVIDIA persistence mode + GPU summary"),
        ("8sync clean --watch",  "loop forever, clean every 1h (or --watch <secs>)"),
        ("8sync clean --timer 1h", "install a systemd user timer (--timer off to remove)"),
    ]);
    println!("  {}", "→ governor is reported, NOT changed (amd-pstate powersave = efficient dynamic mode)".dimmed());

    println!("\n{}", "TERMINAL (kitty palette + wallpaper)".bold().yellow());
    rows(&[
        ("8sync theme",            "list color palettes (★ = active, curated for wallpaper-overlay readability)"),
        ("8sync theme set <name>", "switch palette + reload kitty live (tokyo-night · catppuccin-mocha · gruvbox-dark · nord · rose-pine · dracula)"),
        ("8sync theme show <name>", "preview a palette without applying"),
        ("8sync bg",               "show the current wallpaper (rendered inline in kitty via kitten icat)"),
        ("8sync bg set <file>",    "swap wallpaper live (rewrites 8sync.conf + reloads kitty); no arg → fzf picker"),
        ("8sync bg list",          "browse the collection with a live image preview (fzf) → pick → set"),
        ("8sync bg add <url>",     "download a wallpaper into the collection (-s to also set)"),
        ("8sync bg search <q>",   "search wallhaven.cc (no API key) → fzf + live preview → set"),
    ]);
    println!("  {}", "→ palettes = color fragments; wallpaper swaps the kitty background_image. Both reload via SIGUSR1 (instant)".dimmed());

    println!("\n{}", "PROFILES (opt-in, idempotent)".bold().yellow());
    rows(&[
        ("8sync setup --yall",           "unattended (alias --full): harness + every community profile except warp (VPN); no personal ones"),
        ("8sync setup --no-profile",     "install harness only, skip the y/N profile stage"),
        ("8sync setup --profile <name>", "install harness + apply ONE profile non-interactively"),
        ("8sync setup --dry-run",        "print the full plan, change nothing (combine with any flag)"),
        ("8sync setup profile list",     "show every available profile (✓ = applied)"),
        ("8sync setup profile show <n>", "show resolved packages + services + post-install of a profile"),
        ("8sync setup profile apply <n>", "(re-)apply one profile idempotently"),
    ]);
    println!("  {}", "Community profiles — offered by setup; --full/--yall takes all of them but warp:".dimmed());
    println!("  {}", "  dev-stack · bluetooth · warp (Cloudflare VPN — opt-in only)".dimmed());
    println!("  {}", "  nvidia (auto-detect: Blackwell→Turing→open-dkms; Maxwell/Pascal→dkms)".dimmed());
    println!("  {}", "Personal profiles — never offered, never in --full/--yall; only --profile <name>:".dimmed());
    println!("  {}", "  vietnamese · hardware-cooling · hardware-lianli · displaylink · apps-personal".dimmed());
    println!("  {}", "  alexdev (bundle: extends hardware-cooling + hardware-lianli + warp + vietnamese, adds kitty + AFFiNE)".dimmed());
    println!("  {}", crate::brand::render("Override any built-in: drop a TOML into ~/.config/8sync/profiles/<name>.toml").dimmed());

    println!("\n{}", "SECURITY (VPN + firewall)".bold().yellow());
    rows(&[
        ("8sync sec",          "show WARP and ufw status"),
        ("8sync sec on|off",   "enable/disable BOTH WARP and ufw"),
        ("8sync sec toggle",   "flip both based on current state"),
        ("8sync sec warp on|off|status", "control WARP only"),
        ("8sync sec ufw  on|off|status", "control ufw only"),
    ]);
    println!("  {}", crate::brand::render("→ requires `warp` profile applied (8sync setup --profile warp) for WARP control").dimmed());

    println!("\n{}", "AI TOOLING (cheap visual context for omp)".bold().yellow());
    rows(&[
        ("8sync shot <url|file>", "render web page or HTML file → PNG (saves tokens vs dumping text)"),
        ("8sync diff-img [ref]",  "render `git diff` → PNG"),
        ("8sync pdf-img <file>",  "render PDF pages → PNG"),
        ("8sync skill",           "list ~/.omp/skills/ + project su-code/skills/"),
        ("8sync skill add <url>", "clone a skill repo into both global + project skill dirs, update AGENTS.md"),
        ("8sync skill update",    "re-pull registered skills from their source (git/builtin/path)"),
    ]);

    println!("\n{}", "LIFECYCLE".bold().yellow());
    rows(&[
        ("8sync up",      "self-update 8sync only (omp: `omp update`; system pkgs: `paru -Syu`)"),
        ("8sync doctor",  "health check: tools, configs, VPN/firewall, applied profiles, overlay status"),
        ("8sync flow",    "same content as this page, ordered by workflow step"),
        ("8sync help",    "show this page (alias of `8sync` with no args)"),
    ]);

    println!("\n{}", "WHERE THINGS LIVE".bold().yellow());
    println!("  {:<38}  {}", crate::brand::render("~/.local/bin/8sync").cyan(),                 "the binary itself");
    println!("  {:<38}  {}", crate::brand::render("~/.config/8sync/{global,skills}.toml").cyan(), crate::brand::render("8sync own config (idempotent install)"));
    println!("  {:<38}  {}", crate::brand::render("~/.config/8sync/profile.toml").cyan(),       "state: which profiles are applied");
    println!("  {:<38}  {}", crate::brand::render("~/.config/8sync/profiles/*.toml").cyan(),    "user-defined / overriding profiles");
    println!("  {:<38}  {}", "~/.omp/skills/{name}/SKILL.md".cyan(),      "global omp skills (always-on)");
    println!("  {:<38}  {}", "~/.omp/skills/00-force-load.md".cyan(),     crate::brand::render("master force-load (regenerated by `8sync harness`)"));
    println!("  {:<38}  {}", "<repo>/AGENTS.md".cyan(),                   "project entry point — every AI reads this first");
    println!("  {:<38}  {}", "<repo>/su-code/{PROJECT,STATE,…}.md".cyan(), "per-project memory (committed, shared with team)");
    println!("  {:<38}  {}", "<repo>/su-code/skills/<name>/".cyan(),       "per-project skills (cloned by `skill add`)");

    println!("\n{}", "TIPS".bold().yellow());
    println!("  · Every verb has {} and {} with EXAMPLES.", "-h".bold().green(), "--help".bold().green());
    println!("  · Stuck? run {} to verify, or {} for a workflow walkthrough.", crate::brand::render("8sync doctor").cyan(), crate::brand::render("8sync flow").cyan());
    println!("  · Inspect before installing: any setup flag combines with {}.", "--dry-run".bold().green());
    println!("  · Repo: {}", "https://github.com/8-Sync-Dev/su-code".cyan().underline());
}

fn rows(items: &[(&str, &str)]) {
    let w = items.iter().map(|(k, _)| crate::brand::render(k).len()).max().unwrap_or(8).min(38);
    for (k, v) in items {
        println!("  {:<width$}  {}", crate::brand::render(k).cyan().bold(), crate::brand::render(v), width = w);
    }
}
