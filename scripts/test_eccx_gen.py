"""Tests for scripts/eccx-gen.py: the committed commands match a fresh run, and the loop
commands exist for Claude Code only."""
import importlib.util
import os
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("eccx_gen", os.path.join(HERE, "eccx-gen.py"))
gen = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gen)


class LoopCommands(unittest.TestCase):
    def test_every_category_has_a_claude_loop_command_and_omp_has_none(self):
        cc = set(os.listdir(gen.OUT["cc"]))
        for c in gen.CATS:
            self.assertIn(f"eccx-loop-{c}.md", cc)
        self.assertFalse([f for f in os.listdir(gen.OUT["omp"]) if f.startswith("eccx-loop-")])

    def test_committed_loop_commands_match_the_generator(self):
        for c in gen.CATS:
            with open(os.path.join(gen.OUT["cc"], f"eccx-loop-{c}.md"), encoding="utf-8") as f:
                self.assertEqual(f.read(), gen.loop_body(c), f"eccx-loop-{c}.md is stale: run python scripts/eccx-gen.py")

    def test_loop_body_points_at_its_own_category_and_fits_the_budget(self):
        for c in gen.CATS:
            text = gen.loop_body(c)
            self.assertIn(f"Driver: /eccx-{c}`", text)
            self.assertIn(f"~/.claude/commands/eccx-{c}.md", text)
            self.assertIn("--max-iter 8", text)
            self.assertLessEqual(len(text.encode("utf-8")), gen.MAX_BYTES)
        self.assertIn("Route + Select", gen.loop_body("full"))


if __name__ == "__main__":
    unittest.main()
