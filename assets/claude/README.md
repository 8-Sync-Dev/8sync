# 8sync kit (Claude Code plugin)

Role-routed subagents and the delivery skills from [8sync](https://get.8syncdev.com), packaged as a Claude Code plugin.

```text
/plugin marketplace add 8-Sync-Dev/8sync
/plugin install 8sync-kit@8sync
```

## What you get

- **Subagents** (`agents/`): explore, task, quick-task, reviewer, designer, researcher, verifier, pm, architect, qa, critic.
- **Skills** (`skills/`): `/do`, `/ship`, `/ship-auto`, `/ship-loop`, `/autopilot`, `/ship-tick`, `/sprint`, `/planning`, `/sysdesign`, `/ui-ux`, `/remember`, `/consolidate`, `/rules`, `/sec`, `/harden`.

The plugin does not install hooks or change settings. The guard, verify and stop gates, managed rules and the full skill set come from the `8sync` binary:

```sh
curl -fsSL https://get.8syncdev.com/install | sh   # Linux, macOS
8sync ccc kit
```

```powershell
irm https://get.8syncdev.com/install.ps1 | iex     # Windows
8sync ccc kit
```

## License

PolyForm Noncommercial 1.0.0 (see the repository `LICENSE`). Commercial use needs a license: [COMMERCIAL.md](https://github.com/8-Sync-Dev/8sync/blob/main/COMMERCIAL.md). Agents adapted from Feynman are MIT, see `THIRD_PARTY_NOTICES.md`.

8sync runs Anthropic's Claude Code; it is not made or endorsed by Anthropic.
