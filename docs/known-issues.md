# 🛟 Known issues & migration notes

## Desktop install removed

`8sync` is a **coding harness** — it no longer installs or manages a desktop
environment. The Caelestia integration (`8sync setup --caelestia`,
`--caelestia=rollback`, and `scripts/install-caelestia.sh`) was **removed**.
Install Hyprland / Caelestia / HyDE directly from their own upstreams.

If a machine still has a Caelestia install that `8sync` set up under an older
version, it keeps working — `8sync` simply no longer touches it. To remove it
manually:

```sh
# restore a pre-Caelestia Hypr config if you have a backup
ls -d ~/.config/hypr.bak.caelestia.* 2>/dev/null
# remove the cloned dotfiles + (optionally) the packages
rm -rf ~/.local/share/caelestia
sudo pacman -Rns caelestia-meta quickshell   # only if you want the pkgs gone
```

## Fresh install (no 8sync yet)

```sh
curl -fsSL https://raw.githubusercontent.com/8-Sync-Dev/8sync/main/install.sh | sh \
  && 8sync setup
```

## What `8sync setup` does now

- **Stage A** (always): harness — `github-cli`, `omp`, `paru`, `codegraph`,
  PATH bootstrap (bash/zsh/fish), configs + skills.
- **Stage B** (opt-in): community profiles `dev-stack`, `nvidia`, `bluetooth`,
  `warp` via a y/N menu, or `--community` (dev-stack + bluetooth) / `--profile <name>`.

Personal profiles (`vietnamese`, `hardware-*`, `displaylink`, `apps-personal`,
`alexdev`) stay available via `--profile <name>` but are hidden from the default menu.
