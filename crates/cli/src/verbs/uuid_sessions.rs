//! Name → UUID session registry shared by `8sync forge` and `8sync ccc`. Both
//! CLIs key conversations by UUID, so friendly per-repo names map to a UUID in
//! `<config>/8sync/<kind>/<project-key>/index.json` — machine-local on purpose,
//! like the CLIs' own transcript stores.

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};

use crate::env_detect::Env;

#[derive(Serialize, Deserialize, Default)]
pub(crate) struct Registry {
    pub last_used: Option<String>,
    pub sessions: Vec<Session>,
}

#[derive(Serialize, Deserialize, Clone)]
pub(crate) struct Session {
    pub name: String,
    pub conversation_id: String,
    pub created: u64,
    pub last_active: u64,
}

/// One repo's registry for one CLI. `verb` is the user-facing command
/// (`forge`, `ccc .`) used in messages.
pub(crate) struct Store {
    dir: PathBuf,
    verb: &'static str,
}

impl Store {
    pub fn new(env: &Env, root: &Path, kind: &str, verb: &'static str) -> Self {
        Self { dir: env.xdg_config.join("8sync").join(kind).join(project_key(root)), verb }
    }

    pub fn load(&self) -> Registry {
        std::fs::read_to_string(self.dir.join("index.json"))
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    fn save(&self, reg: &Registry) -> Result<()> {
        std::fs::create_dir_all(&self.dir).with_context(|| format!("mkdir {}", self.dir.display()))?;
        std::fs::write(self.dir.join("index.json"), serde_json::to_string_pretty(reg)?)
            .context("write session index")
    }

    /// Create-or-resume `name` and mark it last used. `refuse_existing` backs `new <name>`.
    pub fn touch(&self, name: &str, refuse_existing: bool) -> Result<Session> {
        if !valid_name(name) {
            bail!("invalid session name '{name}' (use letters, digits, '-', '_', '.'; ≤64 chars)");
        }
        let mut reg = self.load();
        let t = now();
        let session = match reg.sessions.iter_mut().find(|s| s.name == name) {
            Some(_) if refuse_existing => {
                bail!("session '{name}' already exists in this repo (resume it with `8sync {} {name}`)", self.verb)
            }
            Some(existing) => {
                existing.last_active = t;
                existing.clone()
            }
            None => {
                let s = Session { name: name.to_string(), conversation_id: new_uuid(), created: t, last_active: t };
                reg.sessions.push(s.clone());
                s
            }
        };
        reg.last_used = Some(name.to_string());
        self.save(&reg)?;
        Ok(session)
    }

    /// Unregister `name`; the caller deletes the CLI's own transcript.
    pub fn remove(&self, name: &str) -> Result<Option<Session>> {
        let mut reg = self.load();
        let Some(i) = reg.sessions.iter().position(|s| s.name == name) else {
            return Ok(None);
        };
        let s = reg.sessions.remove(i);
        if reg.last_used.as_deref() == Some(name) {
            reg.last_used = reg.sessions.last().map(|x| x.name.clone());
        }
        self.save(&reg)?;
        Ok(Some(s))
    }
}

/// Random RFC 4122 version-4 UUID — the id form Forge and Claude Code accept.
/// `RandomState` is seeded from the OS RNG; no extra crate needed.
pub(crate) fn new_uuid() -> String {
    use std::hash::{BuildHasher, Hasher};
    let mut bytes = [0u8; 16];
    for (i, chunk) in bytes.chunks_mut(8).enumerate() {
        let mut h = std::collections::hash_map::RandomState::new().build_hasher();
        h.write_u128(SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0));
        h.write_usize(i);
        chunk.copy_from_slice(&h.finish().to_le_bytes());
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
    let h: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    format!("{}-{}-{}-{}-{}", &h[..8], &h[8..12], &h[12..16], &h[16..20], &h[20..])
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn project_key(root: &Path) -> String {
    let s = root.to_string_lossy();
    let key: String = s.chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect();
    if key.len() <= 120 {
        return key;
    }
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    s.hash(&mut h);
    format!("h{:016x}", h.finish())
}

fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && name != "."
        && name != ".."
        && name.len() <= 64
        && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

fn ago(secs: u64, now: u64) -> String {
    let d = now.saturating_sub(secs);
    match d {
        0..=59 => format!("{d}s ago"),
        60..=3599 => format!("{}m ago", d / 60),
        3600..=86_399 => format!("{}h ago", d / 3600),
        _ => format!("{}d ago", d / 86_400),
    }
}

pub(crate) fn print(reg: &Registry) {
    let n = now();
    for s in &reg.sessions {
        let star = if reg.last_used.as_deref() == Some(&s.name) { "★ " } else { "  " };
        println!("{star}{:<16}  last active: {:<12}  id: {}", s.name, ago(s.last_active, n), s.conversation_id);
    }
}

#[cfg(test)]
mod tests {
    use super::new_uuid;

    #[test]
    fn session_ids_are_rfc4122_v4_and_unique() {
        let a = new_uuid();
        let groups: Vec<&str> = a.split('-').collect();
        assert_eq!(groups.iter().map(|g| g.len()).collect::<Vec<_>>(), [8, 4, 4, 4, 12]);
        assert!(a.chars().all(|c| c == '-' || c.is_ascii_hexdigit()));
        assert!(groups[2].starts_with('4'), "version nibble: {a}");
        assert!(matches!(&groups[3][..1], "8" | "9" | "a" | "b"), "variant: {a}");
        assert_ne!(a, new_uuid());
    }
}
