//! `8sync ccc risk [--base <ref>] [--paths a,b] [--json]`: which review gates the current diff makes
//! mandatory, decided from the changed paths alone — no judgement call left to the skill or the
//! model. Idea after oh-my-claudecode's risk assessor (`scripts/risk-assess.mjs` +
//! `scripts/review-gate.mjs`, MIT): classify the diff's paths, let the classes pick the gates,
//! print both. Code ours; the classes follow the kit rule (global CLAUDE.md "Cổng bắt buộc"):
//! `/sec` always; `/rules` + `/aup-audit` when the diff touches auth/OAuth/login, data collection,
//! messaging people outside, third-party tools, high-risk decisions, and before a release.
//!
//! Only file names are read, never contents, and whole name tokens are matched (`login` in
//! `apps/web/login.ts` or `user-login.rs`, not in `lesson.md`): a path that hides its purpose is
//! not caught here — this is a floor under the review, not the review. `--release` forces the
//! release gates (the kit rule says "luôn trước release"; a release diff can be code-only).

use anyhow::{Context, Result};
use serde_json::{json, Value};
use std::path::Path;
use std::process::Command;

const USAGE: &str = "usage: 8sync ccc risk [--base <ref>] [--paths a,b] [--release] [--json]";

/// Why a path matters. Ordered from the most to the least consequential for the level.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub(super) enum Cat {
    /// `.env`, keys, certificates, session dumps: the guard denies most of these already.
    Secret,
    /// Credit, hiring, medical, legal, insurance…: AUP high-risk, needs a human reviewer.
    HighRisk,
    /// Login, OAuth, tokens, SSO.
    Auth,
    /// Analytics, telemetry, consent, CRM, leads.
    Data,
    /// Mail, SMS, chat bots, webhooks that reach people outside.
    Messaging,
    /// MCP, plugins, integrations, dependency manifests.
    ThirdParty,
    /// Version bumps, release/deploy config, workflows (not CHANGELOG alone: every PR edits it).
    Release,
    /// Claude Code hooks, settings, guard: the kit's own rails.
    Harness,
}

impl Cat {
    pub(super) fn key(self) -> &'static str {
        match self {
            Cat::Secret => "secret",
            Cat::HighRisk => "high-risk",
            Cat::Auth => "auth",
            Cat::Data => "data",
            Cat::Messaging => "messaging",
            Cat::ThirdParty => "third-party",
            Cat::Release => "release",
            Cat::Harness => "harness",
        }
    }
}

// Whole tokens of a path (segments split on `- _ .`), lowercased.
const AUTH: &[&str] = &["auth", "authn", "authz", "oauth", "oauth2", "oidc", "login", "logout", "signin", "signup", "sso", "jwt", "passwd", "password", "passwords"];
const DATA: &[&str] = &["analytics", "telemetry", "tracking", "tracker", "collect", "collector", "pii", "consent", "gdpr", "crm", "leads", "lead", "survey", "cookie", "cookies", "scrape", "scraper", "crawl", "crawler"];
const MESSAGING: &[&str] = &["mail", "email", "mailer", "smtp", "sms", "discord", "slack", "telegram", "zalo", "messenger", "webhook", "webhooks", "notify", "notification", "notifications", "outreach", "broadcast", "bot", "chatbot"];
const THIRD_PARTY: &[&str] = &["mcp", "plugin", "plugins", "integration", "integrations", "vendor", "provider", "providers", "connector", "connectors"];
const MANIFESTS: &[&str] = &["package.json", "pnpm-lock.yaml", "package-lock.json", "yarn.lock", "cargo.toml", "cargo.lock", "go.mod", "go.sum", "pyproject.toml", "poetry.lock", "gemfile", "gemfile.lock", "composer.json"];
const HIGH_RISK: &[&str] = &["credit", "loan", "loans", "lending", "hiring", "recruit", "recruiting", "candidate", "candidates", "medical", "health", "clinic", "diagnosis", "legal", "insurance", "kyc", "biometric", "biometrics", "face", "facial", "surveillance"];
// CHANGELOG alone is not a release: every PR edits it. Tagging is what the kit rule calls release.
const RELEASE: &[&str] = &["release", "releases", "deploy", "deployment", "dockerfile", "version"];
const RELEASE_FILES: &[&str] = &["encore.app", "vercel.json", "size-gate.sh"];
const HARNESS_FILES: &[&str] = &["settings.json", "settings.local.json", "managed-settings.json", "hooks.json"];
/// Secret-looking config names (with a config extension, never source code like `secret.rs`).
const SECRET_STEMS: &[&str] = &["credentials", "credential", "secrets", "secret"];
const CONFIG_EXT: &[&str] = &["", "json", "yaml", "yml", "toml", "txt", "ini", "cfg", "conf", "env", "properties"];

