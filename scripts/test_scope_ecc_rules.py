"""Tests for scripts/scope-ecc-rules.py: python -I -m unittest discover -s scripts -p "test_*.py"."""
import importlib.util
import os
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location(
    "scope_ecc_rules", os.path.join(os.path.dirname(os.path.abspath(__file__)), "scope-ecc-rules.py"))
assert SPEC is not None and SPEC.loader is not None
scope_ecc_rules = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(scope_ecc_rules)


class ScopeTest(unittest.TestCase):
    def test_scopes_generic_rules_once_and_keeps_gate_rules(self):
        with tempfile.TemporaryDirectory() as repo:
            folder = os.path.join(repo, ".claude", "rules", "ecc", "common")
            os.makedirs(folder)
            for name in ("coding-style.md", "security.md", "git-workflow.md"):
                with open(os.path.join(folder, name), "w", encoding="utf-8") as fh:
                    fh.write(f"# {name}\n")

            self.assertEqual(scope_ecc_rules.scope_repo(repo), ["coding-style.md"])
            self.assertEqual(scope_ecc_rules.scope_repo(repo), [])

            with open(os.path.join(folder, "coding-style.md"), encoding="utf-8") as fh:
                text = fh.read()
            self.assertTrue(text.startswith('---\npaths:\n  - "**/*.rs"\n'))
            self.assertTrue(text.endswith("---\n# coding-style.md\n"))
            with open(os.path.join(folder, "security.md"), encoding="utf-8") as fh:
                self.assertEqual(fh.read(), "# security.md\n")

    def test_missing_folder_changes_nothing(self):
        with tempfile.TemporaryDirectory() as repo:
            self.assertEqual(scope_ecc_rules.scope_repo(repo), [])


if __name__ == "__main__":
    unittest.main()
