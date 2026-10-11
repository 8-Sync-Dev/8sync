//! `8sync ccc hook guard` — Claude Code PreToolUse guard for Bash / Edit / Write.
//!
//! Denies, with the reason handed back to Claude:
//! - writing a credential file (`.env*` except templates, keys, `*.session`, `*.pkl`);
//! - content or a command carrying a real-looking secret (Anthropic, OpenAI,
//!   GitHub, AWS, Slack, Google, private keys); fixtures and doc examples pass;
//! - `git add` of a credential file, named or swept up by `git add -A` / `.`;
//! - code wiring a Claude subscription into another client (Claude Code's
//!   OAuth client id or its OAuth beta header): AUP "Do Not Abuse Our Platform".
//!
//! Pure string scanning in-process; only `git add -A` spawns `git status`.
use std::path::Path;
use std::process::{Command, Stdio};

use serde_json::{json, Value};

/// The hook's stdout for a PreToolUse input: a deny decision, or `None` to allow.
pub(super) fn check(input: &str) -> Option<String> {
    let v: Value = serde_json::from_str(input).ok()?;
    let tool = v["tool_name"].as_str().unwrap_or_default();
    let ti = &v["tool_input"];
    let reason = match tool {
        "Bash" => {
            let cmd = ti["command"].as_str().unwrap_or_default();
            let cwd = v["cwd"].as_str().map(Path::new);
            git_add(cmd, cwd).or_else(|| content(cmd))
        }
        "Edit" | "Write" | "MultiEdit" | "NotebookEdit" => {
            let path = ti["file_path"].as_str().or_else(|| ti["notebook_path"].as_str()).unwrap_or_default();
            credential_file(path)
                .map(|why| format!("{path} is a credential file ({why}). The user creates it themselves and keeps it out of git; read values from the environment instead."))
                .or_else(|| content(&written_text(ti)))
        }
        _ => None,
    }?;
    Some(
        json!({
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "deny",
                "permissionDecisionReason": format!("8sync guard: {reason}")
            }
        })
        .to_string(),
    )
}

/// All text an edit tool would write.
fn written_text(ti: &Value) -> String {
    let mut s = String::new();
    for key in ["content", "new_string", "new_source"] {
        if let Some(t) = ti[key].as_str() {
            s.push_str(t);
            s.push('\n');
        }
    }
    for e in ti["edits"].as_array().into_iter().flatten() {
        if let Some(t) = e["new_string"].as_str() {
            s.push_str(t);
            s.push('\n');
        }
    }
    s
}

/// Why `path` is a credential file, if it is one. Separators of either kind.
pub(super) fn credential_file(path: &str) -> Option<&'static str> {
    let name = path.rsplit(['/', '\\']).next().unwrap_or(path).to_ascii_lowercase();
    if name == ".env" || (name.starts_with(".env.") && ![".example", ".sample", ".template", ".dist"].iter().any(|t| name.ends_with(t))) {
        return Some("dotenv");
    }
    if ["id_rsa", "id_ed25519", "id_ecdsa", "id_dsa"].iter().any(|k| name.starts_with(k)) && !name.ends_with(".pub") {
        return Some("SSH private key");
    }
    let ext = name.rsplit_once('.').map(|(_, e)| e).unwrap_or_default();
    match ext {
        "pem" | "p12" | "pfx" => Some("private key / certificate"),
        "session" | "session-journal" => Some("logged-in session"),
        "pkl" => Some("serialized credentials (*.pkl)"),
        _ => None,
    }
}

/// A secret or a subscription-routing marker inside `text`.
fn content(text: &str) -> Option<String> {
    if let Some(kind) = secret(text) {
        return Some(format!(
            "this would write a real {kind}. Load it from an environment variable or a secret manager; \
             if it already leaked, tell the user to rotate it."
        ));
    }
    // Spelled in pieces so this file never trips its own guard.
    let markers = [concat!("9d1c250a", "-e61b-44d9-88ed-5944d1962f5e"), concat!("oauth-2025", "-04-20"), concat!("claude-code-2025", "0219")];
    if markers.iter().any(|m| text.contains(m)) {
        return Some(
            "this wires a Claude subscription (Claude Code's OAuth client) into other software. \
             Anthropic's Usage Policy (Do Not Abuse Our Platform) and 8sync rules: subscription logins stay \
             in Claude Code / claude.ai; other tools use a Console API key (ANTHROPIC_API_KEY)."
                .into(),
        );
    }
    None
}