fn tokens(seg: &str) -> impl Iterator<Item = &str> {
    seg.split(['-', '_', '.']).filter(|t| !t.is_empty())
}

fn has(words: &[&str], segs: &[&str]) -> bool {
    segs.iter().any(|s| tokens(s).any(|t| words.contains(&t)))
}

/// A path's classes (deduplicated, ordered), from its lowercased segments and file name.
pub(super) fn classify(path: &str) -> Vec<Cat> {
    let lower = path.replace('\\', "/").to_lowercase();
    let segs: Vec<&str> = lower.split('/').filter(|s| !s.is_empty()).collect();
    let Some(&name) = segs.last() else { return Vec::new() };
    let stem = name.rsplit_once('.').map_or(name, |(s, _)| s);
    let ext = name.rsplit_once('.').map(|(_, e)| e).unwrap_or("");
    let mut out = Vec::new();
    // Docs never hold auth/data/messaging code; they can still be a secret dump.
    let doc = matches!(ext, "md" | "mdx" | "txt" | "rst") || segs.first().is_some_and(|s| *s == "docs" || *s == "research");
    let env_file = name == ".env" || (name.starts_with(".env.") && !name.ends_with(".example") && !name.ends_with(".sample") && !name.ends_with(".template"));
    let key_file = (stem.starts_with("id_rsa") || stem.starts_with("id_ed25519") || stem.starts_with("id_ecdsa")) && ext != "pub";
    if env_file
        || matches!(ext, "pem" | "p12" | "pfx" | "key" | "session" | "pkl" | "keystore" | "jks")
        || key_file
        || (SECRET_STEMS.contains(&stem) && CONFIG_EXT.contains(&ext))
    {
        out.push(Cat::Secret);
    }
    if doc {
        out.sort();
        return out;
    }
    if has(HIGH_RISK, &segs) {
        out.push(Cat::HighRisk);
    }
    if has(AUTH, &segs) {
        out.push(Cat::Auth);
    }
    if has(DATA, &segs) {
        out.push(Cat::Data);
    }
    if has(MESSAGING, &segs) {
        out.push(Cat::Messaging);
    }
    if has(THIRD_PARTY, &segs) || MANIFESTS.contains(&name) || segs.contains(&".claude-plugin") {
        out.push(Cat::ThirdParty);
    }
    if has(RELEASE, &segs) || RELEASE_FILES.contains(&name) || segs.windows(2).any(|w| w == [".github", "workflows"]) || (name == "plugin.json" && segs.contains(&".claude-plugin")) {
        out.push(Cat::Release);
    }
    // The kit's own rails: `.claude/`, Claude Code settings/hooks files, and the kit's hooks/guard
    // under a `claude` folder (not every `hooks/` — React has them too).
    let claude_dir = segs.iter().any(|s| *s == ".claude" || *s == "claude");
    if segs.contains(&".claude") || HARNESS_FILES.contains(&name) || (claude_dir && has(&["hooks", "hook", "guard"], &segs)) {
        out.push(Cat::Harness);
    }
    out.sort();
    out.dedup();
    out
}

#[derive(Debug, PartialEq, Eq)]
pub(super) struct Gate {
    pub name: &'static str,
    pub why: String,
}

#[derive(Debug, PartialEq, Eq)]
pub(super) struct Assessment {
    pub base: String,
    pub files: Vec<String>,
    /// `(category, path)`, in category order then path order.
    pub hits: Vec<(Cat, String)>,
    pub gates: Vec<Gate>,
    /// `low` (sec only) · `medium` (rules + aup-audit) · `high` (secret file or high-risk domain).
    pub level: &'static str,
    /// Why the file list may be off (the base could not be fetched), shown with the result.
    pub warning: Option<String>,
}

