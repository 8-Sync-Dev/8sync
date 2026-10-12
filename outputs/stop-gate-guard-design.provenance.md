# Provenance — stop-gate-guard-design (2026-10-12)

- Rounds: 1 gather (4 researcher agents in parallel) → lead draft → verifier (29 OK / 13 FIXED / 3 UNVERIFIED / 0 dead links) → lead closed 3 UNVERIFIED by measurement/code → reviewer (with the code diff).
- Local sources (read only, nothing from the clones was run), `C:\Users\Admin\research\gate-guard\src\` (SOURCES.lock):
  CowAgent aa5f4c9 (MIT) · oh-my-pi 7967984 · forge 8703dec · anthropics/claude-code 3deb873 · anthropics/claude-plugins-official f359d43.
- Web: code.claude.com docs (hooks, hooks-guide, permissions, env-vars, permission-modes, goal; saved as markdown under `C:\Users\Admin\research\gate-guard\docs\`), github.com/Dicklesworthstone/destructive_command_guard README, github.com/kenryu42/claude-code-safety-net README (v0.5.0 and current), hezo-ai/hezo issue 1150 (search snippet only).
- Evidence notes: `outputs/.research/stop-gate-guard/{cowagent,omp-forge,claude-code,public}.md`; draft and cited draft in `outputs/.drafts/`.
- Measured locally: guard / verify-stop / `--version` latency (release build, 30 runs each); Windows and linux-musl release size, upstream v0.66.0 vs working tree (numbers in `scripts/size-gate.sh`); transcript entry shape from this session's JSONL.
- Not read / not verified: CowAgent prompt files (absence of a stop-detector is a grep result over `agent/` and `bridge/` *.py); dcg's windows pack scope; cc-safety-net's current fail-open behaviour; whether `stop_hook_active` resets after tool calls; whether the current user entry is in the transcript when Stop fires (gate falls back safely).
- Remaining [UNVERIFIED]: 2 (both external, listed above).
- Verification: PASS (verifier). Review: see the reviewer verdict in `su-code/STATE.md`.
