#!/usr/bin/env bash
# alexdev one-shot bootstrap — idempotent.
#
# Thiết lập cả môi trường coding cá nhân trong 1 lệnh:
#   · 8sync binary (prebuilt, không cần sudo)
#   · alexdev profile → kitty + fan/LED (CoolerControl/OpenRGB/Lian Li)
#                       + Cloudflare WARP + fcitx5/Unikey
#   · Unikey auto-config (IM env vars + fcitx5 profile + restart)
#                       → gõ tiếng Việt sẵn luôn, không cần làm tay
#
# Check → đã cài thì skip, chưa cài thì cài. Chạy lại bao nhiêu lần cũng OK.
# AI harness đã custom trên omp — `8sync .` chỉ wrap `omp --continue` tại path.
#
# Chạy trong terminal của bạn (cần sudo password cho pacman/paru/yay):
#   bash scripts/alexdev-install.sh
set -uo pipefail

export PATH="$HOME/.local/bin:$PATH"
ALEXDEV_OVERRIDE_DIR="$HOME/.config/8sync/profiles"

c()    { printf '\033[1;36m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[1;32m✓\033[0m %s\n' "$*"; }
wn()   { printf '  \033[1;33m→\033[0m %s\n' "$*"; }
have() { command -v "$1" >/dev/null 2>&1; }

# ─────────────────────────────────────────────────────────────
c "1/5  8sync binary"
# ─────────────────────────────────────────────────────────────
if have 8sync; then ok "8sync $(8sync --version 2>/dev/null) — skip"; else
  wn "tải prebuilt 8sync…"
  curl -fsSL https://raw.githubusercontent.com/8-Sync-Dev/8sync/main/install.sh | sh
fi

# ─────────────────────────────────────────────────────────────
c "2/5  alexdev profile override (kitty + fan/LED + WARP + Unikey)"
# ─────────────────────────────────────────────────────────────
mkdir -p "$ALEXDEV_OVERRIDE_DIR"
cat > "$ALEXDEV_OVERRIDE_DIR/alexdev.toml" <<'TOML'
name = "alexdev"
description = "alexdev bundle — kitty terminal + fan/LED control (CoolerControl/OpenRGB/Lian Li) + Cloudflare WARP + Vietnamese Unikey"
visibility = "personal"

extends = [
  "hardware-cooling",
  "hardware-lianli",
  "warp",
  "vietnamese",
]

[packages]
pacman = ["kitty"]
aur = []

[services]
system_enable = []
user_enable = []

[post_install]
commands = []
hint = "Re-login để fcitx5 (Unikey) + Cloudflare WARP có hiệu lực."
TOML
ok "alexdev override written (trim nvidia/dev-stack/bluetooth/displaylink/apps-personal)"

# ─────────────────────────────────────────────────────────────
c "3/5  apply alexdev profile (pacman/paru/yay — sudo)"
# ─────────────────────────────────────────────────────────────
# Stage A harness (omp/gh/paru/skills/PATH) + bundle đã trim.
# Idempotent (pacman --needed); log tại ~/.cache/8sync/.
8sync setup --profile alexdev

# ─────────────────────────────────────────────────────────────
c "4/5  Unikey auto-config (không cần sudo)"
# ─────────────────────────────────────────────────────────────
# (a) IM env vars — systemd/Hyprland session đọc khi login.
ENV_FILE="$HOME/.config/environment.d/fcitx5.conf"
mkdir -p "$(dirname "$ENV_FILE")"
if [ -f "$ENV_FILE" ] && grep -q '^GTK_IM_MODULE=fcitx$' "$ENV_FILE"; then
  ok "IM env vars đã có — skip"
else
  cat > "$ENV_FILE" <<'EOF'
GTK_IM_MODULE=fcitx
QT_IM_MODULE=fcitx
XMODIFIERS=@im=fcitx
SDL_IM_MODULE=fcitx
INPUT_METHOD=fcitx
EOF
  ok "IM env vars written (active sau re-login)"
fi

# (b) fcitx5 profile — add Unikey nếu chưa có.
FCITX_PROFILE="$HOME/.config/fcitx5/profile"
if [ -f "$FCITX_PROFILE" ] && grep -q '^Name=unikey$' "$FCITX_PROFILE"; then
  ok "Unikey đã trong fcitx5 profile — skip"
else
  if have fcitx5; then pkill -x fcitx5 2>/dev/null; sleep 1; fi   # stop để không overwrite khi save
  mkdir -p "$(dirname "$FCITX_PROFILE")"
  cat > "$FCITX_PROFILE" <<'EOF'
[Groups/0]
Name=Default
Default Layout=us
DefaultIM=keyboard-us

[Groups/0/Items/0]
Name=keyboard-us
Layout=

[Groups/0/Items/1]
Name=unikey
Layout=

[GroupOrder]
0=Default
EOF
  ok "Unikey added vào fcitx5 profile"
fi

# (c) ensure fcitx5 đang chạy
if have fcitx5; then
  if pgrep -x fcitx5 >/dev/null; then ok "fcitx5 đang chạy — skip"; else
    setsid fcitx5 -d --replace >/dev/null 2>&1 < /dev/null
    ok "fcitx5 started"
  fi
fi

# ─────────────────────────────────────────────────────────────
c "5/5  verify"
# ─────────────────────────────────────────────────────────────
have kitty  && ok "kitty $(kitty --version 2>/dev/null)"    || wn "kitty: MISSING"
have omp    && ok "omp present"                             || wn "omp: MISSING"
have fcitx5 && ok "fcitx5 present"                          || wn "fcitx5: MISSING"
pgrep -x fcitx5 >/dev/null && ok "fcitx5 running"          || wn "fcitx5 not running"
grep -q '^Name=unikey$' "$FCITX_PROFILE" 2>/dev/null && ok "Unikey configured" || wn "Unikey not configured"
[ -f "$ENV_FILE" ] && ok "IM env vars file present"        || wn "IM env vars MISSING"
8sync doctor 2>/dev/null || true

echo
c "Done."
echo "  · RE-LOGIN (hoặc reboot) để IM env vars + session pickup."
echo "  · Ctrl+Space = bật/tắt Unikey (gõ tiếng Việt)."
echo "  · cd <project> && omp --continue  — dùng AI harness (đã custom trên omp)."
