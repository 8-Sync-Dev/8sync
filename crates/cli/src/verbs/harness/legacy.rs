//! One-time cutover from the retired STEP-0 stack (codegraph, codebase-memory-mcp, serena) to trail.
//!
//! Everything here is idempotent and quiet when there is nothing to do, and removes ONLY what
//! 8sync itself wrote: an MCP entry with the exact launcher 8sync registered, a skill folder
//! byte-identical to the bundled copy, an interceptor message equal to the old default. Anything
//! the owner changed is left alone. Files that change are backed up once as `*.bak-trail`.
//! Delete this module (and the names kept for one release in `ccc/pressure.rs` and
//! `watchdog.rs`) once every machine has passed through a release carrying it.
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use crate::verbs::skill::deploy;
use crate::{assets, ui};

const CBM: &str = "codebase-memory-mcp";
const SERENA: &str = "serena";
/// The exact uvx launcher 8sync registered for serena.
const SERENA_UVX: [&str; 8] =
    ["--from", "git+https://github.com/oraios/serena", "serena", "start-mcp-server", "--context", "claude-code", "--enable-web-dashboard", "False"];

/// Pure: true when an MCP entry launches exactly `cmd args` (other keys such as
/// `type`/`alwaysLoad`/`env` are ignored; a missing `args` equals `[]`).
fn same_launcher(e: &Value, cmd: &str, args: &[&str]) -> bool {
    e["command"] == cmd
        && match e.get("args") {
            None | Some(Value::Null) => args.is_empty(),
            Some(a) => a.as_array().is_some_and(|a| a.len() == args.len() && a.iter().zip(args).all(|(x, y)| x == *y)),
        }
}

fn managed(name: &str, e: &Value) -> bool {
    match name {
        CBM => same_launcher(e, CBM, &[]),
        SERENA => same_launcher(e, "uvx", &SERENA_UVX),
        _ => false,
    }
}

/// Pure: names of the 8sync-written retired entries in a parsed `mcpServers` owner (omp's
/// `mcp.json` or `~/.claude.json`). Another launcher under the same name is the owner's: not listed.
fn managed_entries(root: &Value) -> Vec<&'static str> {
    [CBM, SERENA].into_iter().filter(|n| root["mcpServers"].get(*n).is_some_and(|e| managed(n, e))).collect()
}

/// Pure: drop the managed retired entries from omp's `mcp.json` value. Returns the names removed.
fn strip_mcp_entries(root: &mut Value) -> Vec<&'static str> {
    let names = managed_entries(root);
    if let Some(m) = root.get_mut("mcpServers").and_then(Value::as_object_mut) {
        for n in &names {
            m.remove(*n);
        }
    }
    names
}

/// Pure: drop `permissions.allow` rules that name a retired tool. Returns how many went.
fn strip_allow_rules(settings: &mut Value) -> usize {
    let Some(allow) = settings.get_mut("permissions").and_then(|p| p.get_mut("allow")).and_then(Value::as_array_mut) else { return 0 };
    let before = allow.len();
    allow.retain(|r| !r.as_str().is_some_and(|s| s.starts_with("mcp__codebase_memory_mcp") || s.starts_with("mcp__serena")));
    before - allow.len()
}

/// 8sync's config dirs for `home`: `<home>/.config/8sync`, plus the platform config dir
/// (`%APPDATA%\8sync` on Windows, where `setup` writes) only when `home` is the real home.
pub(crate) fn config_dirs(home: &Path) -> Vec<PathBuf> {
    let mut v = vec![crate::brand::config_dir(home)];
    if dirs::home_dir().as_deref() == Some(home) {
        if let Some(d) = dirs::config_dir().map(|d| d.join(crate::brand::NS)) {
            if !v.contains(&d) {
                v.push(d);
            }
        }
    }
    v
}

