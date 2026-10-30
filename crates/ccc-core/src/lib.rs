//! `ccc-core` — the pure, dependency-light core of `8sync ccc`, and the stable
//! surface ZUS links against (pin by git tag, e.g.
//! `ccc-core = { git = "https://github.com/8-Sync-Dev/8sync", tag = "vX.Y.Z" }`).
//!
//! - [`secret_mask`]: [`mask`] — one heuristic masker for anything shown or journaled.
//! - [`registry`]: [`registry::Store`] — locked, atomic name → UUID session registry.
//! - [`transcript`]: transcript scan ([`transcript::scan_file`], [`transcript::scan_tail`]),
//!   [`transcript::Row`] / [`transcript::Digest`] types and the `--json` row
//!   builders ([`transcript::row_json`], [`transcript::show_json`]).
//! - [`room_id`]: the inbox id of an omp room (a Claude Code room's inbox id is its session id).
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

/// Inbox id of an omp room: `omp-` + 16 lowercase hex of FNV-1a 64 over the canonical project
/// root (UTF-8, lossy) + `"\0"` + the session name. The single source of truth for the id the
/// omp launch exports (`EIGHTSYNC_ROOM_ID`) and `ls --json` shows (`inbox_id`).
pub fn room_id(root: &std::path::Path, name: &str) -> String {
    let root = std::fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in root.to_string_lossy().as_bytes().iter().chain(b"\0").chain(name.as_bytes()) {
        h ^= u64::from(*b);
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("omp-{h:016x}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn room_id_is_stable_safe_and_keyed_by_root_and_name() {
        let d = std::env::temp_dir().join(format!("ccc-core-room-{}", std::process::id()));
        std::fs::create_dir_all(d.join("sub")).unwrap();
        let id = room_id(&d, "core");
        assert_eq!(id.len(), 20);
        assert!(id.starts_with("omp-") && id[4..].chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()), "{id}");
        assert_eq!(transcript::safe_id(&id).as_deref(), Some(id.as_str()), "usable as an inbox file name");
        assert_eq!(room_id(&d.join("sub").join(".."), "core"), id, "canonical root: same room");
        assert_ne!(room_id(&d, "core2"), id);
        assert_ne!(room_id(&d.join("sub"), "core"), id);
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn room_id_is_fnv1a_64_of_root_nul_name() {
        // A path that does not exist is hashed as given: bytes "a\0b". Golden value: the id
        // format is shared by every launch, row and inbox file, so it must never drift.
        assert_eq!(room_id(std::path::Path::new("a"), "b"), "omp-e5d29919042666b2");
    }
}
