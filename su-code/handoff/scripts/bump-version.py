"""Release bump on a clean main checkout: CHANGELOG heading, Cargo.toml, plugin.json.
    python3 -I bump-version.py <worktree> <old> <new> <date>   # e.g. 0.98.1 0.98.2 2026-10-17
    (cd <worktree> && cargo update --workspace --offline)   # Cargo.lock
    git diff --stat   # must list exactly CHANGELOG.md Cargo.lock Cargo.toml plugin.json
Files are read as UTF-8 (any line ending) and written with LF on every OS.
"""
import re
import sys

if len(sys.argv) != 5:
    raise SystemExit(__doc__)
wt, OLD, NEW, DATE = sys.argv[1:]
if not (re.fullmatch(r"\d+\.\d+\.\d+", OLD) and re.fullmatch(r"\d+\.\d+\.\d+", NEW)
        and re.fullmatch(r"\d{4}-\d{2}-\d{2}", DATE)):
    raise SystemExit(f"want <old> <new> as X.Y.Z and <date> as YYYY-MM-DD\n{__doc__}")


def edit(rel, old, new):
    p = f"{wt}/{rel}"
    with open(p, encoding="utf-8") as f:  # universal newlines: CRLF reads as LF
        s = f.read()
    assert s.count(old) == 1, f"{rel}: want exactly one {old!r}"
    with open(p, "w", encoding="utf-8", newline="") as f:  # LF, not CRLF, on Windows too
        f.write(s.replace(old, new, 1))


with open(f"{wt}/CHANGELOG.md", encoding="utf-8") as f:
    assert f"## [{NEW}]" not in f.read(), f"CHANGELOG already has {NEW}"
# Every file is checked before the first write, so a refused bump changes nothing.
for rel, old in (("Cargo.toml", f'version = "{OLD}"'),
                 ("assets/claude/.claude-plugin/plugin.json", f'"version": "{OLD}"')):
    with open(f"{wt}/{rel}", encoding="utf-8") as f:
        assert f.read().count(old) == 1, f"{rel}: want exactly one {old!r}"
edit("CHANGELOG.md", "## [Unreleased]\n", f"## [Unreleased]\n\n## [{NEW}] — {DATE}\n")
edit("Cargo.toml", f'version = "{OLD}"', f'version = "{NEW}"')
edit("assets/claude/.claude-plugin/plugin.json", f'"version": "{OLD}"', f'"version": "{NEW}"')
print("bumped", OLD, "->", NEW)