fn backup_once(path: &Path) {
    let mut b = path.as_os_str().to_owned();
    b.push(".bak-trail");
    let b = PathBuf::from(b);
    if !b.exists() {
        let _ = std::fs::copy(path, b);
    }
}

fn read_json(p: &Path) -> Option<Value> {
    serde_json::from_str(&std::fs::read_to_string(p).ok()?).ok()
}

fn claude_dir(home: &Path) -> PathBuf {
    std::env::var_os("CLAUDE_CONFIG_DIR").map(PathBuf::from).unwrap_or_else(|| home.join(".claude"))
}

/// Remove the retired MCP servers 8sync registered (omp `mcp.json`, Claude Code user scope) and
/// the allow rules for their tools. Call from `harness global` and the Claude Code kit install.
pub(crate) fn retire_mcp(home: &Path) {
    // omp: ~/.omp/agent/mcp.json
    let omp = home.join(".omp/agent/mcp.json");
    if let Some(mut v) = read_json(&omp) {
        let gone = strip_mcp_entries(&mut v);
        if !gone.is_empty() {
            backup_once(&omp);
            match serde_json::to_string_pretty(&v).map(|s| std::fs::write(&omp, s)) {
                Ok(Ok(())) => ui::ok(&format!("retired {} from {} (backup .bak-trail)", gone.join(" + "), omp.display())),
                _ => ui::warn(&format!("could not rewrite {}", omp.display())),
            }
        }
    }
    // Claude Code user scope: let `claude` rewrite its own file.
    let cj = match std::env::var_os("CLAUDE_CONFIG_DIR") {
        Some(d) => PathBuf::from(d).join(".claude.json"),
        None => home.join(".claude.json"),
    };
    if let Some(v) = read_json(&cj) {
        let names = managed_entries(&v);
        if !names.is_empty() {
            match which::which("claude") {
                Ok(claude) => {
                    backup_once(&cj);
                    for n in names {
                        let ok = Command::new(&claude).args(["mcp", "remove", n, "-s", "user"]).stdin(Stdio::null()).output().is_ok_and(|o| o.status.success());
                        if ok {
                            ui::ok(&format!("retired {n} from Claude Code user scope (backup .bak-trail)"));
                        } else {
                            ui::warn(&format!("`claude mcp remove {n} -s user` failed — remove it by hand"));
                        }
                    }
                }
                Err(_) => ui::info("retired MCP entries remain in ~/.claude.json and `claude` is not on PATH — `claude mcp remove <name> -s user` later"),
            }
        }
    }
    // Allow rules in Claude Code's user settings.
    let st = claude_dir(home).join("settings.json");
    if let Some(mut v) = read_json(&st) {
        if strip_allow_rules(&mut v) > 0 {
            backup_once(&st);
            match serde_json::to_string_pretty(&v).map(|s| std::fs::write(&st, s + "\n")) {
                Ok(Ok(())) => ui::ok(&format!("retired mcp__codebase_memory_mcp*/mcp__serena* allow rules from {}", st.display())),
                _ => ui::warn(&format!("could not rewrite {}", st.display())),
            }
        }
    }
}

// ── retired skills ─────────────────────────────────────────────────────────────────────────

/// (skill, [(relative file, LF-normalised FNV-1a 64, `deploy::fnv1a64`)]) of the copies 8sync bundled
/// up to v0.110.79. A folder is "ours" only when every file is listed here with the same hash.
const RETIRED_SKILLS: [(&str, &[(&str, u64)]); 2] = [
    (
        "codegraph",
        &[
            ("SKILL.md", 0x0fb0_0c65_40d9_ee64),
            ("references/cli-cheatsheet.md", 0x1981_20ee_dc15_0882),
            ("scripts/index-fresh.sh", 0xec21_eed7_33ad_2002),
            ("scripts/refresh.sh", 0x96c2_6fe2_3caa_2021),
        ],
    ),
    ("token-bench", &[("SKILL.md", 0x5cac_bc52_fe89_3ebd), ("scripts/token_bench.py", 0x2d39_4d08_0b3d_7d03)]),
];

