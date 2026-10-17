#!/usr/bin/env bash
# 8sync bootstrap — build & install `8sync` from source (rustup + cargo).
#
# Most users want the prebuilt one-liner instead (no git/rust needed):
#   curl -fsSL https://raw.githubusercontent.com/8-Sync-Dev/8sync/main/install.sh | sh
#
# Use this when you want a source build (no prebuilt for your arch, or dev work).
# Sau đó dùng `8sync setup` cho phần còn lại.

set -euo pipefail

say() { printf "\033[1;36m[bootstrap]\033[0m %s\n" "$*"; }
ok()  { printf "\033[1;32m[ok]\033[0m %s\n" "$*"; }
warn(){ printf "\033[1;33m[warn]\033[0m %s\n" "$*"; }

# 1. rustup
if command -v rustup >/dev/null 2>&1; then
  ok "rustup đã có ($(rustup --version 2>/dev/null | head -1))"
else
  say "Cài rustup (stable, minimal profile)..."
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable --profile minimal
  # shellcheck disable=SC1091
  source "$HOME/.cargo/env"
fi

# Đảm bảo PATH có cargo cho session hiện tại
export PATH="$HOME/.cargo/bin:$PATH"

# 2. base-devel (Arch/CachyOS) — cần cho linker
if command -v pacman >/dev/null 2>&1; then
  if ! pacman -Qg base-devel >/dev/null 2>&1; then
    say "Cài base-devel (cần sudo)..."
    sudo pacman -S --needed --noconfirm base-devel
  else
    ok "base-devel đã có"
  fi
fi

# 3. build
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
say "Build release..."
cargo build --release --locked || cargo build --release

# 4. install vào ~/.local/bin
mkdir -p "$HOME/.local/bin"
install -m 755 target/release/8sync "$HOME/.local/bin/8sync"
ok "Đã cài 8sync → ~/.local/bin/8sync"

# 5. PATH hint
case ":$PATH:" in
  *":$HOME/.local/bin:"*) ;;
  *) warn "Thêm vào ~/.config/fish/config.fish:  fish_add_path -aP ~/.local/bin" ;;
esac

cat <<'EOF'

────────────────────────────────────────
 Tiếp theo:
   8sync setup        # cài full stack + cấu hình
   8sync doctor       # verify
   8sync .            # mở project session đầu tiên
────────────────────────────────────────
EOF
