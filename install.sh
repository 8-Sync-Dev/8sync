#!/bin/sh
#
# 8sync standalone installer.
#
# Downloads the prebuilt `8sync` binary from GitHub Releases — no git clone,
# no Rust toolchain, no cargo build. Ideal for a fresh machine or quick upgrade.
#
#   curl -fsSL https://raw.githubusercontent.com/8-Sync-Dev/su-code/main/install.sh | sh
#
# Upgrade:   re-run the same command (atomically replaces the old binary).
# Uninstall: curl -fsSL .../install.sh | sh -s -- --uninstall
#
# After the binary lands, the installer runs `8sync setup --no-profile`: the AI
# harness (gh, omp, codegraph, forge + zsh, configs, skills, `harness global`).
#
# Environment:
#   SUSYNC_VERSION   release tag to install (default: latest, e.g. v0.12.1)
#   SUSYNC_BIN_DIR   install location (default: ~/.local/bin)
#   SUSYNC_NO_SETUP  set to 1 to install the binary only (skip `8sync setup`)
set -eu

REPO="8-Sync-Dev/su-code"
BIN_DIR="${SUSYNC_BIN_DIR:-$HOME/.local/bin}"
BIN="$BIN_DIR/8sync"

if [ "${1:-}" = "--uninstall" ]; then
  rm -f "$BIN"
  echo "8sync uninstalled (removed $BIN)."
  exit 0
fi

# 1. Platform check — resolve os first, then arch (arm64 naming differs per-os).
os="$(uname -s)"
arch="$(uname -m)"
case "$os" in
  Linux) os="linux" ;;
  Darwin) os="darwin" ;;
  *) echo "8sync: no prebuilt binary for '$os' yet — build from source: https://github.com/$REPO (scripts/bootstrap.sh)" >&2; exit 1 ;;
esac
case "$arch" in
  x86_64|amd64) arch="x86_64" ;;
  aarch64|arm64)
    # Apple Silicon reports/uses arm64; Linux uses aarch64.
    case "$os" in
      linux) arch="aarch64" ;;
      darwin) arch="arm64" ;;
    esac
    ;;
  *) echo "8sync: no prebuilt binary for '$arch' yet — build from source: https://github.com/$REPO (scripts/bootstrap.sh)" >&2; exit 1 ;;
esac

# 2. Resolve the version (latest unless SUSYNC_VERSION is pinned).
#
# Prefer the releases/latest *web* redirect over the GitHub API: the
# unauthenticated API is rate-limited to 60 req/hour per IP (403 once
# exhausted — common on shared/cloud hosts and CI). The redirect
# (github.com/<repo>/releases/latest -> .../releases/tag/vX.Y.Z) is not.
version="${SUSYNC_VERSION:-}"
if [ -z "$version" ]; then
  version="$(curl -fsSLI -o /dev/null -w '%{url_effective}' "https://github.com/$REPO/releases/latest" \
    | sed -n 's#.*/releases/tag/##p' | tr -d '\r')"
fi
if [ -z "$version" ]; then
  version="$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
    | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -n1)"
fi
[ -n "$version" ] || { echo "8sync: could not resolve latest version; set SUSYNC_VERSION (e.g. SUSYNC_VERSION=v0.12.1)." >&2; exit 1; }
# Release tags are vX.Y.Z; accept a bare X.Y.Z in SUSYNC_VERSION too.
case "$version" in v*) ;; *) version="v$version" ;; esac