/// The skill's `skills.toml` registration, written by `setup`/`ensure_codegraph`.
fn registry_src(name: &str) -> String {
    format!("builtin:{name}")
}

/// True when `dir` holds exactly the bundled files (hash-equal, CRLF-insensitive) plus empty
/// `scripts/` / `references/` folders — i.e. nothing the owner added or edited.
fn is_bundled_copy(dir: &Path, files: &[(&str, u64)]) -> bool {
    fn walk(dir: &Path, base: &Path, out: &mut Vec<(String, PathBuf)>) -> bool {
        let Ok(rd) = std::fs::read_dir(dir) else { return false };
        for e in rd.flatten() {
            let p = e.path();
            let Ok(t) = e.file_type() else { return false };
            if t.is_dir() {
                if !walk(&p, base, out) {
                    return false;
                }
            } else if t.is_file() {
                let rel = p.strip_prefix(base).unwrap_or(&p).to_string_lossy().replace('\\', "/");
                out.push((rel, p));
            } else {
                return false;
            }
        }
        true
    }
    let mut found = Vec::new();
    if !walk(dir, dir, &mut found) || found.len() != files.len() {
        return false;
    }
    found.iter().all(|(rel, p)| {
        let Some((_, want)) = files.iter().find(|(f, _)| f == rel) else { return false };
        std::fs::read(p).is_ok_and(|b| deploy::fnv1a64(&String::from_utf8_lossy(&b).replace("\r\n", "\n").into_bytes()) == *want)
    })
}

/// Pure: `text` without the `[name]` table when its body is only the `src`/`when` pair 8sync wrote
/// (`src = "builtin:<name>"`). None when absent or the owner changed it.
fn strip_registry_section(text: &str, name: &str) -> Option<String> {
    let header = format!("[{name}]");
    let lines: Vec<&str> = text.split_inclusive('\n').collect();
    let start = lines.iter().position(|l| l.trim() == header)?;
    let end = lines[start + 1..].iter().position(|l| l.trim_start().starts_with('[')).map_or(lines.len(), |i| start + 1 + i);
    let body: Vec<&str> = lines[start + 1..end].iter().map(|l| l.trim()).filter(|l| !l.is_empty()).collect();
    let src_ok = |l: &&str| l.split_once('=').is_some_and(|(k, v)| k.trim() == "src" && v.trim().trim_matches('"') == registry_src(name));
    let when_ok = |l: &&str| l.split_once('=').is_some_and(|(k, v)| k.trim() == "when" && v.trim().trim_matches('"') == "always");
    if body.is_empty() || !body.iter().all(|l| src_ok(l) || when_ok(l)) {
        return None;
    }
    let mut out = lines[..start].concat();
    if end == lines.len() {
        while out.ends_with("\n\n") {
            out.pop();
        }
    } else {
        out.push_str(&lines[end..].concat());
    }
    Some(out)
}

