#!/usr/bin/env bash
# The release helpers on this OS: Vietnamese UTF-8 in, LF out, no `-X utf8` needed.
# CI runs it on all three OSes. SCRIPTS_DIR swaps in other copies (mutation checks).
set -euo pipefail
dir="${SCRIPTS_DIR:-$(cd "$(dirname "$0")" && pwd)}"
# On Windows `python3` can be the Store alias, which runs nothing: take the first real Python 3.
py=
for c in python3 python; do
  if "$c" -c 'import sys; sys.exit(sys.version_info[0] != 3)' > /dev/null 2>&1; then py=$c; break; fi
done
[ -n "$py" ] || { echo "FAIL: no Python 3 on PATH"; exit 1; }
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
fail() { echo "FAIL: $*"; exit 1; }
# Bytes, not grep: Git for Windows' grep drops the CR of CRLF before matching.
no_cr() { "$py" -c 'import sys; sys.exit(b"\r" in open(sys.argv[1], "rb").read())' "$1" || fail "CR in $1"; }

# merge-changelog.py: both sides add to Unreleased; "ờ" is 0x9D in UTF-8, which cp1252 cannot decode.
r="$tmp/r"
mkdir "$r"
g() { git -C "$r" -c user.name=t -c user.email=t@example.invalid -c core.autocrlf=false "$@"; }
g init -q -b main
base='# Changelog\n\n## [Unreleased]\n\n## [1.0.0] — 2026-01-01\n- bản đầu\n'
printf "$base" > "$r/CHANGELOG.md"
g add CHANGELOG.md
g commit -q -m base
g checkout -q -b feat
printf '# Changelog\n\n## [Unreleased]\n### Added\n- nhánh: thêm mục\n### Fixed\n- nhánh: sửa giờ\n\n## [1.0.0] — 2026-01-01\n- bản đầu\n' > "$r/CHANGELOG.md"
g commit -q -am feat
g checkout -q main
printf '# Changelog\n\n## [Unreleased]\n### Fixed\n- main: đúng giờ — ờ\n\n## [1.0.0] — 2026-01-01\n- bản đầu\n' > "$r/CHANGELOG.md"
g commit -q -am main
g update-ref refs/remotes/origin/main main
g checkout -q feat
if g merge -q origin/main > /dev/null 2>&1; then fail "fixture: expected a CHANGELOG conflict"; fi
"$py" -I "$dir/merge-changelog.py" "$r" > "$tmp/merge.out" 2>&1 || { tail -3 "$tmp/merge.out"; fail "merge-changelog.py"; }
want='# Changelog\n\n## [Unreleased]\n### Added\n- nhánh: thêm mục\n### Fixed\n- main: đúng giờ — ờ\n- nhánh: sửa giờ\n\n## [1.0.0] — 2026-01-01\n- bản đầu\n'
printf "$want" > "$tmp/want.md"
cmp -s "$tmp/want.md" "$r/CHANGELOG.md" || { diff "$tmp/want.md" "$r/CHANGELOG.md" | head -8; fail "merged CHANGELOG"; }

# bump-version.py: CRLF in (an editor or autocrlf checkout), LF out; versions as arguments.
b="$tmp/b"
mkdir -p "$b/assets/claude/.claude-plugin"
printf "$base" | awk '{ printf "%s\r\n", $0 }' > "$b/CHANGELOG.md"
printf '[workspace.package]\r\nversion = "1.0.0"\r\n' > "$b/Cargo.toml"
printf '{\r\n  "name": "x",\r\n  "version": "1.0.0"\r\n}\r\n' > "$b/assets/claude/.claude-plugin/plugin.json"
"$py" -I "$dir/bump-version.py" "$b" 1.0.0 1.0.1 2026-10-17 > "$tmp/bump.out" 2>&1 || { tail -3 "$tmp/bump.out"; fail "bump-version.py"; }
for f in CHANGELOG.md Cargo.toml assets/claude/.claude-plugin/plugin.json; do no_cr "$b/$f"; done
grep -qxF '## [1.0.1] — 2026-10-17' "$b/CHANGELOG.md" || fail "CHANGELOG heading"
grep -qxF 'version = "1.0.1"' "$b/Cargo.toml" || fail "Cargo.toml version"
grep -qF '"version": "1.0.1"' "$b/assets/claude/.claude-plugin/plugin.json" || fail "plugin.json version"
if "$py" -I "$dir/bump-version.py" "$b" 1.0.0 1.0.1 2026-10-17 > /dev/null 2>&1; then fail "a second bump was accepted"; fi
if "$py" -I "$dir/bump-version.py" "$b" 1.0.1 2026-10-17 1.0.2 > /dev/null 2>&1; then fail "swapped arguments were accepted"; fi
grep -qxF 'version = "1.0.1"' "$b/Cargo.toml" || fail "a refused bump changed Cargo.toml"

echo "handoff scripts ok ($(uname -s), $("$py" -c 'import platform; print(platform.python_version())'))"
