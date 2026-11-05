"""The site's skills catalogue (docs/index.html #skills) must list exactly the bundled skills.

A skill added to or removed from assets/skills without touching the page would otherwise leave the
public site advertising the wrong set; the heading's count must match too.
"""

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def bundled() -> set[str]:
    return {p.parent.name for p in (ROOT / "assets" / "skills").glob("*/SKILL.md")}


def section() -> str:
    html = (ROOT / "docs" / "index.html").read_text(encoding="utf-8")
    m = re.search(r'<section class="section" id="skills".*?</section>\s*</div>\s*</section>', html, re.S)
    if not m:
        raise AssertionError("docs/index.html has no #skills section")
    return m.group(0)


class SiteSkills(unittest.TestCase):
    def test_lists_every_bundled_skill_once(self):
        listed = re.findall(r"<li>([a-z0-9-]+)</li>", section())
        self.assertEqual(len(listed), len(set(listed)), "a skill is listed twice")
        self.assertEqual(set(listed), bundled())

    def test_counts_match(self):
        s = section()
        total = int(re.search(r'id="skills-title">(\d+) skills', s).group(1))
        self.assertEqual(total, len(bundled()))
        for group in re.findall(r"<section><h3>.*?</ul></section>", s, re.S):
            n = int(re.search(r"<small>(\d+)</small>", group).group(1))
            self.assertEqual(n, len(re.findall(r"<li>", group)), group[:60])

    def test_readme_table_matches(self):
        readme = (ROOT / "README.md").read_text(encoding="utf-8")
        part = readme.split("## Bundled skills", 1)[1].split("\n## ", 1)[0]
        n = int(re.search(r"(\d+) skills ship", part).group(1))
        rows = [l for l in part.splitlines() if l.startswith("| ") and "`" in l]
        listed = re.findall(r"`([a-z0-9-]+)`", "\n".join(rows))
        self.assertEqual(sorted(listed), sorted(bundled()))
        self.assertEqual(n, len(bundled()))


if __name__ == "__main__":
    unittest.main()