/// Retire the `codegraph` and `token-bench` skills: the global copy, the Claude Code link/copy, the
/// `skills.toml` registration and (with `root`) the per-project mirror — each only when it is
/// 8sync's own, unedited copy.
pub(crate) fn retire_skills(home: &Path, root: Option<&Path>) {
    for (name, files) in RETIRED_SKILLS {
        let mut places = vec![("~/.omp/skills", home.join(".omp/skills").join(name)), ("~/.claude/skills", claude_dir(home).join("skills").join(name))];
        if let Some(r) = root {
            places.push(("su-code/skills", r.join("su-code/skills").join(name)));
        }
        for (label, p) in places {
            let Ok(meta) = std::fs::symlink_metadata(&p) else { continue };
            // A link into a global copy we are keeping would be re-made by the next kit install.
            if label == "~/.claude/skills" && deploy::is_link(&meta) && home.join(".omp/skills").join(name).exists() {
                continue;
            }
            // A link was made by 8sync (`link_bundled_skills`); the folder it pointed at is judged on its own.
            let ours = deploy::is_link(&meta) || is_bundled_copy(&p, files);
            if !ours {
                ui::info(&format!("retired skill `{name}` left in {label}/: not the bundled copy (edited or from an older release) — delete it by hand"));
                continue;
            }
            match deploy::remove_link_or_dir(&p) {
                Ok(()) => ui::ok(&format!("retired skill `{name}` from {label}/")),
                Err(e) => ui::warn(&format!("could not remove {}: {e}", p.display())),
            }
        }
    }
    for reg in config_dirs(home).into_iter().map(|d| d.join("skills.toml")) {
        let Ok(mut text) = std::fs::read_to_string(&reg) else { continue };
        let mut changed = false;
        for (name, _) in RETIRED_SKILLS {
            if let Some(t) = strip_registry_section(&text, name) {
                text = t;
                changed = true;
            }
        }
        if changed && std::fs::write(&reg, text).is_ok() {
            ui::ok(&format!("retired codegraph/token-bench from {}", reg.display()));
        }
    }
}

// ── interceptor messages ───────────────────────────────────────────────────────────────────

/// The three `bashInterceptor` messages 8sync shipped up to v0.110.79, in pattern order.
const OLD_INTERCEPTOR_MESSAGES: [&str; 3] = [
    "STEP-0: search code with `codegraph query \"<symbol>\"` (or `codegraph explore`) / mcp__codebase_memory_mcp_search_graph / mcp__serena_find_symbol — not rg/fd/ag/ack/git grep.",
    "STEP-0: recursive code search goes through `codegraph query \"<symbol>\"` / mcp__codebase_memory_mcp_search_graph. Single-file and log `grep` stay allowed.",
    "STEP-0: locate files with `codegraph query \"<name>\"` / mcp__codebase_memory_mcp_search_graph instead of find.",
];

/// Pure: `text` with every old default message replaced by the matching new one (same position).
/// Messages the owner edited do not match and stay. None when nothing changed.
fn refresh_messages(text: &str, new: &[String]) -> Option<String> {
    let mut out = text.to_string();
    for (old, new) in OLD_INTERCEPTOR_MESSAGES.iter().zip(new) {
        if new.contains('\'') {
            continue; // a TOML literal string cannot hold it
        }
        out = out.replace(&format!("message = '{old}'"), &format!("message = '{new}'"));
    }
    (out != text).then_some(out)
}

/// Bring the owner's copy of `~/.config/8sync/models.toml` onto the trail wording. Only the three
/// default `[[bashInterceptor.patterns]]` messages are replaced, byte-exact; the rest of the file
/// (roles, tasks, owner-edited rules) is untouched. `ensure_bash_interceptor` then re-renders
/// `~/.omp/agent/config.yml` from it.
pub(crate) fn refresh_interceptor_messages(home: &Path) {
    for dir in config_dirs(home) {
        refresh_models_file(&dir.join("models.toml"));
    }
}

