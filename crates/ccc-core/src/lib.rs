//! `ccc-core` — the pure, dependency-light core of `8sync ccc`, and the stable
//! surface ZUS links against (pin by git tag, e.g.
//! `ccc-core = { git = "https://github.com/8-Sync-Dev/su-code", tag = "vX.Y.Z" }`).
//!
//! - [`secret_mask`]: [`mask`] — one heuristic masker for anything shown or journaled.
//! - [`registry`]: [`registry::Store`] — locked, atomic name → UUID session registry.
//! - [`transcript`]: transcript scan ([`transcript::scan_file`], [`transcript::scan_tail`]),
//!   [`transcript::Row`] / [`transcript::Digest`] types and the `--json` row
//!   builders ([`transcript::row_json`], [`transcript::show_json`]).
//!
//! No async runtime, no CLI parsing, no terminal output. Every machine-readable
//! JSON row carries `"schema": `[`SCHEMA`]; it is bumped only on a breaking change.

pub mod registry;
pub mod secret_mask;
pub mod transcript;

pub use secret_mask::mask;

/// Version of every machine-readable `ls` / `show` / `ccc` JSON surface
/// (`docs/hq-ui-contract.md`, "ccc JSON surfaces"). Bump on a breaking change.
pub const SCHEMA: u32 = 1;
