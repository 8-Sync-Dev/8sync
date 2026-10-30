---
title: "Windows/macOS watchdog alerts and renices but never kills by default; Task Scheduler uses a 5-min trigger, not logon"
author: 8syncdev
date: 2026-10-30
branch: claude/xenodochial-leavitt-eef970
cost: { minutes: 26, tokens: 364789 }
id: l-58ab8f54
scope: repo
status: active
src: agent
touches:
  - ".github/workflows/ci.yml"
  - CHANGELOG.md
  - crates/cli/src/verbs/ccc.rs
  - crates/cli/src/verbs/ccc/pressure.rs
  - crates/cli/src/verbs/ccc/reap.rs
  - crates/cli/src/verbs/hq_core/sampler.rs
  - crates/cli/src/verbs/watchdog.rs
  - scripts/uat/watchdog-service.sh
---

## Decided
- crates/cli/src/verbs/watchdog.rs: on Windows/macOS `auto_kill` defaults to false (AUTO_KILL = cfg linux). Owner brief 2026-10-30: the guard never kills another app's or session's process without the owner's yes; Linux keeps its approved helper kill. Kill-path tests use `kill_on()` explicitly.
- Windows service = Scheduled Task `8sync\watchdog` from XML with a 5-minute TimeTrigger (IgnoreNew, PT0S limit, no battery stop, priority 7, `conhost --headless`). A LogonTrigger usually needs admin; the 5-min trigger plus the guard's lock file (state/watchdog.lock) self-heals instead. schtasks /XML is fed UTF-16LE with BOM.
- Per-process data on Windows/macOS comes from `ccc::reap::list` (no WMI, no new crate); macOS `ps` gained `time=` for CPU.

## Tried and ruled out
- `git add -A` before commit: it staged `.trail/cache/.cache/trail-branches.json` (written by `trail check`), which gitleaks flags as generic-api-key and the pre-commit hook blocks. Unstaged it; stage paths explicitly.
- The hq_core Sampler backend for the guard's tick: its Windows read runs PDH energy collection (~0.5 s), too heavy every 5 s; the guard calls sys::win + NVML directly.

## Watch out
- Task registration was only tried from an elevated shell; non-admin is not verified.
- macOS counters (host_statistics, kern.memorystatus_level) are only checked by the CI test, not on real hardware.
