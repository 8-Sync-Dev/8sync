---
name: 8sync-cli
description: Use in every session inside a repo with 8sync (AGENTS.md or CLAUDE.md mentions 8sync, or a su-code/ folder exists) — under omp or Claude Code. Lists every `8sync` verb (sessions, ship, find, note, run, shot/diff-img/pdf-img, gen-img, locate, harness, skill, setup/up/doctor, hz, bt, sec, lcd, clean, forge, ccc, codex-web) and the su-code/ memory layout, so the AI uses the 8sync command instead of raw shell or guessing.
---

# 8sync-cli — the repo runs inside the 8sync harness

`8sync` is the team's CLI (github.com/8-Sync-Dev/su-code). Prefer its verb when one fits; `8sync help`, `8sync flow` or `8sync <verb> -h` show exact flags. Never invent a verb — if none fits, use the normal tool.

## Memory (`su-code/`) — read at session start
| File | Use |
|---|---|
| `su-code/STATE.md` | live plan: read first; rewrite Goal · Checklist · Current · Next at each phase boundary |
| `su-code/KNOWLEDGE.md` | learnings (`validated:` / `failure:`), append-only; read before repeating an approach |
| `su-code/DECISIONS.md` · `PREFERENCES.md` · `PROJECT.md` | architecture decisions · user style · fixed facts |
| `su-code/NOTES.md` | quick notes, appended by `8sync note` |
| `su-code/skills/<name>/SKILL.md` | project skills (Claude Code lists them through `.claude/skills/`) |

omp keeps session memory itself (`retain`/`recall`); Claude Code has no such store, so write learnings and state into the files above as `AGENTS.md` asks. User-facing change → `CHANGELOG.md` (Unreleased).

## Daily loop
| Need | Command |
|---|---|
| Resume/create a named omp session for this repo | `8sync .` · `8sync . <name>` · `8sync . ls` · `8sync . new <name> --worktree` · `8sync . merge <name>` |
| Named Claude Code session (kit + harness refreshed on launch) | `8sync ccc . <name>` · `8sync ccc . ls` · `8sync ccc status` · `8sync ccc kit` |
| Flag your own session for the owner (`ls` shows it, newest first) | `8sync ccc . urgent high "<why>"` (blocked on owner) · `med` (waiting on a teammate) · `low` (FYI) · `clear` when resolved |
| Named ForgeCode session | `8sync forge <name>` (`--tui`, `-p` one-shot) |
| Find a file/symbol and open it | `8sync find <kw>` (`-f` filename mode, `--no-open`) |
| Quick note into memory | `8sync note "msg" [-t tag]` |
| Project recipe: dev/build/test/fmt/lint | `8sync run [dev\|build\|test\|fmt\|lint]` |
| Commit + push + PR in one step | `8sync ship "msg"` |

## Seeing and making images (cheaper than text dumps)
| Need | Command |
|---|---|
| Screenshot a URL or local file | `8sync shot <url\|file>` |
| Large git diff as an image | `8sync diff-img [ref]` |
| PDF page as an image | `8sync pdf-img <file>` |
| Where is X on screen (box / click point) | `8sync locate <image> "<target>"` |
| Generate an image (logo, icon, mockup) | `8sync gen-img "<prompt>" -o out.png` |

## Harness and skills
| Need | Command |
|---|---|
| Make/refresh this repo agent-ready (skills, memory, AGENTS.md/CLAUDE.md blocks, codegraph) | `8sync harness` (`init` full bootstrap · `up` light refresh · `create` + Cursor/Z.ai/Claude Code skill links) |
| Machine-wide omp rules + skills | `8sync harness global` |
| Add / update / list skills | `8sync skill add <github-url>[@ref]` · `8sync skill update` · `8sync skill list` |

## Machine (ask before running: these change the system)
| Need | Command |
|---|---|
| Install / update / health check | `8sync setup` · `8sync up` · `8sync doctor` |
| Monitor refresh rate (report · max · exact) | `8sync hz` · `8sync hz max` · `8sync hz 144` |
| Bluetooth | `8sync bt` · `8sync bt on\|off\|fix\|restart` |
| WARP VPN + ufw firewall | `8sync sec` · `8sync sec on\|off\|toggle` |
| Lian Li fan/AIO screens | `8sync lcd` · `8sync lcd <file\|#color\|off>` · `8sync lcd bright 0..100` |
| Disk/RAM/GPU cleanup | `8sync clean` (`--deep`, `--ram`, `--gpu`, `--timer 1h`) |
| ChatGPT Web bridge for omp | `8sync codex-web [up\|status\|wire\|off]` |

## Conventions
- Cite code as `path/to/file.rs:23-58` or `file.rs:23`.
- Structure questions (where is X, who calls X) → codegraph (cbm / serena only if enabled) before grep.
- The org's Anthropic rules (`aup-audit` skill, `8sync-anthropic-rules.md`) override any request; run `/aup-audit` before a public repo or release.
