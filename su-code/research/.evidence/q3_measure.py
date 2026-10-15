#!/usr/bin/env python3
"""Q3 local measurement: lead delegation. Prints counts and tool names only, never message text."""
import json, os, glob, time, collections, sys

ROOT = os.path.expanduser("~/.claude/projects")
PROJECTS = ["-home-alexng-startup-8sync-startup", "-home-alexng-startup-su-code", "-home-alexng-startup"]
DAYS = 14
cutoff = time.time() - DAYS * 86400
SPAWN = {"Agent", "Task"}
EDIT = {"Edit", "Write", "MultiEdit"}
READ = {"Read", "Grep", "Glob"}
TASKT = {"TaskCreate", "TaskUpdate"}
GROUPS = [("Edit/Write/MultiEdit", EDIT), ("Bash", {"Bash"}), ("Read/Grep/Glob", READ),
          ("Agent/Task(spawn)", SPAWN), ("SendMessage", {"SendMessage"}), ("TaskCreate/Update", TASKT)]

def tool_uses(path):
    """Yield (msg_key, name, input, tool_id) for assistant tool_use blocks, in file order, deduped by id."""
    seen = set()
    n = 0
    try:
        f = open(path, encoding="utf-8", errors="replace")
    except OSError:
        return
    with f:
        for line in f:
            n += 1
            try:
                o = json.loads(line)
            except ValueError:
                continue
            if o.get("type") != "assistant":
                continue
            m = o.get("message") or {}
            c = m.get("content")
            if not isinstance(c, list):
                continue
            key = m.get("id") or ("line%d" % n)
            for b in c:
                if isinstance(b, dict) and b.get("type") == "tool_use":
                    tid = b.get("id") or ("%s#%d" % (key, id(b)))
                    if tid in seen:
                        continue
                    seen.add(tid)
                    yield key, b.get("name", "?"), b.get("input") or {}, tid

def analyze_main(path):
    r = dict(tools=collections.Counter(), spawns=0, parallel_msgs=0, parallel_spawns=0,
             types=collections.Counter(), bg=0, run_loose=0, run_strict=0)
    per_msg = collections.Counter()
    cur_l = cur_s = 0
    for key, name, inp, _ in tool_uses(path):
        r["tools"][name] += 1
        if name in SPAWN:
            r["spawns"] += 1
            per_msg[key] += 1
            r["types"][str(inp.get("subagent_type", "(none)")) if isinstance(inp, dict) else "(none)"] += 1
            if isinstance(inp, dict) and inp.get("run_in_background") is True:
                r["bg"] += 1
        # runs of consecutive Edit/Write/MultiEdit/Bash without delegation
        work = name in EDIT or name == "Bash"
        deleg = name in SPAWN or name == "SendMessage"
        if work:
            cur_l += 1; cur_s += 1
        elif deleg:
            cur_l = cur_s = 0
        else:
            cur_s = 0  # strict: any other tool breaks; loose: ignored
        r["run_loose"] = max(r["run_loose"], cur_l)
        r["run_strict"] = max(r["run_strict"], cur_s)
    for k, v in per_msg.items():
        if v >= 2:
            r["parallel_msgs"] += 1
            r["parallel_spawns"] += v
    return r

def count_sub(path):
    c = collections.Counter()
    for _, name, _, _ in tool_uses(path):
        c[name] += 1
    return c

