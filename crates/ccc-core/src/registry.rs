//! Name → UUID session registry shared by `8sync forge` and `8sync ccc`. Both
//! CLIs key conversations by UUID, so friendly per-repo names map to a UUID in
//! `<config>/8sync/<kind>/<project-key>/index.json` — machine-local on purpose,
//! like the CLIs' own transcript stores.

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Default)]
pub struct Registry {
    pub last_used: Option<String>,
    pub sessions: Vec<Session>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Session {
    pub name: String,
    pub conversation_id: String,
    pub created: u64,
    pub last_active: u64,
    /// How urgently this session needs attention, set by the agent running in it
    /// (`8sync ccc . urgent`). Absent in older index files.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub urgency: Option<Urgency>,
    /// What this session is for right now, set by its agent (`8sync ccc . goal`) so the other
    /// rooms see its target and claimed files. Absent in older index files.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub goal: Option<Goal>,
}

/// A session's current target and the files it claims, shown to the other rooms.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct Goal {
    pub text: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub files: Vec<String>,
    pub set_at: u64,
}

/// An agent-set attention flag shown by `ccc . ls`.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct Urgency {
    /// `high` | `med` | `low` (see [`URGENCY_LEVELS`]).
    pub level: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    pub set_at: u64,
}

/// Valid urgency levels, most urgent first.
pub const URGENCY_LEVELS: [&str; 3] = ["high", "med", "low"];

/// One repo's registry for one CLI. `verb` is the user-facing command
/// (`forge`, `ccc .`) used in messages.
pub struct Store {
    dir: PathBuf,
    verb: &'static str,
}

impl Store {
    pub fn new(config_dir: &Path, root: &Path, kind: &str, verb: &'static str) -> Self {
        Self { dir: config_dir.join("8sync").join(kind).join(project_key(root)), verb }
    }

    pub fn load(&self) -> Registry {
        std::fs::read_to_string(self.dir.join("index.json"))
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    /// The single mutation path: exclusive lock on `index.json.lock`, read, apply `f`,
    /// write `index.json.tmp`, rename over `index.json`. Concurrent launches never
    /// lose an entry; a corrupt index is kept as `index.json.corrupt-<unix>` and rebuilt empty.
    fn update<T>(&self, f: impl FnOnce(&mut Registry) -> Result<T>) -> Result<T> {
        std::fs::create_dir_all(&self.dir).with_context(|| format!("mkdir {}", self.dir.display()))?;
        let lock = std::fs::OpenOptions::new()
            .create(true)
            .truncate(false)
            .write(true)
            .open(self.dir.join("index.json.lock"))
            .context("open session index lock")?;
        lock.lock().context("lock session index")?;
        let path = self.dir.join("index.json");
        let mut reg = match std::fs::read_to_string(&path) {
            Ok(text) => serde_json::from_str(&text).unwrap_or_else(|e| {
                let bak = self.dir.join(format!("index.json.corrupt-{}", now()));
                let _ = std::fs::copy(&path, &bak);
                eprintln!("8sync: session index corrupt ({e}); kept {} and starting empty", bak.display());
                Registry::default()
            }),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Registry::default(),
            Err(e) => return Err(e).context("read session index"),
        };
        let out = f(&mut reg)?;
        let tmp = self.dir.join("index.json.tmp");
        std::fs::write(&tmp, serde_json::to_string_pretty(&reg)?).context("write session index")?;
        std::fs::rename(&tmp, &path).context("replace session index")?;
        Ok(out)
    }

    /// Create-or-resume `name` and mark it last used. `refuse_existing` backs `new <name>`.
    pub fn touch(&self, name: &str, refuse_existing: bool) -> Result<Session> {
        if !valid_name(name) {
            bail!("invalid session name '{name}' (use letters, digits, '-', '_', '.'; ≤64 chars)");
        }
        self.update(|reg| {
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
                    let s = Session { name: name.to_string(), conversation_id: new_uuid(), created: t, last_active: t, urgency: None, goal: None };
                    reg.sessions.push(s.clone());
                    s
                }
            };
            reg.last_used = Some(name.to_string());
            Ok(session)
        })
    }

    /// Unregister `name`; the caller deletes the CLI's own transcript.
    pub fn remove(&self, name: &str) -> Result<Option<Session>> {
        self.update(|reg| {
            let Some(i) = reg.sessions.iter().position(|s| s.name == name) else {
                return Ok(None);
            };
            let s = reg.sessions.remove(i);
            if reg.last_used.as_deref() == Some(name) {
                reg.last_used = reg.sessions.last().map(|x| x.name.clone());
            }
            Ok(Some(s))
        })
    }

    /// Set (or with `None` clear) the urgency of the session named `name` or, when
    /// `name` is `None`, the one whose conversation id is `id`. Returns the session
    /// name it changed, or `None` when nothing matched.
    pub fn set_urgency(&self, name: Option<&str>, id: Option<&str>, urgency: Option<Urgency>) -> Result<Option<String>> {
        if let Some(u) = &urgency {
            if !URGENCY_LEVELS.contains(&u.level.as_str()) {
                bail!("invalid urgency '{}' (use high, med, low or clear)", u.level);
            }
        }
        self.edit(name, id, |s| s.urgency = urgency)
    }

    /// Set (or with `None` clear) the goal of the session picked like [`Store::set_urgency`].
    pub fn set_goal(&self, name: Option<&str>, id: Option<&str>, goal: Option<Goal>) -> Result<Option<String>> {
        self.edit(name, id, |s| s.goal = goal)
    }

    /// Apply `f` to the session named `name` or, when `name` is `None`, the one whose
    /// conversation id is `id`; returns its name, or `None` when nothing matched.
    fn edit(&self, name: Option<&str>, id: Option<&str>, f: impl FnOnce(&mut Session)) -> Result<Option<String>> {
        if name.is_none() && id.is_none() {
            return Ok(None);
        }
        self.update(|reg| {
            let hit = reg.sessions.iter_mut().find(|s| match name {
                Some(n) => s.name == n,
                None => Some(s.conversation_id.as_str()) == id,
            });
            Ok(hit.map(|s| {
                f(s);
                s.name.clone()
            }))
        })
    }
}