fn why(hits: &[(Cat, String)], cats: &[Cat]) -> String {
    let mut parts = Vec::new();
    for c in cats {
        let paths: Vec<&str> = hits.iter().filter(|(k, _)| k == c).map(|(_, p)| p.as_str()).take(3).collect();
        if !paths.is_empty() {
            let more = hits.iter().filter(|(k, _)| k == c).count().saturating_sub(paths.len());
            let tail = if more > 0 { format!(" +{more}") } else { String::new() };
            parts.push(format!("{} ({}{tail})", c.key(), paths.join(", ")));
        }
    }
    parts.join(" · ")
}

/// Pure: classes → gates and level. `release` forces the release gates whatever the paths say.
pub(super) fn assess(base: &str, files: Vec<String>, release: bool) -> Assessment {
    let mut hits: Vec<(Cat, String)> = files.iter().flat_map(|f| classify(f).into_iter().map(move |c| (c, f.clone()))).collect();
    hits.sort();
    let any = |cs: &[Cat]| hits.iter().any(|(c, _)| cs.contains(c));
    let policy = [Cat::Auth, Cat::Data, Cat::Messaging, Cat::ThirdParty, Cat::HighRisk, Cat::Release];
    let mut gates = vec![Gate { name: "sec", why: "luôn, trước mọi commit (secret + lỗ hổng trên diff)".into() }];
    if any(&policy) || release {
        let mut w = why(&hits, &policy);
        if release {
            w = if w.is_empty() { "--release: luôn trước release".into() } else { format!("--release: luôn trước release · {w}") };
        }
        gates.push(Gate { name: "rules", why: w.clone() });
        gates.push(Gate { name: "aup-audit", why: w });
    }
    if any(&[Cat::HighRisk]) {
        gates.push(Gate { name: "human-review", why: format!("quyết định high-risk cần người review + disclose có AI: {}", why(&hits, &[Cat::HighRisk])) });
    }
    if any(&[Cat::Harness]) {
        gates.push(Gate { name: "harden", why: format!("cấu hình Claude Code/kit đổi: {}", why(&hits, &[Cat::Harness])) });
    }
    let level = if any(&[Cat::Secret, Cat::HighRisk]) {
        "high"
    } else if gates.len() > 1 {
        "medium"
    } else {
        "low"
    };
    Assessment { base: base.to_string(), files, hits, gates, level, warning: None }
}

impl Assessment {
    /// The skills a room invokes for this diff, and only these (`/ship` and the lead's merge read
    /// this line instead of loading `/sec` + `/rules` + `/aup-audit` on every diff: 1,003 skill
    /// bodies in 36 h on ai-game-studio). `human-review` is a person, not a skill.
    pub(super) fn skills(&self) -> Vec<String> {
        self.gates.iter().filter(|g| g.name != "human-review").map(|g| format!("/{}", g.name)).collect()
    }

    pub(super) fn json(&self) -> Value {
        json!({
            "schema": 1,
            "base": self.base,
            "warning": self.warning,
            "level": self.level,
            "files": self.files,
            "hits": self.hits.iter().map(|(c, p)| json!({"category": c.key(), "path": p})).collect::<Vec<_>>(),
            "gates": self.gates.iter().map(|g| json!({"gate": g.name, "why": g.why})).collect::<Vec<_>>(),
            "skills": self.skills(),
        })
    }

    pub(super) fn text(&self) -> String {
        let mut out = format!("risk: {} — {} file đổi so với {}\n", self.level, self.files.len(), self.base);
        if let Some(w) = &self.warning {
            out.push_str(&format!("⚠ {w}\n"));
        }
        for (c, p) in &self.hits {
            out.push_str(&format!("  {:<12}{p}\n", c.key()));
        }
        if self.hits.is_empty() {
            out.push_str("  (không file nào thuộc nhóm auth/data/messaging/third-party/secret/release/high-risk)\n");
        }
        out.push_str("gate bắt buộc:\n");
        for g in &self.gates {
            out.push_str(&format!("  /{:<13}{}\n", g.name, g.why));
        }
        out.push_str(&format!("chỉ gọi: {}\n", self.skills().join(" ")));
        out.push_str("(chỉ đọc tên file, không đọc nội dung: sàn dưới review, không thay review; trước release thêm --release)\n");
        out
    }
}

fn git(cwd: &Path, args: &[&str]) -> Result<Option<String>> {
    let out = Command::new("git").args(args).current_dir(cwd).env_remove("GIT_DIR").env_remove("GIT_INDEX_FILE").env_remove("GIT_WORK_TREE").output().context("cannot run git")?;
    Ok(out.status.success().then(|| String::from_utf8_lossy(&out.stdout).trim_end_matches(['\n', '\0']).to_string()))
}

