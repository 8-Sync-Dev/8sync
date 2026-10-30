//! Token-lean kit pieces: ECC's plugin hooks really off while `ECC_HOOKS_ENABLED` is "false", and
//! one-time `settings.json` seeds that shrink the per-request prefix.
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

const OFF: &str = "hooks.json.8sync-off";
const EMPTY: &str = "{\"hooks\":{}}\n";

/// Tools denied once (seed recorded in the kit stamp, so an entry the owner deletes stays deleted).
/// Removing them from the request saved 2,986 tokens of tool schemas per session; 7-day use: 0.
const SEED_DENY: [&str; 3] = ["ShareOnboardingGuide", "ReportFindings", "ScheduleWakeup"];
pub(super) const SEED_DENY_KEY: &str = "seed:deny-unused-tools";
/// 0.01 → 0.005 saved 4,048 tokens of skill listing per session; every skill name stays listed.
const SKILL_BUDGET: f64 = 0.005;

/// `skillListingBudgetFraction` when absent (an owner value wins) and the deny seed once.
/// True when `stamps` changed (the caller writes the stamp after settings.json).
pub(super) fn seed_settings(v: &mut Value, stamps: &mut BTreeMap<String, String>) -> bool {
    let Some(obj) = v.as_object_mut() else { return false };
    obj.entry("skillListingBudgetFraction").or_insert_with(|| json!(SKILL_BUDGET));
    if stamps.contains_key(SEED_DENY_KEY) {
        return false;
    }
    let Some(list) = obj.entry("permissions").or_insert_with(|| json!({})).as_object_mut().and_then(|p| p.entry("deny").or_insert_with(|| json!([])).as_array_mut()) else {
        return false;
    };
    for t in SEED_DENY {
        if !list.iter().any(|r| r == t) {
            list.push(json!(t));
        }
    }
    stamps.insert(SEED_DENY_KEY.into(), "1".into());
    true
}

fn subdirs(d: &Path) -> impl Iterator<Item = PathBuf> {
    std::fs::read_dir(d).into_iter().flatten().flatten().filter(|e| e.file_type().is_ok_and(|t| t.is_dir())).map(|e| e.path())
}

/// Every installed version of the ECC plugin: `plugins/cache/<marketplace>/<plugin>/<version>/`
/// whose `.claude-plugin/plugin.json` names `ecc`.
fn ecc_dirs(claude: &Path) -> Vec<PathBuf> {
    subdirs(&claude.join("plugins").join("cache"))
        .flat_map(|m| subdirs(&m).collect::<Vec<_>>())
        .flat_map(|p| subdirs(&p).collect::<Vec<_>>())
        .filter(|d| {
            std::fs::read_to_string(d.join(".claude-plugin").join("plugin.json"))
                .ok()
                .and_then(|t| serde_json::from_str::<Value>(&t).ok())
                .is_some_and(|v| v["name"] == "ecc")
        })
        .collect()
}

/// `Some(true)` when the file holds no hooks, `None` when it is missing or unreadable.
fn empty_hooks(p: &Path) -> Option<bool> {
    let v: Value = serde_json::from_str(&std::fs::read_to_string(p).ok()?).ok()?;
    Some(v["hooks"].as_object().is_some_and(|m| m.is_empty()))
}

/// Off: `hooks.json` → `hooks.json.8sync-off` (only when no backup exists yet), then an empty one.
/// On: the backup back, only over our empty file. True when a file changed.
fn switch(dir: &Path, on: bool) -> std::io::Result<bool> {
    let (hooks, off) = (dir.join("hooks").join("hooks.json"), dir.join("hooks").join(OFF));
    let state = empty_hooks(&hooks);
    if on {
        if !off.exists() || state == Some(false) {
            return Ok(false);
        }
        std::fs::rename(&off, &hooks)?;
        return Ok(true);
    }
    if state != Some(false) {
        return Ok(false); // already off, or the plugin ships no hooks
    }
    if !off.exists() {
        std::fs::rename(&hooks, &off)?;
    }
    std::fs::write(&hooks, EMPTY)?;
    Ok(true)
}