/// Prefix, minimum body length, body charset — real keys only (fixtures are shorter).
const SECRETS: [(&str, usize, &str); 9] = [
    ("sk-ant-", 40, "Anthropic key"),
    ("sk-proj-", 40, "OpenAI key"),
    ("github_pat_", 50, "GitHub token"),
    ("ghp_", 36, "GitHub token"),
    ("gho_", 36, "GitHub token"),
    ("ghs_", 36, "GitHub token"),
    ("xoxb-", 30, "Slack token"),
    ("xoxp-", 30, "Slack token"),
    ("AIza", 35, "Google API key"),
];

fn secret(text: &str) -> Option<&'static str> {
    for (prefix, min, kind) in SECRETS {
        for (i, _) in text.match_indices(prefix) {
            if i > 0 && text.as_bytes()[i - 1].is_ascii_alphanumeric() {
                continue;
            }
            let body: String = text[i + prefix.len()..]
                .chars()
                .take_while(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
                .collect();
            if body.len() >= min && looks_random(&body) {
                return Some(kind);
            }
        }
    }
    for (i, _) in text.match_indices("AKIA") {
        let body = &text.as_bytes()[i + 4..];
        let key: Vec<u8> = body.iter().take(16).copied().collect();
        let boundary = body.get(16).is_none_or(|b| !b.is_ascii_alphanumeric());
        if key.len() == 16 && boundary && key.iter().all(|b| b.is_ascii_uppercase() || b.is_ascii_digit()) && looks_random(std::str::from_utf8(&key).unwrap_or_default()) {
            return Some("AWS access key");
        }
    }
    if text.contains(concat!("-----", "BEGIN")) && text.contains(concat!("PRIVATE KEY", "-----")) {
        return Some("private key");
    }
    None
}

/// Rules out placeholders: `xxxx`, `EXAMPLE`, repeated runs, too few distinct characters.
fn looks_random(body: &str) -> bool {
    let lower = body.to_ascii_lowercase();
    if ["example", "xxxx", "dummy", "fake", "placeholder", "redacted", "your", "0000", "1234"].iter().any(|p| lower.contains(p)) {
        return false;
    }
    let mut seen = [false; 128];
    body.bytes().filter(|b| *b < 128).for_each(|b| seen[b as usize] = true);
    seen.iter().filter(|s| **s).count() >= 12
}

/// `git add` that would stage a credential file.
fn git_add(cmd: &str, cwd: Option<&Path>) -> Option<String> {
    for seg in cmd.split(['&', '|', ';', '\n']) {
        let words: Vec<&str> = seg.split_whitespace().collect();
        let Some(at) = words.windows(2).position(|w| w[0] == "git" && w[1] == "add") else { continue };
        let args: Vec<&str> = words[at + 2..].iter().map(|a| a.trim_matches(['"', '\''])).collect();
        // `:!path` / `:^path` / `:(exclude)path` pathspecs keep a file out of the add.
        let excluded: Vec<&str> = args
            .iter()
            .filter_map(|a| a.strip_prefix(":!").or_else(|| a.strip_prefix(":^")).or_else(|| a.strip_prefix(":(exclude)")))
            .map(|e| e.trim_start_matches("./"))
            .collect();
        if let Some(f) = args.iter().find(|a| !a.starts_with(':') && credential_file(a).is_some()) {
            return Some(format!("`git add {f}` stages a credential file. Add it to .gitignore instead."));
        }
        if args.iter().any(|a| matches!(*a, "-A" | "--all" | "." | ":/" | "*")) {
            let bad: Vec<String> = pending_credentials(cwd?)
                .into_iter()
                .filter(|p| !excluded.iter().any(|e| p == e || p.ends_with(&format!("/{e}"))))
                .collect();
            if !bad.is_empty() {
                return Some(format!(
                    "`git add -A`/`.` would stage credential file(s): {}. Add them to .gitignore (or stage paths explicitly), then retry.",
                    bad.join(", ")
                ));
            }
        }
    }
    None
}

