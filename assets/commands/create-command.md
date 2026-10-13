---
name: sx-create-command
argument-hint: '<description of what the command should do> [--force]'
description: Scaffold a new slash command from a plain-English description — write a spec-valid command file with frontmatter and a runnable procedure, deployed to both global and project scope with zero Rust changes.
---

# /sx-create-command — author a new slash command

`$ARGUMENTS` = what the command should do. Add `--force` to overwrite an existing one.

## 0. Command or skill?

- **Command** = a trigger the user types. Short, imperative, owns a procedure.
- **Skill** = knowledge the model loads when a situation matches. Never typed directly.

Needs both? Write the skill first (`/sx-create-skill`), then a thin command that invokes it — that is
the `branch-sync` ↔ `sync-pr` pattern. Needs neither? Say so and stop.

## 1. Scaffold

```bash
8sync skill new --command <name> '<description>'      # add --force to overwrite
```

Writes `assets/commands/<name>.md` when run inside the su-code repo, otherwise
`~/.omp/agent/commands/sx-<name>.md` (global) **and** `<repo>/.omp/commands/sx-<name>.md` (project).

**Naming.** Assets are stored bare (`auto.md`); the `sx-` prefix is added at deploy time from
`brand::CMD_PREFIX`, so a rebranded build picks its own. omp derives the invoked name from the
FILENAME, not the frontmatter — `sx-auto.md` is `/sx-auto`. Keep the frontmatter `name:` equal to
the invoked name (`sx-<name>`) so the file does not describe a command nobody can type.

**No Rust change is required.** Command deployment iterates the `commands/` asset directory, so a
new file is picked up on the next `8sync harness`. (This used to need a hardcoded block per command
in `deploy.rs` — that is exactly what the registry work removed.)

## 2. Frontmatter — all three keys are load-bearing

```yaml
---
name: <same as the filename, no .md>
argument-hint: '[<what $ARGUMENTS means>]'
description: <one sentence; this is what the user sees in the command list>
---
```

## 3. Body — write a procedure, not an essay

- Open by saying what `$ARGUMENTS` is.
- Numbered steps. Each step is a real command or tool call with its exact invocation.
- Name the tools explicitly (`8sync …`, `codegraph query`). A command
  that says "analyse the code" produces nothing reproducible.
- State the **acceptance check** — how the user knows it worked.
- State what the command must NOT do (push, delete, widen scope).

Do not restate routing rules that are already enforced. Preferring codegraph/serena/codebase-memory
over `grep` is a TTSR rule plus a `bashInterceptor` pattern; repeating it in prose is pure prompt
weight on every turn. Check `su-code/omp-reference/LEVERS.md` before writing any "always do X"
instruction — if omp can enforce it, enforce it instead of asking.

## 4. Deploy + verify

```bash
8sync harness            # picks up the new command file
ls ~/.omp/agent/commands/ && ls .omp/commands/
```

Then run the command once end-to-end and confirm the acceptance check it declares actually passes.
