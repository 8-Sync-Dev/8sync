# Q3 local measurement: lead delegation (last 14 days by file mtime, run 2026-10-15)

Command: `cd /home/alexng/tools/su-code-hq/su-code/research/.evidence && nice -n 19 python3 -I q3_measure.py`
Script: /home/alexng/tools/su-code-hq/su-code/research/.evidence/q3_measure.py (stdlib only; prints counts and tool names only; ~/.omp and `works` dirs skipped).

Scope and caveats (verified from the script, not assumptions):
- Projects: `-home-alexng-startup-8sync-startup`, `-home-alexng-startup-su-code`. `-home-alexng-startup` has no project dir under ~/.claude/projects, so it contributed 0 (the `startup` project is not separately present).
- A session counts if its main .jsonl mtime is within 14 days; its whole file is counted (activity older than 14 days inside it is included). Subagent files likewise filtered by mtime.
- Tool_use deduped by block id. Parallel = >=2 Agent/Task blocks sharing one assistant `message.id`.
- Longest run: "loose" = consecutive Edit/Write/MultiEdit/Bash calls, Read/Grep/Glob/other tools ignored, reset by Agent/Task/SendMessage; "strict" = any other tool also resets.
- Bash dominates lead work (4512 of 4670 work calls) and includes `8sync`/gh/git CLI calls, so the ratio is a lower bound on "delegable work"; Bash is not necessarily code editing. Not classified further.
- Teammate transcripts live in the same subagents/ dir; they cannot be separated from Agent-spawned ones by path alone (not verified).

## HQ room mapping (subagent_type -> seat)
- /home/alexng/tools/su-code-hq/apps/hq-ui/lib/office.ts:6-15 (SEATS: lead, R&D, Plan, Fullstack, Reviewer, Tester, Quick, Critic)
- /home/alexng/tools/su-code-hq/apps/hq-ui/lib/office.ts:19-35 (BY_TYPE: explore/researcher/claude-code-guide -> rd; plan/pm/architect -> plan; task/general-purpose/designer/claude -> dev; reviewer/verifier -> review; qa -> qa; quick-task -> quick; critic -> critic); `seatOf` at :38; unknown types fall back to dev.
- Role/model hints (separate from rooms): /home/alexng/tools/su-code-hq/apps/hq-ui/lib/roles.ts:22-29; guide text guide.tsx:32-34.

Observed spawns per seat (computed from the distribution below via BY_TYPE): rd 69 (researcher 33, explore 31, claude-code-guide 5), dev 109 (task 87, general-purpose 17, designer 5), review 54 (reviewer 51, verifier 3), quick 3, qa 2, plan 0, critic 0.

## Output
```
## Per project
| project | main sessions | Agent/Task spawns | subagent files |
|---|---|---|---|
| -home-alexng-startup-8sync-startup | 7 | 100 | 97 |
| -home-alexng-startup-su-code | 4 | 137 | 135 |

## Per main session (14d, sorted by lead work calls desc)
| project | session | Edit/Write/MultiEdit | Bash | Read/Grep/Glob | spawn | SendMessage | TaskCreate/Update | ratio | parallel msgs | bg | sub files | sub tool calls | longest run loose | longest run strict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| startup-su-code | s1 | 68 | 1306 | 31 | 130 | 40 | 91 | 0.09 | 24 | 0 | 128 | 2108 | 60 | 38 |
| startup-8sync-startup | s2 | 23 | 1074 | 19 | 52 | 29 | 109 | 0.05 | 9 | 0 | 49 | 956 | 69 | 62 |
| startup-8sync-startup | s3 | 9 | 532 | 5 | 10 | 11 | 54 | 0.02 | 2 | 0 | 10 | 183 | 94 | 55 |
| startup-8sync-startup | s4 | 15 | 489 | 1 | 17 | 28 | 36 | 0.03 | 2 | 0 | 17 | 486 | 130 | 73 |
| startup-8sync-startup | s5 | 22 | 336 | 23 | 0 | 2 | 5 | 0.00 | 0 | 0 | 0 | 0 | 321 | 36 |
| startup-8sync-startup | s6 | 12 | 280 | 2 | 9 | 13 | 23 | 0.03 | 2 | 1 | 9 | 190 | 66 | 39 |
| startup-8sync-startup | s7 | 5 | 231 | 1 | 7 | 42 | 0 | 0.03 | 2 | 0 | 7 | 93 | 82 | 33 |
| startup-su-code | s8 | 4 | 160 | 0 | 7 | 23 | 0 | 0.04 | 2 | 0 | 7 | 124 | 35 | 33 |
| startup-8sync-startup | s9 | 0 | 104 | 0 | 5 | 10 | 2 | 0.05 | 1 | 0 | 5 | 237 | 53 | 24 |
| startup-su-code | s10 | 0 | 0 | 0 | 0 | 0 | 0 | nan | 0 | 0 | 0 | 0 | 0 | 0 |
| startup-su-code | s11 | 0 | 0 | 0 | 0 | 0 | 0 | nan | 0 | 0 | 0 | 0 | 0 | 0 |

## Aggregate lead tool calls
| group | calls |
|---|---|
| Edit/Write/MultiEdit | 158 |
| Bash | 4512 |
| Read/Grep/Glob | 82 |
| Agent/Task(spawn) | 237 |
| SendMessage | 198 |
| TaskCreate/Update | 320 |
| ALL lead tool_use | 5823 |

Delegation ratio (spawns / lead Edit+Write+MultiEdit+Bash) = 237 / 4670 = 0.051
Per-session ratio median = 0.034; sessions with 0 spawns = 3 of 11
Parallel spawn messages (>=2 spawn blocks in one assistant message) = 44 (covering 128 spawns of 237)
run_in_background spawns = 1 of 237

## subagent_type distribution
| subagent_type | spawns |
|---|---|
| task | 87 |
| reviewer | 51 |
| researcher | 33 |
| explore | 31 |
| general-purpose | 17 |
| designer | 5 |
| claude-code-guide | 5 |
| verifier | 3 |
| quick-task | 3 |
| qa | 2 |

## Work share
| who | tool calls | share |
|---|---|---|
| lead | 5823 | 57.1% |
| subagents/teammates (232 files) | 4377 | 42.9% |

Subagent top tools: Bash=3567, WebFetch=351, SubagentHandback=232, WebSearch=69, Read=60, ToolSearch=39, Write=30, Edit=19, bash=5, Skill=2
Lead top tools: Bash=4512, Agent=237, TaskUpdate=198, SendMessage=198, TaskCreate=122, Write=114, Read=82, ToolSearch=75, Skill=60, WebFetch=51
Longest run overall: loose=321 strict=73
```