/// Untracked or modified, not ignored, credential files under `cwd`'s repo.
fn pending_credentials(cwd: &Path) -> Vec<String> {
    let Ok(out) = Command::new("git")
        .args(["status", "--porcelain", "-z", "--untracked-files=all"])
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
    else {
        return Vec::new();
    };
    String::from_utf8_lossy(&out.stdout)
        .split('\0')
        .filter_map(|e| e.get(3..))
        .filter(|p| credential_file(p).is_some())
        .take(5)
        .map(str::to_string)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn decide(tool: &str, input: Value) -> Option<String> {
        check(&json!({ "tool_name": tool, "tool_input": input, "cwd": "." }).to_string())
    }

    #[test]
    fn credential_files_are_denied_with_either_separator_and_templates_pass() {
        for p in [r"C:\app\.env", "/app/.env.staging", "./.env.local", "keys/server.pem", "C:/x/tg/main.session", "data/accounts.pkl", "/home/u/.ssh/id_ed25519"] {
            assert!(decide("Write", json!({ "file_path": p, "content": "A=1" })).is_some(), "{p} must be denied");
        }
        for p in ["/app/.env.example", r"C:\app\.env.template", "src/env.rs", "/home/u/.ssh/id_ed25519.pub", "docs/session.md"] {
            assert!(decide("Write", json!({ "file_path": p, "content": "A=1" })).is_none(), "{p} must pass");
        }
    }

    #[test]
    fn real_secrets_are_denied_but_fixtures_and_doc_examples_pass() {
        let aws = concat!("aws_access_key_id = AKIA", "Q7R2ZK5MNPW3XTYV");
        assert!(decide("Write", json!({ "file_path": "cfg.toml", "content": aws })).is_some());
        let pk = concat!("-----", "BEGIN OPENSSH PRIVATE KEY", "-----\nb3BlbnNzaC1rZXktdjEAAAAA\n-----END OPENSSH PRIVATE KEY", "-----");
        assert!(decide("Write", json!({ "file_path": "k.txt", "content": pk })).is_some());
        let real = format!("const K: &str = \"sk-ant-api03-{}\";", "Zq8vR2xLk9pW4mN7tB1cY6hJ3sD5fG0aQe-_uIoPzXcVbNm".repeat(2));
        assert!(decide("Edit", json!({ "file_path": "src/a.rs", "new_string": real })).is_some());
        assert!(decide("Bash", json!({ "command": format!("export ANTHROPIC_API_KEY=sk-ant-api03-{}", "Zq8vR2xLk9pW4mN7tB1cY6hJ3sD5fG0aQe") }) ).is_some());
        // The repo's own redaction test, AWS's documented example key, placeholders.
        for ok in [
            "assert_eq!(mask(\"sk-ant-usr-0123456789abcdef\"), \"sk-ant-u...abcdef\");",
            "aws_access_key_id = AKIAIOSFODNN7EXAMPLE",
            "ANTHROPIC_API_KEY=sk-ant-api03-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
            "token = \"ghp_your-token-here-replace-me-before-running-it\"",
        ] {
            assert!(decide("Edit", json!({ "file_path": "src/a.rs", "new_string": ok })).is_none(), "{ok} must pass");
        }
    }

    #[test]
    fn git_add_of_a_named_credential_is_denied() {
        assert!(decide("Bash", json!({ "command": "git add .env && git commit -m x" })).is_some());
        assert!(decide("Bash", json!({ "command": "git add src/ .env.example" })).is_none());
        assert!(decide("Bash", json!({ "command": "echo add .env" })).is_none());
        assert!(decide("Bash", json!({ "command": "git add src/ ':!config/.env'" })).is_none(), "an exclusion is not an add");
    }

    #[test]
    fn git_add_all_is_denied_only_while_a_credential_file_is_pending() {
        let dir = std::env::temp_dir().join(format!("8sync-guard-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let git = |args: &[&str]| Command::new("git").args(args).current_dir(&dir).output().unwrap();
        git(&["init", "-q"]);
        std::fs::write(dir.join("main.rs"), "fn main() {}").unwrap();
        let input = |cmd: &str| json!({ "tool_name": "Bash", "tool_input": { "command": cmd }, "cwd": dir }).to_string();
        assert!(check(&input("git add -A")).is_none());
        std::fs::write(dir.join(".env"), "TOKEN=1").unwrap();
        assert!(check(&input("git add -A && git commit -m wip")).unwrap().contains(".env"));
        assert!(check(&input("git add -A -- . ':!.env'")).is_none(), "excluded by pathspec");
        std::fs::write(dir.join(".gitignore"), ".env\n").unwrap();
        assert!(check(&input("git add .")).is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn subscription_routing_markers_are_denied() {
        let code = format!("const CLIENT_ID: &str = \"{}\";", concat!("9d1c250a", "-e61b-44d9-88ed-5944d1962f5e"));
        assert!(decide("Write", json!({ "file_path": "src/proxy.ts", "content": code })).is_some());
        let header = format!("headers['anthropic-beta'] = '{}'", concat!("oauth-2025", "-04-20"));
        assert!(decide("Edit", json!({ "file_path": "src/proxy.ts", "new_string": header })).is_some());
    }

    #[test]
    fn other_tools_and_malformed_input_pass() {
        assert!(decide("Read", json!({ "file_path": "/app/.env" })).is_none());
        assert!(check("not json").is_none());
    }
}
