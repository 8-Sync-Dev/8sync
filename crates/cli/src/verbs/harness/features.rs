//! `<config_dir>/features.toml` — the owner's small on/off + integer switches
//! (ccc idle/delegate/fence …). One flat TOML table; writes keep the other keys.
//! An env var (`1/0/true/false/on/off/yes/no`) always wins over the file value.
use anyhow::Result;
use std::path::{Path, PathBuf};

pub(crate) fn features_path(home: &Path) -> PathBuf {
    crate::brand::config_dir(home).join("features.toml")
}

/// Pure: env override wins over the file value; default off.
pub(crate) fn resolve(env: Option<&str>, file: Option<bool>) -> bool {
    match env.map(|s| s.trim().to_ascii_lowercase()).as_deref() {
        Some("1" | "true" | "on" | "yes") => true,
        Some("0" | "false" | "off" | "no") => false,
        _ => file.unwrap_or(false),
    }
}

pub(crate) fn read_int_key(home: &Path, key: &str) -> Option<i64> {
    let s = std::fs::read_to_string(features_path(home)).ok()?;
    s.parse::<toml::Table>().ok()?.get(key)?.as_integer()
}

pub(crate) fn read_flag_key(home: &Path, key: &str) -> Option<bool> {
    let s = std::fs::read_to_string(features_path(home)).ok()?;
    s.parse::<toml::Table>().ok()?.get(key)?.as_bool()
}

pub(crate) fn write_flag_key(home: &Path, key: &str, on: bool) -> Result<()> {
    write_key(home, key, toml::Value::Boolean(on))
}

/// Any value in `features.toml`, keeping the owner's other keys.
pub(crate) fn write_key(home: &Path, key: &str, value: toml::Value) -> Result<()> {
    let p = features_path(home);
    let mut t = match std::fs::read_to_string(&p) {
        // never replace a file we cannot parse: it may hold the owner's other keys
        Ok(s) => s.parse::<toml::Table>().map_err(|e| anyhow::anyhow!("{} is not valid TOML ({e}); fix it first", p.display()))?,
        Err(_) => toml::Table::new(),
    };
    t.insert(key.into(), value);
    if let Some(d) = p.parent() {
        std::fs::create_dir_all(d)?;
    }
    std::fs::write(&p, toml::to_string_pretty(&t)?)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_off_and_env_override() {
        assert!(!resolve(None, None));
        assert!(!resolve(None, Some(false)));
        assert!(resolve(None, Some(true)));
        assert!(resolve(Some("1"), Some(false)));
        assert!(!resolve(Some("0"), Some(true)));
        assert!(!resolve(Some("garbage"), None));
    }

    #[test]
    fn flag_roundtrip_default_off() {
        let d = std::env::temp_dir().join(format!("features-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        assert_eq!(read_flag_key(&d, "k"), None);
        write_flag_key(&d, "k", true).unwrap();
        assert_eq!(read_flag_key(&d, "k"), Some(true));
        write_flag_key(&d, "k", false).unwrap();
        assert_eq!(read_flag_key(&d, "k"), Some(false));
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn unparseable_features_file_is_not_overwritten() {
        let d = std::env::temp_dir().join(format!("features-badtoml-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        let p = features_path(&d);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(&p, "other = [unclosed\n").unwrap();
        assert!(write_flag_key(&d, "k", true).is_err());
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "other = [unclosed\n");
        let _ = std::fs::remove_dir_all(&d);
    }
}