/// `ccc kit` and every `ccc` launch. ECC reads `ECC_HOOKS_ENABLED` only inside each hook's node
/// process, so with the flag "false" Claude Code still spawned node for all 27 hook commands (on
/// Windows each died at parse: ~8 node spawns per Bash call). "false" empties every installed
/// ECC version's hooks.json, "true" restores it; absent: untouched. No network, a few stats.
pub(super) fn sync_ecc_hooks(claude: &Path) {
    let raw = std::fs::read_to_string(claude.join("settings.json")).unwrap_or_default();
    let flag = serde_json::from_str::<Value>(&raw).ok().and_then(|v| v["env"]["ECC_HOOKS_ENABLED"].as_str().map(str::to_owned));
    let on = match flag.as_deref().map(str::trim) {
        Some("false") => false,
        Some("true") => true,
        _ => return,
    };
    for d in ecc_dirs(claude) {
        match switch(&d, on) {
            Ok(true) if on => crate::ui::ok(&format!("ECC hooks restored ({})", d.display())),
            Ok(true) => crate::ui::ok(&format!("ECC hooks off: no node spawn per tool call (backup {OFF}, {})", d.display())),
            Ok(false) => {}
            Err(e) => crate::ui::warn(&format!("ECC hooks in {}: {e}", d.display())),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tree() -> PathBuf {
        static N: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let d = std::env::temp_dir().join(format!("lean-{}-{}", std::process::id(), N.fetch_add(1, std::sync::atomic::Ordering::SeqCst)));
        let _ = std::fs::remove_dir_all(&d);
        for (plugin, name) in [("ecc/ecc/2.2.3", "ecc"), ("ecc/ecc/2.2.2", "ecc"), ("other/tool/1.0.0", "tool")] {
            let p = d.join("plugins/cache").join(plugin);
            std::fs::create_dir_all(p.join(".claude-plugin")).unwrap();
            std::fs::create_dir_all(p.join("hooks")).unwrap();
            std::fs::write(p.join(".claude-plugin/plugin.json"), json!({ "name": name }).to_string()).unwrap();
            std::fs::write(p.join("hooks/hooks.json"), r#"{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"node x"}]}]}}"#).unwrap();
        }
        d
    }
    fn flag(d: &Path, f: &str) {
        std::fs::write(d.join("settings.json"), json!({ "env": { "ECC_HOOKS_ENABLED": f } }).to_string()).unwrap();
    }
    fn hooks(d: &Path, plugin: &str) -> String {
        std::fs::read_to_string(d.join("plugins/cache").join(plugin).join("hooks/hooks.json")).unwrap()
    }

    #[test]
    fn ecc_hooks_off_idempotent_restore_and_other_plugins_untouched() {
        let d = tree();
        let orig = hooks(&d, "ecc/ecc/2.2.3");
        let other = hooks(&d, "other/tool/1.0.0");
        sync_ecc_hooks(&d); // no settings.json: untouched
        assert_eq!(hooks(&d, "ecc/ecc/2.2.3"), orig);
        flag(&d, "false");
        sync_ecc_hooks(&d);
        for v in ["2.2.3", "2.2.2"] {
            let p = d.join("plugins/cache/ecc/ecc").join(v).join("hooks");
            assert_eq!(std::fs::read_to_string(p.join("hooks.json")).unwrap(), EMPTY);
            assert_eq!(std::fs::read_to_string(p.join(OFF)).unwrap(), orig);
        }
        assert_eq!(hooks(&d, "other/tool/1.0.0"), other);
        assert!(!d.join("plugins/cache/other/tool/1.0.0/hooks").join(OFF).exists());
        // idempotent: the backup is never overwritten by the empty file
        sync_ecc_hooks(&d);
        assert_eq!(std::fs::read_to_string(d.join("plugins/cache/ecc/ecc/2.2.3/hooks").join(OFF)).unwrap(), orig);
        flag(&d, "true");
        sync_ecc_hooks(&d);
        assert_eq!(hooks(&d, "ecc/ecc/2.2.3"), orig);
        assert!(!d.join("plugins/cache/ecc/ecc/2.2.3/hooks").join(OFF).exists());
        sync_ecc_hooks(&d);
        assert_eq!(hooks(&d, "ecc/ecc/2.2.3"), orig);
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn hand_made_backup_with_empty_hooks_means_already_off() {
        let d = tree();
        let h = d.join("plugins/cache/ecc/ecc/2.2.3/hooks");
        std::fs::rename(h.join("hooks.json"), h.join(OFF)).unwrap();
        std::fs::write(h.join("hooks.json"), "{\n  \"hooks\": {}\n}").unwrap();
        assert!(!switch(&d.join("plugins/cache/ecc/ecc/2.2.3"), false).unwrap());
        assert_eq!(std::fs::read_to_string(h.join("hooks.json")).unwrap(), "{\n  \"hooks\": {}\n}");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn seeds_budget_when_absent_and_deny_once() {
        let mut stamps = BTreeMap::new();
        let mut v = json!({ "permissions": { "deny": ["ReportFindings", "Bash(rm -rf /)"] } });
        assert!(seed_settings(&mut v, &mut stamps));
        assert_eq!(v["skillListingBudgetFraction"], json!(0.005));
        let deny: Vec<&str> = v["permissions"]["deny"].as_array().unwrap().iter().filter_map(Value::as_str).collect();
        assert_eq!(deny, ["ReportFindings", "Bash(rm -rf /)", "ShareOnboardingGuide", "ScheduleWakeup"]);
        // the owner deletes one: never re-added; a user budget wins
        v["permissions"]["deny"] = json!(["Bash(rm -rf /)"]);
        v["skillListingBudgetFraction"] = json!(0.02);
        assert!(!seed_settings(&mut v, &mut stamps));
        assert_eq!(v["permissions"]["deny"], json!(["Bash(rm -rf /)"]));
        assert_eq!(v["skillListingBudgetFraction"], json!(0.02));
    }
}
