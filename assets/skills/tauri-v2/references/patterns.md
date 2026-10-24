# Tauri v2 patterns — mined from 8syncdev repos

> Every pattern below is cited `repo:path` and was read from the actual repo via
> `gh api repos/8syncdev/<repo>/contents/<path>`. These are the opinionated
> extensions on top of the canonical base in `base.md`. Re-verify with `gh` /
> `trail ask` before copying — these repos move fast.
>
> Repos: `8syncdev/open-musik` (Tauri 2 + Python ACE‑Step engine, the sidecar
> reference) · `8syncdev/zus` (ZUS AI IDE, production bundling/updater) ·
> `8syncdev/sidex` (VS Code-class IDE on Tauri, multi-config merge).

## P1 — Hand-rolled sidecar over stdin/stdout (heavy native engine)

`8syncdev/open-musik` does NOT use the Tauri shell-plugin sidecar. It spawns a
long-lived Python child and speaks a JSON-lines protocol it controls:

- **`8syncdev/open-musik:src-tauri/src/sidecar.rs`** — a `Sidecar` supervisor:
  - Spawns `<python> -m openmusik_engine` via `tokio::process::Command` with
    `Stdio::piped()` on all three streams and **`.kill_on_drop(true)`**.
  - Wire format it defines and enforces: `-> {"id","op","params"}` /
    `<- {"id","event","data"}` (0..n progress) / `<- {"id","ok":bool,"result"|"error"}`
    (exactly one terminal). A line without `ok` is a `Protocol` error, not a
    silent hang.
  - **Correlation:** a `Correlator` maps request `id` → `oneshot::Sender`. Each
    `request()` registers a channel and `await`s it; the stdout reader resolves
    or `fail_all()`s on process death. This is how overlapping requests stay
    routed even when the engine answers out of order.
  - **Generation stamp:** `Arc<AtomicU64>` bumped on every spawn. A reader whose
    process died must not fail requests a *successor* process is already serving.
  - **`EventSink` trait** (`fn emit(&self, EngineEvent)`) keeps the protocol
    testable without a running Tauri app — production wires `TauriSink`, tests
    wire a `Collector`. Pure `parse_line()` is unit-tested directly.
  - Typed errors via `thiserror` (`SidecarError::{NotInstalled,Spawn,Died,Op,Protocol}`);
    `NotInstalled` prints the fix command (`run: bash scripts/setup-engine.sh`).
- **Why over the built-in sidecar:** this engine holds ~10 GB VRAM, needs a
  custom restart/correlation policy, and speaks its own progress protocol. The
  shell plugin's scoped one-shot spawn model is the wrong shape for it.

## P2 — Command contract: flat args, `Result<T, String>`, boundary validation

`8syncdev/open-musik:src-tauri/src/commands.rs` is the model command surface:

- `pub type CmdResult<T> = Result<T, String>;` — errors serialize straight to the
  frontend as a string the UI can show.
- `#[tauri::command]` with **flat parameters** (`caption: String, title:
  Option<String>, duration: Option<f64>, …`), and a doc comment explaining *why*
  flat: a single struct arg would force `invoke('generate', { args:{...} })`.
- **Validation at the boundary:** caption length (token-window math), BPM range
  `40..=200`, non-blank keyscale/language — all rejected before dispatch with a
  user-readable (Vietnamese) message. Bad values never reach the engine.
- **Async command returns a job id immediately** and does the minutes-long work in
  `tauri::async_runtime::spawn`, finishing via `app.emit("job:update", &snapshot)`.
  `cancel_job` distinguishes a child-process voice job from an engine request so a
  cancel doesn't reboot the whole sidecar.
- `save_song`/`reveal_song` show the `tauri-plugin-dialog` + `tauri-plugin-opener`
  patterns: `app.dialog().file().blocking_save_file()` and
  `app.opener().reveal_item_in_dir(&path)`. Format is whitelisted in Rust before
  it reaches a shell argument — `export_format()` rejects `"wav; rm -rf /"`.

## P3 — Builder wiring + managed state + exit cleanup

`8syncdev/open-musik:src-tauri/src/lib.rs`:

```rust
#[cfg_attr(mobile, tauri::mobile_entry_point)]  // mobile-ready even if desktop-only now
pub fn run() {
    webkit::harden_webkit_linux();               // MUST precede webview construction
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(tauri_plugin_log::Builder::default()
                    .level(log::LevelFilter::Info).build())?;   // log plugin: debug-only
            }
            app.manage(state::AppState::new(app.handle().clone(), state::project_root()));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![commands::engine_status, /* … */])
        .build(tauri::generate_context!())
        .expect("…")
        .run(|app, event| {                       // cleanup on RunEvent::Exit
            if let tauri::RunEvent::Exit = event {
                let st = app.state::<state::AppState>();
                st.recorder.stop_on_exit();
                st.voices.kill_all();
                tauri::async_runtime::block_on(st.sidecar.shutdown());
            }
        });
}
```

`main.rs` is the canonical two-liner: `#![cfg_attr(not(debug_assertions),
windows_subsystem = "windows")]` then `openmusik_lib::run();`. The lib/main split
is the v2 mobile-ready shape (see base §1).

## P4 — State + event sink (progress that survives a webview reload)

`8syncdev/open-musik:src-tauri/src/state.rs`:

- `AppState` holds `Arc<Sidecar>`, `Arc<Mutex<HashMap<u64, JobInfo>>>`, voice
  jobs, the recorder, and `project_root`. Built once in `setup`, read via
  `State<'_, AppState>` in commands.
- `TauriSink` implements the sidecar's `EventSink` and forwards engine
  `progress` events to the webview with `app.emit("job:update", &snapshot)`.
- **Comment worth keeping:** "The event system (rather than `ipc::Channel`) is
  deliberate … events let the job registry survive a webview reload — a Channel
  dies with the invoke that created it." (see base §3).
- Lock discipline: clone the job snapshot out from under the `Mutex` **before**
  emitting into the webview — emitting while holding the lock stalls under load.
- `engine_python()` resolves the interpreter: `OPENMUSIK_PYTHON` env wins, else
  the venv `scripts/setup-engine.sh` builds at `engine/.venv/bin/python`.

## P5 — Capabilities: minimal + granular, per window

`8syncdev/open-musik:src-tauri/capabilities/default.json` — `core:default` plus
only the specific plugin permissions actually used:

```json
{ "identifier": "default", "windows": ["main"], "permissions": [
    "core:default", "dialog:allow-open", "dialog:allow-save",
    "opener:allow-reveal-item-in-dir" ] }
```

`8syncdev/zus:src-tauri/capabilities/default.json` adds the **custom-titlebar**
window permissions a frameless window needs:

```json
"core:window:allow-start-dragging", "core:window:allow-minimize",
"core:window:allow-toggle-maximize", "core:window:allow-is-maximized",
"core:window:allow-close", "dialog:default", "shell:default", "log:default"
```

Lesson: start from `core:default`, add `plugin:default` only for plugins you
register, and reach for `plugin:allow-<cmd>` when a default set is too broad.

## P6 — tauri.conf.json: CSP hardening, asset scope, bundle targets

`8syncdev/open-musik:src-tauri/tauri.conf.json`:

- `"$schema": "https://schema.tauri.app/config/2"` — pin the v2 schema.
- `app.security.csp` whitelists the v2 internal protocols `ipc:` and
  `http://ipc.localhost`, `asset:` / `http://asset.localhost`, plus `media-src`
  for audio and `data:`/`blob:`. A separate permissive `devCsp` adds the dev
  server origin + `'unsafe-inline'` script for HMR.
- `app.security.assetProtocol.scope` = `["$AUDIO/**","$APPDATA/**"]` — the
  glob allowlist that `convertFileSrc` paths must fall under (see base §2).
- `bundle.targets` = `["deb","appimage"]` with `bundle.linux.deb.depends` =
  `["libwebkit2gtk-4.1-0","libgtk-3-0"]` (the webkit2gtk 4.1 line is current).
- `build.beforeDevCommand` / `beforeBuildCommand` shell out to `scripts/web.sh`.

## P7 — Cargo.toml: `rlib`-only on desktop, `protocol-asset` feature

`8syncdev/open-musik:src-tauri/Cargo.toml`:

```toml
[lib]
name = "openmusik_lib"
# rlib only: staticlib/cdylib re-export every public symbol and blow the PE
# 65535-export cap on Windows. They are only needed for iOS/Android targets.
crate-type = ["rlib"]
tauri = { version = "2.11.3", features = ["protocol-asset"] }  # enable asset: protocol
[profile.release]
lto = "thin"; codegen-units = 1; strip = true; panic = "abort"  # small binary
[lints.rust]
unsafe_code = "deny"
```

`8syncdev/zus:src-tauri/Cargo.toml` adds `"tray-icon"` (system tray needs the
feature). The same `rust-version = "1.77.2"` floor and `tauri-build = "2"`
build-dep appear everywhere.