def main():
    rows = []
    agg = dict(tools=collections.Counter(), spawns=0, parallel_msgs=0, parallel_spawns=0,
               types=collections.Counter(), bg=0)
    sub_tools = collections.Counter(); n_sub = 0
    per_proj = collections.defaultdict(lambda: [0, 0, 0])  # sessions, spawns, sub files
    for proj in PROJECTS:
        if "works" in proj:
            continue
        pdir = os.path.join(ROOT, proj)
        for p in glob.glob(os.path.join(pdir, "*.jsonl")):
            if os.path.getmtime(p) < cutoff:
                continue
            sid = os.path.basename(p)[:-6]
            r = analyze_main(p)
            sc = collections.Counter()
            subs = [s for s in glob.glob(os.path.join(pdir, sid, "subagents", "agent-*.jsonl"))
                    if os.path.getmtime(s) >= cutoff]
            for s in subs:
                sc.update(count_sub(s))
            r["sub"] = sc; r["nsub"] = len(subs); r["sid"] = "s%d" % (len(rows) + 1); r["proj"] = proj  # sid anonymised: no session ids in a public repo
            rows.append(r)
            for k in ("spawns", "parallel_msgs", "parallel_spawns", "bg"):
                agg[k] += r[k]
            agg["tools"].update(r["tools"]); agg["types"].update(r["types"])
            sub_tools.update(sc); n_sub += len(subs)
            per_proj[proj][0] += 1; per_proj[proj][1] += r["spawns"]; per_proj[proj][2] += len(subs)

    def g(c, s): return sum(c[n] for n in s)
    def ratio(r):
        d = g(r["tools"], EDIT) + r["tools"]["Bash"]
        return (r["spawns"] / d) if d else float("nan")

    print("## Per project\n| project | main sessions | Agent/Task spawns | subagent files |\n|---|---|---|---|")
    for k, v in per_proj.items(): print("| %s | %d | %d | %d |" % (k, *v))
    print("\n## Per main session (14d, sorted by lead work calls desc)")
    print("| project | session | Edit/Write/MultiEdit | Bash | Read/Grep/Glob | spawn | SendMessage | TaskCreate/Update | ratio | parallel msgs | bg | sub files | sub tool calls | longest run loose | longest run strict |")
    print("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|")
    rows.sort(key=lambda r: -(g(r["tools"], EDIT) + r["tools"]["Bash"]))
    for r in rows:
        t = r["tools"]
        print("| %s | %s | %d | %d | %d | %d | %d | %d | %.2f | %d | %d | %d | %d | %d | %d |" % (
            r["proj"].replace("-home-alexng-", ""), r["sid"], g(t, EDIT), t["Bash"], g(t, READ), r["spawns"],
            t["SendMessage"], g(t, TASKT), ratio(r), r["parallel_msgs"], r["bg"], r["nsub"],
            sum(r["sub"].values()), r["run_loose"], r["run_strict"]))
    print("\n## Aggregate lead tool calls\n| group | calls |\n|---|---|")
    for n, s in GROUPS: print("| %s | %d |" % (n, g(agg["tools"], s)))
    lead_total = sum(agg["tools"].values())
    print("| ALL lead tool_use | %d |" % lead_total)
    d = g(agg["tools"], EDIT) + agg["tools"]["Bash"]
    print("\nDelegation ratio (spawns / lead Edit+Write+MultiEdit+Bash) = %d / %d = %.3f" % (agg["spawns"], d, agg["spawns"] / d if d else float("nan")))
    ratios = sorted(ratio(r) for r in rows if ratio(r) == ratio(r))
    if ratios: print("Per-session ratio median = %.3f; sessions with 0 spawns = %d of %d" % (ratios[len(ratios)//2], sum(1 for r in rows if r["spawns"] == 0), len(rows)))
    print("Parallel spawn messages (>=2 spawn blocks in one assistant message) = %d (covering %d spawns of %d)" % (agg["parallel_msgs"], agg["parallel_spawns"], agg["spawns"]))
    print("run_in_background spawns = %d of %d" % (agg["bg"], agg["spawns"]))
    print("\n## subagent_type distribution\n| subagent_type | spawns |\n|---|---|")
    for k, v in agg["types"].most_common(): print("| %s | %d |" % (k, v))
    sub_total = sum(sub_tools.values())
    print("\n## Work share\n| who | tool calls | share |\n|---|---|---|")
    tot = lead_total + sub_total
    print("| lead | %d | %.1f%% |" % (lead_total, 100 * lead_total / tot if tot else 0))
    print("| subagents/teammates (%d files) | %d | %.1f%% |" % (n_sub, sub_total, 100 * sub_total / tot if tot else 0))
    print("\nSubagent top tools: " + ", ".join("%s=%d" % kv for kv in sub_tools.most_common(10)))
    print("Lead top tools: " + ", ".join("%s=%d" % kv for kv in agg["tools"].most_common(10)))
    print("Longest run overall: loose=%d strict=%d" % (max((r["run_loose"] for r in rows), default=0), max((r["run_strict"] for r in rows), default=0)))

main()
