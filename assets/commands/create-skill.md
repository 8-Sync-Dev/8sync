---
name: sx-create-skill
argument-hint: '<description of what the skill should do> [--force]'
description: Scaffold a new Agent Skill from a plain-English description — decide whether a skill is even warranted, pick the trigger wording, then generate a spec-valid SKILL.md via `8sync skill new` and fill in the body.
---

# /sx-create-skill — author a new skill, properly

`$ARGUMENTS` = what the skill should do, in plain English. Add `--force` to overwrite an existing one.

## 0. Earn the skill first (do not skip)

Read `~/.omp/skills/ponytail/SKILL.md`. A skill is **prompt weight on every session that lists it**,
so the default answer is *no*. Refuse and say why when any of these hold:

- A `8sync` verb, an MCP tool, or an existing skill already covers it → point at that instead.
- It is a one-off. Skills encode a *repeatable* procedure, not a single task.
- It is a tone or style preference → that belongs in `APPEND_SYSTEM.md` or a rule, not a skill.
- It restates something the model already knows (generic framework prose). The bundled library was
  cut down precisely because that kind of filler was dead weight.

State the verdict in one line before doing anything.

## 1. Decide the trigger, not the title

omp selects a skill almost entirely from its `description`. A vague description means the skill is
never loaded — the single most common authoring failure. Write it as **"Use when …"** naming the
concrete situation, the artifacts involved, and the words a user would actually type.

- Bad: `Helps with testing.`
- Good: `Use when a CI test passes locally but flakes in CI — triage flaky tests by rerun history, isolate the shared state, and quarantine.`

## 2. Scaffold

```bash
8sync skill new <name> '<description>'        # add --force to overwrite
```

`<name>` is lowercase `[a-z0-9-]`. This writes `~/.omp/skills/<name>/SKILL.md` (global) **and**
`<repo>/su-code/skills/<name>/SKILL.md` (project-local, committed), then re-injects the force-load
block into `AGENTS.md`/`CLAUDE.md`. Paths written there are repo-relative or `~/`-anchored — never
`/home/<user>/…`, so the block still resolves on someone else's machine.

## 3. Fill the body

Replace every `<placeholder>`. Keep it operational:

- **When this applies / when it does not** — the second half prevents misfires.
- **The procedure** — numbered, each step a concrete command or tool call, not advice.
- **Failure modes** — what breaks and the recovery.
- Cite real paths as `path:line`.

Length discipline: if it exceeds ~200 lines, split the detail into `references/` and keep `SKILL.md`
as the router. Never vendor a public README into `references/` — link it. (A 32.9 KB vendored README
was 83.7% of the removed code-map skill before it was removed.)

## 4. Pair it with a command when it needs an entry point

A skill is knowledge; a slash command is a trigger. When the skill should be *invocable*, run
`/sx-create-command` too and have the command name the skill. The in-repo reference pair is
`branch-sync` (skill) ↔ `commands/sync-pr.md` (command).

## 5. Verify

```bash
8sync skill list                 # the new skill appears with its description
8sync harness audit              # no stale paths introduced
```

Then confirm the frontmatter parses and the description reads as a trigger, not a title.