## P8 — Frontend bridge: typed `invoke`, `inTauri` guard, `listen`, `convertFileSrc`

`8syncdev/open-musik:app/src/lib/tauri.ts` — a reusable wrapper every Tauri+web
project should copy:

- `inTauri = "__TAURI_INTERNALS__" in window` — lets `bun run dev` in a plain
  browser render (commands reject loudly instead of throwing on import).
- `invoke<T>(cmd, args?)` wraps `@tauri-apps/api/core`'s `invoke`; rejects with
  the command name outside the shell.
- `on<T>(event, handler)` wraps `@tauri-apps/api/event`'s `listen`; returns a
  no-op unlisten outside Tauri. **Gotcha called out:** `listen` is async, so a
  `useEffect` cleanup must be `() => { void p.then(off => off()) }`, never
  `return p`.
- `mediaSrc(path, version?)` = `convertFileSrc(path)` + cache-bust query, because
  the webview caches on the `asset:` URL alone and a retake overwriting the same
  path would serve stale audio.

`8syncdev/open-musik:app/src/lib/jobs.ts` — the event-driven frontend reducer:
hydrate once from the `list_jobs` command, then apply `job:update` pushes; a live
upsert is never clobbered by a stale hydration that raced it.

## P9 — Linux WebKitGTK hardening (NVIDIA / black window)

`8syncdev/open-musik:src-tauri/src/webkit.rs` — runs **before** the webview is
built (`harden_webkit_linux()` is the first line of `run()`):

- Default: set only `WEBKIT_DISABLE_DMABUF_RENDERER=1` (the one flag NVIDIA
  proprietary needs to render). JIT, accelerated compositing, native GDK backend
  stay ON — turning those off makes every frame CPU-rendered.
- Opt-in `OPENMUSIK_WEBKIT_SAFE_MODE=1` adds the full slow fallback
  (`GDK_BACKEND=x11`, `WEBKIT_DISABLE_COMPOSITING_MODE=1`, `JSC_useJIT=0`).
- `set_default()` never clobbers a user-set value; `#[cfg(target_os="linux")]`
  makes it a no-op elsewhere. This is the fix pattern for "black/blank webview
  on Linux" (base §9).

## P10 — Production bundling, code signing, auto-updater

`8syncdev/zus:src-tauri/tauri.conf.json` is the full production reference:

- `plugins.updater` = `{ pubkey: <base64 minisign pubkey>, endpoints:
  ["https://github.com/8syncdev/zus-releases/releases/latest/download/latest.json"] }`.
- `bundle.createUpdaterArtifacts: true` — **mandatory** for the updater to ship
  (base §8). `bundle.targets: "all"`, `publisher`, `category: "DeveloperTool"`,
  `homepage`, `copyright`, short/long descriptions.
- `bundle.resources` ships non-Rust assets (`extension-host/*`, `shell-integration/*`).
- **Per-OS:** `macOS.signingIdentity: "-"` (ad-hoc) + `entitlements:
  "entitlements.plist"` + `minimumSystemVersion: "10.15"`; `windows.webviewInstallMode:
  {type:"downloadBootstrapper"}`; `linux.deb.depends` + `linux.rpm.depends`.
- **Frameless window:** `decorations:false, transparent:true, shadow:true,
  visible:false, titleBarStyle:"Overlay", hiddenTitle:true, useHttpsScheme:true`
  (the https scheme preserves IndexedDB — base §1), paired with the window perms
  in P5.

`8syncdev/sidex:src-tauri/tauri.release.conf.json` = `{bundle:{createUpdaterArtifacts:true}}`
and `tauri.macos.conf.json` overrides window/titlebar per-OS — the **config-merge**
pattern: a base `tauri.conf.json` plus `--config tauri.<profile>.conf.json`
overlays selected at build time (`tauri build --config tauri.release.conf.json`).

## P11 — Capability→command troubleshooting loop

When a frontend call fails with `command X not allowed` / `plugin Y not allowed`:
1. The error string names the exact missing permission (e.g.
   `opener:allow-reveal-item-in-dir`). Open the capability file bound to the
   emitting window (`8syncdev/open-musik:src-tauri/capabilities/default.json`).
2. Append that string to `permissions`. If only a broad set exists, prefer the
   granular `plugin:allow-<cmd>` over `plugin:default`.
3. The build regenerates `src-tauri/gen/schemas/desktop-schema.json` — that file
   is the authoritative list of every valid permission identifier.
