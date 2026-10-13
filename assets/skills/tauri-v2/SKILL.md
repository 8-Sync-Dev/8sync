---
name: tauri-v2
description: Use when building, migrating (v1→v2), or debugging a Tauri 2.x desktop app — adding a `#[tauri::command]`, fixing "command not allowed"/capabilities/ACL errors, wiring plugins, bundling per-OS, configuring the auto-updater, or attaching a heavy native/Python sidecar. Produces a verified Rust+webview app whose IPC round-trip and bundle target are exercised. Grounded in official Tauri v2 docs (v2.tauri.app); extends with opinionated patterns from 8syncdev's open-musik/zus/sidex and omp-native tooling (codegraph, codebase-memory, serena, engine_*, browser).
locked: true
---

# tauri-v2 — build & verify Tauri 2 desktop apps

Canonical base: [`references/base.md`](references/base.md) (Tauri **2.11.5** /
`tauri-build` **2.6.3**, v1→v2 deltas, capabilities/ACL, IPC, plugins, bundling,
updater, sidecar, webview debugging). Opinionated extension:
[`references/patterns.md`](references/patterns.md) (11 patterns mined, cited
`repo:path`, from `8syncdev/open-musik`, `8syncdev/zus`, `8syncdev/sidex`).

## When to use

- "add a Tauri command", "call Rust from the frontend", "events aren't reaching
  the webview", "`invoke` returns command not found / not allowed".
- Migrating a v1 app, or a capabilities/ACL permission error after a plugin add.
- Wiring a plugin, bundling for an OS, setting up the auto-updater + signing.
- Attaching a heavy native/Python/Go engine as a sidecar or external binary.
- "the webview is blank/black on Linux", CSP violations, asset-protocol paths.

## When NOT to use

- Mobile (iOS/Android) targets unless the project already targets them — base §1
  notes the lib/main split, but mobile toolchains are out of scope here.
- Maintaining a v1-only app with no migration intent.
- Choosing or rewriting the frontend framework — Tauri is framework-agnostic.
- Electron/CEF or pure-browser PWA work (no Tauri involved).

## Procedure

Every step names a real tool. Prefer omp primitives over reinvention — when omp
upgrades a primitive, a step that only references it inherits the upgrade.

### 0. Ground the change before editing
- If `.codegraph/` exists: `codegraph query "<command_or_fn>"` and
  `codegraph context "tauri ipc"` to map commands/events/state. Else
  `codegraph init -i .` once. After edits: `codegraph sync`.
- If cbm/serena are enabled (opt-in: `8sync harness cbm|serena on`), cross-check structure with `mcp__codebase_memory_mcp__search_graph` /
  `trace_path` (calls) if the project is indexed, and
  `mcp__serena__get_symbols_overview` on the `src-tauri/src/*.rs` file you'll
  touch; `mcp__serena__get_diagnostics_for_file` to see type errors live.
- Read the exact slices you need with `read` (`src-tauri/tauri.conf.json`,
  `src-tauri/Cargo.toml`, `capabilities/*.json`) — never whole-file a >200-line
  Rust file blind; `codegraph`/serena locate first, `read` the narrow range.

### 1. Scaffolding / migration checks
- New app: `cargo tauri init` (or the create-tauri-app template). Confirm
  `"$schema": "https://schema.tauri.app/config/2"`.
- v1→v2: run `pnpm tauri migrate` (or `cargo tauri migrate`), then hand-verify
  the breaking list in base §1 — allowlist→capabilities, `tauri`→`app` key,
  `distDir`→`frontendDist`, plugins extraction, `createUpdaterArtifacts`,
  Windows origin scheme, `Window`→`WebviewWindow`. Use `grep` on the old config
  for `allowlist`/`tauri.updater`/`distDir` to find every site to fix.

### 2. Capabilities / ACL (the #1 error source)
- "command/plugin not allowed" → the runtime error names the missing permission
  verbatim. Open the capability file bound to the emitting window
  (`capabilities/default.json`), append that identifier to `permissions`. Prefer
  granular `plugin:allow-<cmd>` over `plugin:default`. See patterns P5/P11.
- The authoritative identifier list is the build-generated
  `src-tauri/gen/schemas/desktop-schema.json` — `read` it when unsure of the
  exact string. Add a capability file per window when windows diverge.

### 3. IPC — commands, state, events
- Define `#[tauri::command]` with **flat** args returning `Result<T, String>`
  (patterns P2). Inject `AppHandle`/`State<'_, T>` by type.
- Register every command in
  `.invoke_handler(tauri::generate_handler![mod::cmd, …])` — a missing entry is
  "command not found".
- Manage state in `.setup(|app| { app.manage(your_state); Ok(()) })`; in async
  commands, clone owned data out of `State` **before** the `.await` (P4).
- Push progress with `app.emit("name", &payload)`; frontend
  `listen("name", …)`. Pick events over `ipc::Channel` when state must survive a
  webview reload (P4/P8).
- Frontend: wrap `invoke`/`listen`/`convertFileSrc` from
  `@tauri-apps/api/core` + `/event` behind an `inTauri` guard (P8).

