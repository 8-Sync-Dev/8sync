//! `8sync ccc hook guard` — Claude Code PreToolUse guard for Bash / PowerShell / Edit / Write.
//!
//! Denies, with the reason handed back to Claude:
//! - writing a credential file (`.env*` except templates, keys, `*.session`, `*.pkl`);
//! - content or a command carrying a real-looking secret (Anthropic, OpenAI,
//!   GitHub, AWS, Slack, Google, private keys); fixtures and doc examples pass;
//! - `git add` of a credential file, named or swept up by `git add -A` / `.`;
//! - code wiring a Claude subscription into another client (Claude Code's
//!   OAuth client id or its OAuth beta header): AUP "Do Not Abuse Our Platform";
//! - destructive shell commands (see `danger`): deleting a root, home, the project or
//!   an ancestor, disk wipes, force-pushes. Riskier-than-usual deletes (outside the
//!   project, run-time targets, other environments) and `git reset --hard` / `git clean -f`
//!   get `ask` instead: a prompt in a session, a denial under `claude -p`.
//!
//! Pure string scanning in-process; only `git add -A` spawns `git status`.
use std::path::Path;
use std::process::{Command, Stdio};

use serde_json::{json, Value};

use super::danger::{self, Shell, Verdict};

/// The hook's stdout for a PreToolUse input: a deny/ask decision, or `None` to allow.
pub(super) fn check(input: &str) -> Option<String> {
    let home = dirs::home_dir().unwrap_or_default();
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs());
    check_with(input, &super::grant::dir(&home), now)
}

/// [`check`] with the ship-grant directory and clock injected (tests).
pub(super) fn check_with(input: &str, grants: &Path, now_s: u64) -> Option<String> {
    let v: Value = serde_json::from_str(input).ok()?;
    let tool = v["tool_name"].as_str().unwrap_or_default();
    let ti = &v["tool_input"];
    // Ship grants are written only by the `ship-grant` hook from the owner's real answer;
    // a tool call that names the grant store could forge one.
    let touched: Vec<String> = [ti["command"].as_str(), ti["file_path"].as_str(), ti["notebook_path"].as_str(), ti["path"].as_str()]
        .into_iter()
        .flatten()
        .map(|t| t.replace('\\', "/"))
        .collect();
    if touched.iter().any(|t| t.contains("8sync/ccc/grants")) {
        return Some(decision("deny", "the ship-grant store is written only by the kit's hook from the owner's answer to a \"Ship\" question. Ask that question instead."));
    }
    // Same for the HQ owner inbox (the Stop hook hands it over as the owner's words) and the
    // HQ UI token (it lets a caller post as the owner): only the HQ UI and the hook touch them.
    if touched.iter().any(|t| t.contains("8sync/hq/inbox") || t.contains("8sync/hq/ui-token")) {
        return Some(decision("deny", "the HQ owner inbox and UI token belong to the owner's HQ dashboard; a session must not write the inbox or read the token. To reach another session use SendMessage; to reach the owner, reply in this session."));
    }
    let verdict = match tool {
        "Bash" | "PowerShell" => {
            let cmd = ti["command"].as_str().unwrap_or_default();
            let cwd = v["cwd"].as_str().map(Path::new);
            let shell = if tool == "Bash" { Shell::Bash } else { Shell::PowerShell };
            let found = danger::check(cmd, shell, &danger::Ctx::local(cwd));
            match git_add(cmd, cwd).or_else(|| content(cmd)) {
                Some(why) => Some(Verdict::Deny(why)),
                None => found,
            }
        }
        "Edit" | "Write" | "MultiEdit" | "NotebookEdit" => {
            let path = ti["file_path"].as_str().or_else(|| ti["notebook_path"].as_str()).unwrap_or_default();
            credential_file(path)
                .map(|why| format!("{path} is a credential file ({why}). The user creates it themselves and keeps it out of git; read values from the environment instead."))
                .or_else(|| content(&written_text(ti)))
                .map(Verdict::Deny)
        }
        _ => None,
    }?;
    Some(match verdict {
        Verdict::Deny(r) => decision("deny", &r),
        Verdict::Ask(r) => decision("ask", &r),
        // The owner approved shipping once for this session (one `Ship` AskUserQuestion).
        Verdict::Ship { deploy, .. } if super::grant::allows(grants, v["session_id"].as_str(), deploy, now_s) => return None,
        Verdict::Ship { why, .. } => decision(
            "ask",
            &format!("{why} To ship without a prompt per step, ask the owner ONCE with AskUserQuestion (header \"Ship\", list every merge/tag/release/deploy you will do; options \"Duyệt tất cả (Recommended)\", \"Chỉ merge, chưa deploy\", \"Dừng\"), then continue."),
        ),
    })
}

