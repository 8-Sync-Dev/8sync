#!/usr/bin/env python3
"""Add `paths:` frontmatter to ECC's generic rules so they stop loading every turn.

ECC installs `.claude/rules/ecc/common/*.md` without `paths:`, so Claude Code
loads all ten (~18 KB, ~4.6k tokens) into every main turn and every subagent's
first turn. This scopes the generic ones to the files they are about; the
commit-gate rules (security.md, git-workflow.md) stay always-on. Idempotent:
a file that already starts with frontmatter is left alone. Re-run after an ECC
reinstall.

  python -I scripts/scope-ecc-rules.py REPO [REPO...]
"""
import os
import sys

CODE = ["**/*.rs", "**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx", "**/*.py", "**/*.go"]
SCOPES = {
    "agents.md": [".claude/agents/**"],
    "code-review.md": CODE,
    "coding-style.md": CODE,
    "development-workflow.md": CODE,
    "hooks.md": ["**/hooks.json", "**/hooks/**", ".claude/settings*.json"],
    "patterns.md": CODE,
    "performance.md": [".claude/settings*.json", ".claude/agents/**"],
    "testing.md": CODE + ["**/tests/**"],
}


def frontmatter(globs):
    return "---\npaths:\n" + "".join(f'  - "{g}"\n' for g in globs) + "---\n"


def scope_repo(repo):
    """Return the rule files changed under REPO."""
    folder = os.path.join(repo, ".claude", "rules", "ecc", "common")
    changed = []
    for name, globs in SCOPES.items():
        path = os.path.join(folder, name)
        if not os.path.isfile(path):
            continue
        with open(path, encoding="utf-8") as fh:
            text = fh.read()
        if text.startswith("---\n"):
            continue
        with open(path, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(frontmatter(globs) + text)
        changed.append(name)
    return changed


def main(argv):
    if len(argv) < 2:
        print((__doc__ or "").strip())
        return 2
    for repo in argv[1:]:
        changed = scope_repo(repo)
        print(f"{repo}: scoped {len(changed)} rule(s)" + (f" ({', '.join(changed)})" if changed else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
