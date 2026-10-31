#!/usr/bin/env python3
"""Measure Claude Code token use from local transcripts (numbers only).

Reads ~/.claude/projects/*/*.jsonl (main sessions) and */subagents/*.jsonl,
counts each assistant message once (streamed chunks share one message id) and
prints aggregate input-side tokens (input + cache write + cache read), output,
compactions and the subagent first-turn prefix. It never prints message text,
tool output or file paths, so the report is safe to paste into a PR.

  python -I scripts/token-usage.py [DAYS]          last DAYS (default 1)
  python -I scripts/token-usage.py --since ISO     events at/after an ISO time (UTC)

Used by the tech-radar loop to UAT token changes: compare `mean/turn` and
`compactions/day` before and after a change, over windows of similar work.
"""
import calendar
import collections
import glob
import json
import os
import sys
import time

USAGE_KEYS = ("input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens")
BUCKETS = ((100_000, "<100k"), (200_000, "100-200k"), (400_000, "200-400k"))


def bucket(ctx):
    for limit, name in BUCKETS:
        if ctx < limit:
            return name
    return ">400k"


def since_from_args(argv):
    if len(argv) > 2 and argv[1] == "--since":
        return argv[2], None
    days = float(argv[1]) if len(argv) > 1 else 1.0
    start = time.time() - days * 86400
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(start)), days


def scan(path, since, totals, sizes, firsts):
    kind = "sub" if os.sep + "subagents" + os.sep in path else "main"
    seen = set()
    first = None
    with open(path, encoding="utf-8", errors="replace") as fh:
        for line in fh:
            try:
                ev = json.loads(line)
            except ValueError:
                continue
            if ev.get("timestamp", "") < since:
                continue
            if ev.get("type") == "system" and ev.get("subtype") == "compact_boundary":
                totals[kind, "compactions"] += 1
                continue
            if ev.get("type") != "assistant":
                continue
            msg = ev.get("message") or {}
            usage = msg.get("usage") or {}
            if not usage or msg.get("id") in seen:
                continue
            seen.add(msg.get("id"))
            ctx = sum(usage.get(k) or 0 for k in USAGE_KEYS)
            totals[kind, "turns"] += 1
            totals[kind, "input"] += ctx
            totals[kind, "cache_write"] += usage.get("cache_creation_input_tokens") or 0
            totals[kind, "output"] += usage.get("output_tokens") or 0
            sizes[kind, bucket(ctx)] += ctx
            if first is None:
                first = ctx
    if first is not None and kind == "sub":
        firsts.append(first)


def main(argv):
    since, days = since_from_args(argv)
    root = os.path.join(os.path.expanduser("~"), ".claude", "projects")
    cutoff = calendar.timegm(time.strptime(since[:19], "%Y-%m-%dT%H:%M:%S"))
    paths = glob.glob(os.path.join(root, "*", "*.jsonl"))
    paths += glob.glob(os.path.join(root, "*", "*", "subagents", "*.jsonl"))
    totals, sizes, firsts = collections.Counter(), collections.Counter(), []
    for path in paths:
        if os.path.getmtime(path) >= cutoff:
            scan(path, since, totals, sizes, firsts)

    print(f"since {since}Z" + (f" ({days:g} days)" if days else ""))
    all_input = totals["main", "input"] + totals["sub", "input"]
    for kind in ("main", "sub"):
        turns = totals[kind, "turns"]
        if not turns:
            continue
        line = (f"{kind}: turns {turns:,}  input-side {totals[kind, 'input']:,}  "
                f"mean/turn {totals[kind, 'input'] // turns:,}  "
                f"cache_write {totals[kind, 'cache_write']:,}  output {totals[kind, 'output']:,}  "
                f"compactions {totals[kind, 'compactions']}")
        if days:
            line += f" ({totals[kind, 'compactions'] / days:.0f}/day)"
        print(line)
    for kind, name in sorted(sizes):
        share = 100 * sizes[kind, name] / all_input if all_input else 0
        print(f"  {kind:4s} context {name:9s} {sizes[kind, name]:>15,}  {share:5.1f}%")
    if firsts:
        firsts.sort()
        print(f"subagent first-turn prefix: median {firsts[len(firsts) // 2]:,} (n={len(firsts)})")


if __name__ == "__main__":
    main(sys.argv)
