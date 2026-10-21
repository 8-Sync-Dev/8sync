# Known issues and migration notes

## Desktop install removed

`8sync` is a coding harness and no longer installs or manages a desktop
environment. The Caelestia integration (`8sync setup --caelestia`,
`--caelestia=rollback`, and `scripts/install-caelestia.sh`) was removed.
Install Hyprland, Caelestia or HyDE from their own upstreams.

A Caelestia install that an older `8sync` set up keeps working; current
`8sync` no longer touches it. To remove it by hand:

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

The short URL `https://get.8syncdev.com/install` serves the same script; see the
[README](../README.md#install) for the Windows one-liner.

## What `8sync setup` does now

- Stage A runs every time and is idempotent: `gh`, omp, `paru` (Arch family
  only), `codegraph`, Forge with zsh, Claude Code with the 8sync kit, gitleaks,
  the PATH bootstrap (bash/zsh/fish), configs and skills, and `harness global`.
- Stage B is opt-in: the profiles `dev-stack`, `nvidia`, `warp`, `bluetooth`
  and `terminal`, picked from a y/N menu, with `--community` (dev-stack and
  bluetooth, unattended) or with `--profile <name>`.

Personal profiles (`vietnamese`, `hardware-*`, `displaylink`, `apps-personal`,
`alexdev`) stay available through `--profile <name>` but are hidden from the
default menu. `8sync setup --dry-run` prints the full plan without changing
anything.