### 4. Plugins
- Add `tauri-plugin-<name> = "2"` (Cargo) + `@tauri-apps/plugin-<name>` (JS),
  register `.plugin(tauri_plugin_name::init())`, grant permission (step 2).
- Official plugins: `tauri-apps/plugins-workspace`. Shell plugin also owns the
  sidecar mechanism (step 6, model a).

### 5. Sidecar / external binary
- Light, one-shot external program → Tauri shell-plugin sidecar: declare in
  `plugins.shell` + `bundle`, spawn scoped via `app.shell().sidecar(...)`.
- Heavy long-lived engine (Python/Go/ML) → hand-rolled `tokio::process::Command`
  speaking a JSON-lines protocol with id-correlation + generation stamps + an
  `EventSink` trait, exactly as `8syncdev/open-musik:src-tauri/src/sidecar.rs`
  (pattern P1). `.kill_on_drop(true)`; clean up in `RunEvent::Exit` (P3).

### 6. Bundling + signing + auto-updater
- `bundle.targets`: subset (`["deb","appimage"]`) or `"all"`. Per-OS in
  `bundle.{macOS,windows,linux}`. Linux needs `webkit2gtk-4.1` deps (P6).
- Updater: `plugins.updater = {pubkey, endpoints[]}` **and**
  `bundle.createUpdaterArtifacts: true`. `tauri signer generate` →
  `TAURI_SIGNING_PRIVATE_KEY`; pubkey in config. Full production reference:
  `8syncdev/zus:src-tauri/tauri.conf.json` (P10); per-profile overlays via
  `tauri build --config tauri.<profile>.conf.json` (`8syncdev/sidex`, P10).
- macOS: `signingIdentity`, `entitlements` plist, notarization env. Windows:
  `webviewInstallMode`, optional authenticode.

### 7. Run + UI VERIFY (never claim a UI works unseen)
- `cargo tauri dev` (or `pnpm tauri dev`) to launch. Run it as a managed process
  via `hub` `op:"start"` (name `"tauri-dev"`, `ready.log` matching the dev URL,
  `ready.port` = your `devUrl` port) so the webview stays alive across calls.
- Drive the webview with the `browser` tool (`xd://browser`): `open` the
  `devUrl`, `run` `tab.observe()`/`tab.screenshot()` to confirm rendering, then
  exercise the actual IPC round-trip a user depends on (click the button → assert
  the `invoke` result / `listen` event landed). For visual regression use
  `8sync shot <url> -o /tmp/x.png` and `8sync diff-img` against a baseline.
- Blank/black Linux window → apply the WebKitGTK env hardening from P9 before the
  webview is built; `WEBKIT_DISABLE_DMABUF_RENDERER=1` is the usual fix.
- DevTools auto-on in debug; `tauri = { features = ["devtools"] }` for release.

### 8. Build loop with engine_* (verify = real build/test)
- Record the work: `engine_plan` — one slice per capability, each task's
  `verify` = the project's real gate, e.g. `cargo tauri build` (bundle target),
  `cargo test` (the `src-tauri` Rust tests), and/or `pnpm -C app build` (frontend).
- `engine_next` → do the task → `engine_verify` runs its verify commands (ALL
  must pass) → `engine_advance` marks it done (and commits if asked).
- `engine_status` shows per-slice progress / blockers across the batch. Delegate
  independent slices (e.g. "frontend wrapper", "macOS signing") to `task`
  subagents — but keep capability/IPC changes in one slice; they share a schema.
- After a Rust change, `mcp__serena__get_diagnostics_for_file` re-checks the file
  before you spend a `cargo tauri build` cycle.

### 9. Capture durable decisions
- `retain` project-specific facts the next session needs: the sidecar protocol
  shape, the capability layout, the updater endpoint, the bundle target set.
  `recall`/`reflect` them at the start of the next Tauri task on this repo.

## Acceptance check (all must hold before "done")

1. `cargo tauri dev` launches the window (managed `hub` process reaches ready);
   no "command not allowed" / "command not found" in the console.
2. Capabilities validate: every command/plugin the app invokes has a granted
   permission in the window's capability file (verified against
   `gen/schemas/desktop-schema.json`).
3. The IPC round-trip a user depends on is **exercised**, not asserted: drive the
   webview via `browser`/`8sync shot`, fire the real `invoke`, observe the real
   result or `listen` event. Screenshot evidence saved for any visual claim.
4. The target bundle builds: `cargo tauri build` succeeds for the configured
   `bundle.targets`; if the updater is configured, signature artifacts
   (`*.sig`) + `latest.json` are emitted (`createUpdaterArtifacts: true`).
5. `engine_verify` (verify = the build/test above) is green for the changed slice.

## Non-goals

- Mobile (iOS/Android) unless the project already targets it — only the
  lib/main split + `crate-type` note from base §1 apply.
- Maintaining a v1-only app with no v2 migration intent.
- Rewriting or swapping the frontend framework (React/Vue/Svelte/bun — Tauri is
  agnostic; this skill treats the webview as a black box you `invoke`/`listen`).
- Vendoring upstream docs — `references/base.md` distils and links; always defer
  to <https://v2.tauri.app/> for the full, current surface.
