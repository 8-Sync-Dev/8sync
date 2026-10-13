#!/usr/bin/env bash
# Package the HQ web UI + MCP channel as ONE platform-independent release asset.
#
#   bash scripts/package-hq-ui.sh [<version>]     # default: version from Cargo.toml
#   -> dist/8sync-hq-ui-v<version>.tar.gz  (+ .sha256, sha256sum format)
#
# Tarball layout (what `8sync hq ui` extracts into ~/.local/share/8sync/hq-ui/<version>/):
#   hq-ui/server.js, hq-ui/node_modules/, hq-ui/.next/static/, hq-ui/public/   (Next standalone)
#   hq-channel/server.mjs                                                      (esbuild bundle, no node_modules)
#   VERSION
# Linux only (CI): uses GNU tar/cp/find. The tarball has NO symlinks (Windows bsdtar cannot create them).
# Needs only `node >= 22.5` on the user's machine. Fails if any native binary is inside.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
ver=${1:-$(sed -n 's/^version = "\(.*\)"/\1/p' "$root/Cargo.toml" | head -1)}
ver=${ver#v}
[ -n "$ver" ] || { echo "no version" >&2; exit 1; }

out="$root/out"
dist="$root/dist"
asset="8sync-hq-ui-v${ver}.tar.gz"
rm -rf "$out"
mkdir -p "$out/hq-ui" "$out/hq-channel" "$dist"

echo "== hq-ui: install + build"
( cd "$root/apps/hq-ui" && pnpm install --frozen-lockfile && pnpm build )
sa="$root/apps/hq-ui/.next/standalone"
[ -f "$sa/server.js" ] || { echo "no .next/standalone/server.js (next.config output: standalone?)" >&2; exit 1; }
# Stage as-is, drop dangling links (sharp leftovers), then dereference the rest: no symlinks in the asset.
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
cp -a "$sa/." "$stage/"
find "$stage" -xtype l -delete
cp -aL "$stage/." "$out/hq-ui/"

# pnpm resolves siblings through symlinks into node_modules/.pnpm; without links, hoist every package of the
# virtual store to node_modules/ (what Node's resolver needs), refuse a version conflict, then drop .pnpm.
nm="$out/hq-ui/node_modules"
if [ -d "$nm/.pnpm" ]; then
  ver_of() { sed -n 's/^[[:space:]]*"version":[[:space:]]*"\([^"]*\)".*/\1/p' "$1/package.json" | head -1; }
  hoist() { # <pkgdir> <name>
    if [ -e "$nm/$2" ]; then
      [ "$(ver_of "$1")" = "$(ver_of "$nm/$2")" ] || { echo "hoist conflict: $2 $(ver_of "$1") vs $(ver_of "$nm/$2")" >&2; exit 1; }
    else
      mkdir -p "$(dirname "$nm/$2")" && cp -a "$1" "$nm/$2"
    fi
  }
  for pk in "$nm"/.pnpm/*/node_modules/*; do
    n=$(basename "$pk")
    case "$n" in
      @*) for sp in "$pk"/*; do hoist "$sp" "$n/$(basename "$sp")"; done ;;
      *) hoist "$pk" "$n" ;;
    esac
  done
  rm -rf "$nm/.pnpm"
fi
mkdir -p "$out/hq-ui/.next"
cp -a "$root/apps/hq-ui/.next/static" "$out/hq-ui/.next/static"
[ -d "$root/apps/hq-ui/public" ] && cp -a "$root/apps/hq-ui/public" "$out/hq-ui/public"

echo "== hq-channel: install + build + bundle"
( cd "$root/apps/hq-channel" && pnpm install --frozen-lockfile && pnpm build )
( cd "$root/apps/hq-channel" && pnpm exec esbuild src/server.ts --bundle --platform=node --format=esm \
    --target=node22 --outfile="$out/hq-channel/server.mjs" --log-level=warning )
echo "$ver" > "$out/VERSION"

# server-side source maps are dead weight in the asset (client maps are not emitted)
find "$out/hq-ui" -name '*.js.map' -not -path '*/.next/static/*' -delete

echo "== symlink check (asset must have none)"
links=$(find "$out" -type l -print)
if [ -n "$links" ]; then
  echo "symlinks remain in out/:" >&2
  echo "$links" >&2
  exit 1
fi

echo "== platform check (no native binaries)"
native=$(find "$out" \( -name '*.node' -o -name '*.so' -o -name '*.so.*' -o -name '*.dylib' -o -name '*.dll' -o -name '*.exe' \) -print)
if [ -n "$native" ]; then
  echo "native binaries found, asset would not be platform-independent:" >&2
  echo "$native" >&2
  exit 1
fi

echo "== tar"
rm -f "$dist/$asset" "$dist/$asset.sha256"
tar --sort=name --owner=0 --group=0 --numeric-owner -C "$out" -czf "$dist/$asset" hq-ui hq-channel VERSION
( cd "$dist" && sha256sum "$asset" > "$asset.sha256" )
cat "$dist/$asset.sha256"
echo "size: $(stat -c %s "$dist/$asset") bytes ($(du -h "$dist/$asset" | cut -f1)) — $dist/$asset"
