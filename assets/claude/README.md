# 8sync kit (Claude Code plugin)

Role-routed subagents and the delivery skills from [8sync](https://get.8syncdev.com), packaged as a Claude Code plugin.

```text
/plugin marketplace add 8-Sync-Dev/8sync
/plugin install 8sync-kit@8sync
```

## What you get

- **Subagents** (`agents/`): explore, task, quick-task, reviewer, designer, researcher, verifier, pm, architect, qa, critic.
- **Skills** (`skills/`): `/do`, `/ship`, `/ship-auto`, `/ship-loop`, `/autopilot`, `/ship-tick`, `/auto-team`, `/team-tick`, `/sprint`, `/planning`, `/sysdesign`, `/ui-ux`, `/remember`, `/consolidate`, `/rules`, `/sec`, `/harden`.

## What it runs and sends

Agents and skills are Markdown. The plugin also ships `hooks/hooks.json`: seven hooks (secret and destructive-command guard before Bash/PowerShell/Edit/Write, verify after edits, stop gate, session start digest, resume note after an API error, watchdog alerts). Each one runs `8sync ccc hook plugin <name>` and does nothing when:

- the `8sync` binary is neither on `PATH` nor at the installer's default location (`~/.local/bin`, `%LOCALAPPDATA%\Programs\8sync`): the hook exits 0 at once, or
- `8sync ccc kit` already registered the same hook in `~/.claude/settings.json` (so no hook runs twice).

No MCP servers, no settings changes, and no network calls of its own. The skills ask Claude to run commands in your repository with your normal permission prompts: `git`, `gh` (pull requests, CI runs), your project's build, test and lint commands, and `8sync` subcommands when the binary is installed. The researcher and verifier agents read web pages with Claude Code's own web tools. Nothing goes to 8 Sync.

## Claude Desktop and Cowork

`8sync mcp install` registers 8sync as a local MCP server in Claude Desktop (`claude_desktop_config.json`; restart the app after). Tools: `machine` (RAM, CPU, GPU, watts, battery now), `sessions`, `board`, `queue`, `knowledge`, `report`, `kit`, and two writes, `queue_add` and `know_add`. Add `--claude-code` to register it in Claude Code too. `8sync eco install` keeps long sessions light in the background (see `8sync eco`).

## The full kit

The guard, verify and stop gates, managed rules and the full skill set come from the `8sync` binary:

```sh
curl -fsSL https://get.8syncdev.com/install | sh   # Linux, macOS
8sync ccc kit
```

```powershell
irm https://get.8syncdev.com/install.ps1 | iex     # Windows
8sync ccc kit
```

## Troubleshooting and support

- A skill says `8sync: command not found`: install the binary with the one-liner above, or skip the steps that need it; the agents work without it.
- Skills or agents missing after install: run `/plugin` and check that `8sync-kit@8sync` is enabled, then start a new session.
- Bugs and questions: [GitHub issues](https://github.com/8-Sync-Dev/8sync/issues). Security reports and anything private: atus@8syncdev.com.

## License

PolyForm Noncommercial 1.0.0 (see the repository `LICENSE`). Commercial use needs a license: [COMMERCIAL.md](https://github.com/8-Sync-Dev/8sync/blob/main/COMMERCIAL.md). Agents adapted from Feynman are MIT, see `THIRD_PARTY_NOTICES.md`.

8sync runs Anthropic's Claude Code; it is not made or endorsed by Anthropic.