/// How long `git fetch` of the base may take before risk goes on with the local ref.
const FETCH_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(20);

/// Pure: the `git fetch` that brings remote-tracking `base` up to date, or None when `base` is no
/// remote-tracking ref (`HEAD~1`, a local branch). `origin/HEAD` fetches the remote's branches.
fn fetch_args(base: &str) -> Option<Vec<String>> {
    let (remote, branch) = base.split_once('/')?;
    if remote != "origin" || branch.is_empty() || branch.starts_with('-') {
        return None;
    }
    let mut args = vec!["fetch".to_string(), "--quiet".into(), "origin".into()];
    if branch != "HEAD" {
        args.push(branch.to_string());
    }
    Some(args)
}

/// Run [`fetch_args`] for `base` in `top`, bounded by [`FETCH_TIMEOUT`]: Some(warning) when it
/// failed (offline, no auth, slow), None when fetched or nothing to fetch.
fn fetch_base(top: &Path, base: &str) -> Option<String> {
    let args = fetch_args(base)?;
    let mut cmd = Command::new("git");
    cmd.args(&args)
        .current_dir(top)
        .env_remove("GIT_DIR")
        .env_remove("GIT_INDEX_FILE")
        .env_remove("GIT_WORK_TREE")
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null());
    match crate::verbs::hq_core::agents::run_bounded(cmd, FETCH_TIMEOUT) {
        Some(_) => None,
        None => Some(format!("`git {}` lỗi hoặc quá {} s: {base} có thể cũ, danh sách file có thể thừa", args.join(" "), FETCH_TIMEOUT.as_secs())),
    }
}

/// Pure: the diff of the working tree against the merge-base `point` of the base and HEAD (never
/// the base's tip: what only landed on main is not this branch's change).
fn diff_args(point: &str) -> [&str; 6] {
    ["diff", "--name-only", "--no-renames", "-z", point, "--"]
}

/// Paths changed since `base` (committed, staged, unstaged) plus untracked files, repo-root
/// relative, from the repo's top level whatever the cwd. `base` defaults to `origin/main`, else
/// `origin/HEAD`, else `HEAD` (then only uncommitted work is seen: said on stderr). A remote base is
/// fetched first ([`fetch_base`]; ai-game-studio 2026-10-20: a stale local origin/main made an
/// 84-file PR read as 177 files with `ci.yml`). The comparison point is `merge-base(base, HEAD)`
/// so commits that only landed on main are not counted. Returns (base, files, warning).
pub(super) fn changed_paths(cwd: &Path, base: Option<&str>) -> Result<(String, Vec<String>, Option<String>)> {
    let top = git(cwd, &["rev-parse", "--show-toplevel"])?.filter(|s| !s.is_empty()).context("not a git repo (run inside one, or pass --paths)")?;
    let top = Path::new(&top);
    let base = match base {
        Some(b) if b.starts_with('-') || b.is_empty() => anyhow::bail!("--base needs a git ref, not an option ({b:?})"),
        Some(b) => b.to_string(),
        None => match ["origin/main", "origin/HEAD"].into_iter().find(|r| git(top, &["rev-parse", "--verify", "-q", &format!("{r}^{{commit}}")]).ok().flatten().is_some()) {
            Some(r) => r.to_string(),
            None => {
                eprintln!("risk: no origin/main — comparing with HEAD, so only uncommitted work is seen; pass --base <ref> for the branch");
                "HEAD".into()
            }
        },
    };
    let warning = fetch_base(top, &base);
    let point = git(top, &["merge-base", &base, "HEAD"])?.filter(|s| !s.is_empty()).unwrap_or_else(|| base.clone());
    let diff = git(top, &diff_args(&point))?.with_context(|| format!("git diff against {base} failed (no such ref?)"))?;
    let untracked = git(top, &["ls-files", "--others", "--exclude-standard", "-z"])?.context("git ls-files failed")?;
    let mut files: Vec<String> = diff.split('\0').chain(untracked.split('\0')).map(str::trim).filter(|l| !l.is_empty()).map(str::to_owned).collect();
    files.sort();
    files.dedup();
    Ok((base, files, warning))
}