/// Random RFC 4122 version-4 UUID — the id form Forge and Claude Code accept.
/// `RandomState` is seeded from the OS RNG; no extra crate needed.
pub fn new_uuid() -> String {
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

#[cfg(test)]
mod tests {
    use super::*;

    fn store(tag: &str) -> Store {
        let dir = std::env::temp_dir().join(format!("8sync-uuid-{tag}-{}-{}", std::process::id(), new_uuid()));
        Store { dir, verb: "ccc ." }
    }

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

    #[test]
    fn concurrent_inserts_lose_nothing() {
        let st = std::sync::Arc::new(store("conc"));
        let hs: Vec<_> = (0..4)
            .map(|t| {
                let st = st.clone();
                std::thread::spawn(move || {
                    for i in 0..25 {
                        st.touch(&format!("s{t}-{i}"), true).unwrap();
                    }
                })
            })
            .collect();
        hs.into_iter().for_each(|h| h.join().unwrap());
        assert_eq!(st.load().sessions.len(), 100);
        assert!(!st.dir.join("index.json.tmp").exists());
        let _ = std::fs::remove_dir_all(&st.dir);
    }

    #[test]
    fn corrupt_index_is_backed_up_and_rebuilt() {
        let st = store("corrupt");
        std::fs::create_dir_all(&st.dir).unwrap();
        std::fs::write(st.dir.join("index.json"), "{not json").unwrap();
        st.touch("a", false).unwrap();
        assert_eq!(st.load().sessions.len(), 1);
        let bak: Vec<_> = std::fs::read_dir(&st.dir)
            .unwrap()
            .flatten()
            .filter(|e| e.file_name().to_string_lossy().starts_with("index.json.corrupt-"))
            .collect();
        assert_eq!(bak.len(), 1);
        assert_eq!(std::fs::read_to_string(bak[0].path()).unwrap(), "{not json");
        assert!(!st.dir.join("index.json.tmp").exists());
        let _ = std::fs::remove_dir_all(&st.dir);
    }

    #[test]
    fn urgency_set_by_name_or_id_and_cleared() {
        let st = store("urg");
        let a = st.touch("a", false).unwrap();
        st.touch("b", false).unwrap();
        let u = |l: &str| Urgency { level: l.into(), note: Some("chờ owner".into()), set_at: 5 };
        assert_eq!(st.set_urgency(Some("b"), None, Some(u("high"))).unwrap().as_deref(), Some("b"));
        assert_eq!(st.set_urgency(None, Some(&a.conversation_id), Some(u("low"))).unwrap().as_deref(), Some("a"));
        let reg = st.load();
        assert_eq!(reg.sessions[1].urgency, Some(u("high")));
        assert_eq!(reg.sessions[0].urgency.as_ref().map(|x| x.level.as_str()), Some("low"));
        assert_eq!(st.set_urgency(Some("b"), None, None).unwrap().as_deref(), Some("b"));
        assert_eq!(st.load().sessions[1].urgency, None);
        assert_eq!(st.set_urgency(Some("nope"), None, Some(u("med"))).unwrap(), None);
        assert_eq!(st.set_urgency(None, Some("not-an-id"), Some(u("med"))).unwrap(), None);
        assert_eq!(st.set_urgency(None, None, Some(u("med"))).unwrap(), None);
        assert!(st.set_urgency(Some("a"), None, Some(u("urgent"))).is_err());
        let _ = std::fs::remove_dir_all(&st.dir);
    }

    #[test]
    fn goal_set_by_name_or_id_and_cleared() {
        let st = store("goal");
        let a = st.touch("a", false).unwrap();
        st.touch("b", false).unwrap();
        let g = Goal { text: "ship standup".into(), files: vec!["crates/x.rs".into()], set_at: 7 };
        assert_eq!(st.set_goal(None, Some(&a.conversation_id), Some(g.clone())).unwrap().as_deref(), Some("a"));
        assert_eq!(st.load().sessions[0].goal, Some(g));
        assert!(st.load().sessions[1].goal.is_none());
        assert_eq!(st.set_goal(Some("a"), None, None).unwrap().as_deref(), Some("a"));
        assert!(!std::fs::read_to_string(st.dir.join("index.json")).unwrap().contains("goal"));
        assert_eq!(st.set_goal(Some("ghost"), None, None).unwrap(), None);
    }

    #[test]
    fn cleared_urgency_is_not_written() {
        let st = store("urgw");
        st.touch("a", false).unwrap();
        st.set_urgency(Some("a"), None, Some(Urgency { level: "med".into(), note: None, set_at: 1 })).unwrap();
        assert!(std::fs::read_to_string(st.dir.join("index.json")).unwrap().contains("\"urgency\""));
        st.set_urgency(Some("a"), None, None).unwrap();
        assert!(!std::fs::read_to_string(st.dir.join("index.json")).unwrap().contains("urgency"));
        let _ = std::fs::remove_dir_all(&st.dir);
    }

    #[test]
    fn loads_existing_on_disk_format_and_mutates_it() {
        let st = store("fixture");
        std::fs::create_dir_all(&st.dir).unwrap();
        let fixture = r#"{
  "last_used": "alpha",
  "sessions": [
    {"name": "alpha", "conversation_id": "11111111-1111-4111-8111-111111111111", "created": 100, "last_active": 200},
    {"name": "beta", "conversation_id": "22222222-2222-4222-8222-222222222222", "created": 110, "last_active": 210}
  ]
}"#;
        std::fs::write(st.dir.join("index.json"), fixture).unwrap();
        let reg = st.load();
        assert_eq!(reg.last_used.as_deref(), Some("alpha"));
        assert_eq!(reg.sessions[1].conversation_id, "22222222-2222-4222-8222-222222222222");
        assert!(reg.sessions.iter().all(|s| s.urgency.is_none()), "old index has no urgency field");
        assert!(reg.sessions.iter().all(|s| s.goal.is_none()), "old index has no goal field");
        assert_eq!(st.touch("beta", false).unwrap().created, 110);
        assert_eq!(st.remove("alpha").unwrap().unwrap().last_active, 200);
        let reg = st.load();
        assert_eq!(reg.sessions.len(), 1);
        assert_eq!(reg.last_used.as_deref(), Some("beta"));
        let _ = std::fs::remove_dir_all(&st.dir);
    }
}
