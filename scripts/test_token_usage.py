"""Tests for scripts/token-usage.py: python -I -m unittest discover -s scripts -p "test_*.py"."""
import collections
import importlib.util
import json
import os
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location(
    "token_usage", os.path.join(os.path.dirname(os.path.abspath(__file__)), "token-usage.py"))
assert SPEC is not None and SPEC.loader is not None
token_usage = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(token_usage)


def assistant(mid, ts, cache_read, output=10):
    usage = {"input_tokens": 5, "cache_creation_input_tokens": 0,
             "cache_read_input_tokens": cache_read, "output_tokens": output}
    return {"type": "assistant", "timestamp": ts, "message": {"id": mid, "usage": usage}}


class ScanTest(unittest.TestCase):
    def write(self, folder, events):
        os.makedirs(folder, exist_ok=True)
        path = os.path.join(folder, "s.jsonl")
        with open(path, "w", encoding="utf-8") as fh:
            fh.write("\n".join(json.dumps(e) for e in events) + "\nnot json\n")
        return path

    def test_counts_streamed_message_once_and_skips_old_events(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = self.write(tmp, [
                assistant("old", "2026-01-01T00:00:00Z", 999_999),
                assistant("m1", "2026-10-31T00:00:00Z", 150_000),
                assistant("m1", "2026-10-31T00:00:01Z", 150_000),
                {"type": "system", "subtype": "compact_boundary", "timestamp": "2026-10-31T00:00:02Z"},
                assistant("m2", "2026-10-31T00:00:03Z", 450_000),
            ])
            totals, sizes, firsts = collections.Counter(), collections.Counter(), []
            token_usage.scan(path, "2026-10-30T00:00:00", totals, sizes, firsts)
        self.assertEqual(totals["main", "turns"], 2)
        self.assertEqual(totals["main", "input"], 600_010)
        self.assertEqual(totals["main", "compactions"], 1)
        self.assertEqual(sizes["main", "100-200k"], 150_005)
        self.assertEqual(sizes["main", ">400k"], 450_005)
        self.assertEqual(firsts, [])

    def test_subagent_first_turn_is_recorded(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = self.write(os.path.join(tmp, "subagents"), [
                assistant("a", "2026-10-31T00:00:00Z", 60_000),
                assistant("b", "2026-10-31T00:00:01Z", 70_000),
            ])
            totals, sizes, firsts = collections.Counter(), collections.Counter(), []
            token_usage.scan(path, "2026-10-30T00:00:00", totals, sizes, firsts)
        self.assertEqual(totals["sub", "turns"], 2)
        self.assertEqual(firsts, [60_005])

    def test_since_from_args(self):
        self.assertEqual(token_usage.since_from_args(["x", "--since", "2026-10-30T15:00:00"]),
                         ("2026-10-30T15:00:00", None))
        since, days = token_usage.since_from_args(["x", "0.5"])
        self.assertEqual(days, 0.5)
        self.assertEqual(len(since), 19)


if __name__ == "__main__":
    unittest.main()