fn refresh_models_file(p: &Path) {
    let Ok(text) = std::fs::read_to_string(p) else { return };
    let embedded = assets::read("configs/models.toml").and_then(|s| toml::from_str::<toml::Table>(&s).ok());
    let new: Vec<String> = embedded
        .and_then(|t| t.get("bashInterceptor")?.get("patterns")?.as_array().cloned())
        .map(|a| a.iter().filter_map(|r| r.get("message")?.as_str().map(String::from)).collect())
        .unwrap_or_default();
    if new.len() < OLD_INTERCEPTOR_MESSAGES.len() {
        return;
    }
    if let Some(t) = refresh_messages(&text, &new) {
        backup_once(p);
        if std::fs::write(p, t).is_ok() {
            ui::ok(&format!("STEP-0 interceptor messages → trail wording in {}", p.display()));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn only_the_launchers_8sync_wrote_are_retired() {
        let mut v = json!({"mcpServers": {
            "codebase-memory-mcp": {"type":"stdio","command":"codebase-memory-mcp","args":[]},
            "serena": {"type":"stdio","command":"uvx","args": SERENA_UVX, "alwaysLoad": false},
            "headroom": {"command":"headroom","args":["mcp","serve"]}}});
        assert_eq!(strip_mcp_entries(&mut v), [CBM, SERENA]);
        assert!(v["mcpServers"].get("headroom").is_some() && v["mcpServers"].get(CBM).is_none() && v["mcpServers"].get(SERENA).is_none());
        assert!(strip_mcp_entries(&mut v).is_empty(), "second run changes nothing");
        // the owner's own launcher under the same names stays
        let mut own = json!({"mcpServers": {"serena": {"command":"/opt/serena","args":[]}, "codebase-memory-mcp": {"command": CBM, "args": ["--repo","/x"]}}});
        assert!(strip_mcp_entries(&mut own).is_empty());
        assert_eq!(own["mcpServers"].as_object().unwrap().len(), 2);
        // no `args` key == `[]`
        assert_eq!(managed_entries(&json!({"mcpServers": {CBM: {"command": CBM}}})), [CBM]);
    }

    #[test]
    fn retired_allow_rules_go_and_others_stay() {
        let mut v = json!({"permissions": {"allow": ["Bash(git status)", "mcp__serena_find_symbol", "mcp__codebase_memory_mcp_*", "mcp__headroom_compress"], "deny": ["mcp__serena_x"]}});
        assert_eq!(strip_allow_rules(&mut v), 2);
        assert_eq!(v["permissions"]["allow"], json!(["Bash(git status)", "mcp__headroom_compress"]));
        assert_eq!(v["permissions"]["deny"], json!(["mcp__serena_x"]), "deny rules are not ours to touch");
        assert_eq!(strip_allow_rules(&mut v), 0);
        assert_eq!(strip_allow_rules(&mut json!({})), 0);
    }

    #[test]
    fn registry_sections_are_stripped_only_when_unchanged() {
        let t = "[karpathy-guidelines]\nsrc  = \"builtin:karpathy-guidelines\"\nwhen = \"always\"\n\n[codegraph]\nsrc  = \"builtin:codegraph\"\nwhen = \"always\"\n\n[token-bench]\nsrc = \"builtin:token-bench\"\n";
        let a = strip_registry_section(t, "codegraph").unwrap();
        assert_eq!(a, "[karpathy-guidelines]\nsrc  = \"builtin:karpathy-guidelines\"\nwhen = \"always\"\n\n[token-bench]\nsrc = \"builtin:token-bench\"\n");
        let b = strip_registry_section(&a, "token-bench").unwrap();
        assert_eq!(b, "[karpathy-guidelines]\nsrc  = \"builtin:karpathy-guidelines\"\nwhen = \"always\"\n");
        assert!(strip_registry_section(&b, "codegraph").is_none(), "absent");
        let edited = "[codegraph]\nsrc = \"path:/mine/codegraph\"\n";
        assert!(strip_registry_section(edited, "codegraph").is_none(), "owner's registration stays");
    }

    #[test]
    fn a_skill_folder_is_removed_only_when_it_is_the_bundled_copy() {
        let d = std::env::temp_dir().join(format!("8sync-legacy-skill-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        let sk = d.join("token-bench");
        std::fs::create_dir_all(sk.join("scripts")).unwrap();
        std::fs::create_dir_all(sk.join("references")).unwrap();
        let (_, files) = RETIRED_SKILLS[1];
        // a file with the wrong content is the owner's edit
        std::fs::write(sk.join("SKILL.md"), "edited").unwrap();
        std::fs::write(sk.join("scripts/token_bench.py"), "x").unwrap();
        assert!(!is_bundled_copy(&sk, files));
        // extra owner file → not ours either
        std::fs::write(sk.join("notes.md"), "mine").unwrap();
        assert!(!is_bundled_copy(&sk, files));
        // hashes: build a fixture whose bytes hash to the listed values is impossible, so pin the hashing rule instead
        let probe = [("a.txt", deploy::fnv1a64(b"x\ny\n"))];
        let p = d.join("probe");
        std::fs::create_dir_all(&p).unwrap();
        std::fs::write(p.join("a.txt"), "x\r\ny\r\n").unwrap();
        assert!(is_bundled_copy(&p, &probe), "CRLF checkout of the same bytes still counts");
        std::fs::write(p.join("a.txt"), "x\ny").unwrap();
        assert!(!is_bundled_copy(&p, &probe));
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn retire_mcp_rewrites_only_what_it_owns_and_backs_up_once() {
        if std::env::var_os("CLAUDE_CONFIG_DIR").is_some() {
            return; // would point at the real Claude Code config
        }
        let home = std::env::temp_dir().join(format!("8sync-legacy-mcp-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        std::fs::create_dir_all(home.join(".omp/agent")).unwrap();
        std::fs::create_dir_all(home.join(".claude")).unwrap();
        let mcp = home.join(".omp/agent/mcp.json");
        let before = json!({"mcpServers": {"codebase-memory-mcp": {"type":"stdio","command":CBM,"args":[]}, "serena": {"command":"/mine/serena","args":[]}, "headroom": {"command":"headroom"}}});
        std::fs::write(&mcp, before.to_string()).unwrap();
        let st = home.join(".claude/settings.json");
        std::fs::write(&st, json!({"permissions": {"allow": ["mcp__serena_find_symbol", "Bash(ls)"]}, "model": "x"}).to_string()).unwrap();
        retire_mcp(&home);
        let after = read_json(&mcp).unwrap();
        assert!(after["mcpServers"].get(CBM).is_none(), "managed entry gone");
        assert!(after["mcpServers"].get("serena").is_some() && after["mcpServers"].get("headroom").is_some(), "owner entries stay");
        assert_eq!(read_json(&home.join(".omp/agent/mcp.json.bak-trail")).unwrap(), before, "backup holds the original");
        let s = read_json(&st).unwrap();
        assert_eq!(s["permissions"]["allow"], json!(["Bash(ls)"]));
        assert_eq!(s["model"], "x");
        assert!(home.join(".claude/settings.json.bak-trail").exists());
        // second run: nothing to do, backup untouched
        retire_mcp(&home);
        assert_eq!(read_json(&home.join(".omp/agent/mcp.json.bak-trail")).unwrap(), before);
        assert_eq!(read_json(&mcp).unwrap(), after);
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn old_default_interceptor_messages_move_to_trail_and_edits_survive() {
        let new: Vec<String> = (1..=3).map(|i| format!("NEW{i}")).collect();
        let user = format!("[[bashInterceptor.patterns]]\nmessage = '{}'\n[[bashInterceptor.patterns]]\nmessage = 'my own'\n[[bashInterceptor.patterns]]\nmessage = '{}'\n", OLD_INTERCEPTOR_MESSAGES[0], OLD_INTERCEPTOR_MESSAGES[2]);
        let out = refresh_messages(&user, &new).unwrap();
        assert!(out.contains("message = 'NEW1'") && out.contains("message = 'my own'") && out.contains("message = 'NEW3'"));
        assert!(refresh_messages(&out, &new).is_none(), "idempotent");
        // the embedded defaults carry no old tool name, and are what the refresh installs
        let embedded = crate::models::ModelConfig::default().bash_interceptor;
        assert_eq!(embedded.patterns.len(), 3);
        for r in &embedded.patterns {
            assert!(r.message.contains("trail") && !r.message.contains('\''), "{}", r.message);
        }
    }
}
