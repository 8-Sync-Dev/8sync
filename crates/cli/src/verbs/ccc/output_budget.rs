//! Kit tool-output budget: two documented Claude Code env vars written into `~/.claude/settings.json`
//! `env` by `ccc kit`, only when absent, and removed by `ccc kit --remove` only while they still equal
//! the kit value (same pattern as `compact.rs`).
//!
//! Sources (https://code.claude.com/docs/en/env-vars, fetched 2026-10-14):
//! - "`BASH_MAX_OUTPUT_LENGTH` Maximum number of characters of bash output that Claude Code reads back into a
//!   command's result (default: 30000; maximum: 150000). If you set the `bashOutputMaxChars` setting, Claude Code
//!   ignores this variable."
//! - "`CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS` Override the default token limit for file reads, which is 25,000
//!   tokens. Useful when you need to read larger files in full."
//!
//! Output past the Bash limit is not lost: Claude gets a file path plus a preview and reads the rest on demand
//! (https://code.claude.com/docs/en/tools-reference#output-limits). A read past the token limit returns the first page
//! with a `PARTIAL view` notice and how to continue with `offset`/`limit`
//! (https://code.claude.com/docs/en/tools-reference#large-files).
use anyhow::{Context, Result};
use serde_json::{json, Value};

/// (variable, kit value, documented default). Both values are BELOW the default so they cut, and stay
/// large enough that normal commands and source files fit whole.
pub(super) const BUDGET: &[(&str, &str, &str)] = &[
    ("BASH_MAX_OUTPUT_LENGTH", "20000", "30000"),
    ("CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS", "15000", "25000"),
];

fn is_val(env: &serde_json::Map<String, Value>, k: &str, want: &str) -> bool {
    match env.get(k) {
        Some(Value::String(s)) => s == want,
        Some(Value::Number(n)) => n.to_string() == want,
        _ => false,
    }
}

/// `ccc kit`: set each var only when the key is absent (an owner value is never touched).
pub(super) fn kit_default(v: &mut Value) -> Result<()> {
    let obj = v.as_object_mut().context("settings.json is not a JSON object")?;
    if let Some(env) = obj.entry("env").or_insert_with(|| json!({})).as_object_mut() {
        for (k, val, _) in BUDGET {
            env.entry(*k).or_insert_with(|| json!(val));
        }
    }
    Ok(())
}

/// `ccc kit --remove`: drop each key only while it still equals the kit value; true when anything changed.
pub(super) fn strip_kit_default(v: &mut Value) -> bool {
    let Some(obj) = v.as_object_mut() else { return false };
    let Some(env) = obj.get_mut("env").and_then(Value::as_object_mut) else { return false };
    let mut changed = false;
    for (k, val, _) in BUDGET {
        if is_val(env, k, val) {
            env.remove(*k);
            changed = true;
        }
    }
    if changed && env.is_empty() {
        obj.remove("env");
    }
    changed
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn values_are_below_documented_defaults() {
        for (k, val, def) in BUDGET {
            assert!(val.parse::<u32>().unwrap() < def.parse::<u32>().unwrap(), "{k}");
        }
    }

    #[test]
    fn sets_when_absent_and_keeps_other_keys() {
        let mut v = json!({"effortLevel":"medium","env":{"X":"1"}});
        kit_default(&mut v).unwrap();
        assert_eq!(v["env"]["BASH_MAX_OUTPUT_LENGTH"], "20000");
        assert_eq!(v["env"]["CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS"], "15000");
        assert_eq!(v["env"]["X"], "1");
        assert_eq!(v["effortLevel"], "medium");
    }

    #[test]
    fn owner_value_is_kept_and_not_removed() {
        let mut v = json!({"env":{"BASH_MAX_OUTPUT_LENGTH":"100000","CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS":50000}});
        let before = v.clone();
        kit_default(&mut v).unwrap();
        assert_eq!(v, before);
        assert!(!strip_kit_default(&mut v));
        assert_eq!(v, before);
    }

    #[test]
    fn remove_only_values_still_equal_to_kit_default() {
        let mut v = json!({"env":{"BASH_MAX_OUTPUT_LENGTH":"20000","CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS":"9000","X":"1"}});
        assert!(strip_kit_default(&mut v));
        assert_eq!(v, json!({"env":{"CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS":"9000","X":"1"}}));
        // all kit values -> empty env removed too
        let mut w = json!({});
        kit_default(&mut w).unwrap();
        assert!(strip_kit_default(&mut w));
        assert_eq!(w, json!({}));
        assert!(!strip_kit_default(&mut w));
    }

    #[test]
    fn idempotent() {
        let mut v = json!({});
        kit_default(&mut v).unwrap();
        let once = v.clone();
        kit_default(&mut v).unwrap();
        assert_eq!(v, once);
    }

    #[test]
    fn non_object_is_an_error_and_remove_is_a_noop() {
        let mut v = json!([1]);
        assert!(kit_default(&mut v).is_err());
        assert!(!strip_kit_default(&mut v));
        let mut e = json!({"env":"nope"});
        assert!(!strip_kit_default(&mut e));
    }
}
