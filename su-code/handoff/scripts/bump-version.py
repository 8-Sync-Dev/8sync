"""Release bump on a clean main checkout: CHANGELOG heading, Cargo.toml, plugin.json.
Edit OLD / NEW / DATE below, then:
    python3 -I bump-version.py <worktree>
    (cd <worktree> && cargo update --workspace --offline)   # Cargo.lock
    git diff --stat   # must list exactly CHANGELOG.md Cargo.lock Cargo.toml plugin.json
"""
import sys

wt = sys.argv[1]
OLD, NEW, DATE = "0.95.0", "0.96.0", "2026-10-16"

p = f"{wt}/CHANGELOG.md"
s = open(p, encoding="utf-8").read()
assert s.count("## [Unreleased]\n") == 1
assert f"## [{NEW}]" not in s
s = s.replace("## [Unreleased]\n", f"## [Unreleased]\n\n## [{NEW}] — {DATE}\n", 1)
open(p, "w", encoding="utf-8").write(s)

p = f"{wt}/Cargo.toml"
s = open(p, encoding="utf-8").read()
assert s.count(f'version = "{OLD}"') == 1
open(p, "w", encoding="utf-8").write(s.replace(f'version = "{OLD}"', f'version = "{NEW}"', 1))

p = f"{wt}/assets/claude/.claude-plugin/plugin.json"
s = open(p, encoding="utf-8").read()
assert s.count(f'"version": "{OLD}"') == 1
open(p, "w", encoding="utf-8").write(s.replace(f'"version": "{OLD}"', f'"version": "{NEW}"', 1))
print("bumped", OLD, "->", NEW)