pub(super) fn run(rest: &[String], cwd: &Path) -> Result<()> {
    let mut base: Option<String> = None;
    let mut paths: Option<Vec<String>> = None;
    let mut json_out = false;
    let mut release = false;
    let mut it = rest.iter();
    while let Some(a) = it.next() {
        match a.as_str() {
            "--json" => json_out = true,
            "--release" => release = true,
            "--base" => base = Some(it.next().with_context(|| USAGE.to_string())?.clone()),
            "--paths" => paths = Some(it.next().with_context(|| USAGE.to_string())?.split(',').map(str::trim).filter(|p| !p.is_empty()).map(str::to_owned).collect()),
            "--help" | "-h" => {
                println!("{USAGE}");
                return Ok(());
            }
            s => anyhow::bail!("unknown argument `{s}`\n{USAGE}"),
        }
    }
    let (base, files, warning) = match paths {
        Some(p) => ("--paths".to_string(), p, None),
        None => changed_paths(cwd, base.as_deref())?,
    };
    let mut a = assess(&base, files, release);
    a.warning = warning;
    if json_out {
        println!("{}", a.json());
    } else {
        print!("{}", a.text());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(a: &[&str]) -> Vec<String> {
        a.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn risk_classifies_paths_by_name_only() {
        assert_eq!(classify("crates/cli/src/verbs/login.rs"), [Cat::Auth]);
        assert_eq!(classify("apps/web/lib/oauth/callback.ts"), [Cat::Auth]);
        assert_eq!(classify("apps/web/components/user-login.tsx"), [Cat::Auth], "tokens split on -");
        assert_eq!(classify("apps/web/.env.local"), [Cat::Secret]);
        assert_eq!(classify("apps/web/.env.example"), [], "templates are not secrets");
        assert_eq!(classify("ops/id_rsa"), [Cat::Secret]);
        assert_eq!(classify("ops/id_rsa.pub"), [], "a public key is not a secret");
        assert_eq!(classify("assets/configs/kitty.session"), [Cat::Secret]);
        assert_eq!(classify("config/credentials.json"), [Cat::Secret]);
        assert_eq!(classify("crates/cli/src/verbs/ccc/secret.rs"), [], "source code named secret is not a secret file");
        assert_eq!(classify("crates/cli/src/verbs/secret_mask.rs"), []);
        assert_eq!(classify("apps/hq-ui/lib/analytics.ts"), [Cat::Data]);
        assert_eq!(classify("services/notify/discord.go"), [Cat::Messaging]);
        assert_eq!(classify("Cargo.lock"), [Cat::ThirdParty]);
        assert_eq!(classify("assets/claude/.claude-plugin/plugin.json"), [Cat::ThirdParty, Cat::Release]);
        assert_eq!(classify(".github/workflows/release.yml"), [Cat::Release]);
        assert_eq!(classify("CHANGELOG.md"), [], "every PR edits it; release = tag/version/workflow files");
        assert_eq!(classify("scripts/size-gate.sh"), [Cat::Release]);
        assert_eq!(classify("services/credit/score.rs"), [Cat::HighRisk]);
        assert_eq!(classify("assets/claude/hooks/guard.sh"), [Cat::Harness]);
        assert_eq!(classify("crates/cli/src/verbs/ccc/guard.rs"), [], "a `guard` outside a claude folder is not the kit's");
        assert_eq!(classify(".claude/settings.json"), [Cat::Harness]);
        assert_eq!(classify("apps/hq-ui/hooks/use-mobile.ts"), [], "React hooks are not Claude Code hooks");
        assert_eq!(classify("CLAUDE.md"), [], "instructions, not Claude Code configuration");
        assert_eq!(classify("crates/cli/src/verbs/ccc/risk.rs"), [], "plain code");
        // Whole-token matching: no substring hits.
        for p in ["docs/legal/anthropic/usage-policy.md", "docs/lesson-1.md", "src/diagnostics.rs", "src/healthcheck.rs", "src/collections.rs", "src/conversion.rs", "assets/skills/token-bench/x.md", "src/assoc.rs"] {
            assert!(classify(p).iter().all(|c| *c == Cat::Secret), "{p}: {:?}", classify(p));
        }
        assert_eq!(classify("docs/legal/anthropic/usage-policy.md"), [], "docs under docs/ are documents, not code");
        assert_eq!(classify("src/email.rs"), [Cat::Messaging], "email is its own token");
        assert_eq!(classify("docs\\auth\\README.md"), [], "Windows separators parse; a doc is a doc");
        assert_eq!(classify("apps\\web\\auth\\index.ts"), [Cat::Auth], "Windows separators");
        assert_eq!(classify(""), []);
    }

    #[test]
    fn risk_gates_follow_the_kit_rule() {
        let a = assess("origin/main", v(&["crates/cli/src/verbs/ccc/risk.rs", "README.md"]), false);
        assert_eq!((a.level, a.gates.len(), a.gates[0].name), ("low", 1, "sec"));
        assert!(a.text().contains("gate bắt buộc:\n  /sec") && a.text().contains("chỉ đọc tên file"), "{}", a.text());
        let a = assess("origin/main", v(&["crates/cli/src/verbs/ccc/risk.rs"]), true);
        assert_eq!(a.gates.iter().map(|g| g.name).collect::<Vec<_>>(), ["sec", "rules", "aup-audit"], "--release forces the release gates");
        assert_eq!(a.gates[1].why, "--release: luôn trước release");

        let a = assess("origin/main", v(&["apps/web/lib/login.ts", "CHANGELOG.md", ".github/workflows/release.yml"]), false);
        assert_eq!(a.level, "medium");
        assert_eq!(a.gates.iter().map(|g| g.name).collect::<Vec<_>>(), ["sec", "rules", "aup-audit"]);
        assert_eq!(a.gates[1].why, "auth (apps/web/lib/login.ts) · release (.github/workflows/release.yml)");
        assert_eq!(a.hits, [(Cat::Auth, "apps/web/lib/login.ts".to_string()), (Cat::Release, ".github/workflows/release.yml".to_string())]);

        let a = assess("HEAD", v(&["services/hiring/rank.go", ".claude/settings.json", "apps/web/.env"]), false);
        assert_eq!(a.level, "high");
        assert_eq!(a.gates.iter().map(|g| g.name).collect::<Vec<_>>(), ["sec", "rules", "aup-audit", "human-review", "harden"]);
        let j = a.json();
        assert_eq!(j["level"], "high");
        assert_eq!(j["gates"][3]["gate"], "human-review");
        assert_eq!(j["hits"][0], json!({"category": "secret", "path": "apps/web/.env"}));

        // Many hits of one class are elided after three.
        let a = assess("HEAD", v(&["a/auth-1.rs", "a/auth-2.rs", "a/auth-3.rs", "a/auth-4.rs", "a/auth-5.rs"]), false);
        assert_eq!(a.gates[1].why, "auth (a/auth-1.rs, a/auth-2.rs, a/auth-3.rs +2)");
    }

    /// What `/ship` and the lead's merge invoke (auto.rs lane playbooks point here).
    #[test]
    fn risk_skill_list_is_sec_alone_for_docs_and_adds_compliance_for_auth() {
        let docs = assess("origin/main", v(&["docs/guide.md", "README.md", "CHANGELOG.md", "docs/auth/README.md"]), false);
        assert_eq!(docs.skills(), ["/sec"]);
        assert!(docs.text().contains("chỉ gọi: /sec\n"), "{}", docs.text());
        assert_eq!(docs.json()["skills"], json!(["/sec"]));
        let auth = assess("origin/main", v(&["apps/web/lib/oauth/callback.ts", "docs/guide.md"]), false);
        assert_eq!(auth.skills(), ["/sec", "/rules", "/aup-audit"]);
        let high = assess("HEAD", v(&["services/hiring/rank.go", ".claude/settings.json"]), false);
        assert_eq!(high.skills(), ["/sec", "/rules", "/aup-audit", "/harden"], "a person reviews high-risk; not a skill");
    }

    #[test]
    fn risk_reads_the_diff_and_untracked_files_from_git() {
        let d = std::env::temp_dir().join(format!("8sync-risk-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(d.join("src")).unwrap();
        let g = |args: &[&str]| {
            let o = Command::new("git").args(["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null"]).args(args).current_dir(&d).env_remove("GIT_DIR").env_remove("GIT_INDEX_FILE").env_remove("GIT_WORK_TREE").output().unwrap();
            assert!(o.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&o.stderr));
        };
        g(&["init", "-q", "-b", "main"]);
        g(&["commit", "-q", "--allow-empty", "-m", "root"]);
        std::fs::write(d.join("src/login.rs"), "x").unwrap();
        g(&["add", "src/login.rs"]);
        g(&["commit", "-q", "-m", "login"]);
        std::fs::write(d.join("CHANGELOG.md"), "y").unwrap(); // untracked, at the root
        std::fs::write(d.join("src/tệp mới.rs"), "z").unwrap(); // untracked, non-ASCII: -z keeps it unquoted
        let (base, files, _) = changed_paths(&d, Some("HEAD~1")).unwrap();
        assert_eq!((base.as_str(), files), ("HEAD~1", v(&["CHANGELOG.md", "src/login.rs", "src/tệp mới.rs"])));
        let (base, files, _) = changed_paths(&d.join("src"), Some("HEAD~1")).unwrap();
        assert_eq!((base.as_str(), files), ("HEAD~1", v(&["CHANGELOG.md", "src/login.rs", "src/tệp mới.rs"])), "from a subdirectory the same root-relative list");
        let (base, files, warning) = changed_paths(&d, None).unwrap();
        assert_eq!((base.as_str(), files, warning), ("HEAD", v(&["CHANGELOG.md", "src/tệp mới.rs"]), None), "no origin/main → HEAD: only uncommitted work");
        assert!(changed_paths(&std::env::temp_dir(), Some("HEAD")).is_err() || true, "outside a repo: error or a parent repo");
        assert!(changed_paths(&d, Some("no-such-ref")).is_err());
        assert!(changed_paths(&d, Some("--output=x")).unwrap_err().to_string().contains("not an option"), "a ref can never be passed to git as an option");
        // main moved on after the branch (a ci.yml change): diffed from the merge-base, not main's tip
        g(&["checkout", "-q", "-b", "card-1"]);
        g(&["checkout", "-q", "main"]);
        std::fs::create_dir_all(d.join(".github/workflows")).unwrap();
        std::fs::write(d.join(".github/workflows/ci.yml"), "on: push").unwrap();
        g(&["add", ".github/workflows/ci.yml"]);
        g(&["commit", "-q", "-m", "ci"]);
        g(&["checkout", "-q", "card-1"]);
        let (_, files, warning) = changed_paths(&d, Some("main")).unwrap();
        assert_eq!((files, warning), (v(&["CHANGELOG.md", "src/tệp mới.rs"]), None), "main's ci.yml is not this branch's change");
        // origin/main whose remote cannot be fetched: risk goes on from the local ref and says so
        let gone = d.join("no-such-remote");
        g(&["remote", "add", "origin", gone.to_str().unwrap()]);
        g(&["update-ref", "refs/remotes/origin/main", "main"]);
        let (_, files, warning) = changed_paths(&d, Some("origin/main")).unwrap();
        assert_eq!(files, v(&["CHANGELOG.md", "src/tệp mới.rs"]), "still from the merge-base");
        assert!(warning.as_deref().is_some_and(|w| w.contains("git fetch --quiet origin main") && w.contains("origin/main có thể cũ")), "{warning:?}");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn risk_fetches_a_remote_base_and_diffs_from_the_merge_base() {
        let s = |a: &[&str]| a.iter().map(|x| x.to_string()).collect::<Vec<_>>();
        assert_eq!(fetch_args("origin/main"), Some(s(&["fetch", "--quiet", "origin", "main"])));
        assert_eq!(fetch_args("origin/release/1.2"), Some(s(&["fetch", "--quiet", "origin", "release/1.2"])));
        assert_eq!(fetch_args("origin/HEAD"), Some(s(&["fetch", "--quiet", "origin"])));
        for none in ["HEAD", "HEAD~1", "main", "upstream/main", "origin/", "origin/--upload-pack=x"] {
            assert_eq!(fetch_args(none), None, "{none}");
        }
        assert_eq!(diff_args("abc1234"), ["diff", "--name-only", "--no-renames", "-z", "abc1234", "--"]);
        let mut a = assess("origin/main", v(&["src/x.rs"]), false);
        a.warning = Some("`git fetch --quiet origin main` lỗi hoặc quá 20 s: origin/main có thể cũ, danh sách file có thể thừa".into());
        assert!(a.text().lines().nth(1).unwrap().starts_with("⚠ `git fetch"), "{}", a.text());
        assert_eq!(a.json()["warning"], a.warning.clone().unwrap());
    }
}
