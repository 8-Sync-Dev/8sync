"""Tests for scripts/eccx-gen.py: the committed commands match a fresh run, and every category
has a loop command on both hosts (Claude Code: cron ticks; omp: the engine's in-session loop)."""
import importlib.util
import os
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("eccx_gen", os.path.join(HERE, "eccx-gen.py"))
gen = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gen)


class LoopCommands(unittest.TestCase):
    def test_every_category_has_a_loop_command_on_both_hosts(self):
        for h in ("cc", "omp"):
            have = set(os.listdir(gen.OUT[h]))
            for c in gen.CATS:
                self.assertIn(f"eccx-loop-{c}.md", have)

    def test_committed_loop_commands_match_the_generator(self):
        for h, make in (("cc", gen.loop_body), ("omp", gen.loop_body_omp)):
            for c in gen.CATS:
                with open(os.path.join(gen.OUT[h], f"eccx-loop-{c}.md"), encoding="utf-8") as f:
                    self.assertEqual(f.read(), make(c), f"{h} eccx-loop-{c}.md is stale: run python scripts/eccx-gen.py")

    def test_omp_loop_arms_the_engine_first_and_never_promises_more_than_8_continuations(self):
        for c in gen.CATS:
            text = gen.loop_body_omp(c)
            self.assertIn(f"name: eccx-loop-{c}\n", text)
            self.assertIn(f"~/.omp/agent/commands/eccx-{c}.md", text)
            self.assertLess(text.index("engine_plan"), text.index("engine_next"))
            self.assertNotIn("CronCreate", text)
            self.assertIn("--max-iter 8", text)
            self.assertLessEqual(len(text.encode("utf-8")), gen.MAX_BYTES)

    def test_loop_body_points_at_its_own_category_and_fits_the_budget(self):
        for c in gen.CATS:
            text = gen.loop_body(c)
            self.assertIn(f"Driver: /eccx-{c}`", text)
            self.assertIn(f"~/.claude/commands/eccx-{c}.md", text)
            self.assertIn("--max-iter 8", text)
            self.assertLessEqual(len(text.encode("utf-8")), gen.MAX_BYTES)
        self.assertIn("Route + Select", gen.loop_body("full"))

    def test_loop_body_auto_ships_without_a_ship_question(self):
        for c in gen.CATS:
            text = gen.loop_body(c)
            self.assertIn("--no-release", text)
            self.assertIn("Auto-ship, no Ship question", text)
            self.assertNotIn("ONE `Ship`", text)
            self.assertNotIn("[--release]", text)


if __name__ == "__main__":
    unittest.main()
