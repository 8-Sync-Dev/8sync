// 8sync — vibe coding harness for CachyOS + omp
// Org: 8-Sync-Dev

mod ui;
mod env_detect;
mod pkg;
mod platform;
mod assets;
mod brand;
mod models;
mod verbs;

use anyhow::Result;
use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(
    name = brand::CMD,
    bin_name = brand::CMD,
    version,
    about = "vibe coding harness for CachyOS + omp",
    long_about = None,
    disable_help_subcommand = true,
    after_help = HELP_AFTER,
)]
struct Cli {
    #[command(subcommand)]
    cmd: Option<Cmd>,
}

const HELP_AFTER: &str = "\
QUICK START
  8sync                             show this overview (any time)
  8sync flow                        same as above but ordered by workflow
  8sync setup                       install harness, then ask y/N per profile
  8sync setup --community           install harness + dev-stack + bluetooth, no prompts
  8sync .                           seed su-code/* context and run `omp --continue`
  8sync ai \"add dark mode toggle\"   one-shot AI prompt (or resume with `8sync ai`)
  8sync find \"useAuth\"              rg + fzf preview, open at file:line
  8sync ship \"feat: dark mode\"      commit + push + open a GitHub PR
  8sync sec on                      enable WARP VPN + ufw firewall
  8sync bt fix                      troubleshoot bluetooth (unblock + restart + power on)

Every verb supports -h / --help for detailed help with examples:
  8sync setup -h    8sync ai -h    8sync bt -h    8sync find -h
";

#[derive(Subcommand)]
enum Cmd {
    /// Install harness (gh + omp + configs + skills) then prompt per community profile
    Setup(verbs::setup::Args),

    /// Self-update 8sync from the latest GitHub Release (checksum-verified). omp: `8sync omp update`.
    #[command(alias = "update")]
    Up(verbs::up::Args),

    /// Update omp + auto-repair a blocked install (EEXIST/tarball): `8sync omp update`
    Omp(verbs::omp::Args),

    /// Health-check; report what's installed and what's missing
    Doctor,

    /// Seed su-code/* context for the current project and exec `omp --continue`
    #[command(name = ".", alias = "here")]
    Here(verbs::here::Args),

    /// AI session / one-shot prompt (omp)
    Ai(verbs::ai::Args),

    /// Commit + push + PR (smart shortcut)
    Ship(verbs::ship::Args),

    /// Run project command per recipe (dev/build/test/fmt/lint)
    Run(verbs::run::Args),

    /// Security toggle: WARP VPN + ufw firewall (on/off/status/toggle)
    Sec(verbs::sec::Args),

    /// Bluetooth control + troubleshoot (status/on/off/fix/restart)
    Bt(verbs::bt::Args),

    /// Refresh rate: report or set the highest Hz per display (status/max/<Hz>)
    Hz(verbs::hz::Args),

    /// Lian Li fan/AIO screens from the shell: show an image, GIF, video or colour
    Lcd(verbs::lcd::Args),

    /// SoftEther VPN Client + VPN Gate academic relays (install/gui/list/on/off/status)
    Vpn(verbs::vpn::Args),

    /// Reclaim disk/RAM, tidy caches, report CPU/GPU (--deep/--ram/--gpu/--watch/--timer)
    Clean(verbs::clean::Args),

    /// Manage skill library (list/add/sync)
    Skill(verbs::skill::Args),

    /// Switch kitty color palette (live): 8sync theme [list | set <name> | show]
    Theme(verbs::theme::Args),

    /// Manage kitty wallpaper: 8sync bg [show | get | set | list | add] (live swap, inline preview)
    Bg(verbs::bg::Args),

    /// Stand up / refresh the agent harness (init = deploy skills+codegraph+AGENTS.md+memory; up = refresh)
    Harness(verbs::harness::Args),

    /// Render web route / file to PNG (for AI image-routing)
    Shot(verbs::shot::Args),

    /// Render git diff to PNG
    #[command(name = "diff-img")]
    DiffImg(verbs::diff_img::Args),

    /// Render PDF pages to PNG
    #[command(name = "pdf-img")]
    PdfImg(verbs::pdf_img::Args),

    /// Visual grounding: image + prompt → labeled boxes (LocateAnything-3B). `--setup` first.
    Locate(verbs::locate::Args),

    /// Generate an image from a prompt via AI (gpt-image-2)
    #[command(name = "gen-img")]
    GenImg(verbs::gen_img::Args),

    /// Bridge ChatGPT Web into omp: open login, auto-check, wire an isolated provider
    #[command(name = "codex-web")]
    CodexWeb(verbs::codex_web::Args),
    /// Show overview cheatsheet (alias of `8sync` with no args)
    Help,

    /// Workflow-ordered help (lifecycle commands in chronological order)
    Flow,

    /// Search code (rg + fzf) or filenames (fd); pick → open in $EDITOR or hx
    Find(verbs::find::Args),

    /// Append a one-line note to su-code/NOTES.md (AI will read it in the next session)
    Note(verbs::note::Args),

    /// Large multi-phase feature scopes: new/switch/status/list (GSD planning tree)
    Feature(verbs::feature::Args),

    /// Bridge Feynman (Pi research agent) to omp's logins: `auth-omp` (Claude needs a Console API key)
    Feynman(verbs::feynman::Args),

    /// Named ForgeCode sessions with persistent UUID conversation mapping: 8sync forge <name>
    #[command(name = "forge", alias = "forgecode")]
    Forge(verbs::forge::Args),

    /// Claude Code CLI with named per-repo sessions + the 8sync kit: 8sync ccc . <name>
    Ccc(verbs::ccc::Args),
}

fn main() -> Result<()> {
    // Hidden refresh child spawned by `auto_check_notice`. Handled before clap so
    // it stays out of help and cannot collide with a verb.
    if std::env::args().nth(1).as_deref() == Some(verbs::selfup::PROBE_ARG) {
        verbs::selfup::run_probe();
        return Ok(());
    }
    // Single-source rebrand: when `brand::CMD`/`NS` differ from the default,
    // rewrite the command name + every help/EXAMPLES block through `brand::render`
    // in one pass. No-op (vanilla clap) on the default build → byte-identical help.
    let cli = {
        use clap::{CommandFactory, FromArgMatches};
        let cmd = rebrand_cmd(Cli::command());
        let matches = cmd.get_matches();
        Cli::from_arg_matches(&matches).unwrap_or_else(|e| e.exit())
    };
    let hook = matches!(&cli.cmd, Some(Cmd::Ccc(a)) if a.is_hook());
    if !hook && !matches!(cli.cmd, Some(Cmd::Up(_)) | Some(Cmd::Setup(_)) | Some(Cmd::Help)) {
        verbs::selfup::auto_check_notice();
    }
    match cli.cmd {
        None => {
            verbs::root::print_cheatsheet();
            Ok(())
        }
        Some(Cmd::Setup(a))   => verbs::setup::run(a),
        Some(Cmd::Up(a))      => verbs::up::run(a),
        Some(Cmd::Omp(a))     => verbs::omp::run(a),
        Some(Cmd::Doctor)     => verbs::doctor::run(),
        Some(Cmd::Here(a))    => verbs::here::run(a),
        Some(Cmd::Ai(a))      => verbs::ai::run(a),
        Some(Cmd::Bg(a)) => verbs::bg::run(a),
        Some(Cmd::Ship(a))    => verbs::ship::run(a),
        Some(Cmd::Run(a))     => verbs::run::run(a),
        Some(Cmd::Theme(a)) => verbs::theme::run(a),
        Some(Cmd::Sec(a))     => verbs::sec::run(a),
        Some(Cmd::Bt(a))      => verbs::bt::run(a),
        Some(Cmd::Hz(a))      => verbs::hz::run(a),
        Some(Cmd::Lcd(a))     => verbs::lcd::run(a),
        Some(Cmd::Vpn(a))     => verbs::vpn::run(a),
        Some(Cmd::Clean(a))   => verbs::clean::run(a),
        Some(Cmd::Skill(a))   => verbs::skill::run(a),
        Some(Cmd::Harness(a)) => verbs::harness::run(a),
        Some(Cmd::Shot(a))    => verbs::shot::run(a),
        Some(Cmd::DiffImg(a)) => verbs::diff_img::run(a),
        Some(Cmd::PdfImg(a))  => verbs::pdf_img::run(a),
        Some(Cmd::Locate(a))  => verbs::locate::run(a),
        Some(Cmd::GenImg(a))  => verbs::gen_img::run(a),
        Some(Cmd::CodexWeb(a)) => verbs::codex_web::run(a),
        Some(Cmd::Help)       => { verbs::root::print_cheatsheet(); Ok(()) }
        Some(Cmd::Flow)       => verbs::flow::run(),
        Some(Cmd::Find(a))    => verbs::find::run(a),
        Some(Cmd::Note(a))    => verbs::note::run(a),
        Some(Cmd::Feature(a)) => verbs::feature::run(a),
        Some(Cmd::Feynman(a)) => verbs::feynman::run(a),
        Some(Cmd::Forge(a))   => verbs::forge::run(a),
        Some(Cmd::Ccc(a))     => verbs::ccc::run(a),
    }
}

/// Rebrand a clap `Command` tree in place: run `brand::render` over `about`,
/// `long_about`, and `after_help` for the root and every (nested) subcommand.
/// Identity fast-path on the default build so help output is byte-for-byte
/// unchanged. One interception point covers `HELP_AFTER` + all verb EXAMPLES.
fn rebrand_cmd(mut cmd: clap::Command) -> clap::Command {
    if brand::CMD == "8sync" && brand::NS == "8sync" {
        return cmd;
    }
    let re = |s: String| brand::render(&s).into_owned();
    if let Some(s) = cmd.get_about().map(ToString::to_string) {
        cmd = cmd.about(re(s));
    }
    if let Some(s) = cmd.get_long_about().map(ToString::to_string) {
        cmd = cmd.long_about(re(s));
    }
    if let Some(s) = cmd.get_after_help().map(ToString::to_string) {
        cmd = cmd.after_help(re(s));
    }
    for sub in cmd.get_subcommands_mut() {
        *sub = rebrand_cmd(sub.clone());
    }
    cmd
}
