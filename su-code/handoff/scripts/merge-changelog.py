"""Resolve a CHANGELOG.md merge conflict between a feature branch and origin/main.

Both sides add entries under `## [Unreleased]`. Result: one Unreleased block whose
`### ` sections are the union (main's entries first, then the branch's), sections
ordered Added, Changed, Fixed, Removed, Security, then anything else.

usage (after `git merge origin/main` reports a CHANGELOG conflict, HEAD = branch tip):
    python3 -I merge-changelog.py <worktree>
    git -C <worktree> add CHANGELOG.md && git -C <worktree> commit --no-edit
"""
import re
import subprocess
import sys

wt = sys.argv[1]


def show(ref):
    return subprocess.run(["git", "-C", wt, "show", f"{ref}:CHANGELOG.md"], check=True,
                          capture_output=True, text=True).stdout


def split(text):
    m = re.search(r"^## \[Unreleased\]\n(.*?)(?=^## \[)", text, re.S | re.M)
    assert m, "no Unreleased block"
    body = m.group(1)
    head = text[: m.start(1)]
    tail = text[m.end(1):]
    sections = {}
    order = []
    cur = None
    for line in body.splitlines():
        if line.startswith("### "):
            cur = line
            if cur not in sections:
                sections[cur] = []
                order.append(cur)
            continue
        if cur is None:
            if line.strip():
                raise SystemExit(f"entry outside a section: {line[:60]}")
            continue
        sections[cur].append(line)
    return head, sections, order, tail


main_text = show("origin/main")
branch_text = show("HEAD")
head, ms, morder, tail = split(main_text)
_, bs, border, _ = split(branch_text)

RANK = {"### Added": 0, "### Changed": 1, "### Fixed": 2, "### Removed": 3, "### Security": 4}
names = list(dict.fromkeys(morder + border))
names.sort(key=lambda n: RANK.get(n, 9))

out = [head.rstrip("\n")]
for n in names:
    lines = [l for l in ms.get(n, []) if l.strip()] + [l for l in bs.get(n, []) if l.strip()]
    out.append(n)
    out.extend(lines)
out.append("")
out.append(tail.lstrip("\n"))
result = "\n".join(out)
assert result.count("## [Unreleased]") == 1
assert "<<<<<<<" not in result and ">>>>>>>" not in result
open(f"{wt}/CHANGELOG.md", "w", encoding="utf-8").write(result)
print("merged sections:", ", ".join(n[4:] for n in names))