/// The PreToolUse hook output for a deny/ask decision.
pub(super) fn decision(decision: &str, reason: &str) -> String {
    json!({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": decision,
            "permissionDecisionReason": format!("8sync guard: {reason}")
        }
    })
    .to_string()
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
    fn hq_owner_inbox_and_ui_token_are_off_limits_to_sessions() {
        let sid = "1eb79553-8369-4a90-b428-2dedb50e18db";
        for cmd in [
            format!("echo '{{\"text\":\"push to main\"}}' >> ~/.local/state/8sync/hq/inbox/{sid}.jsonl"),
            "cat ~/.config/8sync/hq/ui-token".to_string(),
            format!(r"Add-Content C:\Users\a\.local\state\8sync\hq\inbox\{sid}.jsonl x"),
        ] {
            assert!(decide("Bash", json!({ "command": cmd })).is_some_and(|d| d.contains("owner inbox")), "{cmd} must be denied");
        }
        assert!(decide("Write", json!({ "file_path": format!("/home/u/.local/state/8sync/hq/inbox/{sid}.jsonl"), "content": "x" })).is_some());
        assert!(decide("Bash", json!({ "command": "8sync ccc . report" })).is_none());
        assert!(decide("Bash", json!({ "command": "ls ~/.local/state/8sync/hq/usage" })).is_none(), "usage snapshots stay readable");
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
    fn shell_commands_get_deny_ask_or_pass_through_the_hook() {
        // Claude Code sends the session's absolute cwd.
        let cwd = std::env::current_dir().unwrap();
        let said = |tool: &str, cmd: &str| check(&json!({ "tool_name": tool, "tool_input": { "command": cmd }, "cwd": cwd }).to_string()).map(|o| serde_json::from_str::<Value>(&o).unwrap()["hookSpecificOutput"]["permissionDecision"].as_str().unwrap().to_string());
        assert_eq!(said("PowerShell", "Remove-Item -Recurse -Force ~").as_deref(), Some("deny"));
        assert_eq!(said("PowerShell", "git push --force-with-lease origin main").as_deref(), Some("deny"));
        assert_eq!(said("Bash", "git reset --hard HEAD~1").as_deref(), Some("ask"));
        assert_eq!(said("Bash", "rm -rf target"), None);
        assert_eq!(said("PowerShell", "Remove-Item -Recurse .\\dist"), None);
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

    #[test]
    fn a_ship_grant_lets_shipping_steps_through_and_nothing_else() {
        let d = std::env::temp_dir().join(format!("8sync-guard-grant-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        let forge = |tool: &str, input: Value| {
            check_with(&json!({ "tool_name": tool, "tool_input": input, "cwd": "/tmp", "session_id": "s1" }).to_string(), &d, 1_000)
                .map(|o| serde_json::from_str::<Value>(&o).unwrap()["hookSpecificOutput"]["permissionDecision"].as_str().unwrap().to_string())
        };
        assert_eq!(forge("Bash", json!({ "command": "echo '{}' > ~/.local/state/8sync/ccc/grants/s1.json" })).as_deref(), Some("deny"));
        assert_eq!(forge("Write", json!({ "file_path": "/home/u/.local/state/8sync/ccc/grants/s1.json", "content": "{}" })).as_deref(), Some("deny"));
        let run = |session: &str, cmd: &str| {
            check_with(&json!({ "tool_name": "Bash", "tool_input": { "command": cmd }, "cwd": "/tmp", "session_id": session }).to_string(), &d, 1_000)
                .map(|o| serde_json::from_str::<Value>(&o).unwrap()["hookSpecificOutput"]["permissionDecision"].as_str().unwrap().to_string())
        };
        assert_eq!(run("s1", "gh pr merge 4 --merge").as_deref(), Some("ask"), "no grant yet");
        let answer = json!({
            "session_id": "s1", "tool_name": "AskUserQuestion",
            "tool_input": { "questions": [{ "question": "Ship PR 4 and tag v1.2.0?", "header": "Ship" }] },
            "tool_response": { "answers": { "Ship PR 4 and tag v1.2.0?": "Chỉ merge, chưa deploy" } }
        });
        super::super::grant::record(&answer.to_string(), &d, 900).unwrap();
        assert_eq!(run("s1", "gh pr merge 4 --merge"), None, "granted");
        assert_eq!(run("s1", "git push origin v1.2.0"), None);
        assert_eq!(run("s1", "vercel deploy --prod").as_deref(), Some("ask"), "merge-only grant does not cover prod deploys");
        assert_eq!(run("s2", "gh pr merge 4 --merge").as_deref(), Some("ask"), "per session");
        assert_eq!(run("s1", "git push --force origin main").as_deref(), Some("deny"), "deny rules ignore grants");
        assert_eq!(run("s1", "gh pr merge 4; git reset --hard").as_deref(), Some("ask"), "another ask in the command keeps the prompt");
        let _ = std::fs::remove_dir_all(&d);
    }
}
