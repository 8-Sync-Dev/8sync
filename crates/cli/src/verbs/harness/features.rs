//! `<config_dir>/features.toml` — the owner's small on/off switches
//! (fence, skill libraries …). One flat TOML table.
use anyhow::Result;
use std::path::{Path, PathBuf};

pub(crate) fn features_path(home: &Path) -> PathBuf {
    crate::brand::config_dir(home).join("features.toml")
}

pub(crate) fn read_flag_key(home: &Path, key: &str) -> Option<bool> {
    let s = std::fs::read_to_string(features_path(home)).ok()?;
    s.parse::<toml::Table>().ok()?.get(key)?.as_bool()
}

/// Keys of features 8sync no longer has (room-to-room delegation and the idle
/// nudge went with the board and teams).
const DEAD_KEYS: [&str; 3] = ["delegate", "delegate_after_s", "no_idle"];

/// Deletes the [`DEAD_KEYS`] lines from an existing features.toml, keeping every
/// other line (and the owner's comments) byte for byte. True when the file changed;
/// a missing file is `Ok(false)`.
pub(crate) fn retire_dead_keys(home: &Path) -> Result<bool> {
    let p = features_path(home);
    let Ok(s) = std::fs::read_to_string(&p) else { return Ok(false) };
    let mut top_level = true;
    let mut changed = false;
    let mut out = String::with_capacity(s.len());
    for line in s.split_inclusive('\n') {
        let t = line.trim_start();
        if t.starts_with('[') {
            top_level = false;
        }
        let key = t.split('=').next().unwrap_or("").trim().trim_matches('"');
        if top_level && t.contains('=') && DEAD_KEYS.contains(&key) {
            changed = true;
            continue;
        }
        out.push_str(line);
    }
    if changed {
        std::fs::write(&p, out)?;
    }
    Ok(changed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flags_read_from_the_file_and_absent_is_none() {
        let d = std::env::temp_dir().join(format!("features-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        assert_eq!(read_flag_key(&d, "k"), None);
        let p = features_path(&d);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(&p, "k = true\nn = 3\n").unwrap();
        assert_eq!((read_flag_key(&d, "k"), read_flag_key(&d, "n"), read_flag_key(&d, "x")), (Some(true), None, None));
        std::fs::write(&p, "other = [unclosed\n").unwrap();
        assert_eq!(read_flag_key(&d, "k"), None, "unparseable file reads as unset");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn dead_keys_are_retired_and_the_rest_kept() {
        let d = std::env::temp_dir().join(format!("features-retire-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        assert!(!retire_dead_keys(&d).unwrap(), "no file → nothing to do");
        let p = features_path(&d);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        let before = "# mine\ndelegate = true\nfence = true\ndelegate_after_s = 600\n\"no_idle\" = false\nskill_libraries = [\"/x\"]\ndelegates = 1\n\n[other]\nno_idle = 1\n";
        std::fs::write(&p, before).unwrap();
        assert!(retire_dead_keys(&d).unwrap());
        assert_eq!(
            std::fs::read_to_string(&p).unwrap(),
            "# mine\nfence = true\nskill_libraries = [\"/x\"]\ndelegates = 1\n\n[other]\nno_idle = 1\n"
        );
        assert!(!retire_dead_keys(&d).unwrap(), "idempotent");
        let _ = std::fs::remove_dir_all(&d);
    }
}
