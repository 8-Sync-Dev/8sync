# Changelog

Mọi thay đổi đáng kể của `8sync` ghi vào đây. Format theo [Keep a Changelog](https://keepachangelog.com),
versioning theo [SemVer](https://semver.org). **8sync rule:** mỗi PR cập nhật mục `Unreleased`.

## [Unreleased]

## [0.100.1] — 2026-10-17
### Added
- **Rooms never sit idle while the board has work: `/goal` plus `auto wait`.** In the first live UAT of `auto up` (5 rooms on a Godot game repo), the lead split an epic into 8 ready cards with checks within minutes. The dev room had already run its first tick on an empty lane, though, so all 5 rooms sat idle until the next 10-minute cron tick.
  - `auto up` now opens every room that owns a board lane on Claude Code's own `/goal`. Checked live: `claude --bg … "/goal …"` printed "Goal set", then "Goal achieved".
  - The condition only holds when auto stops (off, paused, or the usage cap). Each turn claims a card, does that lane's job and moves it on.
  - With the lane empty, the room runs `8sync ccc auto wait`, which blocks without tokens until a card reaches its lane. It returns `{"wake":"card"|"off"|"cap"|"timeout"}` and gives up after at most 9 minutes (under Claude Code's 10-minute Bash cap).
  - The cron loop is still set up as a fallback. Rooms without a lane (rd, ops, docs, sec) keep the loop message.
- `8sync ccc auto wait [--lane <cột>] [--as <phòng>] [--timeout 1..590] [--json]`. It sees the same card as `auto claim` would take, a stale claim included.
### Fixed
- **`auto up` no longer resumes a room that is open in a terminal in another folder.** Before, the live check only listed sessions started in the project, so a room's id open elsewhere could be resumed in the background as well, running one conversation in two processes. The room's own id now counts wherever it runs. A background session with the room's name still counts only inside the project.
- **One `Ship` answer now covers the session, on Windows too.** After the owner approved Ship, every merge and tag push still prompted. There were two causes.
  - On Windows the `ship-grant` hook looked for the grant store under `HOME`. Claude Code's hook process there has no `HOME`, or holds a `/c/Users/…` path that is not absolute, so the grant was never written, while the guard reads the store under the real home directory. Both sides now find the store the same way (`dirs::home_dir`). A store that is not absolute never grants.
  - With a grant, the guard used to stay silent. Auto mode's classifier then still prompted for the merge or tag. The guard now answers `allow` for a ship step covered by the grant, which skips the prompt (https://code.claude.com/docs/en/hooks). Settings deny and ask rules still apply. A command that mixes a ship step with anything the guard asks about still asks, and force-push, secrets and deletes never consult a grant.
### Docs
- **Pages: an animated board.** The team section replays a card crossing `backlog → ready → building → qa → review → approved → done`, with the command each room ran. The static markup is the final state, so it reads the same without JavaScript or with reduced motion. The hero names v0.100.0, and the nav has a Team link.
- **README: "Quick start: a whole team in four commands"** at the top.

## [0.100.0] — 2026-10-17
### Added
- **`8sync ccc auto up`: the whole team in the background with one command.** Before, every room had to be opened in its own terminal before auto could run. `auto up` turns `auto on --here` on and starts every role room as a Claude Code background session (`claude --bg --name <room> --permission-mode auto --model <role model>`), with the loop prompt as its first message. You follow the work in `8sync hq ui`, `claude agents` or `8sync ccc auto board`. `auto down` stops the background rooms (conversations kept) and pauses auto.
  - Default team `lead,dev,qa,review`; `--roles` picks up to 8 rooms. Roles and models: lead, ba and rd on opus; dev and review on sonnet; qa on haiku. Aliases map to a role (`qc` → QA, `critic` → Review, `pm` → Lead, `analyst` → BA, `builder` → Dev). `ui`, `api`, `core`, `ops`, `docs` and `sec` keep the session's default model.
  - A room that is already live (by id, or a background session with its name) only gets the loop. A stopped room resumes in the background under the same id. A new room's registry entry is rebound to the id Claude Code picked (`--bg` ignores `--session-id`), so inbox, HQ and hooks find it.
  - An untrusted workspace stops `up` with the fix: open `claude` there once and accept the trust prompt. Rooms never run in bypass.
  - `--clear-ss` (alias `--clean`) first deletes this project's junk background sessions with `claude rm`: duplicates of a room, leftovers of old runs, rooms no longer in the team, and finished ones too. The registry entries that pointed at them go with them. Interactive sessions are never touched. Claude Code keeps a worktree with unpushed commits, and `up` prints why each kept session stayed.
- **Board with lanes, after [super-board](https://github.com/EricTechPro/super-board) (MIT), rebuilt in Rust.** The project's target queue is now a board: `backlog → ready → building → qa → review → approved → done`, plus `blocked`.
  - `auto add` lands a card in `ready` when it has a check and in `backlog` otherwise. `--label bug|feature|qa` labels it. Adding the same open text again adds a "↺ thêm lại" note instead of a twin.
  - `auto claim [--lane] [--as]` gives a room the first free card of its lane (lead/ba backlog, dev/ui/api/core ready → building, qa qa, review review), or the card it already holds. A `qa`-labelled card goes straight to qa.
  - `auto move <id> <lane>` checks the transition. `ready` needs a check, `approved` needs `--sha <reviewed head>`, and `--pr` records the PR. A card bounced back to ready more than twice goes to `blocked`.
  - A claim quiet for 2 h is taken back, and a stranded building card returns to ready. `auto note` logs progress and keeps the claim.
  - `auto board` / `auto lint` (`--json`) show the lanes and what needs the lead or you: no check, no PR, blocked, approved waiting for Ship.
  - Targets written by an older version read as `ready`.
- **Each room's loop works its lane.** The cron prompt now claims the room's card first and follows that lane's playbook:
  - lead writes the acceptance criteria and check, unblocks cards, and gathers every approved card into one Ship question.
  - dev builds in worktree `.claude/worktrees/card-<id>` on branch `card-<id>-<slug>` through `/ship`, then opens a PR.
  - qa runs the check and a UAT.
  - review approves the head SHA.
  - Merging stays a plain `gh pr merge --squash --match-head-commit <sha>` after the owner's Ship answer, which the guard already gates; 8sync has no merge verb. A new `.claude/loop.md` carries the same board section; an existing one is never overwritten.
- **HQ: the board by lane.** The Board tab opens on "Card dự án". There is one column per lane, Backlog → Blocked, for each project with a live room (project picker when there are several).
  - Each card shows its id and text, label, the room holding it and since when, PR, approved SHA and bounces, plus the last note.
  - A claim quiet for 2 h shows amber, and Approved turns amber with a Ship icon while cards wait for your answer.
  - The board refreshes every 15 s while the tab is visible.
  - "Task của session" keeps the old view of the sessions' own tasks.
  - New `GET /api/board` (token checked) runs `8sync ccc auto board --json` with argv only, in each live project's root. An 8sync without the board gets an "update with `8sync up`" note.
- **HQ: a "Gửi cho mọi phòng" box under Văn phòng and Chat tổng.** It sends one task to every room of a project, the same as `8sync ccc auto add "<việc>" --now`. Before this, Chat tổng only showed the thread and had no input, so it was unclear where to type a task for the whole team. Pick the project (or "Mọi dự án" when several have rooms), keep "Gửi ngay" ticked to push the task into every room's inbox, or untick it to only queue it for the auto loop. "Lệnh kiểm" adds an optional `--check` command. The line under the box names the rooms before you send. After sending it shows, per project, the target id and which rooms take the task as soon as they are idle and which take it after their current turn.
  - New `POST /api/targets` (token and origin checked) runs `8sync ccc auto add --json [--now] [--check <cmd>] -- <text>` with argv only and the project root as cwd.
  - It accepts only a root that has a live room right now, never an arbitrary path.
  - With "Mọi dự án", a worktree inside another project is left to that project's queue; its rooms are not counted as reached, and the line under the box says they take the task on a loop tick.
  - Ctrl+Enter (Cmd+Enter) sends; Enter alone is a new line, so a stray key never pushes a half-typed task into every room.
  - If some projects fail, the text stays in the box and the toast names them. A timeout says the task may already be queued (`8sync ccc auto queue`) instead of inviting a duplicate.
  - The "Lệnh kiểm" command runs in the project, like `--check` from the terminal.
  - The Cách dùng guide and the empty Chat tổng point at the box.
### Fixed
- **Sessions on 1M models no longer auto-compact at about 22% context.** The kit wrote `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=60` with `CLAUDE_CODE_AUTO_COMPACT_WINDOW=400000`, so a 1M session compacted at 60% × 400K = 240K tokens. On the status line, which counts against the full 1M window, that showed as about 22–24%.
  - The kit now writes 65% and window `1000000`, the top of the range. Claude Code caps the window at the model's own window (https://code.claude.com/docs/en/env-vars), so every model compacts at 65% of its real context: 650K on 1M, 130K on 200K.
  - `8sync ccc kit` / `8sync up` migrate the old pair. Window 400000 becomes 1000000, and 60% becomes 65% only when it sits next to the old window. A value the owner chose stays as it is.
  - The status line now shows each session's own point, for example `ctx 22%→nén 65%`, in red below 50%. It is computed from the window Claude Code reports (`context_window.context_window_size`) and the env the session sees.
  - `8sync ccc compact` lists every model window the status line has seen and where it compacts (`claude-opus-5-5: window 1000000 → nén ở ≈ 650000 token = 65% ctx`), with a warning when the point is early.
  - To fix a machine right away, without waiting for the release: `8sync ccc compact --window 1000000` and `8sync ccc compact --at 65`.
- **`auto on --loop` no longer rests a busy team on someone else's spend.** With `auto on --here --loop 2m --team`, every room skipped its tick on "$6.72 in the last hour against a $5/hour limit" while tasks were still open and the 5-hour window showed 23%. Two causes: the $/hour cap added up the status-line cost of every session on the machine, not only the project's, and on a subscription that cost is an API-price estimate, not money spent.
  - Under `--here`, the $/hour cap counts only sessions inside that project (API key logins too: the cap is per project).
  - On a subscription without `--usd-per-hour`, the cap is the usage window instead: rooms rest once the newest 5-hour or 7-day reading is at 90% or more, leaving the rest for the owner, and pick up again after the window resets. A reading counts only while it is younger than its window. With no fresh reading (status line off, or no session changed for a whole window), the old $5/hour default still applies. `auto status` shows both readings.
  - `--usd-per-hour X` keeps a $/hour cap on a subscription too, on top of the window. API key logins keep the $5/hour default.
  - A lease written by an older version keeps its stored $5/hour until `8sync ccc auto on` (or `idle on`) runs again; the rest message and `idle status` say how to drop it.

## [0.99.0] — 2026-10-17
### Changed
- **The repo is now `8-Sync-Dev/8sync` and the installer lives at `get.8syncdev.com`.** One-liners: `curl -fsSL https://get.8syncdev.com/install | sh` and `irm https://get.8syncdev.com/install.ps1 | iex`. Old links keep working: GitHub redirects `github.com/8-Sync-Dev/su-code` (repo, releases, downloads, API, raw files), and the org site `8-Sync-Dev/8-sync-dev.github.io` keeps `8-sync-dev.github.io/su-code/install` and `install.ps1` as shims that run the new installer (`/su-code/` forwards to the new domain). `8sync up`, `install.sh`, `install.ps1`, the kit's links and the plugin marketplace (`/plugin marketplace add 8-Sync-Dev/8sync`) use the new name; the managed `strictKnownMarketplaces` policy allows both names so machines that added the marketplace before the rename keep working. The per-project memory folder is still `su-code/`.
- **Plugin `8sync-kit` is ready for the Claude plugin directory.** `claude plugin validate --strict` passes: the plugin has a `displayName`, its own README, the new homepage and license, and the kit's `CLAUDE.md` moved from the plugin root (where Claude Code does not load it) to `assets/configs/claude/CLAUDE.md`. The `8sync-hints` and `8sync-inbox` mods moved out of the plugin folder to `assets/configs/claude/mods/`, so the plugin is Markdown only (agents and skills); `8sync ccc kit` still installs both mods to `~/.claude/skills/`. The README says what the plugin runs and that it sends nothing to 8 Sync. The plugin name stays `8sync-kit`.
- **License: MIT → PolyForm Noncommercial 1.0.0 (source-available) for everything after v0.98.4.** Personal study, hobby projects, research, education, charities and government use stay free; use at or for a company, client work, or a paid product or service needs a commercial license from 8 Sync (`COMMERCIAL.md`, atus@8syncdev.com). Releases up to and including v0.98.4 remain MIT. Third-party files keep their own licenses (THIRD_PARTY_NOTICES.md, `assets/skills/*/LICENSE`, OFL fonts). `LICENSE` holds the upstream PolyForm text unchanged under a `Required Notice` line. `Cargo.toml` declares `PolyForm-Noncommercial-1.0.0`. `.github/FUNDING.yml` adds the Sponsor button (GitHub Sponsors 8syncdev, 8syncdev.com, the commercial license page). README and the Pages footer now state the new license.
### Docs
- **Landing page SEO basics:** `robots.txt`, `sitemap.xml`, a canonical link and `SoftwareApplication` JSON-LD. The page stays static HTML, which crawlers read without running JavaScript.
- **New GitHub Pages landing** (https://get.8syncdev.com/). It replaces the v0.63-era page and is organised around the five levels of hands-off work (`/do` → `/autopilot`), shown as a staircase. Sections: the rails panel (guard, verify, stop gate, ask gate, Ship grant, no bypass); `auto on --here --loop 10m --team` with the project queue (`auto add … --check`, `--now`, `auto queue`, `auto pause`); the headless command and subscription limits; the bypass lock from v0.98.4; and the safety and bench tables, copied as measured from the README. It also replays a real verify and stop-gate run. Every command was checked against `8sync ccc help` and `claude --help`. Fonts (Archivo, JetBrains Mono) are self-hosted with their OFL licences, and the page works without JavaScript and with reduced motion. `docs/PRODUCT.md` records who the page is for and its design rules.
- **README:** new "Hands-off: five levels, one switch" section (level table, `auto on/add/queue/pause`, subscription limits, headless command). Binary sizes are now those of v0.98.4 (4.9 MB macOS arm64 to 7.0 MB linux-x86_64). The Defaults row mentions the bypass lock, and the bench rows are labelled "0.67 build".
- **`docs/huong-dan.md`:** new short section "Auto mạnh nhất, bản ngắn" (open a room, the 5 levels, `auto on` for the whole project, headless). The kit file count and the hq-ui size are corrected.

## [0.98.4] — 2026-10-17
### Fixed
- **Sessions opened by a launcher start in auto mode, not bypass.** Orca's default arguments for Claude Code are `--dangerously-skip-permissions`, and a launch flag takes precedence over `permissions.defaultMode`, so every Orca session ran in bypass although the kit sets `defaultMode: "auto"`. `8sync ccc kit` (and `8sync up`) now also sets `permissions.disableBypassPermissionsMode: "disable"` in `~/.claude/settings.json`: Claude Code rejects the bypass flag and starts the session in `defaultMode` (checked on Claude Code 2.1.296: a launch with `--dangerously-skip-permissions` reports `"permissionMode":"auto"`). Shift+Tab no longer offers bypass either.

## [0.98.3] — 2026-10-17
### Fixed
- **The release helper scripts work on Windows as written.** `su-code/handoff/scripts/merge-changelog.py` decoded `git show` with the locale codec, so on Windows (cp1252) a Vietnamese "ờ" in CHANGELOG made it crash with `TypeError … NoneType` unless run with `-X utf8`. It now reads UTF-8. Both scripts write LF instead of CRLF. `bump-version.py` takes the versions as arguments (`<worktree> <old> <new> <date>`) instead of constants edited before each release, and changes nothing when a check fails. CI runs `test-scripts.sh` (a Vietnamese CHANGELOG conflict and a CRLF bump fixture) on all three OSes.
- **`8sync ccc loop ev` records the check's verdict, not stderr noise.** The evidence line was the last line of stdout followed by stderr, so a passing `cargo test` showed cargo's `Running unittests …` and a passing script showed a build warning instead of `test result: ok. N passed` or `C1-ok`. A passing check now takes its line from stdout and a failing one from stderr, falling back to the other stream when one is empty. The printed tail no longer merges the last stdout line with the first stderr line.

## [0.98.2] — 2026-10-17
### Changed
- **CI runs the release size gate on every PR.** The new `size-gate` job builds the linux-x86_64 musl release (the largest asset, same steps as `release.yml`) and runs `scripts/size-gate.sh`, plus a self-test that the gate fails over the ceiling. Seven releases (v0.67.0, v0.74.0, v0.78.0, v0.81.0, v0.89.0, v0.93.0, v0.98.0) were tagged and only then failed the gate; now an oversized PR is red before the tag.
### Fixed
- **`auto on --loop` no longer promises that a `/bg` room resumes after a usage limit.** The note now says the next tick after the reset *may* pick the work up again, because the docs only state that background sessions don't wait. On a subscription login, the pointer to Routines now warns that a routine runs "without stopping for approval" and outside the 8sync rails, so the owner should grant only the repos and connectors it needs (https://code.claude.com/docs/en/routines). The same note is in `docs/huong-dan.md`.
- **`8sync ccc loop ev <slug> <C#> -- bash x.sh …` runs Git Bash on Windows, not WSL.** In the argv form a bare `bash` was spawned by name, and Windows looks in `System32` before PATH, so it ran the WSL launcher: no `gh`, exit 127, recorded as a failed check (seen 2026-10-16 on an autopilot item; the installed 0.98.1 gives exit 1 for `-- bash -c "command -v gh"`, this fix exit 0). A bare `bash`/`sh` (with or without `.exe`) now gets the same Git Bash the one-string form already used; any other program or full path runs as given, so WSL bash is still reachable by its path. The no-Git-Bash error no longer suggests the argv form as the way out.
### Tests
- **hq-ui: `mountSprite.setState` is tested over time** (`tests/sprite-setstate.test.ts`), not only `transitionFor()` as a table. A fake canvas and a hand-run rAF clock drive the real shared loop: stand-up/sit-down before work/rest and the hand-over after the one-shot ends, a repeated target that must not restart a transition, a mid-transition retarget, `done` re-triggering then going idle, reduced motion (frame 0, no loop) and `dispose`. Three mutations of `render.ts` (no transition, no repeated-target guard, one-shot never hands over) each make it fail.

## [0.98.1] — 2026-10-16
### Changed
- Release size ceiling 6784 → 6912 KiB, attributed in `scripts/size-gate.sh` (v0.98.0 linux-x86_64 was 6,973,520 B, 26,704 B over; +69,632 B vs v0.97.0 from `auto on --loop/--team`, the project target queue and the subscription loop notes; no new dependency). v0.98.0 was tagged but not published; 0.98.1 ships everything listed under 0.98.0.

## [0.98.0] — 2026-10-16 (tagged, not published)
### Added
- **`8sync ccc auto on --loop [10m] [--team]` puts every room of the project on its own loop with one command.** It writes `.claude/loop.md`, the file Claude Code uses as the default prompt for a bare `/loop` and re-reads every iteration. 8sync writes it only when no file is there, so the owner's edits are never overwritten, and it never follows a symlink.
  - Each tick, a room works through `loop.md`. It checks `auto status`, takes one `su-code/STATE.md` item for its role (or a `workflows/*.md` spec written with `/loop-me`) and picks the skill for the job: full `/ship` with karpathy-guidelines, tests, review and the `/sec` + `/rules` + `/aup-audit` gates before commit, or `/do`, `/deep-research`, `impeccable`, `/sysdesign`. Then it posts to the sprint meeting. A job that needs several ticks gets one `/ship` step per tick. A scheduled fire cannot run skills marked `disable-model-invocation`, so `/ship-loop`, `/ship-auto`, `/autopilot`, `/sprint` and `/loop-me` stay owner-typed, and a test keeps the playbook from routing a tick to them.
  - The command then sends one inbox message to each room of the project. The room sets up its own recurring `CronCreate` job, the same mechanism as `/loop 10m`, using the cron step for the interval (1–59 min or whole hours). Running the command again replaces the job, which restarts Claude Code's 7-day expiry.
  - With `--team`, a room opened with `--team` also fills the rd, qa and reviewer seats.
  - Every cron prompt keeps the stop check itself, so editing `loop.md` cannot remove it: the loop deletes itself when auto is off or paused. When the $/hour cap holds, the room rests that tick and keeps the loop. The cap is an average since auto turned on, so it clears as time passes. `auto status --json` now reports it as `cap`, even after the subscription lease has expired; before, an expired lease hid the cap, so a loop past 4 hours had no $ rail at all. The idle lease does not stop the loop. The loop is Claude Code's own scheduler, and it only runs while the room is alive (`/bg` keeps a room running without a terminal) (https://code.claude.com/docs/en/scheduled-tasks, https://code.claude.com/docs/en/agent-view). After a usage-limit reset, `autoContinueAtUsageLimit` resumes a room open in a terminal; Claude Code offers no such wait in a background (`/bg`) session or for a teammate, and the command now says so (https://code.claude.com/docs/en/interactive-mode#wait-for-a-usage-limit-to-reset). On a subscription it also says the loop is for ordinary use in rooms the owner opened, and that unattended multi-day or 24/7 runs belong on Routines (`/schedule`), Desktop scheduled tasks or a Console API key, the routes Claude Code documents for unattended scheduling (https://code.claude.com/docs/en/scheduled-tasks#limitations).
  - Starting the loop with this command counts as the owner being present, so the loop runs without the per-room 30-minute typing check. Nothing is queued when auto did not turn on. Ship, secret and money questions still go to the owner.
  - The HQ auto-tick prompt now follows `.claude/loop.md` too.
- **`8sync ccc auto` has a target queue for the whole team, like typing while Claude is busy.**
  - `auto on --target "<đích>" [--check "<lệnh>"]` starts auto with a target. `auto add "<việc>"` queues one at the end. `auto add --now` puts it first and pushes it into every room's inbox: Claude Code's "ctrl+x ctrl+s to send now", for the whole project. A room gets it as soon as it is idle; a running turn is not cut off.
  - `auto status --json` carries the first open target, so every tick (cron prompt, `.claude/loop.md`, HQ auto-tick) works on it. Each room does its role's part (lead splits and assigns, dev `/ship`, qa runs the check, reviewer reviews, rd unblocks). A room that proves the target met (the `--check` command exits 0, or runnable evidence) runs `auto done <id> --evidence "<lệnh: kết quả>"`, and the team moves to the next target. With none left, the loop goes back to `loop.md` and `STATE.md` Next.
  - `auto queue` lists the queue: current, open, done with evidence and who, dropped. `auto drop <id>` removes a target. A target a room queued itself (from inside Claude Code) is tagged "thêm bởi phòng <tên>", so the owner can tell it from their own and drop one an agent should not have added.
  - The kit rules teach every room that "đưa vào loop: …" means `auto add`, and "làm ngay: …" means `auto add --now`.
  - The queue lives in `~/.local/state/8sync/ccc/targets.json`, keyed by project root; a room in a subfolder uses its project's queue. Writes take a lock and replace the file atomically. A corrupt file fails closed and never breaks the stop check in `auto status`.
  - Owner (2026-10-16): "chế độ auto cũng nên có đưa prompt vào được để hiểu là auto target output ra là gì done rồi thì các agent mới tự làm tiếp việc khác … ctrl x+ s là nó đưa lên liền".
  - Owner (2026-10-16): "lệnh auto … cần là loop … all agents swarm all vị trí, thủ công quá".
### Fixed
- **Idle R&D nudges skip owner-only steps.** `8sync ccc hook idle` picks the first open `Next` item in `su-code/STATE.md` as the research question; items starting with `Owner` (Channels toggle, bot token) are now skipped, so an idle R&D room no longer researches a step only the owner can do. (`crates/cli/src/verbs/ccc/idle.rs`, `research_question`)
- **The ask gate no longer floods the terminal or blocks questions about safety rails.** When the gate turns a question back, Claude Code prints the gate's whole prompt in the error line, so the prompt is now about 520 bytes instead of about 880, and it puts the rules in four short lines. A question about loosening a safety or compliance rail (for example, how owner presence is counted on a subscription) now always reaches the owner; before, it was turned back as a "minor technical choice". Run `8sync ccc kit` to install the new prompt. Owner (2026-10-16): "hay bị bug … hook error".

## [0.97.0] — 2026-10-16
### Added
- **`8sync ccc auto on --here`** keeps auto to one project. Without the flag, `auto on` still reaches every session of every project on the machine, including sessions opened later, because its state lives under home. With `--here`, the project root of the current folder is stored in `auto.json` as `repo`. The `idle` (Stop/TeammateIdle), `delegate` and `taskdone` hooks then skip any session whose cwd is outside that root; subfolders and in-repo worktrees count as the same project. `auto status` (and `--json` `repo`) shows the scope; a plain `auto on`, `pause` or `off` clears it. If the marker cannot be written, auto is turned back off rather than left running everywhere. Owner (2026-10-16): "bổ sung thêm cờ auto all session trong 1 folder dự án".
### Fixed
- **`8sync ccc . rd` no longer opens under a new random name each time.** Claude Code session names are machine-wide, so when a session in another project already goes by `rd`, Claude Code appends a random suffix (`rd-crispy-sutton`), and a different one on every launch until the room has a transcript. In that case a new session now gets the stable name `<name>-<repo dir>` (`rd-su-code`); `8sync ccc . rd` still opens the same room, and the role (R&D, lead…) is still read from the leading name. Sessions that already have a transcript resume under their current title (rename with `/rename`). Owner (2026-10-16): "mỗi lần vô ra 1 tên khác nhau".

## [0.96.0] — 2026-10-16
### Added
- **Kit skill `/sysdesign`** — system design for a real change (new service, storage, queue, cache, scale, AI feature) with The System Design Primer (Donne Martin, CC BY 4.0) as the reading source: a scope gate (when a design is needed at all), a task-question → primer-section map (≤3 sections per task), the primer's 4-step method (use cases/constraints → high level → core components → scale) with mandatory back-of-the-envelope numbers from a named source, an ADR in `docs/adr/` (or `su-code/ship/<slug>/DESIGN.md`) reviewed by the `architect` agent, and a study track (Study guide, one `solutions/system_design/*` exercise a week, Anki decks). The primer is cloned once into `~/.cache/8sync/system-design-primer`; nothing of it is copied into the kit (size gate, licence). Owner (2026-10-16): "System Design Primer … tải thành skills luôn, quy trình đọc". Kit 40 files, `CORE_SKILLS` 16.
- **Sprite-pipeline gates as tests** (`apps/hq-ui/tests/sprite-pipeline.test.ts`): palette/canvas invariants, no anchor drift (desk rows, contact row, keyboard hands), head hair count constant, 1 px per step inside stand/sit, every transition and direct switch connects without a visible jump at any phase, manifest agreement (CLIP_MS/CLIPS/ONE_SHOT), timing caps, walker ground row and mirror involution.
### Changed
- **Ask gate prompt cut from 1,338 to under 800 characters.** When the gate denies an `AskUserQuestion`, Claude Code prints the whole hook prompt in the error line (`PreToolUse:AskUserQuestion hook error: [<prompt>]: <reason>`) and a narrow terminal wraps and cuts it into unreadable fragments (owner 2026-10-16: "check bug … icorrect, worchoices"). The four-rule checklist and the reply format are unchanged in substance; the explanatory sentences moved into a code comment. Re-run `8sync ccc kit` to install it (the gate decision itself was correct: rule 4, Claude picks and continues).
### Fixed
- **HQ sprites: no more 3 px jump after "stand"** — the work clips (typing, running, reading, waiting, meeting) now use the risen posture the `stand` transition ends in (head row 5, chair back showing), so stand → work and work → sit connect pixel-exact; `stalled` is the idle exhale pose with closed eyes (seated, reached via `sit` from work), `rest` breathes at the idle rows, and a work clip sits down before any seated clip (idle, rest, done, stalled) instead of only idle. The meeting speech bubble moved above the raised head. Owner (2026-10-16): apply the sprite-pipeline skill rigorously.

## [0.95.0] — 2026-10-16
### Added
- `8sync hq ui --install`: download the HQ UI asset for this binary version when missing and exit (no server). `8sync up` runs it after a successful update when HQ has been used on the machine, so the next `8sync hq ui` starts without a download.
- **Kit skill `/ship-tick [slug]`** — one iteration of a loop the owner already started. It is model-invocable on purpose: `/ship-loop`, `/autopilot`, `/ship-auto` and `/ship … --release` now add a Claude Code scheduled task (`CronCreate` `*/5 * * * *`, prompt `/ship-tick <slug>`) right after `8sync ccc loop init` or the first push, so the loop continues whenever the session is idle (after a turn ends, after /compact, while CI runs) without the owner typing again: the `/loop 5m` + loop-me pattern built into the ship skills. A tick: standup (`8sync ccc standup`, daily `8sync ccc meet --say` once), red CI first, then the first red criterion, `researcher`/`deep-research` when the same failure repeats, smallest change, `8sync ccc loop ev` evidence, `8sync ccc loop tick`; all green → review + `8sync ccc risk` + sec/rules/aup-audit + CHANGELOG + commit + push + CI; release only after ONE Ship question and only when the parent loop asked for it; done/stop → `loop done`, ACTIVE cleaned, its own cron deleted. Listed in `8sync ccc help`. Owner (2026-10-16): "các command ship-* có full skills khả năng loop + loop-me + scrum skill, /deep-research".
- **HQ auto-tick: "Chạy liên tục" now wakes idle sessions** — while `8sync ccc auto` is on and not paused, every Office poll of `GET /api/auto` (60 s) queues one inbox message for each room that is idle for ≥ 60 s, has the `8sync-inbox` mod live and nothing pending, at most once per 10 minutes per session (`<state>/hq/auto-tick.json`, 0600, write-then-rename; the idle clock restarts after 3 minutes without a poll). It only runs while an Office tab is open (the tab is the poll) and never while the lease gate holds (expired, over budget, owner away). The message tells the session: a `/loop` of its own → answer "đã có loop"; an open loop in `su-code/ship/ACTIVE` → `/ship-tick <slug>`; otherwise one small item from `su-code/STATE.md` Next or R&D for the next criterion, then `8sync ccc meet --say`; never merge/push main/tag/deploy. `GET /api/auto` carries `tick: { ticked: [...] }`. Owner (2026-10-16): "chờ tôi quá 1 phút không tự làm tiếp thì phải tự làm tiếp, mặc định luôn chạy liên tục". (`apps/hq-ui/lib/auto-tick.ts`, `lib/server/auto-tick.ts`)
### Changed
- `8sync up` warns when something is listening on the HQ port (8740): a running `8sync hq ui` keeps the UI it started with, so the owner must Ctrl-C and start it again to see the new version. The HQ page shows the same notice with the exact versions (running UI vs. installed 8sync, from `/api/auto` → `versions`) above the Pause / Run control.
- **`8sync ccc hook idle` (Stop) works for a session without an agent team** while `auto on` is running and not paused: the session is treated as its own lead (team name `session-<8 id chars>`, task list `~/.claude/tasks/<session_id>/`), so a standalone session that goes idle gets the same research / hand-out ladder as a team lead. `auto off` / `pause`, or no `auto` at all, keep the old behaviour (lead only). Session ids are validated before they become a path. (`crates/cli/src/verbs/ccc/idle.rs`, `auto::running`)

## [0.94.0] — 2026-10-16
### Added
- **`8sync ccc auto on [--hours N] [--after <60|1m>] | off | pause | status [--json]`** — one switch for "team never sits idle": `idle on` (lease, default 2 h; a subscription login keeps the 4 h cap and bails the same way) + `delegate on --after` (default 60 s) + `<state>/ccc/auto.json` (`{schema, on, paused, since, hours, after_s}`). `pause` turns both off and records `paused: true` so HQ does not turn it on again; `off` leaves `paused: false`. Validation runs before anything is written. `status --json` reports `on`, `paused`, `idle`, `delegate`, `after_s`, `lease_until`, `gate`, `subscription`, `manual`. The owner's hand switches win: `idle off` / `delegate off` / `ccc cancel --all` after `auto on` read as `paused` (and `cancel --all` writes the marker), `idle on` / `delegate on` by hand without `auto` read as `manual` — HQ turns auto on by itself only when neither is set, once per page load, and shows an expired lease instead of re-arming it. The marker write is fail-closed (a `pause` that cannot be saved is an error, and a lease without its marker is rolled back). Owner (2026-10-16): "chờ tôi quá 1p không tự R&D và lead tự giao nghiên cứu tự làm tiếp, có nút pause, mặc định luôn chạy liên tục".
- **`8sync ccc meet [--say "<done>|<doing>|<blocked>"] [--room <tên>] [--json]`** — daily sprint meeting of a repo's rooms: appends `| HH:MM | phòng | done | doing | blocked |` to `su-code/standup/<YYYY-MM-DD>.md` (UTC, locked, cells sanitised, ≤100 chars); a room that spoke in the last 30 minutes has its row replaced. Room name from `--room`, else the session registry, else `?`; bails without `su-code/`. Owner (2026-10-16): "các session phòng ban chưa bao giờ họp chung với nhau".
- **HQ office: a real sprint-meeting room** — a room whose lead has a row younger than 30 min in `su-code/standup/<today UTC>.md` (`8sync ccc meet --say`) is "in the meeting": its Lead seat is empty ("đi họp"), a walker leaves the room (`hq-walk-out`, 1.6 s) and returns facing left (`mirror()` frames, `hq-walk-back`) for the last 1.6 s, and a "Phòng họp" card above the project's rooms seats every attending lead around a CSS table with its "doing" line and "Họp sprint · N phòng · còn M phút". Rooms of the same project meet together; `Office.meetings` reads only that one file (≤ 64 KB). Owner (2026-10-16): "ra khỏi chỗ để họp sprint daily 30p … các session phòng ban chưa bao giờ họp chung với nhau". (`apps/hq-ui/lib/meeting.ts`, `lib/server/office.ts`)
- **HQ office: an empty chair** — a lead at the sprint meeting leaves an "away" desk (chair back, screen off, no person) instead of a dimmed resting character; in the meeting room the lead walks in (phase out) / leaves (phase back) as a walker sprite instead of a blank. Owner: "nhân vật di chuyển thật".
- **HQ office: seats clone** — a seat with 2–3 agents of one kind draws that many sprites side by side (40 px, overlapping); more than 3 keeps the ×N label. Owner: "nhiều cần nhiều thì nhân vật tự nhân bản". (`cloneCount`)
- **HQ Pause / Run button** — `GET|POST /api/auto` wraps `8sync ccc auto status --json | on | pause` (token required, only the fixed words `on`/`pause`, 422 otherwise, 200 with `error` when 8sync has no `auto`). The Office tab polls every 60 s, turns auto on by itself once per page load unless the owner paused or set idle/delegate by hand, and shows "Tạm dừng" / "Chạy liên tục" with "Luôn chạy · lease tới HH:MM", "Đang nghỉ: <gate>" or "Lease hết hạn — bấm Chạy liên tục để gia hạn" (never re-armed by itself: the 4 h subscription cap stays). A failed status read shows its own error; only a missing verb says "chạy 8sync up". Owner: "có nút pause, mặc định luôn chạy liên tục".
- **Assign dialog preset "Họp sprint (09:00 hằng ngày)"** (`MEET_DAILY`, mode "Cả dự án") — each room reports `8sync ccc meet --say`, takes one open item of another room, stops within 30 min.

### Changed
- The SessionStart "Phòng của bạn" block now lists `Sprint <slug>: role rảnh …` for each board in `su-code/ship/ACTIVE` that has idle roles, and `Họp sprint hôm nay: N phòng đã nói, phòng này chưa → 8sync ccc meet …` when today's standup file exists without a row for this room. Owner (2026-10-16): "skills scrum luôn bật, lead và R&D luôn work để giao việc".
- `auto` and `meet` are ccc verbs (reserved words): sessions with those names can no longer be opened with `8sync ccc . <name>`. `idle::on` and `delegate::on` are extracted from the CLI handlers (no behaviour change).

## [0.93.3] — 2026-10-16
### Added
- **`8sync ccc cancel [--all] [--session <tên>] [--json]`** — one command that stops everything the calling session set in motion, fail-closed: its goal and urgent flag (registry), every live loop named in the repo's `su-code/ship/ACTIVE` (`stopped: "cancelled"`, read back to verify; ACTIVE is per repo, so a loop another session listed there stops too), then ACTIVE itself; `--all` adds every live loop under `su-code/ship`, `idle off` and `delegate off`. No session id and no `--session` → refused, nothing touched, exit 1; a `--session` this repo does not have → refused; any step that cannot be verified gone (a loop.json that cannot be read or written, an ACTIVE line that is not a slug, a switch still on because an env var overrides the flag) → `✗ FAILED …`, exit 1, and ACTIVE keeps exactly those lines for the retry. Claude Code's own scheduled tasks cannot be reached from outside: the summary says `/loop clear`. Idea after oh-my-claudecode's `/cancel` skill (github.com/Yeachan-Heo/oh-my-claudecode, MIT, `skills/cancel/SKILL.md`): per-session scope by default, cross-session only behind a flag, "cancelled" only when verified. Code ours. Tests: `cancel_session_scope_…`, `cancel_all_…`, `cancel_fails_closed_…`, `scripts/uat/omc-cancel-risk.sh`.
- **`8sync ccc risk [--base <ref>] [--paths a,b] [--json]`** — which review gates this diff makes mandatory, decided from the changed file names (committed since `merge-base(origin/main, HEAD)`, staged, unstaged, untracked): `/sec` always; `/rules` + `/aup-audit` when a path falls in auth/OAuth/login, data collection, messaging people outside, third-party tools (MCP/plugins/dependency manifests), release files (workflows, version/size-gate, deploy config; CHANGELOG alone is not one, every PR edits it) or a high-risk domain (credit, hiring, medical, legal, insurance…; that one also needs a human reviewer + AI disclosure); whole name tokens only (`user-login.ts` yes, `lesson.md` no; files under `docs/` and `*.md` count only as secret dumps); `--release` forces `/rules` + `/aup-audit` for a code-only release diff; `/harden` when hooks/settings/`.claude/` files change; level low/medium/high (high = secret file or high-risk domain). Reads names only, never contents — a floor under the review, not the review (the text output says so). Git runs at the repo top level with `-z`, so a subdirectory cwd or a Vietnamese file name changes nothing; without `origin/main` it falls back to `origin/HEAD`, then `HEAD` with a stderr note that only uncommitted work is seen. The kit's CLAUDE.md rule and the ship / ship-loop / ship-auto / autopilot skills now say to run it before `sec`; the rule itself now asks for `sec` + `rules` + `aup-audit` on every diff (owner, 2026-10-16: "luôn check tuân thủ"), `risk` adds the extra gates. Idea after oh-my-claudecode's `scripts/risk-assess.mjs` + `review-gate.mjs` (MIT); code ours. Tests: `risk_classifies_paths_by_name_only`, `risk_gates_follow_the_kit_rule`, `risk_reads_the_diff_and_untracked_files_from_git`.
- `research/omc-features.md`: scan of oh-my-claudecode v5.7.4 (39,944 stars, MIT) — 64 table rows (overlapping features merged) vs ccc, what is portable, and what is not ported on purpose (OAuth usage API reading Claude Code credentials, `--dangerously-skip-permissions` launchers, auto-typing into tmux). Ideas only.

### Changed
- `cancel` and `risk` are now ccc verbs (reserved words): a session named `cancel` or `risk` can no longer be opened with `8sync ccc . <name>`.
- `8sync ccc loop` stops a loop with reason `cancelled` when `cancel` ran; `idle off`/`delegate off` share the `off()` the cancel uses.

## [0.93.2] — 2026-10-16
### Fixed
- **HQ now says whether a session will take its task now or only at its next turn end.** Owner (2026-10-16): "cứ rơi vô trạng thái xong việc là không làm tiếp dù có gửi tin nhắn cho nhau … apply active lại các session đang work tôi không muốn mở lại claude code". A session opened before `8sync ccc kit` wrote the `8sync-inbox` mod has not loaded it (Claude Code loads a skills-dir plugin at start or on `/reload-plugins`, no restart needed — code.claude.com/docs/en/plugins/loading), so a task "qua inbox (nhận ngay khi phiên rảnh)" silently waited for the Stop hook. Now `8sync ccc inbox` (only the mod calls it) touches `<state>/inbox/<session_id>.live` on every poll (from session start, then while idle); a marker from the last day means the mod is loaded — age is not "polling now", a long turn does not poll. HQ (`Room.inboxLive`, `Session.inbox_live`, `live` in the `/api/messages` and `/api/tasks` responses) shows "Inbox · mod" or "Inbox · chưa nạp mod" on the office card and the assign dialog, and the toasts/summary say "qua inbox (nhận ngay khi phiên rảnh)" only when live, else "qua inbox (nhận khi xong lượt — gõ /reload-plugins trong phiên để nhận ngay)". `8sync ccc . ls` prints the same `inbox:` line per session active in the last day; `8sync ccc kit` prints "mod … đổi: … gõ /reload-plugins" when it rewrote an existing mod file (not on first install) and `8sync up` forwards that line. Markers older than a day are swept with the claim orphans; the marker and its dir are 0600/0700 like the inbox. Not done on purpose: typing `/reload-plugins` into panes for the owner (it could answer an open dialog). Tests: `inbox_live_marker_follows_the_mod_poll`, `kit_reload_hint_names_changed_mods`, vitest `office` (live marker), `assign-ui`.
- **HQ "chưa trả lời" on handoffs that were answered.** `SendMessage(to: "core [ff2607]")` (the `name [ref]` form ListAgents prints) did not resolve, so the journal kept the typed text as `to` while the reply's `from` was a session uuid, and the two never matched. `resolve_peer` now strips the ` [ref]` suffix, and the team thread marks a handoff answered by comparing resolved names (`from_name`/`to_name`, case-insensitive, ref stripped) with the raw ids as fallback. Tests: `resolve_peer` (`rd [6de1ef]`), vitest `team-thread` "handoff answered by name".

## [0.93.1] — 2026-10-16
### Changed
- Release size ceiling 6592 → 6784 KiB, attributed in `scripts/size-gate.sh` (v0.93.0 linux-x86_64 was 6,801,424 B, 51,216 B over; +131,424 B vs v0.92.1 from `ccc hint`, `completions` with clap_complete, `ccc inbox` and the two embedded mods). v0.93.0 was tagged but not published; 0.93.1 ships everything listed under 0.93.0.

## [0.93.0] — 2026-10-16 (tagged, not published)
### Fixed
- **HQ "Giao việc" to an idle session no longer hangs.** Owner (2026-10-16): "giao task khi ccc còn working nó mới làm, còn khi nó chưa working gửi task nó bị treo". A session HQ did not start (every `8sync ccc` room, every session on Windows) gets tasks through its inbox, and only the kit's Stop hook read it, at the end of a turn; an idle session has no turn to end, so the task waited for good. New mod **`8sync-inbox`** (installed by `8sync ccc kit` into `~/.claude/skills/8sync-inbox`; open sessions need one restart) polls while the main loop is idle (every 5 s for the first minute, then 15 s, then 30 s; a finished turn starts over) and submits pending tasks as a new prompt (`$.prompt.submit`). It calls the new **`8sync ccc inbox [--session <id>] [--ack|--release] [--json]`**, which claims the messages instead of deleting them: the mod acks once the prompt entered the session, appends a refused prompt to the prompt box (the owner's draft stays) with a toast, and releases the claim back to the inbox when neither worked; a claim nobody acks (killed process) is served again after 2 minutes. The Stop hook leaves a claimed message alone, so a task is delivered once and never lost. The HQ API that writes the inbox requires the local HQ token; the text is framed as the owner's message. HQ now says "qua inbox (nhận ngay khi phiên rảnh)". Tests: `inbox_claim_ack_release_and_stale_claims`, `inbox_cmd_parses_flags_and_falls_back_to_the_env_session`, `kit_installs_the_inbox_mod`, `claude plugin test` (9). Not verified until a session restarts with the mod: a task arriving while the owner has a half-typed prompt.

### Added
- **Realtime hints inside Claude Code (`8sync ccc hint` + mod `8sync-hints`).** Owner (2026-10-16): "enhance prompt in ccc can auto hint real time like omp suggestion to tab completion". The kit now installs a Claude Code function-hooks mod at `~/.claude/skills/8sync-hints` (auto-loaded; open sessions need a restart) that draws three things from one local Rust call: **ghost text** for the next prompt (Tab/→ takes it: "tiếp tục loop <slug> (iter k/N)", own urgent flag, the prompt the owner typed after this one before — a bigram over `~/.claude/history.jsonl` filtered by project, local-only — then "/sec rồi commit" or "push nhánh … rồi mở PR" from git), **typeahead** rows with descriptions for `/skill` (installed + repo skills), `8sync <cmd>` and `8sync ccc <verb>` / `ccc <verb>` tokens, and a dim **band above the prompt** (≤ 2 lines: loop · branch ↑ahead ✎dirty · urgent · watchdog alert < 10 min) with an "Ẩn" button. The mod only calls `8sync ccc hint [--complete <token>] --json` (no network, no model, no `gh`; one `git status` with a 300 ms budget, run beside the prompt; silent when `8sync` is missing) — idea ported from omp's predictive composer, code ours. Tests: `hint_*` (Rust; < 50 ms without git on a 41-skill + 512 KiB-history fixture), `claude plugin validate|test` (8 mod tests), `kit_installs_the_hints_mod`, `scripts/uat/hints-load.sh`.
- **`8sync completions <bash|zsh|fish|powershell|elvish>`**: shell tab-completion scripts generated from the same clap tree the binary parses (`8sync completions bash > ~/.local/share/bash-completion/completions/8sync`).
- `research/omp-features.md`: scan of omp 18.11.1 features (MIT; ideas only) with what ccc already has, what this batch ports and what is queued for later.


## [0.92.1] — 2026-10-15
### Fixed
- **HQ "Giao việc" › Một phiên** on real data: every session the owner started outside HQ landed under "Phiên khác", and two rooms with the same name (two `rd`, two `web`) were indistinguishable. The list now groups those sessions by the git folder + branch their office room reports, exactly like the sidebar ("su-code ⎇ main"), and a duplicated name gets its first 8 session-id characters ("rd · 1a2b3c4d") in the list, the fan-out chips and the summary line (`groupTargets(sessions, projects, rooms)`, `distinctLabels`; tests in tests/assign-ui.test.ts).

## [0.92.0] — 2026-10-15
### Changed
- **HQ "Giao việc" dialog redesigned.** Owner (2026-10-15): one dropdown mixed roles and sessions, so it was unclear whether a task went to one session, to a role, or to every session of a repo. The dialog now has three explicit ways to hand a task: **Một phiên** (a list of live sessions grouped by project, with status dot, role and terminal/inbox delivery), **Theo vai trò** (role cards showing model and how many sessions of that role are running; "mở mới" + project picker when none) and **Cả dự án** (every live session of one project, or of all projects, each gets its own task row). A summary line above the buttons says exactly where the task will go, e.g. "Giao cho phiên rd qua inbox", "Giao cho phiên R&D rảnh lâu nhất trong 2 phiên: rd-1, rd-2" or "Giao cùng một việc cho 4 phiên trong levels-repo". Priority is a P0–P3 segmented control; "Khi nào" sits beside it; the R&D preset is a text link. Pure rules live in `lib/assign.ts` (tests/assign-ui.test.ts). Dark/light and phone widths checked with a headless browser against a seeded preview (not verified: Windows, macOS browsers).

## [0.91.1] — 2026-10-15
### Fixed
- `8sync learn trending` run from inside a project's `su-code/` memory directory (which carries its own AGENTS.md) wrote to `su-code/su-code/research/trending/`; the trending dir is now resolved by `trending_dir()`: a `su-code` memory dir without a VCS/manifest of its own belongs to its parent project, a repo that is itself named `su-code` stays a normal root, and any subfolder of the project resolves to `<project>/su-code/research/trending/<date>.md` (test `learn_trending_dir_resolves_from_memory_dir_and_subfolders`; reported by the R&D session in UAT of v0.91.0).

## [0.91.0] — 2026-10-15
### Added
- **`8sync learn trending`** (Rust): the most-starred repos created in the last N days (`--lang`, `--days 7`, `--top 25`, `--json`) through GitHub's official search API — not the trending page, which must not be scraped — written to `su-code/research/trending/<date>.md` with a "Có ích cho 8sync vì" column for the R&D room to fill. Unauthenticated, no token read; adult-content repos are dropped.
- **`8sync skill learn <owner/repo>`** (Rust): shallow-clone a public repo, delete its `.git`, check the licence (MIT/Apache/BSD/ISC/MPL/CC BY/CC BY-SA/CC0/Unlicense/GPL family allowed; NC/ND/none refused with the reason), and distil the README into a ≤ 6 KB `SKILL.md` (frontmatter, source + licence + attribution, a section index with `refs/README.md:<line>` pointers) beside the untouched `refs/README.md` + `refs/LICENSE` in `~/.claude/skills/<name>` — local only, never committed. First target: donnemartin/system-design-primer (CC BY 4.0; 109,830 B README → 6,042 B skill).
- **HQ office: sprint meeting + standing up/sitting down + carrying a task.** A room whose `su-code/ship/<slug>/STANDUP.md` was written < 2 min ago shows the `meeting` state ("họp sprint"); desks play a `stand` clip when work starts and `sit` when it ends; a walker bringing a task carries a paper. All code-drawn, reduced-motion safe.
- **`scripts/uat/hook-latency.sh`**: median hook latency with budgets (guard/wake/watchdog/resume-note ≤ 20 ms, verify no-op ≤ 50 ms). Measured on Linux (`bash scripts/uat/hook-latency.sh`, 7 runs): median 2–3 ms each; the Orca per-event shell hook on this machine adds ≈ 5 ms (not verified: macOS, Windows). `HOOK_BUDGET_SCALE=3` relaxes budgets on a loaded CI runner; `EPOCHREALTIME` is read locale-safe, macOS falls back to python3/perl. The real verify check (tsc/cargo) runs with `asyncRewake` and never blocks the model.
### Changed
- **"R&D trực" preset** now studies the codebase (`codegraph`), the web (primary sources), papers (arXiv / Semantic Scholar) and today's trending file, then hands ≤ 2 concrete tasks to the rooms that are free (`8sync ccc . ls` + SendMessage, or HQ Giao việc), instead of only writing a research note. It proposes `8sync skill learn <owner/repo>` to the owner and never installs a skill unattended (`~/.claude/skills` is loaded globally; a human approves).
### Security
- `8sync skill learn`: README/LICENSE symlinks are ignored (a hostile repo cannot pull a local file into a globally loaded skill); source-available texts that quote OSI wording (Commons Clause, SSPL, BSL, Elastic, PolyForm, "sell the software") are refused before the allow-list; README/LICENSE capped at 2 MB; `SKILL.md` has a hard 6144-byte ceiling; skill names must start with `[a-z0-9]`, ≤ 64 chars, no Windows device names; `--name --force` no longer yields a skill called "--force".
- `8sync learn trending`: rows whose `owner/repo` is not GitHub-legal are dropped; description/licence cells lose link, image, HTML, backtick, control characters and URLs, so the file the R&D room reads carries no injected links; the only link per row is the github.com URL; curl is pinned to `--proto =https`; `--days` is clamped to 1–3650.

## [0.90.0] — 2026-10-15
### Added
- **HQ: giao việc theo lịch.** The "Giao việc" dialog has "Khi nào": now, once at HH:MM, daily at HH:MM, or every 5–30 min / 1–12 h. HQ runs no timer of its own: it hands the session one prompt to book the task with Claude Code's native `CronCreate` (local time, fires between turns while the session is open, recurring jobs expire after 7 days by design and are not silently re-created). The task row reads `… · ⏰ mỗi 30 phút`. Preset **"R&D trực"**: every 30 min the R&D room researches the next backlog item when it has nothing assigned, or says `rest`.
- **`8sync ccc delegate on --after 1m`.** The critic answers a product/technical question only when the owner has typed nothing in that session for the given time; while the owner is active the question still reaches them. Owner-only topics (Ship, secrets, destructive, money, deploy/merge/release, high-risk) are unchanged. A hook cannot answer a question already on screen, so "no reply for 1 minute" is approximated by "no typing for 1 minute"; an unreadable transcript means the owner is asked.

- **`8sync ccc hook wake`** (Rust, UserPromptSubmit, no model call): a scheduled HQ prompt (marked `[8sync:wake]`) is dropped before it reaches Claude — zero tokens — when the session has an `in_progress` task, ran a scheduled prompt < 4 min ago (queued fires collapse), or, on a subscription login, the owner has typed nothing in that session for 30 min (unattended use needs a Console API key). Claude Code runs UserPromptSubmit hooks on cron and `/loop` fires too (https://code.claude.com/docs/en/hooks). Idea after ProactiveAgent's decision engine + minimum interval (github.com/leomariga/ProactiveAgent, BSD-3).

### Changed
- HQ tab "Chat nhóm" is now **"Chat tổng"**: every room (session) shares one chat.

### Fixed
- `8sync ccc . goal --help` / `-h` printed nothing and stored "--help" as the goal; it now prints usage and leaves the registry alone, and an unknown `-flag` is an error.

## [0.89.1] — 2026-10-15
### Changed
- Release size ceiling 6400 → 6592 KiB, attributed in `scripts/size-gate.sh` (v0.89.0 linux-x86_64 was 6,616,688 B, 63,088 B over; +69,664 B vs v0.88.0). v0.89.0 was tagged but not published; 0.89.1 ships everything listed under 0.89.0.

## [0.89.0] — 2026-10-15 (tagged, not published)
### Added
- **`8sync ccc . ls` lists the most recently active session first and shows an urgency flag set by the agent.**
  - New verb `8sync ccc . urgent <high|med|low|clear> [note] [--session <name>]`. With no `--session` it flags the agent's own session, found from `CLAUDE_CODE_SESSION_ID`.
  - `ls` shows the flag as text plus colour: `▲ high` (red), `◆ med` (yellow), `▽ low` (cyan). The note goes on a `flag` line, cut to one line of at most 80 characters, with secrets masked.
  - `ls --json` rows come newest first and carry `urgency` (`level`, `note`, `set_at`).
  - Old session indexes load unchanged.
  - The kit's CLAUDE.md and `8sync-cli` skill tell agents to set `high` when blocked on the owner, `med` when waiting on a teammate, and `clear` when resolved.
- **New kit skill `/sprint` adds a scrum-master cadence so no role sits idle.**
  - A scale gate runs first: tasks of ≤3 files open no sprint; mid-size tasks pick 2–4 roles; the full roster is for ≥2 independent file groups.
  - The cadence: sprint planning → roles assigned in waves (rd/plan → dev → review/qa) (R&D, Plan, Fullstack, Reviewer, Tester, Quick, Critic, the same seats as HQ) → a standup at every phase boundary or iteration (done/doing/blocked, backlog, bugs, other rooms) → sprint review → retro into `/remember`.
  - The roster maps every kit agent and skill to a role.
  - `/ship`, `/ship-auto`, `/ship-loop`, `/autopilot` and `/planning` now run this cadence.
  - It keeps token rails: at most 4 writers, real backlog items only (`rest <reason>` instead of busywork), and unattended runs dispatch only on a Console API key.
  - Measured lead delegation before this change: 237 spawns vs 4,670 own calls (`su-code/research/sprint-delegation.md`).
- **New verb `8sync ccc standup <slug> [init | set <role> <status> … | --json]` keeps the sprint board.**
  - The board is `su-code/ship/<slug>/SPRINT.md` and each standup is appended to `STANDUP.md`.
  - `init --roles` picks the sprint's roles. The verb exits 3 while a role on the board is idle (1 stays "error"), so loops can gate on it. Writes are locked, cells are sanitised on read too, and `--json` does not log.
  - It lists the other rooms' goals and warns `⚠ trùng file` when a board row's files overlap another room's claim.
- **New verb `8sync ccc . goal <mục tiêu> [--files a,b] [--session <name>]` (`goal clear` to drop it) sets a session's target and claimed files.**
  - Other rooms see the goal in `ccc . ls` (a `goal` line and `--json` `goal`), in the SessionStart/compact "Phòng khác đang làm" block, and in `standup`.
  - The text is one line, with control characters dropped and secrets masked.

## [0.88.0] — 2026-10-15
### Added
- **R&D researches when idle.** In `ccc hook idle` (still OFF by default, same rails: lease on subscription, $/hour cap, 3 blocks):
  - a teammate named for research (`rd`, `rd2`, `research…`, `explore…`) that runs out of tasks is told to run `/deep-research` on the first STATE `Next` item that has no brief in `su-code/research/` yet;
  - after the brief it runs `/planning` and asks the owner ONE AskUserQuestion table with a Recommended option first;
  - the lead gets the same nudge once the team and every other room are idle.
- **Critic picks for the owner: `8sync ccc delegate on | off | status`** (OFF by default).
  - When on, a product or technical AskUserQuestion is sent back to Claude with "have the `critic` agent grade the options (FATAL/MAJOR/MINOR), go with its pick (else the Recommended one), log it in `su-code/DECISIONS.md`, keep working".
  - The owner still answers the `Ship` question and anything about secrets/credentials/login, deletes or irreversible steps, money, production deploys, merges/releases, and high-risk decisions from the Usage Policy list (legal, medical, finance, credit, insurance, housing, hiring, admissions/grading, welfare).
  - New kit agent `critic` (read-only, Sonnet) and hook `ccc hook delegate` (PreToolUse on AskUserQuestion, no model call).
- **Rooms named after sessions.** At session start the kit reads the session's name from `8sync ccc .`'s registry and adds:
  - "Phòng của bạn": the role the name implies (`rd` → R&D, `qa`, `ui`, `api`, `ops`, `docs`, `sec`, `critic`, `lead`, `core`…; any other name is its own topic) plus up to 5 recall lines on that topic;
  - "Phòng khác đang làm": the other sessions of the same repo active in the last 2 hours, with their current task and files, so rooms don't edit the same files.
  - Same repo's registry only, masked, and fitted inside Claude Code's 10,000-char hook limit.
- **HQ office looks alive.**
  - 8th seat: Critic.
  - Every seat has a sprite with its own prop, empty seats included (resting, screen off).
  - Per-state frame timing, 1 px breathing, random blinks, a "done" flash, and a 4-frame walker with a dust puff.
  - One shared animation loop with a frame cache. It stops in hidden tabs and shows a still frame under reduced motion.
- Research brief `su-code/research/2026-10-15-always-on.md` covers Feynman, agent-sprite-forge, XERJ and Rust/wasm, with adopt/trial/skip calls and sources.

## [0.87.0] — 2026-10-14
### Added
- **Long tasks continue after a usage limit.** `8sync ccc kit` sets `autoContinueAtUsageLimit: true` in Claude Code user settings.
  - When a claude.ai usage limit stops a task, the open session waits and continues after the reset (Claude Code v2.1.234+; on by default there, now pinned).
  - An owner who turned it off in `/config` (`false`) stays off.
  - Limits of the feature (Claude Code's own): interactive sessions only (not `-p` or background sessions), resets within 24 h (not a weekly limit days out), at most 2 re-waits in a row, permission prompts still apply.
  - Same account, same plan. The kit does not switch accounts when a limit is hit: using several accounts to get around usage limits breaks the Usage Policy ("Do Not Abuse Our Platform"). To keep working before the reset, use `/usage-credits`, a bigger plan, or a Console API key.
  - Source: https://code.claude.com/docs/en/interactive-mode ("Wait for a usage limit to reset"), https://code.claude.com/docs/en/settings-reference (`autoContinueAtUsageLimit`).

## [0.86.0] — 2026-10-14
### Added
- **"Không ai rảnh" works like a real department.**
  - Quality gate: `ccc hook task-done` runs on `TaskCompleted`, sync, with the same `no_idle` switch.
    - It keeps a task open (exit 2) when the agent's transcript shows a code edit after its last test, lint or build command and the git tree still has uncommitted changes.
    - At most 2 holds per task, then the task passes.
    - Only real runners count as a check (`cargo test`, `pnpm run lint`, `pytest`, `8sync run`), not `ls tests`.
    - A teammate is judged by its own transcript. If that transcript is missing, the task passes.
  - Learning reflex: a task that was held back and then passed leaves one note. The member's next idle asks it to write the lesson with `/remember` (`failure: … → fix: …`). The hook never writes KNOWLEDGE itself.
  - The lead's advice (write the lesson, offer help to another session's room) now uses Stop `additionalContext`, which Claude Code shows as feedback, not as a hook error. Handing out an open task still blocks.
  - Source: https://code.claude.com/docs/en/hooks (TaskCompleted, Stop decision control).
- **HQ handoff cards across sessions.**
  - A `SendMessage` to another Claude Code session (a `uds:` address or a session name) is journaled under that session's id, with both session names ("core → rd").
  - The id is resolved from Claude Code's `~/.claude/sessions/<pid>.json` records. Only the `.json` files are read, never the `.key` files. The layout is not documented.
  - Only the message summary or its first line, at most 80 characters, is kept for another session, never the body (data minimisation).
  - The team thread card shows names and "đã trả lời / chưa trả lời" (the recipient wrote back afterwards).
  - Idle chips gain a "đang ghi bài học" state.
- `scripts/uat/no-idle-hook.sh`: 15/15 ok on Linux (task-done hold, then pass, then the lesson nudge).

## [0.85.0] — 2026-10-14
### Added
- **"Không ai rảnh" for agent teams** (`8sync ccc idle on|off|status`, default OFF). The kit registers a sync `ccc hook idle` on `TeammateIdle` and `Stop`; it decides from local files only (team task list `~/.claude/tasks/<team>/`, `su-code/STATE.md` Next, `su-code/KNOWLEDGE.md` `failure:` lines, other sessions' task lists), never calls a model. Teammate ladder: finish own in-progress task → take the next unblocked task via TaskList (Claude Code's file lock settles claims; the hook never assigns) → recall ≤5 lines → rest with a reason (Claude Code already notifies the lead when a teammate idles). Lead's Stop: hand out unowned tasks → when nothing is open, offer help to another session with open tasks → rest. Rails: ≤3 nudges in a row without task progress, the same nudge twice = rest, a $/hour budget from the status-line usage snapshots (default $5/h), and on a subscription login a lease the owner renews while present (`idle on --hours N`, default 2) because unattended automated use belongs on a Console API key. Each member's state is written to `~/.local/state/8sync/ccc/idle/status/` for `8sync hq ui`. Hook semantics: https://code.claude.com/docs/en/hooks (TeammateIdle exit 2), https://code.claude.com/docs/en/agent-teams (task list path).
- `scripts/uat/no-idle-hook.sh`: free sandbox UAT of the ladder and rails (12/12 ok on Linux).

## [0.84.0] — 2026-10-14
### Added
- `8sync ccc compact --window <100000..1000000>` / `--window-reset`: absolute cap on the auto-compact window (`CLAUDE_CODE_AUTO_COMPACT_WINDOW` in `~/.claude/settings.json` `env`, plain integer only; Claude Code also caps it at the model window and the env var beats `/autocompact`, `--autocompact` and `autoCompactWindow`). `compact` and `compact --json` show percent, window and the effective trigger "≈ pct × window" (8sync does not know the model window). `ccc kit` sets 400000 only when no window is set anywhere (env, `autoCompactWindow`, `modelSettings`), so Opus 1M compacts at ≈ 60 % × 400K = 240K instead of ≈ 580K; `kit --remove` drops it only while it still equals 400000. https://code.claude.com/docs/en/env-vars
- `scripts/uat/compact-window.sh`: real Haiku 5.5 run with the env var and no `--autocompact` flag. Measured first auto-compaction (override 60): 119,955 tokens = 60.0 % of 200K (US$0.21, token from the first file recalled after compaction); 58,098 at 120K and 50,136 at 100K, i.e. below 60 % at small windows (not verified why; those runs ended in Claude Code's autocompact-thrash stop, about US$0.04 each).

## [0.83.0] — 2026-10-14
### Added
- **`ccc kit` tool-output budget.** Writes `env.BASH_MAX_OUTPUT_LENGTH=20000` (documented default 30000) and `env.CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS=15000` (documented default 25,000) into `~/.claude/settings.json` only when absent. An owner value is never overwritten, and `kit --remove` drops a key only while it still equals the kit value. Output past the limit is not lost: Bash saves it to a file and Claude reads the rest on demand, and a long Read returns the first page with a `PARTIAL view` notice. Sources: https://code.claude.com/docs/en/env-vars, https://code.claude.com/docs/en/tools-reference#output-limits.
  - `scripts/uat/tool-output.sh` (real `claude -p`, Haiku 5.5, 2 runs each, cost about US$0.02 per arm): input tokens (input + cache) 171,115 / 171,177 at baseline vs 98,897 / 98,863 with the budget, about -42 %. Both runs still returned both hidden tokens (file end and command end). One task, Read and Bash effects not separated.
  - Not done: Read dedupe (skip re-reads of an unchanged file) stays a follow-up.

## [0.82.0] — 2026-10-14
### Fixed
- `8sync ccc kit` / `8sync up` / every `ccc` launch now refresh the 8sync block in ancestor CLAUDE.md files up to `$HOME` (exclusive), git repo or not: a stale FULL block becomes the current compact block (only text between the markers; CRLF and user text kept; `.bak-8sync` saved). A su-code memory dir's CLAUDE.md loses the block (a bare 8sync stub is deleted). cbm/serena lines still appear only when `harness cbm|serena on`.

## [0.81.1] — 2026-10-14
### Changed
- Release size ceiling 6272 → 6400 KiB, attributed in `scripts/size-gate.sh` (v0.81.0 linux-x86_64 was 6,428,208 B, 5,680 B over; +12,288 B vs v0.80.0). v0.81.0 was tagged but not published; 0.81.1 ships everything listed under 0.81.0.

## [0.81.0] — 2026-10-14 (tagged, not published)
### Added
- **Kit rules: cross-platform and rule gates are mandatory.**
  - Every build and release must work on Windows, macOS and Linux.
  - `/ship`, `/ship-auto`, `/ship-loop` and `/autopilot` merge only when CI is green on all three OSes (tests and release build). An OS without a job reads "not verified: <OS>" and blocks the merge.
  - Before every commit or Ship, the `sec` skill must be invoked, never replaced by a hand-written grep. `/rules` and `/aup-audit` run when the diff is high-risk, and always before a release.
- **`scripts/uat/`: real UATs with official `claude -p`.** They run in temp dirs, never touch the owner's config, and are budget-capped.
  - `compact.sh`: Claude Code auto-compacts at the `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` threshold. It measured 58.0 % of a 100K window with the override at 60, versus 75.6 % without it.
  - `up-kit.sh`: `8sync up` on an older machine refreshes the kit (stamp, statusline chain, compact env).
  - `auto-levels.sh`: `/ship-auto` and `/autopilot` on a toy repo with no remote. It checks green tests, conventional commits, a `sec` skill call in the transcript, ship state files, and that nothing was pushed.
- **`outputs/hq-team-ux.md`: cited UX brief for HQ.** It covers attention-first triage, needs-you, and the inter-agent thread. It has a gap table against v0.80.0 with a code/changelog basis for each row. Provenance is in `outputs/hq-team-ux.provenance.md`.

### Fixed
- **`8sync up` never refreshed the kit on Linux.** After the binary was replaced, `/proc/self/exe` reads `…/8sync (deleted)`, so `ccc kit` could not be started ("kit refresh failed"). `up` now resolves the install path before replacing the binary, and the path helper strips a trailing ` (deleted)`. A sandbox UAT now shows the kit stamp moving 0.79.1 → 0.80.0 with the fix.
- **`/ship-auto` and `/autopilot` skipped `/sec` and improvised without a remote.**
  - Both now must invoke the `sec` skill before every commit.
  - With no git remote, they commit, record `Ship: n/a (no remote)` and stop without asking Ship.
  - `/ship-auto` always writes `su-code/ship/<slug>/STATE.md`.
  - `/autopilot` runs every item, even a small one, through the `/ship-loop` rails (PLAN, `loop init`, `loop ev` evidence).

### Changed
- **`crates/ccc-core`** (lib `ccc_core`, `publish = false`): the session registry (`registry`, was `uuid_sessions.rs`), transcript scan + `Row`/`Digest` + `row_json`/`show_json` (`transcript`, was the pure half of `session_view.rs`), the secret masker (`secret_mask`) and `SCHEMA = 1` moved out of `crates/cli` into their own crate, with their unit tests. No behaviour change; the CLI keeps rendering/printing and re-exports the crate. ZUS pins it by git tag. Deps: `anyhow`, `serde`, `serde_json` only.

## [0.80.0] — 2026-10-14
### Added
- **HQ office: every session is a room.** The "Văn phòng" tab shows one room per running Claude Code session (started in HQ or anywhere else), grouped by the session's git folder and branch. Every room has the same seats (Lead, R&D, Plan, Fullstack, Reviewer, Tester, Quick); a seat lights up while that session's subagent of that kind runs (new `SubagentStart`/`SubagentStop` journal events). When a session messages another, its lead walks into the other room with the message (code-drawn walker sprite; static with reduced motion). The sidebar groups sessions by git folder and branch.
- **"Chat phòng" vs "Chat nhóm".** Chat phòng is one session's conversation (click a room to open it); Chat nhóm is every room talking to each other.
- **Message and assign to sessions started outside HQ (inbox).** The composer, Board and "Giao việc" reach any live session: non-tmux sessions (all of Windows) get the message through an owner inbox that the Stop hook hands over at the end of the current turn (`~/.local/state/8sync/hq/inbox/<session id>.jsonl`, 0600, secrets masked).
- **`8sync ccc secret set <encore|vercel|gh> <NAME> (--from <env-file> | --generate)`**: puts a secret into Encore (`--type prod,dev,pr,local`), Vercel (`--env production|preview|development`) or GitHub Actions through the provider CLI's stdin. The value never reaches the transcript, argv, a file or git; output shows the name and result only (the value is scrubbed and anything key-shaped masked). `secret keys <env-file>` lists key names only. `--generate` uses 48 bytes of OS randomness. Third-party keys (Mistral, PayOS…) still come from the owner. Encore's environment types are `prod, dev, pr, local` (`preview` is rejected with a hint).
- **`8sync ccc loop ev <slug> <label> -- '<cmd>'`**: runs one acceptance check and appends `iter N | label | exit E | last line` to LOOP.md; `/ship-loop` uses it instead of ad-hoc `bash -c "$2"` helpers the guard cannot read.
- **Kit teaches the auto mode classifier 8 Sync's infrastructure** (`autoMode.environment` in `~/.claude/settings.json`, Anthropic's `$defaults` kept, no allow/deny rule changed): GitHub orgs 8-Sync-Dev and 8syncdev, 8syncdev.com, Vercel and Encore Cloud deploy targets, and secrets set through `8sync ccc secret set`. `kit --remove` takes the entries back out (https://code.claude.com/docs/en/auto-mode-config).
- **`8sync ccc . report [--json]` and the "Báo cáo" tab.** Cost, time, lines +/−, context, tasks done/open and $ per finished task per session plus totals, and the `/ship-loop` runs. Numbers come from what Claude Code gives the 8sync status line (snapshot in `~/.local/state/8sync/hq/usage/`, written only when a number moves); unmeasured sessions read "chưa đo", never an estimate, and $/task only counts sessions with a measured cost.

### Fixed
- **HQ: clicking a running session showed "Start a session".** The composer only counted sessions HQ started in tmux, and scope matched the session name only. Any live session HQ can reach now counts, and a session is matched by name, session id or label; the header counts every live session.
- **HQ Board offered no session** ("Start a session to hand it tasks") while sessions were running: same tmux-only filter.
- **HQ tests wrote into the real HQ state on Windows** (`os.homedir()` reads `USERPROFILE`, tests set only `HOME`); a test run could rotate the owner's journal. Tests now isolate both.
- HQ tab bar overflowed at phone width.
- **Fewer "Do you want to proceed?" prompts in auto mode.** Replaying 2,397 real shell calls from three days of sessions: guard prompts went from 91 to 18 (the rest are pushes/merges, which the one `Ship` question approves, and deletes outside the repo). When 8sync merely cannot read a command (a command held in a variable, a delete target known only at run time, a piped script), auto mode now gets a deny with the fix, so Claude rewrites the command and continues; other permission modes still ask. Known-destructive work still asks; catastrophic deletes stay denied.
- Guard: a `|` inside a quoted search pattern (`grep -E "a|git push encore"`) was read as a push to a deploy remote. Shipping is now detected on a quote-aware split; quoted scripts (`bash -c "git push …"`) are still checked.
- Guard: the project is the git root above the session directory, so after a `cd apps/x` a delete elsewhere in the same repo no longer counts as "outside the project". `~/tmp` counts as a scratch directory.
- Guard: a recursive search that would print a `.env` is denied with the fix (`--exclude='.env*'`) instead of asking the user.
- Kit no longer installs `Edit(**/.env)` / `Edit(**/.env.*)` deny rules and removes them on update: Claude Code applies Edit deny rules to `rm` in Bash, so Claude could not delete a stray `.env` copy. Reading `.env` stays denied (`Read(...)` rules + guard), and the guard still blocks printing credentials and writing real secrets.

### Security
- The kit guard denies a session writing the HQ owner inbox or reading the HQ UI token (Bash, PowerShell, Write, Edit), so a session cannot speak as the owner to another session.

## [0.79.1] — 2026-10-14
### Fixed
- **`8sync hq ui` on Windows**: the first-run download failed with `curl: (43) A libcurl function was given a bad argument`. The stock Windows `curl.exe` (8.8.0, what PowerShell runs) rejects every `--write-out`; the HQ UI download now uses `--fail` and reads the HTTP status from curl's error, and the Discord API calls (`hq setup`/`post`/hooks) read it from the response headers (`include`). Reproduced and verified on this box with `C:\Windows\System32\curl.exe` first on PATH: 0.79.0 fails with error 43, the fix downloads, checks the sha256 and starts the UI.

## [0.79.0] — 2026-10-13
### Added
- **HQ web team control (`8sync hq ui`).** Everything works from the browser:
  - **Roles with model routing.** R&D, Plan and Architect use Opus 5.5. Fullstack, AI and Reviewer use Sonnet 5.5. Tester and Quick use Haiku 5.5. The model can be overridden from an allowlist of those three ids. The session starts with `--model` and `EIGHTSYNC_HQ_ROLE`, and the role badge shows on session rows.
  - **"Giao việc" dialog.** Send a task to a role or to one session. With a role, HQ reuses the least busy running session or starts `hq-<role>-<n>`. A new session gets the task as its first prompt, so a booting pane never loses it. Errors show inside the dialog, and projects whose folder is gone are not offered.
  - **Live terminal drawer.** Click a desk or a "needs you" card to open the session's tmux screen, refreshed under 1 s. The drawer has a "Gõ cho session" box, dialog keys and a full-screen toggle.
  - **"Chat nhóm" tab.** One thread with owner messages, replies, handoff cards (A → B), task cards with role, and "needs you" callouts.
  - **Handoff bubbles.** Desks show "→ B" / "← A" for 4 s when a session messages another. Reduced motion shows a static label.
  - **"Cách dùng" guide.** Five steps in Vietnamese, opened on first run and from the header.
  - **`scripts/hq-offline-check.sh`.** It fails on non-local fetch/WebSocket/EventSource targets, remote fonts/CDNs, or key-shaped strings in the UI source.
- **`8sync ccc compact`**: auto-compact threshold for Claude Code sessions. `compact` shows it (`--json`), `compact --at <10..95>` writes `env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` in `~/.claude/settings.json` (atomic + `.bak-8sync`, other keys kept, no-op when unchanged), `compact --reset` removes it. `ccc kit` sets 60 only when the key is absent (an owner value is never overwritten); `kit --remove` drops it only if it still equals 60. Claude Code can only lower the threshold with this variable, and it applies to new sessions (https://code.claude.com/docs/en/env-vars).
- **`8sync ccc help`**: every ccc verb on one screen (Vietnamese), grouped Session / Kit / Tự động / Xem / An toàn. A unit test reads the dispatcher and fails if a verb is missing from the list.
- **Statusline reaches every machine**: `8sync ccc kit` now installs the 8sync status line (and subagent line) by default and chains a foreign `statusLine` as the last row (parked as `statusLine_prev`), instead of only printing a hint; our command path is refreshed to the current exe. `8sync ccc statusline --uninstall` records `statusline = false` in `features.toml` so the kit never reinstalls it; `--install` clears that. **Behaviour change** (kit used to keep a foreign statusLine untouched).
- **`8sync up` refreshes the kit** after a successful update when a kit is installed (runs `ccc kit` on the new binary), so other machines get new kit files + statusline without a separate step.
- Statusline faster and tidier: branch read from `.git/HEAD` (worktrees and detached HEAD handled, no `git` spawn; one spawn left for the dirty check); model label `Opus 5.5 (1M context)` → `Opus 5.5 · 1M`, effort dim `med/high/low`; row 2 shows the dim folder name outside a git repo.

### Fixed
- HQ journal: a `SendMessage` sender that is the session's own uuid was masked to `***`, so every handoff lost its sender. The own session id now bypasses the masker, and the web falls back to the row's session for older rows.
- `8sync ccc <verb-like word>` (`help`, `compact`, `guard`, `ship-grant`, …) never starts a headless claude session: reserved words route to their handler or print help.

## [0.78.1] — 2026-10-13
### Changed
- Release size ceiling 6144 → 6272 KiB from the measured v0.78.0 linux-x86_64 asset (6,338,096 B, 46,640 B over: statusline + JSON surfaces). v0.78.0 was tagged but not published; this release carries everything listed under 0.78.0.

## [0.78.0] — 2026-10-13
### Added
- **`8sync ccc statusline`: a Claude Code status line.** Row 1: model (+ effort), context bar (green below 50%, yellow 50–80%, red above 80%), 5h and 7d rate limits with reset countdown (`↻ 1h23m`, only when Claude Code sends them), session cost, `+lines/-lines`. Row 2: branch (`*` when dirty; 50 ms git budget), PR `#12 ✓/●/✗` from Claude Code's own `pr` field (no `gh` calls), tasks done/total with the current task, fresh watchdog alert, `ccc loop` iteration, `🚢 grant` while the session holds a ship grant. Respects `COLUMNS`, never fails (falls back to `8sync · <model>`).
- `8sync ccc statusline --agents` for `subagentStatusLine`: `⚙ 2 running (task 3m12s · reviewer 40s) · 1 idle`.
- `8sync ccc statusline --install` / `--uninstall`. `ccc kit --remove` also restores your previous statusLine. A foreign `statusLine` is parked as `statusLine_prev` in `~/.config/8sync/features.toml` and chained: it runs with the same stdin and its output becomes the last row. `8sync ccc kit` installs it only when no `statusLine` exists and prints a hint otherwise.
- **ccc JSON surfaces** (`docs/hq-ui-contract.md` section 4): `8sync ccc . show <name> --json` / `8sync show <name> --json` (adds `last_users`, `last_text`, `tasks`, `files`, masked), `8sync ccc kit status --json`, `8sync ccc login-kind [--json]` (presence checks only, never prints a token or email). Every ccc/ls JSON output now carries `"schema": 1` (on each row for arrays).

## [0.77.0] — 2026-10-13
### Added
- **`--offline` for `8sync ccc`** (`new <name>`, `<name>`, `.`, `kit`; or `EIGHTSYNC_OFFLINE=1`): no network step runs — no auto-update, no background update probe, no Claude Code installer (`claude` must already be on PATH), no `claude mcp add-json` mirroring. Kit files and local skill linking still install. Each skipped step prints one `skip` line. All of these go through one `net_allowed` gate, covered by unit tests.

### Fixed
- Security: `8sync ls/show` and the HQ journal printed passwords typed in prose ("sudo password của tôi là …", "mật khẩu: …", "pass: …", "password is …"). The shared masker (`secret_mask.rs`) now masks the value after pass/password/passwd/pwd/pin/otp/secret/token/api key/mật khẩu/sudo triggers; ordinary prose ("password reset flow", "sudo apt install") is left alone.
- Floor: desk subtitle no longer shows a truncated full session uuid; a paired hq session id goes to `sid` and keeps the ls name (`apps/hq-ui/lib/floor.ts`, `lib/server/floor.ts`).
- Session registry (`index.json` for `forge` / `ccc .`) is now written atomically under an exclusive lock (`index.json.lock`, tmp + rename) through one `update` helper, so concurrent launches no longer lose entries; a corrupt index is kept as `index.json.corrupt-<unix>` and rebuilt instead of silently dropped. On-disk format unchanged.



## [0.76.0] — 2026-10-13
### Added
- **Five graded auto commands for ccc** (all inside official Claude Code; no bypassPermissions): `/do <việc>` (one small change, no plan, no commit, light checks), `/ship` (full process), `/ship-auto` (ship through PR → CI → merge → release → install → monitor with ONE "Ship" question), `/ship-loop <mục tiêu>` (acceptance criteria with check commands, iterate implement → check → fix with evidence in `LOOP.md`, caps `--max-iter 12` / `--max-min 90`, stuck and no-change detection via `8sync ccc loop`; Claude Code's built-in `/goal` can be layered on top by the owner), `/autopilot` (unattended backlog: issues labelled ccc/8sync → STATE Next → KNOWLEDGE failures; one Ship question per batch; respects other sessions' lanes). Levels 3–5 are owner-invoked only (`disable-model-invocation`).
- `8sync ccc loop <init|tick|status|done|ls>`: bounded-loop state (`su-code/ship/<slug>/loop.json`) with stop rules max-iter, max-min, stuck (same digest twice) and no-change; kit gains the `do`, `ship-auto`, `ship-loop`, `autopilot` skills (`ship-loop`, `autopilot` stay core).
- `8sync ls --json` rows gain `sid` (Claude session uuid for `claude`/`ccc` engines, `null` otherwise); other fields unchanged.

### Fixed
- **hq-ui "Văn phòng": a running Claude session no longer shows as two desks.** The floor now joins an hq session to its `8sync ls` row by session id, then by name, then by folder (`~` expanded; an agent working in a subfolder or worktree of the repo still matches when that is unambiguous). Matched sessions are never appended again. A truly unknown hq session still shows, labelled with its 8-char id instead of the full uuid, after the matched desks.

## [0.75.0] — 2026-10-13
### Changed
- Release size ceiling 6080 → 6144 KiB from the measured v0.74.0 linux-x86_64 asset (6,231,472 B, 5,552 B over: taste-skill variants + `ls` fields). v0.74.0 was tagged but not published; this release carries everything listed under 0.74.0.

### Added
- **Ship once, not at every step.** Claude now asks a single `AskUserQuestion` with header "Ship" that lists every merge, push to main, tag, release, publish and production deploy it will do. Options: "Duyệt tất cả", "Chỉ merge, chưa deploy" or "Dừng".
  - Claude Code passes the owner's answer to the new `ccc hook ship-grant` (PostToolUse on AskUserQuestion), so it cannot be forged. The hook writes an 8-hour grant for that session (0600 file).
  - The guard then lets those shipping steps through without a prompt each time. "Chỉ merge" grants shipping but not production deploys.
  - Deny rules (force-push, deleting roots, secrets) never look at a grant. A command that also contains a non-shipping ask still prompts.
  - Before this, every `gh pr merge` or `vercel --prod` prompted separately.

## [0.74.0] — 2026-10-13
### Added
- **`8sync hq ui` "Văn phòng" (default tab): every Claude Code / omp session is a pixel coworker at a desk.**
  - Seven code-drawn 32×32 animated states: resting, typing, running a command, reading/searching, waiting for you (raised hand), stuck (red "!"), done (cheer).
  - Each desk shows a Vietnamese text label, one caption line and task progress; waiting and stuck desks come first, and old idle ones are collapsed.
  - The sprites are drawn in the browser on a canvas: no image files, no image-generation APIs.
  - The animation runs at about 7 fps, pauses while the tab is hidden or the desk is offscreen, and shows a single frame under `prefers-reduced-motion`.
  - Data comes from the new token-gated `/api/floor` (`8sync ls --json --all` + hq sessions, 4 s cache, single flight).
  - Desks are grouped by repo. Working, waiting and stuck sessions sit as large desks (character ~100 px) in one shared pixel room per repo. Idle and done sessions show as one line each (state, name, engine, last line, age). Repos with someone waiting or stuck come first.
  - Each desk shows an engine badge (Claude / omp). Repeated names inside a repo get the 8-char session id (or `#n`). Leading emoji and ALLCAPS tags ("🔗 TRACE:") are hidden from titles; the full title stays in the tooltip.
  - Waiting desks get a lime ring and a "Chờ anh" badge; stuck desks get a red ring and a "Kẹt" badge.
- **Sidebar: projects whose folder no longer exists fold under "Không còn thư mục (N)".** `GET /api/projects` now returns `missing` per project. No data is deleted.
- **`8sync ls --json` rows gain `last_tool` and `stalled_error`.** `last_tool` is the raw name of the latest tool. `stalled_error` is the API error that the kit's StopFailure hook recorded for that Claude session within the last 24 h.
- **HQ UI on brand and simpler.**
  - 8 Sync mark and lime-on-near-black tokens (WCAG AA checked in light and dark); Geist and Be Vietnam Pro fonts.
  - Readable session names instead of uuids, with old or ended sessions under "Older".
  - The composer is replaced by a "Start a session" action when no session is running.
  - Chat is rendered with Vercel AI Elements components (display only: no model calls, no keys).
- CI runs hq-ui typecheck (`next typegen` + `tsc`) and vitest, and uploads the packaged hq-ui tarball as an artifact for local UAT without building.
### Changed
- **Release notes come from CHANGELOG:** the release workflow publishes the version's CHANGELOG section plus an install line, followed by GitHub's generated PR list. Before this, the notes were only the PR title. The v0.72.0 and v0.73.0 notes were rewritten the same way.
- `taste-skill` (design-taste-frontend) refreshed from upstream Leonxlnx/taste-skill d237dd3 (MIT, LICENSE now shipped). Five plain-markdown variants are added as skills: `taste-brutalist`, `taste-minimalist`, `taste-soft`, `taste-redesign` and `taste-output`. Variants that need image generation or Google Stitch are left out.

## [0.73.0] — 2026-10-13
### Added
- **`/ui-ux <việc>`**: an easy-to-type entry point for UI/UX work. The `/` menu matches skill names, so `/ui` never found `impeccable`. It opens `impeccable` (the 8 Sync design system) first and routes to the right sub-command, then to taste-skill, frontend-ui-engineering, senior-frontend, nextjs-app or browser testing when they fit.
- The kit links **every** skill in `~/.omp/skills`, not only the 29 8sync ships. Previously `frontend-ui-engineering`, `browser-testing-with-devtools`, `api-and-interface-design` and others were missing from Claude Code.
- **Workspace skill libraries for every ccc session:** `8sync ccc kit --skills-from <dir>` registers a skill folder, for example `~/startup/8sync-startup/su-code/skills` with its 237 skills (`loop-me`, `grill-me`, `agent-browser`, `live-verify`…). Before this, those skills only existed inside that repo.
  - Each kit run links every skill Claude Code doesn't have yet into `~/.claude/skills`. Kit files, bundled skills and the owner's own skills are never overwritten.
  - Library skills are listed by name only (`skillOverrides`), so a large library barely grows the session prefix.
  - The libraries are kept in `features.toml` as `skill_libraries`.

## [0.72.0] — 2026-10-13
### Fixed
- Guard: a data here-doc later in the command (`cat > report.md <<'EOF' … for … () …`) no longer turns off variable resolution, so `S=/tmp/x/scratchpad; rm -rf $S/target` stops asking (seen live in a subagent's cleanup).

### Added
- **Watchdog soft remedy + early warning:** under sustained pressure (MemAvailable, load, or PSI `/proc/pressure` memory/io full, cpu some) busy session processes — compilers, linkers, bundlers (new `build` list) and watched runtimes, above 25% CPU — get `renice 19` + `ionice -c3` once (they keep running; never killed), and Claude is told to stop parallel agents/builds and use CI. PSI gives its own `pressure` alert, earlier than MemAvailable/load.
- **Watchdog GPU without vendor tools:** AMD GPUs are read from sysfs (`gpu_busy_percent`, `mem_info_vram_*`) and warn on busy/VRAM; `8sync watchdog status` shows the GPU sources, says when an NVIDIA card is present but unmeasured (no `nvidia-smi`), and prints PSI.
- **Session fence (Linux, systemd --user):** `8sync ccc .` runs claude inside `8sync-ccc.slice` — shared by all ccc sessions, `MemoryHigh=70%` (soft: the kernel throttles, never kills), `CPUWeight=50`, `IOWeight=50` — so a heavy session slows down instead of freezing the desktop. Off: `EIGHTSYNC_FENCE=0` or `session_fence = false` in features.toml.
- **Kit rules: no heavy local builds; sessions work as a team.** Heavy build/test goes to GitHub Actions (`gh workflow run` → `gh run watch` → `--log-failed`); locally only light checks under `nice -n 19 ionice -c3 -j2`; never flip repo visibility for free minutes. Sessions check `8sync ccc . ls` / ListAgents first, split overlapping work and announce shared changes via SendMessage.

## [0.71.0] — 2026-10-13
### Added
- **Stop gate checks the task list:** when Claude touched its tasks (TaskCreate/TaskUpdate/TodoWrite) since the owner's last message and still has open tasks of this turn (in progress, or created since that message — older pending ones are left alone), a silent stop is blocked once with their titles ("finish them, or mark them completed/deleted, or say what you need"). A question to the owner, a hand-off, a risky action, the owner saying stop, or a second stop in a row still end the turn. Never blocks an agent-team lead (TeamCreate/SendMessage: teammates' completions are not in its transcript) or a transcript only tail-scanned (> 24 MB). Measured on a 14 MB transcript: 34–38 ms (release); 5 ms when tasks were not touched this turn.
- **Turns that die on an API error are caught:** `ccc hook stop-failure` (Claude Code's `StopFailure`: rate_limit, overloaded, server_error, max_output_tokens, …) records the error per session (0600 file in a 0700 dir under `~/.local/state/8sync/ccc/stopfail`, dropped after 24 h; nothing written without an absolute HOME) and shows a desktop notification; on the next prompt in that session — even a bare "tiếp" — `ccc hook resume-note` tells Claude its last turn ended early and to check TaskList and `su-code/ship/ACTIVE` before continuing (said once). StopFailure itself cannot make Claude continue (docs: no decision control).

## [0.70.0] — 2026-10-13
### Added
- **`/ship` runs the whole team process:** plan → R&D → code → test → UAT → review/QC (`/sec`, `/aup-audit` when triggered) → docs + memory → commit; with a trailing `--release`/`--deploy` flag it goes on to PR → CI → merge/tag/deploy → monitor (no push without it). State lives in `su-code/ship/<slug>/STATE.md`; `su-code/ship/ACTIVE` names the running one and the session-start digest puts its head first, so it survives /compact, /clear and resume.
- **`/planning`** (plan only: acceptance criteria, tasks by file, risks, one batched question), **`/remember`** (one evidence-backed `failure:`/`validated:`/`decision:` line in `su-code/KNOWLEDGE.md`) and **`/consolidate`** (dedup/prune memory, owner approves once). Kit: 22 files.
- **Session thread survives /compact and resume:** `ccc hook session-start` (matcher now `startup|resume|clear|compact`) appends this session's latest owner requests, open tasks first and recent files (masked, ≤ 3 KB; STATE digest + block ≤ ~9 KB, under the 10,000-char hook cap). Measured on a 14 MB transcript: 149 ms (debug build).
- Release size ceiling 6016 → 6080 KiB (+14,320 B local gnu vs v0.69.0, embedded skills; attribution in `scripts/size-gate.sh`).
- **Guard asks before shipping:** push to `main`/`master`, tag pushes (`v1.2.3`, `--tags`, `--follow-tags`), push to an `encore` remote, `gh pr merge`, `gh release create`, `vercel --prod`, `npm|pnpm|yarn|bun|cargo publish`, `fly|flyctl|wrangler|firebase deploy`. Feature-branch pushes, PRs and dry-runs stay silent.

### Fixed
- Watchdog: machine load is compared with the real core count from `/proc/stat`; under the service's `CPUQuota=5%`, `available_parallelism` reported 1 core, so load > 2 alerted on a 16-core box.
- Watchdog: a RAM/CPU alert for a process that is not a known helper (e.g. `node`) no longer says "keep that helper off"; it says the watchdog only reports it.


## [0.69.0] — 2026-10-13
### Added
- **`8sync watchdog`** — an always-on, std-only guard (reads `/proc`, ~2 s period) for runaway harness helpers. `run [--dry-run]` builds the process trees under `claude`/`omp` plus known helpers (codebase-memory-mcp, serena, headroom, codegraph, tsserver, rust-analyzer…; list in `~/.config/8sync/watchdog.toml`, created with defaults) and, on sustained CPU / RSS, machine MemAvailable or load, GPU memory (optional `nvidia-smi`, 10 s), writes an alert to `~/.local/state/8sync/watchdog/alerts.jsonl` (0600), calls `notify-send`, and — only for known helpers running inside a `claude`/`omp` process tree, never `claude`/`omp`/editors/browsers/runtimes, and never for the `warn_only` indexers (codegraph, LSPs: alert only) — sends SIGTERM then SIGKILL after a grace period; a helper killed more than 3× in 10 min is quarantined in `~/.config/8sync/watchdog-blocked`. `install|uninstall|status` manage a `systemd --user` service (Nice=10, CPUQuota=5%, MemoryMax=64M; other OSes print "not supported yet").
- **`8sync ccc hook watchdog`** (registered by `8sync ccc kit` on `UserPromptSubmit` and `PostToolUse`, synchronous, timeout 5): feeds unseen alerts for this session's process tree or the whole machine to Claude Code as `hookSpecificOutput.additionalContext` (≤ 1,500 chars; per-session cursor; no output and no writes when nothing is new).
- `8sync harness cbm|serena off` removes the Claude Code user-scope entry only when it is the exact launcher 8sync mirrored; an owner-added entry with the same name is kept (hint printed). `features.toml` that does not parse is reported, never overwritten.
- **`8sync watchdog unblock <name>|--all`** allows a quarantined helper again; the blocked list is updated under a file lock with tmp+rename, the running service re-reads it every tick and the helper starts with a clean kill history. Alerts for codebase-memory-mcp / serena point at `8sync harness cbm off` / `8sync harness serena off`.
- Release size ceiling 5952 → 6016 KiB (watchdog + cbm/serena switches: +87,176 B on a local gnu release vs v0.68.0; attribution in `scripts/size-gate.sh`).
### Changed
- **Kit question rules:** questions go in one batched `AskUserQuestion` (≤4, Recommended first, one Submit); when the owner says "tự làm đi"/"auto", Claude picks Recommended for every product/technical question and states assumptions — secrets and destructive/paid/prod/push-main actions still ask. Fewer permission prompts: run in the session dir, `git -C`/absolute paths instead of `cd … &&`, worktrees inside the repo.
- **codebase-memory-mcp is now strictly opt-in (default off).** Its index worker, one MCP server per Claude Code/omp session and a systemd --user daemon pegged the CPU (one worker ~283% / 847 MB, 1.2 GB cache). `8sync harness`, `harness up/auto` and `8sync ccc kit` no longer install, register or index it unless enabled. Toggle with `8sync harness cbm on|off|status` (stored in `~/.config/8sync/features.toml` as `codebase_memory_mcp`; `EIGHTSYNC_CBM=1|0` overrides). `off` also removes it from Claude Code (user scope) and the 8sync-written entry from `~/.omp/agent/mcp.json` (other entries untouched); it kills nothing, only prints a hint. When on, `auto_index` is set to `false` (index on demand only) instead of `true`. A stub binary (`--version` says "disabled"/"(stub)") counts as not installed and is never registered. Kit CLAUDE.md / injected block no longer tell agents to use it first (codegraph CLI first).
- **serena MCP is opt-in too (default off).** Python/JS MCP servers cost a process per agent session; 8sync prefers native/Rust tooling (codegraph CLI, Claude Code LSP plugins). `8sync harness serena on|off|status` (`serena` key in `features.toml`, `EIGHTSYNC_SERENA=1|0` overrides); `ccc kit` and `harness up` no longer register it unless enabled; `off` removes it from Claude Code (user scope) and the uvx entry from omp's mcp.json.
- **Agent guidance is codegraph-first; cbm/serena text is gated on the flags.** Rules, APPEND_SYSTEM, force-load, kit CLAUDE.md, AGENTS/CLAUDE blocks, commands and bashInterceptor messages only mention `mcp__codebase_memory_mcp_*` / `mcp__serena_*` when `harness cbm|serena on` (asset lines prefixed `@cbm ` / `@serena `; `code_intel_available` also requires the flag).

## [0.68.0] — 2026-10-13
### Added
- **`8sync hq ui` works without a repo checkout.** The UI (Next standalone) and the `8sync-hq` channel (one esbuild file, no `node_modules`) ship as a platform-independent release asset `8sync-hq-ui-v<version>.tar.gz` + `.sha256` (built by the new `hq-ui` job in `release.yml` via `scripts/package-hq-ui.sh`, which fails if any native `.node`/`.so` is inside). On first run 8sync downloads it with `curl` (https only), verifies the sha256 (mismatch or no hasher = refuse, existing install untouched), extracts it with `tar` into `.tmp-<pid>` (refuses absolute / `..` entries and any symlink or file that resolves outside the tree), then swaps it atomically into `~/.local/share/8sync/hq-ui/<version>/`, then runs `node hq-ui/server.js` (no pnpm). It also writes `~/.config/8sync/hq/channel-mcp.json` (0600) for the installed channel and defaults `HQ_CHANNEL_FLAGS` for the UI process. Resolution order: `--app` / `EIGHTSYNC_HQ_UI_APP`, installed copy, a *built* `~/tools/su-code/apps/hq-ui`, else download. `8sync hq ui --update` reinstalls; `EIGHTSYNC_HQ_UI_TARBALL=<file>` installs a local tarball (sha from `<file>.sha256`).

- Install hardening: `<base>/.install.lock` (stale after 10 min), failed update restores the previous install, leftover `.tmp-*`/`.dl-*`/`.old-*` older than 1 h are cleaned, only the current and previous version dirs are kept. The `.sha256` comes from the same release as the tarball, so it checks integrity (corrupt/partial download), not an independent root of trust; when the GitHub API lists an asset digest it is cross-checked too (mismatch = refuse; API unreachable = warning). The asset has no symlinks (dereferenced when packaged; `ci.yml` job `package-hq-ui` checks it on PRs) and no server-side `*.js.map`. `--update` with `--app` / `EIGHTSYNC_HQ_UI_APP` prints a warning.

### Fixed
- `8sync hq ui --app <dir>` / env / a repo checkout now runs the app's `pnpm start` (fallback `npm start`) instead of `.next/standalone/server.js`, which has no `.next/static` next to it (every CSS/JS asset 404). Only the installed release asset runs `hq-ui/server.js`.

### Changed
- `apps/hq-channel` pins `esbuild` 0.25.12 as a devDependency; the package script uses `pnpm exec esbuild`.
- `apps/hq-ui` builds with `output: "standalone"`, `images.unoptimized` and sharp/libvips excluded from tracing (platform-independent asset). The old `<exe>/../share/8sync/hq-ui` lookup is gone.

## [0.67.1] — 2026-10-13
### Changed
- Release size ceiling 5888 → 5952 KiB from the measured v0.67.0 linux-x86_64 asset (6,030,288 B, 976 B over). v0.67.0 was tagged but not published; this release carries everything listed under 0.67.0.

## [0.67.0] — 2026-10-13 (not published)
### Added
- **`8sync ccc . ls` shows what every session is doing**: `● running` (a live Claude Code process holds it), `● active` (written < 2 min ago) or `○ idle`; the latest request ("ask"), the latest action ("now"), task progress (`todo 3/7 ▸ current task`, from TaskCreate/TaskUpdate/TodoWrite), messages, context tokens and model. Width-aware, secrets masked (title included), reads at most the last 256 KB of transcripts over 24 MB and smaller ones whole, on at most 8 threads (45–115 ms per repo here); a session whose scan fails shows as `unreadable` instead of vanishing. `--json` carries the same fields. `8sync . ls` (omp) uses the same view.
- `8sync ls [--all]` (every session of this repo, or of every repo), `8sync show <name>` (last 5 requests, last answer, task checklist, files touched, resume line), `8sync guide` (Vietnamese quickstart, Claude Code first); full guide in `docs/huong-dan.md`.
- **Local team UI: `8sync hq ui`** (Next.js + shadcn/ui, SQLite via `node:sqlite`, 127.0.0.1 only, local token + Origin/Host checks): add project folders, start official Claude Code sessions in tmux, team chat, kanban board, live session status, an interactive terminal drawer (allow-listed keys: Enter/Esc/↑/↓/Tab/1–3/y/n/typed text) to answer Claude Code's dialogs, activity log. Hooks write a local journal (`~/.local/state/8sync/hq/events.jsonl`, 0600) when `local = true`: tasks, session start/end, cross-session `SendMessage`, and, only for `hq-*` sessions started by the UI, each turn's final answer (Stop hook `last_assistant_message`) and notifications. Every text/subject field passes the shared secret masker first (heuristic: see below). `8sync hq ui` prints a notice when it turns `local` on (and only after the UI process started); `8sync hq ui --off` turns it off; `8sync hq purge [--yes]` deletes `events*.jsonl`, `hq.db*` and `channel-*.json` under `~/.local/state/8sync/hq` (without `--yes` it only lists them). Files are rotated at 5 MB (one `events.1.jsonl` kept) and stay until you purge.
  - Owner messages go to the session through the `8sync-hq` channel when Channels work, else they are typed into the session's own terminal. The UI detects "Channels are not enabled for your org" and uses the terminal, retries an unanswered channel message in the terminal after 25 s, and **refuses (409) to type while Claude shows a dialog**: in a live test, a message typed into the "Teach auto mode" wizard had moved it to "scan shell history: true" (cancelled before Continue).
  - Live UAT on Claude Code 2.1.296 (Team login): folder-trust dialog answered from the UI's key API, owner message → task created/completed → board shows it under the session name → the Vietnamese answer appears in the chat; session `alpha` found `beta` with `ListAgents`, asked it over `SendMessage`, and relayed its answer. Channels on this org are off ("set channelsEnabled"), so the channel path itself is tested with an MCP client only.
- **`8sync ccc . <name> --team`** starts the session with Claude Code agent teams on (env `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` for that launch only, never written to settings); `--panes` shows teammates as tmux split panes (`teammateMode: "tmux"`, inside tmux). `8sync ccc . --team` with no name reopens the last-used session with teams on. Refuses `-p`, `-pc` and `--print=…`, because Claude Code spawns no teammates there. Live: the lead spawned `@helper` from the kit's `quick-task` agent, helper answered, the lead relayed it.
- `8sync ccc kit --remove` takes every 8sync hook entry out of `~/.claude/settings.json` (your own hooks stay, also when they share a group with an 8sync hook). It writes nothing when there is nothing to remove, keeps `settings.json.bak-8sync`, and replaces the file by rename. Run it before uninstalling 8sync: the guard now fails closed. If the binary is already gone, see the manual recipe in `docs/huong-dan.md`.
- **One shared secret masker** (`verbs/secret_mask.rs`) for `8sync ls/show/--json` and the HQ journal: splits on any whitespace, handles `key: value`, `key=value`, `"key":"value"` for token/secret/password/passwd/api_key/apikey/access_key/private_key/authorization/bearer/cookie/session, known prefixes (`sk-ant-`, `sk-`, `ghp_`/`gho_`, `github_pat_`, `AKIA`/`ASIA`, `xox[bpas]-`, JWT `eyJ`, `AIza`, Discord bot token shape) and PEM blocks. Heuristic: a secret with no name and no known shape is not caught, and non-English key names (e.g. Vietnamese "mật khẩu:") are not recognised. Non-ASCII text before `:`/`=` ("Lưu ý:") is handled (a slicing panic found in review is fixed and fuzz-tested).

- **The Claude Code guard now stops destructive shell commands, in Bash and in PowerShell** (`crates/cli/src/verbs/ccc/danger.rs`). Measured against omp 18.9 and Forge 2.14 on direct instructions: both deleted a folder outside the repo, printed `.env` and force-pushed; `8sync ccc` stopped all three: force-push denied by the guard, the outside delete asked first (a denial under `claude -p`), `.env` refused by the org rules before any tool call.
  - **Denied:** deleting a filesystem root, a top-level folder, the home directory, the project or any of their ancestors, or a temp root, also as "everything in it" (`rm -rf *`, `rm -rf */`, `find . -delete`, `Remove-Item -Recurse ~`, `rd /s /q C:\Users\me`, `[IO.Directory]::Delete`); disk wipes (`mkfs`, `dd of=/dev/sdX`, `Format-Volume`, `diskpart`); `wsl --unregister`; force-push in every spelling (`-f`, `-uf`, `--force-with-lease`, `+ref`, `--mirror`, `-c remote.*.push=+…`); printing or uploading a credential file (`cat .env`, `cat .env*`, `Get-Content .env`, `curl -F f=@.env`, `scp .env host:`).
  - **Asked first** (a denial Claude reads under `claude -p`): deletes outside the project and the temp dirs, `rm -rf .git`, targets only known at run time (`$VAR`, `$(…)`, `xargs`, a filtered pipeline into `Remove-Item` such as `gci | ? Name -like x | Remove-Item`), deletes inside `wsl`/`ssh`/`docker exec`/`kubectl exec`, a script piped into a shell (`curl … | bash`), `-EncodedCommand`, unbalanced quotes, `git reset --hard`, `git clean -f`, deleting a remote branch.
  - It reads the command the way the shell does: quotes, escapes, line continuations, `#` comments, here-docs and here-strings, `$(…)`/backticks/`<(…)` (also inside double quotes), `then`/`do`/`!`, `cd`/`Push-Location` tracking, `sudo`/`env`/`timeout` wrappers, `eval`/`iex`, nested `bash -c`, `pwsh -c`, `powershell '…'`, `cmd /c`, `wsl -- …`, `ssh host '…'`, here-docs fed to a shell. A structure-blind pass over the raw text also denies a delete aimed at a root, home or top-level folder and a force-push, so a parsing gap alone cannot let `rm -rf ~` through. In straight-line Bash, a variable set to a literal earlier in the same command is resolved (`out=build; rm -rf "$out"` passes, `X=/; rm -rf "$X"` is denied). Anything that could change the value unseen keeps it unknown (asked): an assignment after `||`, in a pipe or group, or reassigned from a non-literal; values with spaces, globs or `~`; and for the whole command any loop, function, `+=`, `IFS`, `eval`, `source`/`.`, `declare`/`local`/`export`/`read`/`printf`/`let`/`unset`. Scripts handed to another shell (`bash -c '…'`, `ssh h '…'`) are never rewritten. `eval "$(…)"` asks unless it runs a known shell-init generator (`ssh-agent`, `direnv`, `pyenv`, `brew shellenv`…). Everyday work passes: `rm -rf target`, `cd build && rm -rf *`, `rm -f *.log`, `rm -rf /tmp/x-*`, `find . -name '*.pyc' -delete`, `Remove-Item -Recurse .\dist`, `docker rm -f web`, `grep .env .gitignore`, commit messages that mention `rm -rf ~`.
  - The hook matcher includes Claude Code's separate `PowerShell` tool (Windows), which `Bash(...)` rules and `Bash` hooks never covered. About 9 ms per call on Windows, process start included (`8sync --version` alone: 8.6 ms; 30 runs, release build). If the analyser ever panics, the hook answers `ask` instead of letting the command run.

### Changed
- The guard hook fails closed (`onFailure: "block"`, Claude Code 2.1.295+): if it can't start, crashes, times out or returns bad JSON, the tool call is blocked instead of running unguarded.
- Release size ceiling 5760 → 5888 KiB, attributed in `scripts/size-gate.sh` (ls/show/guide ≈ +95.7 kB, HQ journal/launcher ≈ +12.1 kB on local x86_64 builds).
- **Native Stop gate** (`ccc/gate.rs`) replaces the Haiku prompt hook. No model call: it reads the last message and the user's last message from the transcript tail. Ending on an unfinished plan ("Next I'll…", "I'll fix that now.", "Tiếp theo tôi sẽ…") or a routine "shall I proceed?" continues the turn. It ends the turn when the plan is a destructive, outward-facing or paid action, when the question is about secrets, access, money or a choice between options, while a background task is still running, on a second stop in a row, and when the user's last message says stop/wait ("stop", "wait, …", "dừng lại", "khoan") — the rule 0.66.0 added to the Haiku gate, now read from the user instead of Claude's paraphrase. Words match whole words (`fix` ≠ `prefix`) and Vietnamese phrases (`đánh giá`, `khóa học` are not price/key questions). Design brief with sources (CowAgent, oh-my-pi, ForgeCode, Claude Code docs/plugins, public guards): `outputs/stop-gate-guard-design.md`. The Haiku gate cost ~30k Haiku tokens and ~2.6 s per turn end (~48k tokens per bench run), and most of its 20 real blocks were turns waiting for a background agent.
- **claude.ai connectors off by default** (`disableClaudeAiConnectors: true`, only when unset): a trivial `claude -p` on a claude.ai login went from ~8.4 s to ~7.2 s and the prefix shrank by ~2k tokens per request; Gmail/Drive tools are no longer reachable from a prompt injection.
- Same-model bench (Sonnet 5.5; ccc on the team login, omp and Forge on a Console key; Rust, TypeScript, Python and repo-exploration tasks × 2 runs; cost at API list price): every arm 82/82 hidden checks.

  | Harness | Wall median | Requests / run | Output tokens / run | $ / run |
  |---|---|---|---|---|
  | `8sync ccc` 0.65 | 44.4 s | 6.5 | 4,830 | 0.150 |
  | `8sync ccc` dev (0.65 + this change) | 43.1 s | 7.1 | 4,799 | 0.143 |
  | omp 18.9 | 40.1 s | 5.6 | 3,242 | 0.103 |
  | Forge 2.14 | 35.9 s | 6.4 | 4,958 | 0.155 |

  ccc is still a few seconds slower (Claude Code spends ~9.5 s per run outside API time) and omp is the cheapest (fewer output tokens); the gap this change closes is safety, not speed. One dev-build run took 750 s: a here-doc that hit the 120 s Bash timeout went to the background and `claude -p` waited for it.
- Release size ceiling 5632 → 5760 KiB, attributed in `scripts/size-gate.sh`: measured on release builds of v0.66.0 vs this change, separate target dirs — linux-musl (local, zig cc) +114,448 B, Windows +108,032 B. v0.66.0's published linux-x86_64 asset was 5,747,632 B, so the next one is expected near 5.86 MB (5,862,080 B), ~35 KiB under the new ceiling.

### Fixed
- `8sync setup`/package installs on Fedora: dnf5 (5.4.1) rejects `--`, so dnf commands no longer pass it (pacman keeps it); the option-like-name guard stays.
- The guard no longer denies a heredoc that only writes a file (`cat > notes.md <<'EOF' … rm -rf ~ … EOF`); heredocs fed to a shell, interpreter, `eval` or `ssh` stay denied, and `os.system('rm -rf ~')` is now caught.

## [0.66.0] — 2026-10-12
### Security
- **`8sync harness claude-code` only accepts endpoints Anthropic sanctions.** Allowed: `https://api.anthropic.com`, Amazon Bedrock, Google Vertex, Microsoft Foundry, and localhost or one exact host you run yourself (`EIGHTSYNC_SELF_HOSTED_GATEWAY=<host>`). Any other gateway is refused before anything is written: gateways that resell Claude break the Usage Policy ("Do Not Abuse Our Platform"), and your code would go to an undisclosed third party. The official-endpoint check is an exact host match now (`api.anthropic.com.evil.io` used to pass as a substring); plain `http://` is refused except on localhost.
- **Only Console API keys leave Claude Code.** `harness claude-code` writes a token into `~/.omp/agent/models.yml` (and Windows User env) only when it starts with `sk-ant-api`; `harness add-model` refuses non-Console Anthropic tokens and Claude-protocol providers outside the allowlist; `forge key` takes only a Console key for `anthropic` and refuses ForgeCode's `claude_code` provider; the Feynman bridge skips every Claude/Anthropic model. A subscription/OAuth token stays in Claude Code and is not used for the endpoint probe. Tokens are printed as `…` + the last 4 characters (`harness claude-code`, `harness gateway`, `forge`) and kept out of `curl`'s argv. `scripts/setup-claude-key.ps1` and `.sh` now only forward to `8sync harness claude-code` on stdin (the `.ps1` used to write any token for any endpoint into settings.json and the Windows User env first; the `.sh` overwrote settings.json when 8sync was missing). A subscription/OAuth token is accepted only for `api.anthropic.com`, never for localhost or a self-hosted gateway.
- **`8sync harness gateway` no longer routes Claude through the 9router proxy**: the `cc/` provider (which made omp pose as Claude Code) is gone and `apply` removes an already-deployed one. The remaining non-Claude routes need `EIGHTSYNC_GATEWAY_ACCEPT=1`, `gateway key` rewrites only its own provider block, `gateway apply` re-deploys the template but keeps your other providers (backup in `models.yml.bak`), and both refuse Anthropic keys (`sk-ant-…`).
- **`8sync codex-web` is opt-in** (`EIGHTSYNC_CODEX_WEB_ACCEPT=1`): it automates a ChatGPT Web subscription into omp, the same pattern 8 Sync's rules forbid for Claude, and OpenAI's terms for it are not verified. Without the opt-in only `status`/`off` run.
- `8sync forge` writes `~/.forge/.credentials.json` with mode 0600 (and tightens an existing file).

### Fixed
- `8sync feynman` works with Feynman ≥ 0.5.35: the bridge finds Pi's packages under `@earendil-works/*` (then `@mariozechner/*`), in the launcher and the extension (was `Cannot find module '@mariozechner/pi-ai'`).
- Claude 5.5 model IDs (`claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`) in `harness claude-code`, the `harness model` aliases (`opus`/`sonnet`/`haiku`), the endpoint probe (now `x-api-key` + `anthropic-version`, official endpoint and localhost only) and the kit's gates.
- `8sync ccc kit` says why codebase-memory-mcp / serena were not registered in Claude Code (missing from omp's `mcp.json`, not on PATH, or the `claude mcp add-json` error) instead of skipping silently; serena is registered with `alwaysLoad: false`.

### Added
- **`8sync hq` — Agent HQ on Discord** ([docs/hq.md](docs/hq.md)): `hq setup` builds a private server idempotently: categories, the forum `task-board` (required status/role/priority tags), `rfcs`, `notes`, `#standup`, team rooms, ops channels, persona roles, one webhook per channel, and a pinned charter that says the personas are AI. Claude Code hooks (`TaskCreated`, `TaskCompleted`, `TeammateIdle`, `Notification`) turn team work into forum posts and tag changes posted as PM/Architect/Backend/Frontend/QA/Reviewer/Researcher. Also `hq post`, `hq task`, `hq standup`, `hq status`, and `hq up`, which prints/installs a systemd unit running the lead session with the official Channels plugin in tmux plus a 09:00 standup timer. Tasks are tracked per agent team (or per session), because Claude Code numbers tasks from 1 again in every session; parallel async hooks create exactly one post per task. HQ never touches Claude credentials. The bot token and webhooks live in a 0600 file, are sent to `curl` on stdin, and are always masked; state keeps ids and titles only; a hook is a ~4 ms no-op until setup. Verified against a mock Discord API and with real Claude Code hooks (2 tasks created and completed → 2 tagged forum posts, then `done` + thread comments); the generated units pass `systemd-analyze verify`. Not yet run against real Discord.
- **Security commands in the kit and plugin**: `/rules` (is X allowed? Anthropic AUP/terms + 8 Sync rules + Vietnamese data law, with verdict, exact clause and official link), `/sec` (secrets with file:line and never the value, sensitive files, dependency audit, kit guard, OWASP pass), `/harden` (this machine's Claude Code posture), next to `/aup-audit`.
- **`8sync ccc policy [--org-uuid] [--out] [--strict-hooks] [--lock-mcp]`**: a managed-settings JSON for the org, built only from documented keys. It disables bypass-permissions mode, sets the kit deny rules, can force claude.ai login (optionally pinned to your org UUID), restricts marketplaces to the official one plus 8sync, turns on the sandbox and `channelsEnabled`, and with `--lock-mcp` restricts MCP to codebase-memory-mcp/serena (off by default so the Discord Channels plugin keeps working), and prints per-OS install paths. It never writes system paths itself; `ccc status` shows whether a managed file is present.
- Kit agents `pm` (lead/coordinator, one writer per worktree, aware of the 5-hour window), `architect` (writes docs/ADR/RFC only, no code edits by convention) and `qa` (tests only).
- **Public plugin marketplace**: the kit's subagents and `/ship` install as a Claude Code plugin — `/plugin marketplace add 8-Sync-Dev/su-code` then `/plugin install 8sync-kit@8sync` (~630 tokens always-on per `claude plugin details`); hooks, rules and the full skill set still come from `8sync ccc kit`.
- `8sync ccc kit` enables Anthropic's official LSP plugins (rust-analyzer, TypeScript, gopls, pyright from `claude-plugins-official`) for the language servers found on PATH — code intelligence without MCP schemas in the prompt; values you set are kept.

### Changed
- The Stop gate lets a turn end when Claude's last message quotes the user's own stop/wait words and says it is holding for the next instruction (it used to keep the turn going three times in a row after an explicit stop).
- Release size ceiling 5392 → 5632 KiB, attributed in `scripts/size-gate.sh` (compliance/kit +38,208 B, Agent HQ + policy + skills +193,712 B on local x86_64 release builds).
- **Leaner Claude Code sessions.** Measured on one machine (2026-10-12; `wc -c` of every always-loaded layer, and `message.usage` of the first request in 2 Claude Code transcripts), the kit + repo layers came to 55,663 B (≈13.9k tokens at 4 B/token) of a ~58k-token first request; most of it is gone:
  - the repo `CLAUDE.md` block is compact (≤1.1 KB), no longer orders reading 4 SKILL.md bodies (15.4 KB) before the first tool call, and no longer claims MCP tools are always present;
  - no block in a `su-code/` memory dir, and no new block in a child repo when an ancestor `CLAUDE.md` already has it (Claude Code loads both; they were byte-identical 8.6 KB copies); an existing child block is kept and refreshed to the compact one;
  - the kit's `CLAUDE.md` summarises the 8 Sync / Anthropic rules instead of importing the 6.7 KB rules doc into every session (full text: `/aup-audit`, `skills/aup-audit/8sync-anthropic-rules.md`);
  - on-demand bundled skills are `name-only` in user-scope `skillOverrides` (values you set are kept; core skills keep their descriptions).
- **Kit agents are routed by role**: explore and quick-task on Haiku (`effort: low`), task on Sonnet, reviewer on Sonnet (`effort: high`), with `maxTurns`, read-only `disallowedTools` where they only read, and a short return envelope (reviewer keeps its BLOCKER/SHOULD/NIT + verdict format).
- New kit agents `researcher` and `verifier`, and `deep-research` v2: plan → scale gate → lead drafts → verifier checks every citation → reviewer grades FATAL/MAJOR/MINOR → provenance file, `Verification: BLOCKED` when it cannot finish. Adapted from Feynman (MIT, see `THIRD_PARTY_NOTICES.md`). Private repo source is researched locally, not sent to third-party models.
- The Stop gate (Haiku 5.5) lets a turn end while Claude waits on background agents it launched (it blocked 4 times in a row in a real session); the ask gate stays on Sonnet (5.5). `/ship` requires every "done/verified" claim to cite the command output.
- New `8sync ccc hook session-start` (startup/clear/compact, found from any subdirectory): a byte-stable digest of `su-code/STATE.md` plus recent `failure:`/`validated:` lessons, at most 6,000 B.
- `docs/legal/anthropic/index.md` records the snapshot date; `legal-sync.py` refreshes it only when a page changed.

## [0.65.0] — 2026-10-11
### Added
- **`8sync ccc` keeps itself and the repo current on every launch** (no network on the launch path, never blocks it):
  - a newer 8sync release (found by the 6-hourly background probe) is installed with the usual sha256 check and the same command re-runs on the new binary (`SUSYNC_NO_AUTO_UPDATE=1` opts out);
  - after an update, the bundled skills (`~/.omp/skills`) and the Claude Code kit are refreshed once;
  - a git repo gets the 8sync harness: missing skills vendored into `su-code/skills`, memory + `AGENTS.md`/`CLAUDE.md` blocks, `.claude/skills` → `su-code/skills`, and the managed `.gitignore`.
- **Claude Code sees every 8sync skill.** Project skills come through `.claude/skills` (also created by `8sync harness create`); each bundled skill is linked into `~/.claude/skills/<name>` → `~/.omp/skills/<name>`, and personal skills win over project ones, so Claude Code always reads the current bundled copy. On-demand skills are listed by name only (`.claude/settings.local.json` → `skillOverrides`), always-on skills keep their descriptions: the per-request prefix with 237 skills is 41.1k tokens instead of 57.3k with every description (38.9k with no project skills). Live check: "which command raises the refresh rate to the max?" → Claude invoked `8sync-cli` and answered `8sync hz max`.
- **The org's Anthropic rules ship with 8sync and load into every Claude Code session.** `assets/skills/aup-audit/8sync-anthropic-rules.md` (the 8 Sync rules doc) is installed into `~/.omp/skills/aup-audit/` and `~/.claude/skills/aup-audit/`, and the kit's `CLAUDE.md` block imports it ahead of every other instruction. Live check: three rules questions answered from context with zero tool calls.
- **`legal-sync` workflow**: every Monday it snapshots Anthropic's Usage Policy, Commercial and Consumer Terms, Privacy Policy, Claude Code legal + data-usage pages and the sitemap's `/legal/` index into `docs/legal/anthropic/` (`scripts/legal-sync.py`). A change is committed and opens an issue to review the rules doc; with an `ANTHROPIC_API_KEY` repo secret (Console key), Claude Code drafts the rules update as a pull request. The draft step was rehearsed on a fake effective-date change: it changed only the date reference.
- **Free CI on the public repo**: `ci.yml` runs `cargo test` on Linux, macOS and Windows and builds `--no-default-features` on every push/PR; `install-smoke.yml` runs the published one-line installers on ubuntu x64 + arm64, macOS arm64 + Intel and Windows after each release and weekly, and fails unless the installed version is the latest and setup reports "all steps succeeded".

### Changed
- **Claude Code is about as fast as omp on a hard task now** (was ~1.8× slower). Calc evaluator: 3 bugs + missing features across 4 files, 11 hidden tests, Sonnet 5, Console key, wall-clock per run:

  | Harness | Runs | Mean | Hidden tests |
  |---|---|---|---|
  | omp | 155 · 124 · 136 s | 138 s | 11 · 10 · 11 of 11 |
  | ccc kit 0.64 | 281 · 216 s | 249 s | 11 · 11 |
  | ccc kit 0.65 at `high` effort | 209 · 179 s | 194 s | 11 · 11 |
  | ccc kit 0.65 default (`medium` effort) | 100 · 161 s | 131 s | 11 · 11 |

  - The verify hook is **async** (`asyncRewake`): edits no longer wait for `cargo check` (2.5 s per edit warm on this repo, 8.6 s cold). One check per project runs at a time and the latest edit wins; a failure wakes Claude with the errors.
  - New `8sync ccc hook verify-stop` (Stop): before a turn ends it waits for a running check or checks once, and blocks the stop while the build is broken — once per broken state, so a deliberate stop cannot loop 8 times.
  - `permissions.allow` gets the build/test/lint commands of the supported stacks plus `git add`: in auto mode each would otherwise wait for a classifier review (~0.65 s per `cargo check`). Commits, pushes and anything that discards work stay reviewed.
  - `effortLevel: "medium"` when you have not set one (Sonnet 5 and Opus 5 default to `high`; Opus 5.5 is already `medium`). Output tokens on the bench: 9.4k / 15.3k vs 17.6-20.6k at `high`. Use `/effort high` for a hard reasoning session.
  - Tried and dropped: Anthropic's `<use_parallel_tool_calls>` system-prompt snippet (`--append-system-prompt-file`) did not raise multi-call requests on a lookup task.
- `8sync-cli` skill rewritten harness-neutral (omp and Claude Code) and complete: every verb (sessions, `ccc`, `forge`, `find`, `note`, `run`, `ship`, image tools, `locate`, `gen-img`, harness/skills, `setup`/`up`/`doctor`, `hz`, `bt`, `sec`, `lcd`, `clean`, `codex-web`) plus the `su-code/` memory layout. The old text told agents never to edit `su-code/*.md`, which contradicted `AGENTS.md`.
- `assets/skills/aup-audit/RULES.md` now points at the org rules doc for the 8 Sync rules instead of keeping a second copy.

### Fixed
- **Skill links were committed.** The managed `.gitignore` used `.cursor/skills/` and `.zcode/skills/`, but git sees a symlink/junction as a file and a `dir/` pattern never matches it, so `git add -A` committed the links (this repo tracked both). The block now writes `.cursor/skills`, `.zcode/skills`, `.claude/skills` and `.claude/settings.local.json`; a test runs real `git status` against the links. The two links are untracked here.
- A repo's own committed `.claude/skills/` is never replaced, not even by `harness create --force`.
- **Windows one-liner failed whenever the GitHub API was rate-limited** (shared CI runners, office NAT): `install.ps1` resolved the latest tag with `Invoke-WebRequest -MaximumRedirection 0`, which on Windows PowerShell 5.1 throws without the response, so only the 60-per-hour API fallback ever worked. It now reads the `releases/latest` 302 with a no-redirect `HttpWebRequest` (proven on PS 5.1 and 7 with the API path disabled). Found by the new `install-smoke` run on `windows-latest`.

## [0.64.0] — 2026-10-11
### Added
- **`8sync ccc hook guard`** — a native PreToolUse hook in the kit (Bash/Edit/Write/MultiEdit/NotebookEdit, about 23 ms per call on Windows). It denies, with the reason handed back to Claude:
  - writing a credential file: `.env` / `.env.*` (templates `.example`/`.sample`/`.template` pass), `*.pem`/`*.p12`/`*.pfx`, `id_rsa*`/`id_ed25519*`, `*.session`, `*.pkl` — with either path separator;
  - content or a command carrying a real-looking Anthropic/OpenAI/GitHub/AWS/Slack/Google key or a private key (short fixtures, `EXAMPLE`/`xxxx` placeholders pass);
  - `git add` of a credential file, named or swept up by `git add -A`/`.` (`:!path` exclusions honoured);
  - code that wires a Claude subscription into another client (Claude Code's OAuth client id / OAuth beta headers).
  It replaces the bash + python `aup-guard.sh` from omp-style-kit v2, which let `C:\…\.env` and `.env.staging` through and cost ~240 ms per call.
- **`/aup-audit` skill** (bundled for omp and copied into the Claude Code kit): Anthropic Usage Policy + 8 Sync rules check — gitleaks over tree and history, sensitive files ever committed, then the model reads the product and walks `RULES.md` (Usage Policy sections incl. High-risk Physical Actions, access paths, 8 Sync internal rules). No python scanner: the kit's 240-line regex scanner reported 1 BLOCK + 52 WARN on this repo, all false positives, in 37 s.
- The kit now also ships the `deep-research` skill; more deny rules (`Edit(**/.env*)`, keys, `*.session`, `*.pkl` — `Write(...)` path rules are ignored by Claude Code, so none are used).
- Stage A of `8sync setup` installs **gitleaks** (GitHub release, sha256-checked, `~/.local/bin`), so the pre-commit secret hook exists on fresh machines.
- `8sync doctor` warns when omp's `anthropic` login is a Claude subscription (OAuth).

### Changed
- **Fewer tokens in Claude Code on 8sync repos.** `CLAUDE.md` gets a compact block (~0.7k tokens) that points at `AGENTS.md` and the skill dirs instead of a second copy of the full force-load block (~8k). Per-request prefix in this repo: 41.0k → 34.3k tokens (omp: 56.2k). Importing `AGENTS.md` instead was measured at 20.5k and rejected.
- Kit agents: `explore` runs on Haiku, `reviewer`/`designer` inherit the session model instead of forcing Opus, and the `plan` agent is gone (`/ship` plans in the main context). An unedited `plan.md` from 0.63 is removed on the next `8sync ccc kit`.
- Kit `CLAUDE.md` rules gain the Anthropic Usage Policy points (subscription only in Claude Code / claude.ai, AI disclosure, human review for high-risk decisions, `/aup-audit` before publishing); the "read AGENTS.md first" rule is gone.
- `deep-research` skill rewritten token-lean and host-neutral (omp + Claude Code tools): one artifact (`outputs/<slug>.md`) instead of five, snippets before pages, compressed worker returns, measure-when-you-can. The binary-weight audit protocol moved to `assets/skills/deep-research/references/binary-weight-audit.md`.
- The managed `.gitignore` block also ignores `*.pem`, `*.p12`, `*.pfx`, `id_rsa*`, `id_ed25519*`, `*.session`, `*.session-journal`, `*.pkl`.

### Fixed
- **Usage Policy compliance.** `8sync feynman auth-omp` no longer bridges Claude models (omp's `anthropic` OAuth login or gateways serving `claude-*`) into Feynman; set `ANTHROPIC_API_KEY` to a Console key there. `8sync harness claude-code` with a non-Anthropic endpoint configures Claude Code only and leaves omp's models alone.

## [0.63.0] — 2026-10-11
### Added
- **`8sync ccc` — Claude Code with named sessions.** `8sync ccc . <name>` create-or-resumes a Claude Code conversation by name in this repo: the name maps to a UUID that starts the session (`--session-id`, `--name`) and resumes it (`--resume`). Also `8sync ccc .` (last used), `. ls`, `. new`, `. rm` (removes the transcript too), `status`, and flags after the name go to `claude`. Installs Claude Code with Anthropic's official installer when missing.
- **The 8sync kit for Claude Code** (`8sync ccc kit`, run by `8sync setup`). It goes into `~/.claude`, so it applies to every repo:
  - 6 subagents (`explore` · `plan` · `task` · `quick-task` · `reviewer` · `designer`) and the `/ship` skill (explore → plan → implement → review → commit). Read-only agents use `disallowedTools` instead of a tool allow-list, so they keep the MCP code-intelligence tools.
  - **Verify hook**: after every Edit/Write, `8sync ccc hook verify` runs `cargo check`, the package's `typecheck` script (or `tsc --noEmit`) or `go vet` from the edited file's nearest manifest, and returns only failures to Claude. Native Rust, so no python3/jq/bash is needed, and it runs on Windows.
  - **Stop gate**: a Haiku prompt hook keeps the turn going while the last message shows unfinished work: planned steps not done, edits not verified, failing checks, `NOT MERGEABLE`, or a question it should have answered itself.
  - **Ask gate**: a Sonnet prompt hook on `AskUserQuestion` sends unnecessary questions back to Claude to decide. Questions about credentials, destructive or paid actions, and product decisions go through.
  - Auto permission mode and task tools on every model (both only when you have not set them), deny rules for `.env` reads and force-push, global rules in a managed block of `~/.claude/CLAUDE.md`, and omp's `codebase-memory-mcp` + `serena` registered in Claude Code.
  - Files you edited are kept (`--force` overwrites); settings are merged, never replaced.
- Stage A of `8sync setup` installs Claude Code + the kit (after `harness global`, so the MCP servers exist).
- The name → UUID registry is now shared by `8sync forge` and `8sync ccc` (`uuid_sessions.rs`).

### Fixed
- **Official installers on Windows launched from PowerShell 7.** Windows PowerShell 5.1 inherited pwsh's `PSModulePath`, lost `Get-FileHash`, and `claude.ai/install.ps1` failed. 8sync now clears that variable for every `powershell` child it starts.
- `8sync harness claude-code` overwrote `~/.claude/settings.json` and wrote lower-case `env` keys that Claude Code ignores. It now merges the upper-case `ANTHROPIC_*` keys into the existing file.

## [0.62.0] — 2026-10-11
### Added
- **Pro zsh for `8sync forge` and everyday use** (`assets/configs/zsh/8sync.zsh`):
  - Two-line prompt: repo-relative path, branch read straight from `.git/HEAD` (no `git` process per prompt), session name, Forge's agent · tokens · model segment, last-command duration (≥ 2 s), `❯` green/red by exit status. The Forge segment renders asynchronously (`zle -F`) and refreshes only after a Forge command, on resize, or every 30 s, so the prompt never waits for `forge`. Before this it sat in a right prompt that clipped in narrow panes (`claude-opus-5-5 ME…`).
  - Arrow-key completion menu: case-insensitive and fuzzy on `._-`, grouped, cached; the dump is rebuilt at most daily.
  - ↑/↓ history search by prefix; Windows Terminal/xterm Home, End, Delete and Ctrl/Alt word keys; window title set to `dir · forge:<session>`.
  - Pinned **zsh-autosuggestions v0.7.1** and **zsh-syntax-highlighting 0.8.0**, shallow-cloned and checked against their commits; Forge's `:command` / `@[file]` highlight rules stay.
  - Measured in a ConPTY on Windows: about 0.3 s from `8sync forge core` to a prompt (was 3.4 s), about 0.2 s per command.
- **`8sync setup --profile terminal` works on every OS:**
  - Windows: helix + JetBrainsMono Nerd Font via winget; the installed Nerd face becomes the Windows Terminal default only when none is set (targeted insert, re-parsed before writing).
  - macOS: brew helix + Nerd font cask.
  - Debian/Ubuntu: helix 25.07.1 release tarball, sha256-pinned, into `~/.local/share/8sync/helix`.
  - Arch/Fedora: native packages + kitty glass, as before.
  - Every OS: helix config if absent + the pro zsh. On Linux/macOS it is wired into `~/.zshrc` as one managed block.
  - Before this, every OS other than Arch/Fedora printed "Stage B profiles need pacman or dnf".
- **README rewritten**: Rust-core harness, one-line install table, the official Anthropic API path for Claude, the Forge shell.

### Fixed
- **zsh without sudo on Linux/macOS.** When zsh is missing and root needs a password, setup installs romkatv/zsh-bin's static zsh 5.8 (sha256-pinned per platform, relocated) into `~/.local/share/8sync/zsh`. The unattended `curl | sh` used to fail the Forge step on Ubuntu.
- **PATH bootstrap on Windows.** `~/.zshrc` / `~/.bashrc` got `C:\Users\…` entries whose `:` split PATH into junk in Git Bash and MSYS zsh. The block now uses `$HOME/…`, and existing blocks are rewritten in place.
- `8sync forge` writes its zsh files only when they change, and regenerates Forge's plugin/theme only when the forge binary changes (they were 150 ms of every launch). `compinit` now runs before Forge's plugin, which ends with `compdef`.
- Forge's per-command `$(date +%s)` fork is replaced with `$EPOCHSECONDS`, and autosuggestions run synchronously (async forks per keystroke). Each fork costs 10–25 ms on Windows.

## [0.61.3] — 2026-10-11
### Fixed
- **`8sync setup` installs gh on Debian, Ubuntu and other Linux without a native gh route.** Those distros
  only got "install `gh` manually" — not even counted as a failed step — so the one-line installer left
  Ubuntu members without gh (`8sync ship` needs it). Stage A now fetches the official
  `gh_<ver>_linux_<amd64|arm64>.tar.gz` from `cli/cli`'s latest release, checks it against the release's
  `checksums.txt`, and installs `~/.local/bin/gh` — no sudo, no apt repo.

## [0.61.2] — 2026-10-11
### Fixed
- **`8sync up` verifies checksums on Windows.** The install target came from `canonicalize`, i.e.
  `\\?\C:\…`; Git's MSYS `sha256sum` mangles that form into a missing file, and the failure was reported
  as "no sha256sum, shasum or certutil on PATH" — every Windows self-update ran unverified. The drive form
  is now unwrapped, and the hashers are tried in turn until one works.
- `8sync --help` described `up` as "8sync + omp + system pkgs + rustup + flatpak"; it updates 8sync only.

## [0.61.1] — 2026-10-11
### Fixed
- **Update check throttles on Windows.** The 6-hour window was the mtime of an empty `last_check` file;
  rewriting an empty file with `""` leaves the NTFS mtime alone, so every 8sync command in a terminal
  spawned a probe against the GitHub API (60 req/h unauthenticated). The stamp is now epoch seconds in
  the file's content; legacy empty markers, garbage and future stamps count as due.
- **`install.ps1` upgrades a running 8sync.** `Move-Item -Force` cannot replace a live `.exe` (any open
  `8sync . <session>`), so re-running the one-liner died with "Cannot create a file when that file
  already exists" and left a `.8sync.new.*` behind. The live binary is now renamed to `.8sync.old.<pid>`
  first (restored on failure, swept on the next install) — the same dance as `8sync up`.
- **`install.ps1` checksum no longer silently skipped.** Windows PowerShell launched from pwsh 7 inherits
  pwsh's `PSModulePath`, loads the wrong `Microsoft.PowerShell.Utility`, and loses `Get-FileHash`; the
  installer then printed "checksum: skipped". SHA-256 now comes from .NET directly.

## [0.61.0] — 2026-10-11
### Added
- **`8sync codex-web [up|status|wire|off]` — bridge ChatGPT Web (incl. Pro) into omp CLI.**
  Opens the [miuuyy/codex-chatgpt-web](https://github.com/miuuyy/codex-chatgpt-web) launcher so YOU
  log into ChatGPT (never logs in for you), polls the local loopback Responses server on `:17841`,
  auto-detects `/v1/models`, and wires an **isolated** `chatgpt-web` provider (`api: openai-responses`)
  into `~/.omp/agent/models.yml` — never touching native `anthropic`/`openai`, no global env var, no
  secret copied.
  `up` = launch the installed **production** Codex Web GPT app (the only build that serves omp; prints
  the one-line installer if missing) + wait-for-login + auto-wire; bare/`status` = probe + auto-wire if
  ready; `wire` = force re-detect; `off` = remove the provider. `--dir`/`CODEX_WEB_DIR` opt into the
  source `bun run app` launcher — a **DEV harness that CANNOT serve omp** (`purpose: "dev-harness"` is
  hard-blocked in `server.ts`), for tool development only. Loopback-only; ChatGPT web automation carries
  the upstream project's inherent account risk.
- **`8sync gen-img <prompt> [-o file.png]` — AI Image Generation via `gpt-image-2`.**
  Generates logos, icons, diagrams, UI mockups, and illustrations via `gpt-image-2`
  (OpenAI Images API via `https://api.apikey.fun/v1/images/generations`). Resolves API key
  from `--key`, `OPENAI_API_KEY`, or `~/.omp/agent/models.yml`. Decodes base64 or downloads
  image URL directly.
- **`image-gen` bundled skill (28th skill).** Teaches agents when and how to generate images,
  mockups, and visual assets, with prompt engineering best practices and immediate VLM inspection.
- **Standalone image generation scripts:** `scripts/gen-img.ps1` (PowerShell) and `scripts/gen-img.sh` (Bash).
- **Codex & OpenAI provider auto-configuration in `models.yml`:** Registered `gpt-5.6-sol`, `gpt-5.6-terra`,
  `gpt-5.6-luna`, `gpt-5.5`, `gpt-5.4`, `gpt-5.4-mini`, and `gpt-5.3-codex-spark`.
- **`8sync feynman [name|ls|rm|new|auth-omp|status|off]` — named session management for Feynman research agent.**
  Brings `8sync . <name>` parity to Feynman (`companion-inc/feynman`): `8sync feynman <name>` (e.g. `8sync feynman core`)
  creates or resumes an isolated named research session in the current project via `feynman --cwd <root> --session-dir <dir>`,
  tracked in `~/.config/8sync/feynman-sessions/<project-key>/index.json`. Supports `ls` (list project sessions with last active
  time), `rm <name>` (clean up session and directory), and `new <name>`. Every launch synchronizes omp's available chat catalog, including configured API-key providers.
- **`8sync forge <name> [--tui]` (alias `forgecode`) — named ForgeCode sessions, zsh-native by default.**
  `8sync forge core` opens an interactive zsh with Forge's own zsh plugin bound to the session's
  conversation: `: <prompt>` asks Forge, `:<Tab>` lists Forge commands, everything else is a normal
  terminal. `--tui` opens Forge's TUI on the same conversation; `-p "…"` is a one-shot. Names map to
  the UUID conversation ids Forge requires, per project (`<config>/8sync/forge-sessions/<key>/index.json`);
  `ls`, `new`, `rm`, `status`, `key [provider] <key>` (writes Forge's credential file — never `~/.env`,
  which Forge no longer reads) and `provider|config|workspace|mcp|info` passthrough. Forge is installed
  from its GitHub release when missing (`forgecode.dev/cli` currently 404s). Windows has no zsh: MSYS2's
  zsh 5.9.2 (pinned, sha256-verified) is unpacked with Windows' bsdtar into `%LOCALAPPDATA%\8sync\zsh`,
  reusing Git for Windows' runtime DLLs, terminfo, mount table and coreutils — no admin rights.
- **One-line installers now set up the whole harness.** `curl … /install | sh` and
  `irm … /install.ps1 | iex` run `8sync setup --no-profile` after installing the binary (opt out:
  `SUSYNC_NO_SETUP=1`). Under `curl | sh` setup reads the terminal (or `/dev/null`), never the script pipe.
### Changed
- **Setup Stage A = full AI harness on every OS:** gh, omp, codegraph, **forge + zsh**, configs, skills and
  **`harness global`** (every bundled skill, APPEND_SYSTEM, MCP, hooks). `--no-profile` now runs
  unattended (logged, a failed tool is reported and the rest still installs).
### Fixed
- **Windows Stage A no longer needs `sh`:** omp and codegraph install through their official
  `install.ps1` (`irm | iex`) instead of `sh -c "curl … | sh"`, which a stock PowerShell box lacks; tools
  that a fresh install put only on the user PATH are detected at their default locations.
- **Update notifications and `8sync up` survive GitHub API rate limits:** when `api.github.com` refuses
  (60 req/h per IP), the latest tag is resolved from the `releases/latest` redirect, as the installers do.
- **Checksums on Windows:** Git for Windows' `sha256sum` prefixes its output with `\` for backslash paths,
  so every Windows download was reported "checksum NOT VERIFIED"; the marker is now skipped.
- **`--no-default-features` builds again** (`8sync forge` no longer calls the `web`-gated project
  scaffolder — which also `git init`-ed any directory a session was opened in).
- **Size gate ceiling 5180 → 5300 KiB, with attribution** (`scripts/size-gate.sh`): v0.60.0 → v0.61.0 every
  asset grew by the same four new verbs/bridges (linux-x86_64 +102,656 B → 5,390,608 B; windows +123,392 B);
  `web` gate still +1,159,680 B. `scripts/size-report.sh` now finds `8sync.exe` on Windows hosts.
- **`8sync feynman <name>`: automatic authenticated model synchronization and native omp inference.**
  Replaces hardcoded Opus registration and copied OAuth tokens with managed `models.json` entries,
  live vault lookups and a Pi extension using `omp auth-gateway stdio`. Keeps Feynman's existing
  `/model` picker, tools and selected default; supports omp-native transports including Cursor.
  Synchronization and `off` preserve user-edited models, credentials and unrelated providers.
  Omit null/unknown model limits instead of invalidating Pi's whole catalog. On Windows, seed
  missing `shellPath` with real Git Bash; isolate Feynman's `PI_CODING_AGENT_DIR` from omp's
  vault while restoring any original user override for both key lookup and inference.
  Native stdio buffers each turn before returning its SSE events; output is not token-live.
  Verified 345 bridged models across 12 providers in actual Pi; real named-session `/model`
  selection and Opus 5.5 inference passed, as did native tool-call/result continuation.
- **Feynman Windows renderer crash:** repair the missing `truncateToWidth` import and reassigned
  `const line` on every launch. Actual differential-render smoke covers normal text, ANSI/Unicode
  overflow and intact image data; bundled versions with the intentional overflow guard remain unchanged.
- **`8sync feynman` (Windows): `/` was swallowed, so slash commands (`/model`, `/settings`) never opened.**
  Feynman's embedded Pi 0.62 key parser ignores modifiers it cannot detect, so pi-btw's default
  `super+/` focus shortcut matched a bare `/`. The launcher now patches that parser (both bundled
  `@mariozechner/pi-tui` copies) to reject unsupported modifiers. Verified via ConPTY: `/` opens the
  command menu and `/mod` filters to `model`; `ctrl+c`/`shift+tab` still match.
- **Local omp 18.8.3 Windows terminal hotfix:** preserve incomplete win32-input-mode
  packets across the 75 ms input timeout instead of inserting `ESC[8;14;8;…_`
  fragments into the composer. Reproducible upstream source/test patch:
  `scripts/omp-win32-record-framing.patch`; installed locally, not an upstream release.
  Verified all Backspace packet split positions with 500 ms delays, existing Escape,
  Enter, paste and modifier tests (23 passing), plus compiled-binary smoke test.
- **Session resume no longer clobbers active model with GLM:** `cfg.resume_flags()` previously emitted
  `--model <roles.default>`, which defaulted to `"glm"`. Whenever a user resumed a session with `8sync .`,
  `8sync . <name>`, or `8sync ai continue`, omp was invoked with `--model glm --continue`, forcibly overriding
  the session's active model (e.g. Claude Opus or Gemini Flash) to GLM. `resume_flags()` now omits `--model`,
  preserving the session's active model across resumes.
- **`8sync feynman` Windows process launch, `/model` switching, and OAuth/API-key bridge:**
  - **Preserved `google-antigravity` OAuth provider:** Previously mapped to `google`, causing all Gemini and Antigravity models (`claude-opus-4-6-thinking`, `claude-sonnet-4-6`, `gemini-3-flash`, `gemini-3.1-pro-high`) to fail or disappear. Now correctly mapped with full OAuth payload (`token`, `projectId`, `refreshToken`, `expiresAt`, `email`).
  - **Direct token resolution for API keys:** Replaced `!omp token <p> --raw` with pre-resolved keys in `auth.json`, eliminating Windows WSL bash 127 status traps where `resolveConfigValue` failed on Windows.
  - **Removed invalid legacy entries:** Purged invalid `google` (oauth) and `cursor` entries that broke model selection dialogs.
  - **Fixed broken default model on startup:** Automatically checks `settings.json` and resets failing default models (such as rate-limited `anthropic/claude-opus-4-6`) to verified available models (`google-antigravity/gemini-3-flash` or `zai/glm-5`).
  - **Direct Node runner on Windows:** Bypasses `cmd.exe /C` by invoking `node bin/feynman.js` directly with inherited stdio, avoiding quoting bugs and signal interception.
  - **CLI subcommand passthrough & flag support:** Supports `8sync feynman model [list|set]`, `8sync feynman doctor`, `8sync feynman setup`, and flags (`--model`, `--prompt`, `-h`) with `allow_hyphen_values`.
  - **Patched `pi-subagents` extension crash:** Guarded `selectedTools` access with optional chaining to prevent undefined property errors on turn startup.
## [0.60.0] — 2026-09-04
### Added
- **`8sync harness claude-code [JSON|FILE]` — one-command Claude Code settings & Anthropic models auto-setup.**
  Accepts the standard Claude Code settings JSON payload (`ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`,
  `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`, `CLAUDE_CODE_ATTRIBUTION_HEADER`). Automatically writes
  `~/.claude/settings.json`, configures Windows User environment variables, updates `~/.omp/agent/models.yml`
  with the 9 current Claude models (`claude-opus-5`, `claude-fable-5-1`, `claude-fable-5`, `claude-opus-4-8`,
  `claude-opus-4-7`, `claude-opus-4-6`, `claude-sonnet-5`, `claude-sonnet-4-6`, `claude-haiku-4-5`) under
  both `anthropic` override and custom provider slug, configures `anthropic-budget-effort` thinking, sets
  `anthropic/claude-fable-5-1:high` as default role, and verifies connectivity with a live probe.
  Also available via standalone scripts: `scripts/setup-claude-key.ps1` and `scripts/setup-claude-key.sh`.

### Fixed
- **GLM-5.3 / GLM-5.3-Flash native vision.** These models read images in-session
  (`image_url`, https://docs.z.ai/guides/vlm/glm-5.3-flash). Always-on prompts
  (`APPEND_SYSTEM`, `image-routing`, `00-force-load`, recall hook) used to treat
  every Z.ai model as text-only GLM-5.2 and bounce pixels through the
  `zai-vision` MCP (`glm-4.6v-flash`). Agents now **look at the attached image**
  when the session is `zai/glm-5.3*`. `zai-vision` remains a **fallback for
  GLM-5.2 only** (STOP gate at the top of the skill). Alias `glm`/`zai` →
  `zai/glm-5.3-flash`; combo `claude+glm` keeps `modelRoles.vision` on the cheap
  native VLM instead of routing images to Opus. Cursor/AGENTS force-load now
  states the same gate (Cursor does not read `~/.omp/APPEND_SYSTEM.md`).

## [0.59.0] — 2026-08-25

### Added
- **`8sync harness create` — full multi-host bootstrap for Cursor + Z.ai Code + omp.** One command
  vendors `su-code/skills/`, then fans the same Agent Skills tree out to **`.cursor/skills/`**
  (Cursor's project skill path) and **`.zcode/skills/`** (Z.ai Code), plus a Cursor-native
  **`.cursor/rules/8sync-harness.mdc`** (`alwaysApply: true`) so a Cursor session loads the
  CORE contract without reading `~/.omp`. Host dirs are a relative symlink / Windows junction
  when the OS allows it, otherwise a copy. `create --sweep [DIR]` stamps every omp project
  (has `su-code/` or AGENTS.md) under DIR — default `~/Projects`, and on Windows also
  `<Users>/Projects` next to the home folder. Bare `8sync harness` / `init` / `global --sweep`
  now run the same host adapters, so existing projects pick this up on the next refresh.

## [0.58.0] — 2026-08-21

### Added
- **`super-pdf` bundled skill** — the HTML→PDF report engine (design system that produced
  the admired CloudGO review/architecture PDFs) is now self-contained in su-code: annotated
  `references/report-template.html` (kicker cover + meta table + tagbox, §N section spine,
  navy comparison tables with pills, 4 callout variants, stat cards, 3-zone running footer
  with page numbers) + `scripts/build.sh` (WeasyPrint via `uv run`, page-count guard) +
  content rules (§0 = verdict first, every number traces to a source). Every machine gets
  it after `8sync setup`; previously the engine only lived inside `agentic-cloudgo-v1`
  project skills while the `repo-md2pdf-git-report` managed skill pointed at a deleted
  tool path.
  Renamed from the in-session `report-pdf` draft before release. Also adds an optional
  cover `.chips` strip (category chips, as on the architecture-PDF variant).

### Changed
- **Size ceiling recalibrated `5 MiB` → `5 180 KiB` (5,304,320 B), attribution-first.** The
  ratchet headroom was 4,208 B at v0.57.0; v0.56+v0.57 feature growth had eaten it all,
  so this release`s legitimate +20,608 B (omp hardening + sweep + super-pdf) tripped the
  gate. `size-report.sh` attribution: the `web` feature gate alone = +1,732,232 B — the
  only elephant. Ceiling stays tight on purpose: the next feature release trips it again
  and must attribute again. `AGENTS.md` §8 numbers refreshed (CI musl sizes).

### Fixed
- **`8sync omp update` could hang forever and repaired via the wrong channel.** omp's
  self-updater downloads a ~185 MB standalone binary with no progress output and no timeout
  of its own; the verb ran it with `Command::output()` (silent, unbounded), and its repair
  path reinstalled via `npm install -g` for an EEXIST scenario that no longer matches the
  omp.sh standalone layout. Now: the update attempt is time-boxed (10 min) with a 60 s
  heartbeat, interrupted-update `~/.local/bin/omp.*.new` partials (up to ~185 MB each) are
  swept, and repair reinstalls via the official `omp.sh/install --binary` (same channel as
  `8sync setup`, stall-protected + smoke-tested), with binary backup/restore insurance.
- **Retired omp extensions hard-fail loading since omp 17.4 (zod v4).** Stale copies of the
  old engine — the multi-file `8sync-gs/` and the `ckit-engine.ts` / `ckit-workflow.ts`
  interim renames — use `.default([])` array-literal zod defaults, which omp 17.4's bundled
  zod v4 rejects at load ("ParseError: A mutable default value must be specified as a
  factory"), spamming a warning and silently dropping those tools in every project still
  carrying a copy. `ensure_engine`'s sweep (formerly workflow-only) now also removes
  `8sync-gs/` and the `ckit-*` renames from the global and project extension dirs on every
  `8sync harness` / `harness up`. `ckit-*` removal is content-gated on the
  `8sync-engine`/`8sync-workflow` lineage marker so a user's own same-named file survives.

## [0.57.0] — 2026-08-14

### Added
- **`sx-plan` command**: Autonomous plan-review gate for deep research, slice decomposition, and task-reviewer contract verification using `engine_plan`, `task`, and `recall`.
- **`sx-sync-pr` command hardened**: Existence guards, branch validation gate, SHA-based main up-to-date checks, and non-push default safety.
- **4 Foundation Reference Skills**: Added `tauri-v2`, `nextjs-app`, `encore-eino-go`, and `ai-microservice-design` with `locked: true` frontmatter, grounded in real 8syncdev production repos. Registered as foundation skills in `AGENTS.md` and committed under `assets/skills/`.
- **Default Boot Kernel Enforcement**: Configured `grubby` to set `/boot/vmlinuz-6.19.10-300.fc44.x86_64` as default boot kernel, restoring native Fedora Bluetooth support (`btusb`), 180Hz display rate, and official NVIDIA RTX 5080 driver persistence across reboots.

### Changed
- **Size ceiling recalibrated `5 MiB` → `5 180 KiB` (5,304,320 B), attribution-first.** The
  ratchet headroom was 4,208 B at v0.57.0; v0.56+v0.57 feature growth had eaten it all,
  so this release`s legitimate +20,608 B (omp hardening + sweep + super-pdf) tripped the
  gate. `size-report.sh` attribution: the `web` feature gate alone = +1,732,232 B — the
  only elephant. Ceiling stays tight on purpose: the next feature release trips it again
  and must attribute again. `AGENTS.md` §8 numbers refreshed (CI musl sizes).

### Fixed
- **`8sync .` and `8sync ai` could not launch omp at all.** STEP-0 steered omp with
  `--tools`, which is an ALLOWLIST — so 8sync had to name every built-in tool omp has, and
  omp 17.3 renaming `ast_grep` and dropping `github`/`checkpoint`/`rewind`/`security_scan`
  made every launch die on the spot with `CliUsageError: Unknown tools in --tools`. The
  failure looked like a session bug rather than a flag bug: `8sync . core` printed
  `→ resume session 'core'`, omp exited before drawing a frame, and the user fell back to a
  bare `omp --continue` — which reads omp's *default* per-cwd store, not the named session's,
  so the session they had just opened appeared to have vanished.
  STEP-0 is now a DENY-list: 8sync writes `grep.enabled: false` + `glob.enabled: false` to a
  managed overlay (`~/.config/8sync/omp-step0.yml`) and passes it as `--config`. It names only
  the two tools that must go, so no omp release can brick a launch or silently disable a tool
  again, and MCP/xdev tools are untouched. Per-launch, so `--no-step0` and the user's own bare
  `omp` still get the searchers. omp's accepted-tool set turned out to be assembled
  asynchronously and to differ between runs of the same binary, so the old
  "mirror omp's list, probe for drift" approach could never have been made correct.
- **`8sync doctor` checks that STEP-0 still bites, not that a list still matches.** It asks omp
  to accept `--tools grep,glob` under the overlay and expects a rejection; the answer is now
  a property of the running omp rather than of a constant in this repo.
- **A named session now prints the omp command that reopens it** (`omp --session-dir … --continue`),
  because a named session deliberately lives in its own store and a bare `omp --continue` will
  never find it.
- **The four foundation skills shipped in v0.56.0 were never deployed.** `tauri-v2`, `nextjs-app`,
  `encore-eino-go` and `ai-microservice-design` were embedded in the binary and listed in
  `AGENTS.md` but missing from `BUNDLED_SKILLS`, so `8sync harness` never wrote them to
  `~/.omp/skills/`. The registry test caught it; they are registered now.
- **The STEP-0 overlay is written atomically.** `fs::write` truncates before it writes, so a
  second `8sync` starting concurrently — or omp itself, reading the `--config` it was just
  handed — could observe an empty file and hard-error on it. The overlay now lands via a
  staged sibling plus `rename`, so every reader sees one whole version or the other. The stage
  name carries a per-call sequence, not just the pid: two threads in one process would otherwise
  choose the same sibling and the one that renamed second would fail on a file already moved
  away, silently dropping STEP-0 for that launch. Both directions were found by the release CI
  (Windows read `""`, then Linux hit the collision) and are now covered by a concurrency test.

## [0.56.0] - 2026-08-09

### Added
- **`8sync lcd` — Lian Li fan/AIO screens from the shell.** `8sync lcd` lists every screen the
  `lian-li-linux` daemon can see, `8sync lcd photo.png` (or `.gif` / `.mp4` / `#ff0055` / `off`)
  draws on all of them, `--device` targets one by index or id, `8sync lcd bright 60` sets
  brightness. It speaks the daemon's own newline-JSON IPC on
  `$XDG_RUNTIME_DIR/lianli-daemon.sock` instead of re-implementing the USB protocol, so the
  setting lands in the daemon's config and survives a reboot — and none of it needs the GUI.
  `SetLcdMedia.device_id` is sent as `serial:<id>` because upstream matches the request against
  `LcdConfig::device_id()`; any other spelling appends a duplicate entry rather than replacing the
  screen's existing one. Verified on 8× UNI FAN TL V2 LCD (400x400): colour, image and
  single-screen targeting all confirmed in the daemon's own log.
- **`8sync lcd gui` launches the upstream GUI with the fix already applied.** `lianli-gui` is
  Tauri/WebKitGTK and its DMA-BUF renderer dies with `Error 71 (Protocol error) dispatching to
  Wayland display` on a machine whose GPU path is degraded (here: an RTX 5080 on `nouveau`) — the
  window simply never appears. The verb sets `WEBKIT_DISABLE_DMABUF_RENDERER=1`, which costs
  nothing visible and is the difference between an app that starts and one that does not.
- **`8sync hz` — refresh-rate manager.** `8sync hz` reports every output's current rate against
  the highest one available, `8sync hz max` raises each to its ceiling, `8sync hz 144` picks a
  specific rate; `--output` narrows to one connector and `--dry-run` prints the backend call.
  Resolution is never changed — only the refresh field of the mode already in use — because the
  fastest mode a monitor offers is routinely a *smaller* one (this dev box lists 2560x1440@144
  while running 3440x1440@100), and "faster" must never mean "smaller".
  Backends: GNOME/Mutter over `busctl` (Wayland *and* X11 — the only supported way to set a mode
  under GNOME Wayland), Hyprland `hyprctl`, KDE `kscreen-doctor`, and X11 `xrandr`. Mutter applies
  are `VERIFY`-ed before they are made persistent, and the full logical-monitor layout (position,
  scale, rotation, primary) is echoed back untouched, because `ApplyMonitorsConfig` replaces the
  *whole* layout and silently resets anything omitted. Backends that cannot persist a change say
  so and print the config line that would.
- **`8sync hz` diagnoses a capped panel instead of accepting it.** The verb parses the display's
  own EDID range-limits descriptor and compares the panel's ceiling with what the driver exposes.
  A 180 Hz monitor pinned to 100 Hz is not a compositor setting: the kernel filters out every mode
  above the negotiated DisplayPort link bandwidth, so the fast mode is gone before GNOME ever sees
  it. When the gap is real, `hz` names the bound driver, explains it, and prints the fix — on an
  NVIDIA card still on `nouveau` that is `8sync setup --profile nvidia`, worded per distro family
  (RPM Fusion `akmod-nvidia` on Fedora, `nvidia-open-dkms` on Arch). `8sync doctor` carries the
  same check as a one-liner. Distro-agnostic: no package manager is involved in reading or setting
  a mode, so Fedora and Arch behave identically.

### Changed
- **Size ceiling recalibrated `5 MiB` → `5 180 KiB` (5,304,320 B), attribution-first.** The
  ratchet headroom was 4,208 B at v0.57.0; v0.56+v0.57 feature growth had eaten it all,
  so this release`s legitimate +20,608 B (omp hardening + sweep + super-pdf) tripped the
  gate. `size-report.sh` attribution: the `web` feature gate alone = +1,732,232 B — the
  only elephant. Ceiling stays tight on purpose: the next feature release trips it again
  and must attribute again. `AGENTS.md` §8 numbers refreshed (CI musl sizes).

### Fixed
- **Upgrading no longer leaves duplicate slash commands.** v0.55.0 removed the pre-prefix copy of a
  command only when it was byte-identical to the asset in the *current* build — but that same
  release rewrote every command body to self-reference the new prefixed name, so the compare could
  never match and every upgraded machine kept both `/auto` and `/sx-auto` (eight stale pairs,
  frozen at v0.54.1). The gate now recognises any body 8sync has ever shipped, from a frozen table
  of digests that by construction can never grow. A command the user wrote at one of those names is
  still never touched.

## [0.55.0] - 2026-08-09

### Added
- **`/sx-super-dev`** — one command for the whole lifecycle: ground → research (feynman/web) →
  plan → parallel build → adversarial review (reviewer + security-reviewer, fresh context) → deep
  UAT that role-plays a real user with browser capture and a clean-environment CLI run → ship →
  CI/CD and **published-artifact** verification. Distilled from the v0.54.x release, including the
  traps it hit: a tag that disagrees with the manifest, a "non-blocking" background thread the
  runtime kills at exit, and reviewers finding release-breaking defects the author could not see.
  Its governing rule is that the author's own "done" is never the evidence.

### Changed
- **Every slash command now deploys under an `sx-` prefix** (`/sx-auto`, `/sx-feature`, …).
  omp merges commands from every tool into one flat namespace shared with the user's own, so an
  unprefixed `/auto` was unattributable and collided with any other tool shipping the same obvious
  name. The prefix comes from `brand::CMD_PREFIX`, so a rebranded build picks its own; assets stay
  bare and are prefixed at deploy time. omp registers a command by FILENAME, so the frontmatter
  `name:` was realigned to the invoked name, and `8sync skill new --command` scaffolds it that way.
- Upgrades remove the pre-prefix copy of a command, but ONLY when it is byte-identical to the asset
  we shipped — a same-named command the user wrote is never touched.

## [0.54.1] - 2026-08-09

### Security
- **`8sync up` now verifies the downloaded binary.** `install.sh` checked the release asset's
  sha256 `digest` from the GitHub API, but the recurring path the update notice steers everyone
  toward — `8sync up`, including `--to <tag>` — curled the asset and renamed it into place
  unverified. It now checks the same digest with the same semantics, deletes the temp file and
  refuses to install on a mismatch (naming expected vs actual), and never leaves an executable
  behind. When no digest is published or no `sha256sum`/`shasum`/`certutil` is on PATH it still
  upgrades — aborting would strand minimal images — but says `checksum NOT VERIFIED` out loud
  instead of looking verified. Both curl calls also gained `--proto '=https' --tlsv1.2`.

## [0.54.0] - 2026-08-09

### Security
- **Command injection in the shipped `8sync-engine.ts`.** `engine_advance` built
  `git commit -m <msg>` as a string for `bash -lc`; `JSON.stringify` escapes `"` and `\` but a
  double-quoted bash word still performs command substitution, and the message is a model-supplied
  parameter routinely paraphrased from files the agent just read. Git and gitleaks now run through
  an argv-based `runArgv` with no shell. Shell evaluation is retained only for a task's `verify`
  commands, where it is the documented contract.
- **Argument injection into `sudo pacman` / `sudo dnf`.** Profile package lists were spliced into a
  privileged argv with no end-of-options separator, so an entry beginning with `-` became a flag —
  `--hookdir=` hands alpm attacker-written root hooks, `--setopt=reposdir=` repoints dnf. Package
  names starting with `-` are now refused outright at all three privileged entry points, and the
  planners emit `--` before the package list.
- The autonomous-commit gitleaks gate no longer fails open silently: `if command -v gitleaks` exits
  0 when gitleaks is absent, so fresh machines got unscanned commits from a gate that claimed to
  scan. Presence is probed separately and an unscanned commit says so.

### Fixed — profiles a teammate never asked for
- **`--full`/`--yall`/`-y` applied the maintainer's personal `alexdev` bundle**, so a teammate
  running "install everything" got Lian Li chassis drivers, a Vietnamese IME, DisplayLink DKMS and
  Bitwarden. `--full` now means every **community** profile, read from the same
  `offered_profiles()` the y/N prompt uses. Personal profiles are reachable only via
  `--profile <name>`; `--profile alexdev` restores the old behaviour in one flag.
- `--full` also skips the `warp` VPN: a flag meaning "don't ask me" is the wrong way to acquire
  something that rewrites DNS and routing, and `--community` already documented that opt-out.
- **Profiles installed packages for hardware the machine does not have.** `apply` installs packages
  before `post_install`, so the nvidia profile's own "no NVIDIA GPU detected" guard ran far too
  late. New `requires.detect` probe is evaluated in `resolve`, per bundle member, before any
  package work; `nvidia` probes sysfs PCI vendor `0x10de` (no `lspci` dependency) and fails closed.
- A profile skipped for missing hardware is no longer recorded as applied.

### Changed
- **Size ceiling recalibrated `5 MiB` → `5 180 KiB` (5,304,320 B), attribution-first.** The
  ratchet headroom was 4,208 B at v0.57.0; v0.56+v0.57 feature growth had eaten it all,
  so this release`s legitimate +20,608 B (omp hardening + sweep + super-pdf) tripped the
  gate. `size-report.sh` attribution: the `web` feature gate alone = +1,732,232 B — the
  only elephant. Ceiling stays tight on purpose: the next feature release trips it again
  and must attribute again. `AGENTS.md` §8 numbers refreshed (CI musl sizes).

### Fixed
- Line endings are now pinned to LF by `.gitattributes`. 14 embedded assets (a skill and the
  impeccable keyword rules) had CRLF committed, so the binary shipped assets whose bytes differed
  from every other asset — defeating the byte-compare that keeps user-edited files untouched and
  omp's prompt-cache prefix stable, and breaking frontmatter matching that keys on `\n`. A Windows
  checkout would have baked CRLF into every asset; the new CI `Test` step caught it.
- `Cargo.toml` version now matches the release tag, enforced by a new CI gate. Shipping 0.53.0
  under a v0.54.0 tag would have told every up-to-date user "update available" forever and made
  `8sync up` re-download the binary on every run.
- **A stale `8sync-workflow.ts` kept loading after upgrade.** The extension was retired this
  release, but nothing deleted the copy an earlier 8sync had already written to
  `~/.omp/agent/extensions/` and `<root>/.omp/extensions/`, so omp went on registering its tools
  next to the engine's. `8sync harness` (any subcommand) now removes both copies; the retired
  deploy path and its six call sites are gone.
- **Two shipped skills never deployed.** `research-paper` and `remote-compute` were added to
  `assets/skills/` but never registered in the deploy list, so `~/.omp/skills/<name>/` was never
  created on any machine — while `00-force-load.md` told the agent to open those SKILL.md files.
  Both are registered now, and a new guard test walks the embedded assets in the opposite
  direction (asset → list) so an unregistered skill dir fails the build by name; `social-growth`
  stays the single documented opt-in exception.
- **The shipped skill registry pointed at a deleted asset dir.** `assets/configs/skills.toml`
  (deployed to `~/.config/8sync/skills.toml`) still declared `src = "builtin:karpathy"` after the
  rename to `karpathy-guidelines`, so `8sync skill update` warned and skipped it on every run.
- **User-facing docs advertised 15 skills that no longer ship.** `README.md`, `AGENTS.md` and the
  docs site claimed "37 skills bundled" (and, elsewhere, 17) and named `literature-review`,
  `autoresearch` and `paper-writing` among "18 research skills" — all three directories were
  deleted, and the research set is now `deep-research`, `research-paper`, `remote-compute`. Every
  count now reads 23, matching `assets/skills/*/SKILL.md`, every named skill resolves to a real
  directory, and the two-tier force-load order (4 CORE + 6 specialist always-on) is described as
  `00-force-load.md` actually implements it. The docs site also told users to run
  `8sync skill add builtin:karpathy`, which no longer resolves.

### Added — Fedora-first package core (8sync now works on Fedora/RHEL)
- `trait PkgBackend` with `Pacman` + `Dnf` impls, selected by `env_detect::distro_family()`
  (`Family::{Arch,Fedora,Other}`, reads `ID` **and** `ID_LIKE`; Fedora 44 ships no `ID_LIKE`, so
  `ID` alone resolves). `backend()` returns `Option`, so a distro with neither manager keeps
  today's warn-and-continue instead of failing — Debian/openSUSE users are unaffected.
- Every package-manager spawn now lives **only** in `pkg.rs`. `platform::install_core_pkg` takes a
  `CorePkg { arch, fedora, brew, winget }` instead of positional strings nobody could tell apart.
- Profiles gained an **additive** `[packages.fedora]` table (`dnf`/`copr`/`rpmfusion`/`swap`)
  beside the existing `pacman`/`aur`/`aur_yay` keys, plus `#[serde(deny_unknown_fields)]`. All 37
  Fedora package names were verified against the live repos with `dnf repoquery`; profiles with no
  real rpm equivalent declare none and are skipped with a printed reason rather than guessing.
- `vpn` and `harness browser` are no longer Arch-only (Cloudflare WARP / `chromium` on Fedora);
  `clean` gained a dnf arm (`dnf clean all`, `dnf autoremove`).
- COPR is treated as third-party root code: `copr_enable` refuses any `owner/project` outside a
  checked-in allowlist unless explicitly allowed, and `dnf swap --allowerasing` prints the erase
  set first.

### Changed
- **Size ceiling recalibrated `5 MiB` → `5 180 KiB` (5,304,320 B), attribution-first.** The
  ratchet headroom was 4,208 B at v0.57.0; v0.56+v0.57 feature growth had eaten it all,
  so this release`s legitimate +20,608 B (omp hardening + sweep + super-pdf) tripped the
  gate. `size-report.sh` attribution: the `web` feature gate alone = +1,732,232 B — the
  only elephant. Ceiling stays tight on purpose: the next feature release trips it again
  and must attribute again. `AGENTS.md` §8 numbers refreshed (CI musl sizes).

### Fixed
- **`8sync setup` aborted at step 3 of 8 on every non-Arch Linux.** The AUR-helper step was gated
  on `Os::Linux` instead of the Arch family, so on Fedora it failed and `try_step`'s `?`
  propagated — `codegraph`, `path-bootstrap`, `configs`, `skills` and `codegraph-skill` never ran.
  This is why `~/.omp/skills` was empty on Fedora machines.
- **Skill paths written into `AGENTS.md` were absolute to the authoring machine**
  (`/home/alexdev/...`, `/home/alexng/...`), so on any other clone omp was told to read files that
  do not exist and silently skipped the skills. `skill/inject.rs` now emits repo-relative paths for
  project skills and `~/`-anchored paths for global ones. `harness audit` could never catch this
  because it skipped every `/`-prefixed token; it now flags `/home/`, `/Users/`, `/root/` while
  still ignoring `/etc`, `/usr`, `/tmp`.
- `Dnf::install` left a half-applied batch: its plan can hold two transactions (install, then
  upgrade), and a failed upgrade returned `Err` while the committed install stayed. It now reverts
  via `dnf history undo`.
- `install.sh` created its temp file in `/tmp` (tmpfs) while installing to `~/.local/bin` (btrfs),
  so the "atomic" `mv` crossed filesystems and degraded to a copy. The temp file is now a sibling
  of the destination, matching `selfup.rs`.
- `install.ps1` hardcoded the x86_64 asset, silently giving Windows ARM64 the wrong binary.

### Changed — enforced tool routing (omp stops ignoring the code-intel stack)
- Preferring codegraph/serena/codebase-memory was previously **prose**, which omp ignores under
  load. It is now enforced by mechanisms omp implements in code: a TTSR rule
  (`condition` + `scope: "tool:grep(*), tool:glob(*)"` + `interruptMode: tool-only`) that aborts the
  stream mid-tool-call, plus `bashInterceptor` patterns closing the `bash rg` escape.
- Both are **capability-gated**: with no code-intel tool installed the rule and the interceptor
  block are removed, so a bare machine is never dead-ended. TTSR `repeatMode: once` means the worst
  case is one restarted turn, not a hard veto.
- `APPEND_SYSTEM.md` shrank 9 198 → 3 260 B (−64.6 %); it is in every prompt on every turn, and the
  TTSR rule body costs zero prompt tokens.
- Downloads are now sha256-verified using the `digest` field the GitHub Releases API already
  returns — no new dependency, no release-plumbing change.
- First tests in the repo: 48 passing (`cargo test`), covering distro parsing, the pacman argv
  regression fixture, the COPR allowlist refusal, path portability, and audit path classification.

## [0.53.0] — 2026-08-08

### Added — `8sync .` named per-project sessions (run many features at once)
- `8sync .` grew a session layer so you can keep several concurrent lines of work in one repo,
  each an isolated omp conversation. Surface (namespaced under `.`, no new top-level verbs):
  `8sync . <name>` create-or-resume · `8sync . new <name> [--worktree]` · `8sync . ls`/`--list`
  (`--json`) · `8sync . mv <old> <new>` · `8sync . rm <name> [--force]` · `8sync . merge <name>...
  [--keep-worktree]`. `8sync .` with no name resumes the last-used session (omp's default store
  when none was ever named — unchanged legacy behavior).
- Mechanism (a thin layer over omp's existing session core — not a reinvention): one omp
  `--session-dir` per name (omp's own `--continue` resumes it — zero session-id bookkeeping),
  tracked in a machine-local registry `~/.config/8sync/sessions/<repo>/index.json` that stores
  only what omp lacks (human name, worktree binding, last-used). Every launch reuses `ModelConfig`
  so STEP-0 tool-routing + advisor survive.
- `--worktree` gives a session its own `git worktree add -b 8sync/<name>` so two features edit the
  same files concurrently without collision; `ls` shows branch + dirty state.
- `merge <name>...` lands session branches into the current branch, ECC-style (affaan-m/ECC, MIT):
  read-only `git merge-tree --write-tree` conflict preflight → `git merge --no-edit` → rebase the
  conflicting worktree onto the target to unblock (auto-abort + skip on true conflict) → clean up
  merged worktree + branch + session (`--keep-worktree` to preserve). Sequential, so branch-vs-branch
  conflicts surface as the target advances. Local-only — never pushes.
- Everything runs through `git`/`omp` shell-out — **no new dependencies** (ECC's rusqlite/git2/tokio
  stack was deliberately not adopted; it would bust the size budget). `8sync doctor` reports session
  count + dirty worktrees. New module `crates/cli/src/verbs/session.rs`; `here.rs` dispatches.
- Evaluated but NOT integrated (user asked to review): linshenkx/prompt-optimizer (AGPL-3.0 +
  optimizes human prose — wrong layer) and TypeScript 7 / typescript-go (transparent to `8sync run`,
  no code change).

### Fixed — `8sync up` was Linux-only and bricked itself on Windows
- Symptom (Windows): running `8sync up` left an un-runnable file so the next `8sync` invocation popped Windows' *"Select an app to open '8sync'"* picker instead of executing. Root cause in `crates/cli/src/verbs/selfup.rs`: the self-updater hard-coded `ASSET_SUFFIX = "-linux-x86_64"` (downloaded the **Linux** binary), wrote it to `~/.local/bin/8sync` with **no `.exe`**, and replaced it with a plain `std::fs::rename` (which Windows forbids on a running `.exe`). The release CI already publishes `8sync-<tag>-windows-x86_64.exe` and `install.ps1` installs to `%LOCALAPPDATA%\Programs\8sync\8sync.exe`, so the updater was simply never taught about non-Linux.
- Fix — self-update is now genuinely cross-platform:
  - **Correct asset per OS/arch:** `asset_label()` maps `platform::os()` + `std::env::consts::ARCH` to the CI labels (`linux-x86_64`, `linux-aarch64`, `darwin-x86_64`, `darwin-arm64`, `windows-x86_64`; macOS ARM is `arm64`, not `aarch64`), and `asset_filename()` appends `.exe` on Windows. Both `fetch_latest_release` (auto-check + `8sync up`) and `install_tag` (`8sync up --to`) use it.
  - **Install to the running exe** via `dest_path()` = `std::env::current_exe()` (canonicalized), so `8sync up` replaces 8sync wherever it actually lives — the Unix `~/.local/bin/8sync` OR the Windows `…\Programs\8sync\8sync.exe` — instead of a hard-coded Unix path. Falls back to the legacy path only if the current exe can't be resolved.
  - **Windows-safe replace:** `download_and_replace()` renames the live `.exe` aside to `.8sync.old.<pid>` (allowed while running) before sliding the new binary in, restoring the original if the install fails; stale `.old` files are swept on the next run. Unix keeps the same-dir inode-swap rename.
- Verified: native Linux release build is clean; the `#[cfg(windows)]` branch type-checks (it uses only cross-platform `std::fs` APIs — confirmed by compiling it with the gate temporarily forced on).

### Fixed — serena's web dashboard opened a browser tab on every session start
- Symptom: a Serena dashboard tab kept reappearing (showing `Error loading configuration` / `Error loading stats`, since it races the server it is reporting on), and RAM climbed. Cause: serena ships `web_dashboard: true` **and** `web_dashboard_open_on_launch: true`, so every `start-mcp-server` binds an HTTP dashboard and pops a browser tab. omp spawns one serena per session, so this multiplies — measured here: **16 live serena processes holding 878 MB**, one dashboard each.
- Fix: `deploy::ensure_serena_mcp` now registers serena with `--enable-web-dashboard False`. The flag is passed on the **command line** rather than by editing `~/.serena/serena_config.yml`, because serena owns that file and rewrites it — a config edit alone does not survive. `register_omp_mcp`'s self-heal rewrites the existing `mcp.json` entry in place, so the fix lands on `8sync harness global` with no manual step.
- The dashboard is pure observability: serena's MCP tools are unaffected. Verified live — no listener on `24282`, and `mcp__serena_get_current_config` still answers.
- Note (not a leak): a serena pair (`uv` wrapper + python child ≈ 145 MB) is held per **live omp session**, not per project. Closing unused omp sessions is what reclaims that memory.

### Added — STEP-0 tool-routing ENFORCEMENT (`step0`): the rule is now code, not prose
- Measured problem (this machine, `8sync harness toolstats`): the STEP-0 MCP stack was connected and callable yet effectively unused — `cbm 0 · serena 0 · headroom 0` agent calls; every code lookup fell back to the built-in `read`/`grep`. Prose directives in `APPEND_SYSTEM.md`/AGENTS.md had failed to change behaviour three times (see KNOWLEDGE). Zero-friction built-ins always beat an instruction.
- **Fix — remove the fallback instead of asking nicely.** `8sync ai` / `8sync .` now launch omp with `--tools` DROPping the two redundant searchers `grep` + `glob` (`STEP0_TOOLS` in `crates/cli/src/models.rs`), so code lookup MUST flow through codegraph (CLI) · codebase-memory-mcp · serena. `--tools` is an **allowlist** (omp has no deny-list — `tools.blocked` is only a telemetry counter), so it must name every tool to keep: anything omitted is silently disabled. The list is omp's validator list minus `grep`/`glob`, and minus `computer` to preserve its default-disabled state. `lsp` is deliberately KEPT (zero-friction; serena needs `activate_project` per session). MCP/xdev tools are orthogonal to `--tools` and survive it.
- **Shell escape closed:** `deploy::ensure_bash_interceptor` writes `bashInterceptor.patterns` into `~/.omp/agent/config.yml`. omp's rule shape is `{ pattern, tool, message }`, and its matcher **skips any rule whose `tool` is not in the session's tool list** — so a rule pointing at `grep`/`glob` disables itself precisely because STEP-0 removed them. Every rule therefore points at `lsp` (always present, and the honest suggestion). Blocks `rg`/`ag`/`ack`, `grep -r`, and `find -name`; single-file and log `grep` stay allowed. Setting the key replaces omp's default array. Wired into both `global_pass` and `harness_init`.
- **Verified end-to-end on omp 17.2.9** (the previous iteration was verified only as "the string is embedded in the binary", which is why it shipped broken): the captured provider request carries 18 tools with `grep`/`glob` **absent** and `recall`/`retain`/`reflect`/`memory_edit`/`hub`/`eval`/`ast_edit`/`lsp` **present**; `8sync ai` returns normally; `rg main main.rs` is refused with `Blocked: STEP-0: …`; `grep -r main .` is refused; plain `grep main main.rs` still runs.
- **Drift guard so the allowlist cannot rot silently again** (`8sync doctor`): an allowlist fails in two directions, and both have now happened — a name omp *drops* bricks every launch, a name omp *adds* disappears from the agent with no error at all. `models::step0_tool_drift` asks omp itself (`omp --tools __8sync_probe__ -p ""` — the validator runs before any provider call, so the probe is free and offline) and diffs the answer against `STEP0_TOOLS`, reporting `REJECTED by omp: …` or `missing omp tool(s): …`. Proven in both directions: injecting `bogus_tool` produced the REJECTED warning, reverting restored `✓ STEP-0 allowlist matches omp's tool list`.
- **`codegraph callers` demoted in the STEP-0 routing** (`assets/configs/omp/APPEND_SYSTEM.md`): on a clean, freshly rebuilt full index it reported `No callers found` for a function with two real call sites, and the misses cluster by *caller* (nothing inside `global_pass` resolves) rather than by callee — `let _ =` discards are not the cause. codegraph is a prebuilt external binary with no local source, so "who calls X" now routes to `mcp__serena_find_referencing_symbols`, with `codegraph callers` allowed only as a second opinion, never as proof of absence. The same note warns against `rm -rf .codegraph`, which deletes the exclusion config and makes the next index walk ~16k files instead of ~6k.
- **Toggle (never a trap):** default ON; `8sync ai --no-step0` for one run, or `step0 = false` in `~/.config/8sync/models.toml`.
- `APPEND_SYSTEM.md` RULE #0 rewritten to match reality: states that `grep`/`glob` are gone, gives a cheapest-first routing decision tree (cbm → serena → codegraph), and **drops the stale omp-16 `mcp.discoveryDefaultServers` claim** (omp ≥17 mounts MCP as `xd://` devices — that key no longer exists).

### Fixed — STEP-0 review pass: interceptor over-block + config-migration data loss
An independent reviewer (12 min) caught defects the happy-path tests missed; all verified live.
- **grep rule blocked single-file/log grep on hyphenated names** (`grep x-ray my-report.txt`, `grep bug build-Release.log`). The `.*(-[rR])` shape matched `-r`/`-R` *inside* words. The first repair (`\s-`) then over-corrected — `grep\s+` already consumed the space, so a first-token `grep -r` stopped matching and recursive grep was *allowed through*. Final pattern uses a negative lookbehind `(?<![A-Za-z0-9-])` so the dash must be a real token boundary, and excludes double-dash long flags from the short-flag matcher (`--color`/`--directories` contain an `r` but are not recursive). Verified 19/19 cases in Python before editing source, then live both directions: `grep -r` blocked, hyphenated-name grep + `--color=auto` allowed. Same lookbehind applied to the `find`/`fd` `-name`/`-type` rule.
- **config migration silently deleted user keys** — block-end detection used `is_ascii_alphabetic()`, so a following `# comment`, `_private:`, or `'quoted':` key was swallowed into the block and overwritten on the next `8sync harness`. Now ends at any column-0 line that is not an indented continuation, and the scan is no longer single-occurrence: every `bashInterceptor:` block is enumerated and only those carrying the `STEP-0` signature are removed (any ordering; duplicates collapse), so a user-authored block is never touched. Proven by replicating the exact Rust logic in Python against a config with comment + `_key` + quoted key + user block + ours.
- **doctor surfaced only one drift direction** — an omp upgrade that renames *and* adds reports both now (`rejected` and `silently_disabled` are no longer mutually exclusive arms).
- Trims the blank line that accumulated per `8sync harness` run.
- **Second review round — the `^` anchor made the guard mostly decorative.** `^\s*grep` only fires when the tool starts the command string, so `cd src && grep -r foo .`, `cd crates/cli && rg TODO`, `LC_ALL=C grep -r`, `sudo grep -r`, `time rg`, `cat x | grep -r y` and `; do grep -r …` all escaped. Rules now match at a **command position** — `(?:^|[;&|])` plus optional `\` escape, env assignments and wrapper words. `(` is deliberately not a separator and `do`/`then` are wrappers only, so quoted prose (`git commit -m '(rg removal)'`, `echo "do rg later"`) no longer trips the rule.
- **Substitutes closed:** blocking `rg` alone just moved the habit. `git grep` (recursive by default — the obvious fallback), `egrep`/`fgrep`, bare `fd '\.rs$'` and `fd -t f`, and `find -path`/`-regex` were all open. Tools with no single-file mode worth preserving (`rg`, `fd`, `git grep`) are now blocked outright; only `grep` gets flag analysis.
- **The grep rule is quote-aware.** It walks the option cluster (a run of shell words that are neither quoted nor containing `;&|`) instead of `.*`, so a flag-looking string inside the *search pattern* no longer counts: `grep " -r " f.txt`, `grep 'make -r' build.log`, `grep -F -- -r file.txt` and `grep pat /var/log/-r-rotated.log` are allowed again, and the scan can no longer cross into the next command (`grep foo a.txt; ls -r`). 48/48 cases verified against the patterns as actually written to disk, in omp's own JS engine.
- **P1 — a user-authored `bashInterceptor:` block was being silently voided.** The code appended its own block beside the user's, assuming a duplicate top-level key would make omp fail loudly. It does not: omp parses config.yml with `Bun.YAML.parse`, which keeps the **last** key, and 8sync always appends last — so every rule the user wrote disappeared on each `8sync harness`, with no error anywhere. The function now detects a surviving user block, leaves the file untouched, and warns instead of installing.
- Fresh-machine formatting: no stray leading blank line when `config.yml` did not exist.

### Fixed — omp 17 "Failed to load extension: mutable default value must be specified as a factory"
- omp 17.2.9 added a schema validator that rejects any zod `.default(<mutable>)` where the value is an array or object literal — it must be a **factory**: `.default(() => [])`. Primitives (`false`/`0`/`""`/`3`) are unaffected. Every `omp` session printed `Warning: Failed to load extension …/8sync-engine.ts: ParseError: A mutable default value must be specified as a factory`, so none of the `engine_*` tools registered.
- One site: `assets/extensions/8sync-engine.ts:146`, `verify: z.array(z.string()).default([])` → `.default(() => [])`. `8sync-workflow.ts` had no defaults. Verified: `omp -p` in the affected project loads the extension with zero warnings. The asset is rust-embedded, so this needs `cargo build` + `8sync harness` to redeploy; live project copies were refreshed directly for immediate relief.
- Note: the separate "`omp --continue` loses chat history" report is **not** caused by this — omp continues past extension-load failures. It is a distinct omp-17 symptom; retest `--continue` after this fix and diagnose separately if it persists.

### Changed — CI: `aarch64` builds without Docker, and the size budget is now enforced
- **`cross` → `cargo-zigbuild`** for `aarch64-unknown-linux-musl`. This fixes a correctness bug, not just speed: `cross` ran inside a Docker image with no JS toolchain, so `build.rs` could not build the Vite dashboard and **silently embedded the stub page** into that asset. zigbuild runs on the runner, where `npm` exists. Verified locally (zig 0.16.0 + cargo-zigbuild 0.23.0): 31.9 s → statically linked aarch64 ELF, **4 151 328 B — already under the 4 MiB goal**.
- **New `scripts/size-gate.sh`**, run on every release asset: hard-fails above a **5 MiB ceiling**, warns above the **4 MiB goal**. `AGENTS.md` §8 carried a budget nothing enforced, which is how the binary drifted 52 % over unnoticed. The ceiling sits above today's size on purpose — a gate that is already red gets ignored — and ratchets down as `size-report.sh` shows headroom. Both directions tested.
- **`universal2` rejected** (reversing the earlier proposal): a fat macOS binary makes every Mac user download both slices — the opposite of the goal — and would rename assets `install.sh` resolves by `${os}-${arch}`.

### Fixed — a directory merely *named* `su-code` made its parent look like a project
- `discover::detect_current_project_root` and `harness global`'s project test accepted any folder called `su-code` as proof of an omp project. Since this repo's own checkout is `~/Projects/tools/su-code`, an auto-stamp run from `~/Projects/tools` wrote a blank memory tree (`STATE.md`, `KNOWLEDGE.md`, `PLAYBOOKS.md`, …) **plus a 74-entry `skills/` tree into the repo root**.
- Both paths now share `discover::is_omp_project`, and the `su-code` marker requires the directory to actually contain memory (`skills/` or one of `STATE.md`/`KNOWLEDGE.md`/`PROJECT.md`/`PLAYBOOKS.md`/`skills.toml`). Verified three ways: a bare `su-code/` dir is left alone, an `AGENTS.md` repo is still stamped, and a memory tree without `AGENTS.md` is still detected.

### Changed — **binary is 24 % smaller**: 6 407 848 → 4 859 696 B, no feature removed (`lean-binary` M2)
- **Dropped `rusqlite` (−1 035 384 B).** `harness toolstats` never needed a database: its ingest opened with `DELETE FROM calls` and re-parsed every session JSONL on each run, so nothing ever persisted — 1 MB of embedded SQLite C answered `COUNT`/`GROUP BY` over rows the same process had just built. Now a single in-memory pass. Output is **byte-identical**, proven by running the old and new binaries against a frozen copy of the session tree; only the provenance line changed (`→ …/toolstats.db` became `← …/sessions/<slug>`). SQLite left `ORDER BY` ties in table-scan order, so ranking tie-breaks on first appearance to preserve it.
- **Replaced `elkjs` with `@dagrejs/dagre` (−512 768 B).** `elk.bundled.js` was 1 606 238 B of the 1 891 858 B dashboard chunk — 85 % of the frontend was a GWT-compiled Java layout engine serving two `layered` calls. New `web/src/layout.ts`; bundle down to 478 704 B (−75 %). A lazy `import()` was measured first and rejected: `rust-embed` embeds the whole `web/dist` tree, so chunk-splitting saves zero binary bytes. Verified headless — codegraph lays out in four clean LR ranks, workflow auto-layout chains top-down, zero page errors.
- **`toolstats` feature flag removed** — it guarded only `rusqlite`. `features` is now just `web`; a `--no-default-features` build *gains* the tracker and sits at 3 109 496 B, **25.86 % under the 4 MiB budget**.
- `AGENTS.md` / `README.md` size and tracker claims replaced with measured numbers.

### Added — `lean-binary` feature scope (GSD planning tree): M0 + M1 landed
- `su-code/planning/lean-binary/` — 4-phase roadmap to bring the binary back under the `AGENTS.md` §8 "< 4 MB" budget **without dropping a user-visible feature**: M0 land pending WIP · M1 feature gating + per-gate byte attribution · M2 eliminate rather than gate · M3 CI (`cargo-zigbuild` `aarch64-musl`, macOS `universal2`) + budget truth.
- **M0 PASS.** Baseline **6 407 848 B** vs the 4 194 304 B budget. Every commit in the range was replayed in a throwaway `git worktree` and built from scratch — 4/4 green — because `engine_verify` only ever sees the working tree.
- **M1 PASS (8/8 AC).** `crates/cli/Cargo.toml` gets its first `[features]` table: `default = ["web","toolstats"]`, `web` = axum + tokio + tower-http + scraper, `toolstats` = rusqlite. `marketplace` folds into `web` (single caller: `/api/marketplace`). A `--no-default-features` build now compiles **and runs**, warning-clean, with no JS toolchain — `build.rs` skips the Vite bundle when `CARGO_FEATURE_WEB` is unset. Gated subcommands say `rebuild with --features web` instead of failing as unknown.
- **New `scripts/size-report.sh`** — A/Bs four feature combinations into separate `--target-dir`s. Measured: full **6 407 144** · web-only 5 346 304 · toolstats-only **4 144 576** · minimal **3 081 416**. Per-gate cost: `web` **2 262 568 B**, `toolstats` **1 060 840 B**.
- **`cargo bloat` was wrong by ~26×** on SQLite (40 KiB claimed vs 1 060 840 B measured) — it attributes `.text` by symbol and is blind to `.rodata` and C blobs. Ranking tool only; every load-bearing number now comes from an A/B build.

### Added — `deep-research` §5 "Native & Binary-Weight Audits" + a measured audit of `8sync` itself
- `assets/skills/deep-research/SKILL.md` gains a 7-step protocol for native/binary-weight research: ground with `size -A`, attribute with `cargo bloat --crates` (and chase its `[Unknown]` C row through `build/*/out/*.a`), A/B every proposed flag into a scratch `--target-dir` with an explicit `--target`, record falsified knobs as `failure:` entries, trace surprise deps with `cargo tree -i`, prefer `[features]` gating over rewrites, and reach for Zig only as build tooling.
- Applied it to this repo — brief at `outputs/native-tooling-zig-rust.md` (+ plan/drafts/provenance). Headline: the binary is **6 406 696 B (6.11 MiB)** against the `AGENTS.md` §8 "< 4 MB" budget, and the cause is that `crates/cli/Cargo.toml` has **no `[features]` section** — `harness web` (axum/tokio/hyper), marketplace scraping (scraper/html5ever) and `harness toolstats` (bundled SQLite, 2.1 MB `.a`) link into every build, alongside 4.9 MB of embedded assets (`web/dist` 1.9 MB, `impeccable/scripts` 1.6 MB).
- Release-profile knobs proven exhausted by A/B: `opt-level="s"` is **+307 392 B** vs `"z"`; `-C force-unwind-tables=no` saves **704 B**; `-C relocation-model=static` breaks proc-macro builds. No profile change made.

### Added — `branch-sync` skill & automated script for zero-conflict multi-branch sync
- **`/sync-pr` slash command**: Deployed globally (`~/.omp/agent/commands/sync-pr.md`) and per-project (`.omp/commands/sync-pr.md`). Invoking `/sync-pr [<branch>]` in any omp session automatically loads the `branch-sync` skill, audits all local/remote branches, deep-previews and safely merges specified feature branches to `main`, and synchronizes all active branches to match latest `main` with zero conflicts.
- New skill `assets/skills/branch-sync/SKILL.md` + helper script `assets/skills/branch-sync/scripts/branch_sync.py`: provides complete audit, deep-preview (`git diff main...<branch>`, commit breakdown, conflict dry-run), safe merge to `main`, and zero-conflict multi-branch synchronization across all active local/remote branches without risk of merge conflict leaks or data loss.

### Enhanced — `8sync harness global` auto-detection for `su-code/` projects
- `8sync harness global` now automatically detects if the current working directory is an `omp` project (containing `su-code/` or `AGENTS.md`) and stamps its per-project harness layer (vendors global skills into `su-code/skills/`, injects `AGENTS.md`/`CLAUDE.md`, seeds memory, installs pre-commit hook, and initializes `codegraph`) without requiring manual `--sweep`.

### Enhanced — `deep-research` skill with AI Agent loop engineering & design patterns
- Deepened `assets/skills/deep-research/SKILL.md`: incorporates state-machine loop engineering (Plan → Execute → Verify → Advance), STEP-0 code intelligence (`codegraph`, `codebase-memory-mcp`, `serena`), multi-agent wave execution (`tasks[]`), headroom output compression, modality-fit vision routing, and ponytail YAGNI discipline for large real-world codebases.

### Added — `8sync omp update` verb (update omp + auto-repair a blocked install)
- New verb `crates/cli/src/verbs/omp.rs` (`8sync omp update`, `--force`): runs `omp update`
  and, when it fails with `npm error EEXIST … ~/.local/bin/omp` or bun `Fail extracting
  tarball`, auto-repairs — backs up the current binary, clears the standalone file squatting
  the symlink path, `npm install -g @oh-my-pi/pi-coding-agent@latest`, then re-resolves and
  reports `CURRENT → NEW`. Runs from the SHELL (not an omp `/command`) so it works even when
  omp is broken; native Rust, no `sudo`/system-pkg/git. `8sync up` note now points here.
- Verified live both paths: normal ("Already up to date" @ 17.0.7) and `--force` (backup → rm
  → npm reinstall → `~/.local/bin/omp` healthy `node_modules` symlink). Root cause: omp ships
  as a standalone binary that squats the bin path where the package manager wants a symlink.

### Added — Lark (larksuite) to the `apps-personal` profile
- `assets/profiles/apps-personal.toml` now installs Lark via AUR `larksuite-bin`
  (v7.66.11, URL larksuite.com) alongside Bitwarden. AUR bin package auto-fetches the
  official `.deb` at build time and is pacman-tracked — the 437 MB binary is NEVER
  committed to the repo/GitHub, only the download reference. Sets `requires.aur_helper`.
  China build (Feishu) is a separate package, `feishu-bin`. Opt-in; the `alexdev`
  bundle intentionally excludes `apps-personal`.

### Fixed — STEP-0 MCP tools were connected but NEVER called (0.09% usage) → always visible
- Root cause (measured over 29 omp sessions / 13,854 tool calls: serena 0 · headroom 0 ·
  cbm 10 · zai 3 calls; `search_tool_bm25` taken 2×): omp's default
  `tools.discoveryMode: auto` hides ALL MCP tools behind a `search_tool_bm25` discovery
  hop once the registry exceeds 40 tools (this stack registers 48), and every instruction
  surface taught BASE tool names (`search_graph`, `find_symbol`) that are not callable —
  the registered forms are `mcp__codebase_memory_mcp_search_graph`, `mcp__serena_find_symbol`, ….
- Fix: `8sync harness`/`harness global` now writes `mcp.discoveryDefaultServers:
  [codebase-memory-mcp, headroom, serena, zai-vision]` into `~/.omp/agent/config.yml`
  (`ensure_mcp_tools_visible` in `crates/cli/src/verbs/skill/deploy.rs`) — the four
  harness servers' full catalogs stay in the active tool set, zero discovery hops.
  Key-presence idempotent; never overrides a user-set value. NOTE:
  `tools.essentialOverride` does NOT work for MCP (omp filters entries to built-in
  tool names only — verified in omp 16.4.8 bundle); an inert pin block from that
  approach is auto-migrated away (byte-exact match only).
- Instruction surfaces now teach the REGISTERED `mcp__…` names + the
  `search_tool_bm25` escape hatch for other/new servers: `APPEND_SYSTEM.md` RULE #0,
  `00-force-load.md`, the AGENTS.md STEP-0 sentinel template (`inject.rs`), the
  capabilities catalog header, and the feature-skill R10 literals (assets + su-code
  mirror). Stale names dropped everywhere: `semantic_query` (never existed on cbm),
  `codegraph search/deps/defs` (real 1.1.2 verbs: `query/explore/node/callers/callees/impact`).
  Unfollowable headroom mandate ("compress before it enters context") rewritten to the
  followable form: compress what YOU re-emit (`mcp__headroom_compress`).
- `8sync doctor` now flags hidden MCP tools (`discoveryDefaultServers` missing) and a
  dead serena (mcp.json + uvx check). Live probe verified: `omp -p` calls
  `mcp__codebase_memory_mcp_search_graph` and `mcp__serena_find_symbol` directly — both OK,
  no discovery hop; toolstats records serena/cbm optimizer calls for the first time.

### Fixed — omp ≥17 dropped bm25 discovery; the recurring "MCP HIDDEN" was a phantom
- omp 17.x replaced the pre-17 tool-discovery model (the `search_tool_bm25` hop +
  `mcp.discoveryDefaultServers`) with `tools.xdev` (default on): MCP tools mount as
  `xd://mcp__…` device URLs, callable via read/write without shipping schemas every
  request. `discoveryDefaultServers` is gone from omp's settings schema — writing it is
  a no-op that omp strips on the next config rewrite. That churn is exactly why STEP-0
  looked like it "regressed" after every omp self-upgrade (upgrade resets `config.yml`
  → doctor's string-check screamed HIDDEN → re-harness → repeat), while the tools were
  callable all along (verified live via `xd://mcp__codebase_memory_mcp_*` this session).
- `ensure_mcp_tools_visible` (`deploy.rs`) now detects omp ≥17 and skips the dead key
  (nothing to configure — `tools.xdev` mounts them); pre-17 keeps the discoveryDefaultServers write.
- `8sync doctor` MCP check is omp-version-aware: omp ≥17 reports the xd:// mount (OK)
  instead of the false "HIDDEN behind search_tool_bm25" warning; the `harness global`
  summary bullet updated to match. New `env_detect::omp_major()` parses omp's major version.

### Added — omp `/push-now` command (cross-machine handoff + commit + push)
- New embedded command `assets/commands/push-now.md`, deployed by `8sync harness`
  (`ensure_engine` in `crates/cli/src/verbs/skill/deploy.rs`) to
  `~/.omp/agent/commands/push-now.md` (global) + `<repo>/.omp/commands/push-now.md`
  (project), alongside `/auto` and `/feature`. `/push-now [msg]` is the
  "I'm switching machines right now" verb: it rewrites `su-code/STATE.md` with a
  cold-resume handoff (branch/HEAD, what changed this session, done/next/blockers,
  new-machine runbook), updates `CHANGELOG.md`/`KNOWLEDGE.md` if code changed, then
  `git add -A` + commit (gitleaks-gated, no `--no-verify` past a real secret) +
  `git push` origin current branch. No PR, no branch switch, no tag bump, no
  force-push (that's `8sync ship` / a release). Since it's in `assets/`, a fresh
  machine gets it automatically after `git pull && bash scripts/bootstrap.sh && 8sync harness`.

### Added — omp `/pull-now` command (cold-resume: pull + orient + prepare)
- New embedded command `assets/commands/pull-now.md`, deployed by `8sync harness`
  the same way (`ensure_engine`) to `~/.omp/agent/commands/pull-now.md` +
  `<repo>/.omp/commands/pull-now.md`. `/pull-now [go]` is the **receiving end of
  `/push-now`**: safe `git pull` (ff-only → rebase on divergence; stop on conflict
  or dirty tree), then read `su-code/STATE.md` HANDOFF + recent `KNOWLEDGE.md`
  learnings + `CHANGELOG.md`/`git log` to understand exactly where the project is,
  prepare the workspace (rebuild + `8sync harness` if `crates/`/`assets/` changed,
  verify the per-machine gotchas the handoff listed, `8sync doctor`), and report
  current state + the single next concrete action. `go` = start that action;
  empty = orient + prepare, then STOP for the human. No push, no clobber.

Older releases (0.52.0 and down) live in [CHANGELOG-ARCHIVE.md](CHANGELOG-ARCHIVE.md).
