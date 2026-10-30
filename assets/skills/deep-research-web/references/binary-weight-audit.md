# Native & binary-weight audits (measure, never assume)

When the question is *"can Zig/Rust/native tooling make this leaner or faster?"*, opinions are worthless — only A/B byte counts and timings count.

1. **Ground the artifact.** `stat -c%s <bin>` and `size -A <bin>` (`.text` = code, `.rodata` = embedded data, `.eh_frame`/`.rela.dyn` = link overhead). Compare against the project's stated budget first.
2. **Attribute before optimising.** `cargo bloat --release --crates -n 25` for per-crate `.text`. Treat `[Unknown]` as C code and chase it with `du -h` on `build/*/out/*.a`. The tool says its numbers are guesswork — quote that caveat.
3. **A/B every flag.** Scratch `--target-dir`, explicit `--target` (so `RUSTFLAGS` skip host proc-macros), `CARGO_PROFILE_RELEASE_*` env overrides instead of editing `Cargo.toml`.
4. **Report negative results** as `failure:` entries in `su-code/KNOWLEDGE.md`; size folklore (`opt-level="s"`, `panic="abort"`) is often false on real binaries.
5. **Trace surprise dependencies:** `cargo tree -i <crate>`.
6. **Real levers first:** feature-gate optional subsystems and un-embed asset trees before compiler flags or rewrites.
7. **Language question:** Zig/C/asm only with a profile showing a compute hot path; for IO/orchestration CLIs the answer is build tooling (`cargo-zigbuild`, `universal2`), never a second runtime.