# 3. Optional integrity check.
#
# GitHub's release API exposes a per-asset `digest` of the form "sha256:<hex>".
# Both halves of this check are best-effort: the unauthenticated API is
# rate-limited to 60 req/hour (the very reason step 2 avoids it) and minimal
# images may ship no sha256 tool. Either miss prints a notice and continues —
# refusing to install because GitHub throttled us would be worse than the
# status quo. A digest we *do* obtain that does *not* match is fatal.
verify_checksum() {
  _asset="$1"
  _file="$2"

  if command -v sha256sum >/dev/null 2>&1; then
    _hasher="sha256sum"
  elif command -v shasum >/dev/null 2>&1; then
    _hasher="shasum"
  else
    echo "  checksum: skipped (no sha256sum or shasum on PATH)"
    return 0
  fi

  # Within an asset object the API emits "name" before "digest", so latch on
  # the matching name and take the next digest. Any other shape -> no match
  # -> skipped, never a false pass.
  _want="$(curl -fsSL --proto '=https' --tlsv1.2 \
      "https://api.github.com/repos/$REPO/releases/tags/$version" 2>/dev/null \
    | tr ',' '\n' \
    | awk -v a="$_asset" '
        /"name"[[:space:]]*:/ {
          n = $0
          sub(/.*"name"[[:space:]]*:[[:space:]]*"/, "", n)
          sub(/".*/, "", n)
          hit = (n == a)
          next
        }
        hit && /"digest"[[:space:]]*:[[:space:]]*"sha256:/ {
          d = $0
          sub(/.*"sha256:/, "", d)
          sub(/".*/, "", d)
          print d
          exit
        }')"

  if [ "${#_want}" -ne 64 ]; then
    echo "  checksum: skipped (no sha256 digest published for $_asset)"
    return 0
  fi

  if [ "$_hasher" = "sha256sum" ]; then
    _got="$(sha256sum "$_file" | cut -d' ' -f1)"
  else
    _got="$(shasum -a 256 "$_file" | cut -d' ' -f1)"
  fi

  if [ "$_got" != "$_want" ]; then
    echo "8sync: checksum mismatch for $_asset — refusing to install." >&2
    echo "  expected sha256:$_want" >&2
    echo "  actual   sha256:$_got" >&2
    exit 1
  fi
  echo "  checksum: ok (sha256:$_want)"
}

# 4. Download the release asset to a temp file, then atomically replace.
#
# The temp file must be a *sibling* of the destination, not $TMPDIR: on most
# distros /tmp is tmpfs while $BIN_DIR (~/.local/bin) is not, so `mv` across
# that boundary is an EXDEV copy, not a rename — leaving a partially written
# binary observable at $BIN. A same-directory rename is atomic. This mirrors
# download_and_replace() in crates/cli/src/verbs/selfup.rs.
asset="8sync-${version}-${os}-${arch}"
url="https://github.com/$REPO/releases/download/$version/$asset"
echo "Installing 8sync $version ($os-$arch)..."
mkdir -p "$BIN_DIR" || { echo "8sync: could not create $BIN_DIR" >&2; exit 1; }
tmp="$BIN_DIR/.8sync.new.$$"
trap 'rm -f "$tmp"' EXIT HUP INT TERM
curl -fSL --proto '=https' --tlsv1.2 "$url" -o "$tmp" 2>/dev/null \
  || { echo "8sync: download failed: $url" >&2; exit 1; }
[ -s "$tmp" ] || { echo "8sync: downloaded an empty file from $url" >&2; exit 1; }
verify_checksum "$asset" "$tmp"
chmod 0755 "$tmp"
mv -f "$tmp" "$BIN"
trap - EXIT HUP INT TERM

echo "Installed → $BIN"
"$BIN" --version 2>/dev/null || true

# 5. PATH hint if ~/.local/bin is not yet on PATH (bash/zsh/fish).
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *)
    echo ""
    echo "$BIN_DIR is not on your PATH. Add it:"
    echo "  bash/zsh: echo 'export PATH=\"$BIN_DIR:\$PATH\"' >> ~/.bashrc   # or ~/.zshrc"
    echo "  fish:     fish_add_path -aP $BIN_DIR"
    echo "  (\`8sync setup\` also wires PATH for bash/zsh/fish automatically.)"
    ;;
esac
echo ""

# 6. Harness setup. Under `curl | sh` our stdin IS this script: a child that
# reads stdin would swallow the rest of it, so give setup the terminal when
# there is one and /dev/null otherwise (setup never prompts with --no-profile;
# sudo reads the tty directly).
if [ "${SUSYNC_NO_SETUP:-0}" = "1" ]; then
  echo "SUSYNC_NO_SETUP=1 — skipped setup. Run it any time: 8sync setup"
else
  echo "Running 8sync setup --no-profile (AI harness: omp, codegraph, forge, skills, MCP)..."
  if (exec </dev/tty) 2>/dev/null; then setup_in=/dev/tty; else setup_in=/dev/null; fi
  # Tools installed during setup land in these dirs; later steps must see them
  # even before the user's shell rc picks them up.
  if PATH="$BIN_DIR:$HOME/.local/bin:$HOME/.bun/bin:$PATH" "$BIN" setup --no-profile <"$setup_in"; then
    echo "Setup finished — the summary above lists any step to retry."
  else
    echo "8sync: setup reported failures — fix them and re-run: 8sync setup --no-profile" >&2
  fi
fi
echo ""
echo "Next steps:"
echo "  8sync doctor             # verify"
echo "  8sync setup              # optional Linux profiles (dev-stack, nvidia, terminal, ...)"
echo "  cd <project> && 8sync .  # omp session  ·  8sync forge <name>  # Forge zsh session"
echo "  8sync up                 # upgrade later (8sync also notifies when a release is out)"
