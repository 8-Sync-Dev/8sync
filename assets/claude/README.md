# 8sync kit (Claude Code plugin)

Role-routed subagents and the delivery skills from [8sync](https://get.8syncdev.com), packaged as a Claude Code plugin.

```text
/plugin marketplace add 8-Sync-Dev/8sync
/plugin install 8sync-kit@8sync
```

## What you get

- **Subagents** (`agents/`): explore, task, quick-task, reviewer, designer, researcher, verifier, pm, architect, qa, critic.
- **Skills** (`skills/`): `/do`, `/ship`, `/ship-auto`, `/ship-loop`, `/autopilot`, `/ship-tick`, `/sprint`, `/planning`, `/sysdesign`, `/ui-ux`, `/remember`, `/consolidate`, `/rules`, `/sec`, `/harden`.

## What it runs and sends

The plugin is Markdown only: no hooks, no MCP servers, no scripts, no settings changes, and no network calls of its own. The skills ask Claude to run commands in your repository with your normal permission prompts: `git`, `gh` (pull requests, CI runs), your project's build, test and lint commands, and `8sync` subcommands when the binary is installed. The researcher and verifier agents read web pages with Claude Code's own web tools. Nothing goes to 8 Sync.

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
