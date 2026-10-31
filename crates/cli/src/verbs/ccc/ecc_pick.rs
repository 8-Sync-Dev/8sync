//! `ccc hook ecc-pick` (UserPromptSubmit): picks the few ECC members a prompt needs.
//!
//! With the `ecc@ecc` plugin off, Claude Code no longer lists ECC's skills/agents/commands in
//! every call (~9k tokens, estimate). This hook gives that choice back for free: it scores the
//! prompt (plus the repo's stack) against an index of the newest ECC plugin cache and adds at most
//! [`MAX_PICKS`] members, with their file paths, as context. Nothing matches → no output, 0 tokens.
//! - the index (`kind\tname\tdescription` per line, first line = the ECC dir it came from) is
//!   rebuilt only when that dir changes (a new ECC version);
//! - a member already suggested in a session is not suggested again there;
//! - the plugin on, no ECC cache, `ECC_PICK=0`, or any error → silent.
use serde_json::{json, Value};
use std::collections::HashSet;
use std::path::{Path, PathBuf};

use super::read_json;

/// At most this many members per prompt.
const MAX_PICKS: usize = 3;
/// Below this score a match is noise (one name word = 3, one description word = 1, stack = 2).
const MIN_SCORE: u32 = 4;
/// Session dedupe files older than this are dropped.
const MAX_AGE_S: u64 = 24 * 3600;
/// Words of a member's description shown with it.
const DESC_WORDS: usize = 10;

const STOP: &[&str] = &[
    "the", "and", "for", "with", "use", "using", "when", "this", "that", "from", "into", "your", "you", "are", "all", "any", "can", "not", "but", "how",
    "what", "why", "make", "add", "new", "file", "files", "code", "run", "get", "set", "one", "also", "like", "need", "want", "should", "patterns", "pattern",
    "including", "use", "used", "via", "its", "has", "have", "more", "best", "practices", "expert", "specialist", "proactively", "must", "every", "after",
    "before", "nhé", "này", "của", "cho", "các", "những", "với", "không", "được", "thì", "làm", "đi", "rồi", "xem", "thử",
];

/// Vietnamese phrases the owner types → the English words ECC descriptions use.
const VI: &[(&str, &str)] = &[
    ("kiểm thử", "test testing"),
    ("viết test", "test testing tdd"),
    ("bảo mật", "security"),
    ("lỗ hổng", "security vulnerability"),
    ("hiệu năng", "performance"),
    ("tối ưu", "optimize performance"),
    ("triển khai", "deploy deployment"),
    ("giao diện", "frontend design"),
    ("cơ sở dữ liệu", "database"),
    ("tài liệu", "docs documentation"),
    ("tái cấu trúc", "refactor"),
    ("sửa lỗi", "debug fix bug"),
    ("lỗi build", "build error"),
    ("kiến trúc", "architecture"),
    ("kế hoạch", "plan planning"),
    ("nghiên cứu", "research"),
    ("đánh giá code", "review"),
    ("rà soát", "review audit"),
    ("kiểm tra", "check verify"),
];

/// Language/framework words: a member named for one of these is dropped unless the repo's stack
/// or the prompt has it (`go-reviewer` never shows up for a review in a Rust repo).
const LANGS: &[&str] = &[
    "rust", "go", "golang", "python", "django", "fastapi", "pytorch", "java", "kotlin", "springboot", "spring", "quarkus", "jpa", "mybatis", "gradle",
    "android", "swift", "swiftui", "cpp", "csharp", "dotnet", "fsharp", "perl", "php", "laravel", "ruby", "rails", "flutter", "dart", "react", "vue",
    "angular", "nuxt", "nuxt4", "nextjs", "nestjs", "typescript", "bun", "harmonyos", "bengali", "clickhouse", "mysql", "redis", "prisma", "postgres",
    "kubernetes", "docker", "remotion", "manim", "blender", "cisco", "homelab", "healthcare", "hipaa",
];

pub(super) struct Entry {
    kind: String,
    name: String,
    desc: String,
}

/// `~/.claude` (or `CLAUDE_CONFIG_DIR`).
pub(super) fn claude_dir() -> Option<PathBuf> {
    std::env::var_os("CLAUDE_CONFIG_DIR").map(PathBuf::from).or_else(|| dirs::home_dir().map(|h| h.join(".claude")))
}

/// Where the index and the per-session dedupe files live.
pub(super) fn state_dir(home: Option<&Path>) -> Option<PathBuf> {
    home.filter(|h| h.is_absolute()).map(|h| h.join(".local/state/8sync/ccc/ecc-pick"))
}

/// Newest `plugins/cache/ecc/ecc/<version>/` (numeric compare, so 2.10.0 > 2.9.9).
pub(super) fn ecc_root(claude: &Path) -> Option<PathBuf> {
    let base = ["plugins", "cache", "ecc", "ecc"].iter().fold(claude.to_path_buf(), |p, c| p.join(c));
    let key = |n: &str| n.split('.').map(|p| p.parse::<u64>().unwrap_or(0)).collect::<Vec<_>>();
    std::fs::read_dir(base)
        .ok()?
        .flatten()
        .filter(|e| e.path().join("skills").is_dir())
        .filter_map(|e| e.file_name().to_str().map(|n| (key(n), e.path())))
        .max_by(|a, b| a.0.cmp(&b.0))
        .map(|(_, p)| p)
}

fn plugin_on(claude: &Path) -> bool {
    read_json(&claude.join("settings.json")).is_some_and(|s| s["enabledPlugins"]["ecc@ecc"] == json!(true))
}

/// `description:` of a markdown frontmatter, block scalars (`>`, `|`) joined into one line.
fn description(text: &str) -> String {
    let text = text.replace("\r\n", "\n");
    let Some(fm) = text.strip_prefix("---\n").and_then(|t| t.split("\n---").next()) else { return String::new() };
    let mut lines = fm.lines();
    while let Some(l) = lines.next() {
        let Some(v) = l.strip_prefix("description:") else { continue };
        let v = v.trim();
        if matches!(v, ">" | ">-" | "|" | "|-" | "") {
            let parts: Vec<&str> = lines.take_while(|l| l.starts_with([' ', '\t'])).map(str::trim).collect();
            return parts.join(" ");
        }
        return v.trim_matches(['"', '\'']).to_string();
    }
    String::new()
}

fn head(path: &Path) -> Option<String> {
    use std::io::Read;
    let mut buf = vec![0u8; 4096];
    let n = std::fs::File::open(path).ok()?.read(&mut buf).ok()?;
    buf.truncate(n);
    Some(String::from_utf8_lossy(&buf).into_owned())
}

fn clean(s: &str) -> String {
    s.chars().map(|c| if c == '\t' || c == '\n' || c == '\r' { ' ' } else { c }).collect()
}

/// Every skill/agent/command of an ECC dir.
pub(super) fn build(root: &Path) -> Vec<Entry> {
    let mut out = Vec::new();
    let names = |dir: &Path| -> Vec<String> {
        let mut v: Vec<String> = std::fs::read_dir(dir).into_iter().flatten().flatten().filter_map(|e| e.file_name().to_str().map(String::from)).collect();
        v.sort();
        v
    };
    for d in names(&root.join("skills")) {
        if let Some(t) = head(&root.join("skills").join(&d).join("SKILL.md")) {
            out.push(Entry { kind: "skill".into(), name: d, desc: clean(&description(&t)) });
        }
    }
    for (kind, sub) in [("agent", "agents"), ("command", "commands")] {
        for f in names(&root.join(sub)) {
            let Some(name) = f.strip_suffix(".md") else { continue };
            if let Some(t) = head(&root.join(sub).join(&f)) {
                out.push(Entry { kind: kind.into(), name: name.to_string(), desc: clean(&description(&t)) });
            }
        }
    }
    out
}

/// The index for `root`, from `cache` when it was built from the same dir, else rebuilt + saved.
pub(super) fn index(root: &Path, cache: &Path) -> Vec<Entry> {
    let tag = root.to_string_lossy().to_string();
    if let Ok(text) = std::fs::read_to_string(cache) {
        let mut lines = text.lines();
        if lines.next() == Some(tag.as_str()) {
            return lines
                .filter_map(|l| {
                    let mut p = l.splitn(3, '\t');
                    Some(Entry { kind: p.next()?.to_string(), name: p.next()?.to_string(), desc: p.next().unwrap_or("").to_string() })
                })
                .collect();
        }
    }
    let entries = build(root);
    let mut text = format!("{tag}\n");
    for e in &entries {
        text.push_str(&format!("{}\t{}\t{}\n", e.kind, e.name, e.desc));
    }
    if let Some(dir) = cache.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let _ = std::fs::write(cache, text);
    entries
}

/// `reviewer`/`reviews` → `review`, `testing`/`tests` → `test`, `optimize`/`optimizer` →
/// `optimiz`; language names stay as they are.
fn stem(w: &str) -> String {
    if LANGS.contains(&w) {
        return w.to_string();
    }
    let long = |b: &&str| b.chars().count() >= 4;
    let base = ["ing", "ers", "er", "es", "ed", "s"].iter().find_map(|suf| w.strip_suffix(suf).filter(long)).unwrap_or(w);
    base.strip_suffix('e').filter(long).unwrap_or(base).to_string()
}

/// Lowercase stemmed words of 3+ letters (or a language name), stop words out.
fn words(s: &str) -> HashSet<String> {
    s.to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| (w.chars().count() >= 3 || LANGS.contains(w)) && !STOP.contains(w))
        .map(stem)
        .collect()
}

/// The prompt's words plus the English words of the Vietnamese phrases in it.
fn prompt_words(prompt: &str) -> HashSet<String> {
    let low = prompt.to_lowercase();
    let mut w = words(&low);
    for (vi, en) in VI {
        if low.contains(vi) {
            w.extend(words(en));
        }
    }
    w
}

/// The stack words of a repo, from its root files.
pub(super) fn stack(cwd: &Path) -> HashSet<String> {
    let mut s = HashSet::new();
    let has = |f: &str| cwd.join(f).is_file();
    let mut add = |ws: &[&str]| s.extend(ws.iter().map(|w| w.to_string()));
    if has("Cargo.toml") {
        add(&["rust"]);
    }
    if has("go.mod") {
        add(&["go", "golang"]);
    }
    if has("pyproject.toml") || has("requirements.txt") {
        add(&["python"]);
    }
    if has("pom.xml") || has("build.gradle") || has("build.gradle.kts") {
        add(&["java", "kotlin", "gradle"]);
    }
    if has("pubspec.yaml") {
        add(&["flutter", "dart"]);
    }
    if has("Package.swift") {
        add(&["swift"]);
    }
    if has("CMakeLists.txt") {
        add(&["cpp"]);
    }
    if let Ok(pkg) = std::fs::read_to_string(cwd.join("package.json")) {
        add(&["typescript"]);
        for (dep, w) in [("\"react\"", "react"), ("\"vue\"", "vue"), ("\"next\"", "nextjs"), ("\"@angular/core\"", "angular"), ("\"nuxt\"", "nuxt")] {
            if pkg.contains(dep) {
                add(&[w]);
            }
        }
    }
    s
}

/// How well `e` fits the prompt; 0 = not at all.
fn score(e: &Entry, prompt: &HashSet<String>, stack: &HashSet<String>) -> u32 {
    let name: HashSet<String> = e.name.split('-').map(stem).collect();
    if name.iter().any(|w| LANGS.contains(&w.as_str()) && !stack.contains(w) && !prompt.contains(w)) {
        return 0;
    }
    let by_name = name.iter().filter(|w| prompt.contains(*w)).count() as u32;
    let by_desc = words(&e.desc).iter().filter(|w| prompt.contains(*w) && !name.contains(*w)).count() as u32;
    if by_name + by_desc == 0 {
        return 0;
    }
    let on_stack = name.iter().any(|w| stack.contains(w));
    3 * by_name + by_desc + if on_stack { 2 } else { 0 }
}

/// The best members for a prompt, best first, minus those in `seen`: a member already suggested
/// in this session is not repeated, and the next-best ones do not move up in its place.
pub(super) fn pick<'a>(entries: &'a [Entry], prompt: &str, stack: &HashSet<String>, seen: &HashSet<String>) -> Vec<&'a Entry> {
    let p = prompt_words(prompt);
    if p.len() < 2 {
        return Vec::new();
    }
    let mut scored: Vec<(u32, &Entry)> = entries
        .iter()
        .map(|e| (score(e, &p, stack), e))
        .filter(|(s, _)| *s >= MIN_SCORE)
        .collect();
    scored.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.name.cmp(&b.1.name)));
    // `rust-review` (command) and `rust-reviewer` (agent) are one pick, the better-scored one.
    let mut names = HashSet::new();
    let top = scored.first().map_or(0, |s| s.0);
    scored
        .into_iter()
        .filter(|(s, _)| s * 3 >= top * 2)
        .filter(|(_, e)| names.insert(e.name.split('-').map(stem).collect::<Vec<_>>()))
        .take(MAX_PICKS)
        .map(|(_, e)| e)
        .filter(|e| !seen.contains(&format!("{}:{}", e.kind, e.name)))
        .collect()
}

fn rel(e: &Entry) -> String {
    match e.kind.as_str() {
        "skill" => format!("skills/{}/SKILL.md", e.name),
        "agent" => format!("agents/{}.md", e.name),
        _ => format!("commands/{}.md", e.name),
    }
}

/// The context line block for the picks.
fn render(root: &Path, picks: &[&Entry]) -> String {
    let mut s = format!(
        "8sync ecc-pick: ECC members that match this prompt (plugin off; read one only if it helps — skill: follow the file; agent: a general-purpose agent whose prompt opens with the file; command: follow the file). ECC = {}",
        root.display()
    );
    for e in picks {
        let d: Vec<&str> = e.desc.split_whitespace().take(DESC_WORDS).collect();
        s.push_str(&format!("\n- {} `{}` {} — {}", e.kind, e.name, rel(e), d.join(" ")));
    }
    s
}

/// The hook: input = the UserPromptSubmit JSON. `claude` = `~/.claude`, `state` = [`state_dir`].
pub(super) fn run(input: &str, claude: &Path, state: &Path, now_s: u64) -> Option<String> {
    if std::env::var("ECC_PICK").is_ok_and(|v| v == "0") || plugin_on(claude) {
        return None;
    }
    let v: Value = serde_json::from_str(input).ok()?;
    let prompt = v["prompt"].as_str()?;
    if prompt.trim_start().starts_with("/ecc") {
        return None;
    }
    let root = ecc_root(claude)?;
    let entries = index(&root, &state.join("index.tsv"));
    let stack = v["cwd"].as_str().map(|c| stack(Path::new(c))).unwrap_or_default();
    let sid = v["session_id"].as_str().filter(|s| crate::verbs::ccc::report::safe_id(s));
    let seen_file = sid.map(|s| state.join(format!("{s}.seen")));
    let seen: HashSet<String> = seen_file.as_ref().and_then(|f| std::fs::read_to_string(f).ok()).map(|t| t.lines().map(String::from).collect()).unwrap_or_default();
    let picks = pick(&entries, prompt, &stack, &seen);
    if picks.is_empty() {
        return None;
    }
    if let Some(f) = seen_file {
        prune(state, now_s);
        let mut all: Vec<String> = seen.into_iter().collect();
        all.extend(picks.iter().map(|e| format!("{}:{}", e.kind, e.name)));
        let _ = std::fs::write(f, all.join("\n"));
    }
    let body = render(&root, &picks);
    Some(json!({ "hookSpecificOutput": { "hookEventName": "UserPromptSubmit", "additionalContext": body } }).to_string())
}

fn prune(dir: &Path, now_s: u64) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        if e.path().extension().is_none_or(|x| x != "seen") {
            continue;
        }
        let old = e.metadata().ok().and_then(|m| m.modified().ok()).and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).is_some_and(|t| now_s.saturating_sub(t.as_secs()) > MAX_AGE_S);
        if old {
            let _ = std::fs::remove_file(e.path());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("8sync-eccpick-{tag}-{}", crate::verbs::uuid_sessions::new_uuid()));
        let _ = std::fs::remove_dir_all(&d);
        d
    }

    fn put(p: &Path, text: &str) {
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, text).unwrap();
    }

    /// A fake `~/.claude` with an older and a newer ECC cache.
    fn claude(tag: &str) -> PathBuf {
        let c = tmp(tag);
        let old = c.join("plugins/cache/ecc/ecc/2.9.0");
        put(&old.join("skills/old-only/SKILL.md"), "---\nname: old-only\ndescription: Rust testing old\n---\n");
        let r = c.join("plugins/cache/ecc/ecc/2.10.0");
        put(&r.join("skills/rust-testing/SKILL.md"), "---\nname: rust-testing\ndescription: Rust testing patterns including unit tests, property-based testing and coverage.\n---\n");
        put(&r.join("skills/golang-testing/SKILL.md"), "---\nname: golang-testing\ndescription: Go testing patterns with table-driven tests.\n---\n");
        put(&r.join("skills/security-review/SKILL.md"), "---\nname: security-review\ndescription: >\n  Security checklist for auth, input handling\n  and secrets.\n---\n");
        put(&r.join("agents/rust-reviewer.md"), "---\nname: rust-reviewer\ndescription: Expert Rust code reviewer for ownership and unsafe.\ntools: Read\n---\n");
        put(&r.join("agents/go-reviewer.md"), "---\nname: go-reviewer\ndescription: Expert Go code reviewer.\n---\n");
        put(&r.join("commands/rust-test.md"), "---\ndescription: Run Rust tests with TDD.\n---\n# x\n");
        c
    }

    fn input(prompt: &str, cwd: &Path, sid: &str) -> String {
        json!({ "session_id": sid, "prompt": prompt, "cwd": cwd }).to_string()
    }

    #[test]
    fn newest_version_wins_and_descriptions_parse() {
        let c = claude("root");
        let root = ecc_root(&c).unwrap();
        assert!(root.ends_with("2.10.0"), "{root:?}");
        let es = build(&root);
        assert_eq!(es.len(), 6);
        let sec = es.iter().find(|e| e.name == "security-review").unwrap();
        assert_eq!(sec.desc, "Security checklist for auth, input handling and secrets.");
        assert!(es.iter().any(|e| e.kind == "command" && e.name == "rust-test"));
    }

    #[test]
    fn picks_stack_members_and_drops_other_languages() {
        let c = claude("pick");
        let repo = tmp("repo");
        put(&repo.join("Cargo.toml"), "[package]\n");
        let state = tmp("state");
        let out = run(&input("write unit tests and review this module", &repo, "s1"), &c, &state, 1_000).unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        let ctx = v["hookSpecificOutput"]["additionalContext"].as_str().unwrap();
        assert!(ctx.contains("`rust-testing` skills/rust-testing/SKILL.md"), "{ctx}");
        assert!(ctx.contains("`rust-reviewer` agents/rust-reviewer.md"), "{ctx}");
        assert!(!ctx.contains("`rust-test` "), "rust-test is the same pick as rust-testing: {ctx}");
        assert!(!ctx.contains("golang") && !ctx.contains("go-reviewer"), "other stacks are dropped: {ctx}");
        assert!(ctx.lines().count() <= 1 + MAX_PICKS);
        // the same session is not told twice; a new session is
        assert!(run(&input("write unit tests and review this module", &repo, "s1"), &c, &state, 1_001).is_none(), "nothing new to say");
        assert!(run(&input("write unit tests and review this module", &repo, "s2"), &c, &state, 1_002).unwrap().contains("rust-testing"));
        // the prompt naming another language brings it back
        assert!(run(&input("port the golang testing suite", &repo, "s3"), &c, &state, 1_003).unwrap().contains("golang-testing"));
    }

    #[test]
    fn vietnamese_phrases_match() {
        let c = claude("vi");
        let state = tmp("vi-state");
        let out = run(&input("rà soát bảo mật phần auth giúp anh", &tmp("norepo"), "v1"), &c, &state, 1).unwrap();
        assert!(out.contains("security-review"), "{out}");
        put(&ecc_root(&c).unwrap().join("agents/performance-optimizer.md"), "---
description: Performance analysis and optimization specialist.
---
");
        let _ = std::fs::remove_file(state.join("index.tsv"));
        let out = run(&input("tối ưu hiệu năng api", &tmp("norepo2"), "v2"), &c, &state, 1).unwrap();
        assert!(out.contains("performance-optimizer"), "{out}");
    }

    #[test]
    fn silent_when_nothing_fits_or_turned_off() {
        let c = claude("off");
        let state = tmp("off-state");
        let repo = tmp("off-repo");
        assert!(run(&input("tiếp", &repo, "o1"), &c, &state, 1).is_none(), "short prompt");
        assert!(run(&input("what time is the meeting tomorrow", &repo, "o1"), &c, &state, 1).is_none(), "no match");
        assert!(run(&input("/eccx-full write rust tests", &repo, "o1"), &c, &state, 1).is_none(), "explicit eccx");
        assert!(run("not json", &c, &state, 1).is_none());
        assert!(run(&input("review rust tests", &repo, "o1"), &tmp("empty"), &state, 1).is_none(), "no ECC cache");
        put(&c.join("settings.json"), r#"{"enabledPlugins":{"ecc@ecc":true}}"#);
        assert!(run(&input("write rust unit tests", &repo, "o1"), &c, &state, 1).is_none(), "plugin on lists them itself");
    }

    #[test]
    fn index_is_cached_per_ecc_dir() {
        let c = claude("cache");
        let root = ecc_root(&c).unwrap();
        let cache = tmp("cache-state").join("index.tsv");
        assert_eq!(index(&root, &cache).len(), 6);
        put(&root.join("skills/added-later/SKILL.md"), "---\ndescription: x\n---\n");
        assert_eq!(index(&root, &cache).len(), 6, "same dir → cached");
        let other = c.join("plugins/cache/ecc/ecc/2.11.0");
        put(&other.join("skills/a/SKILL.md"), "---\ndescription: y\n---\n");
        assert_eq!(index(&other, &cache).len(), 1, "new version → rebuilt");
        assert!(state_dir(None).is_none() && state_dir(Some(Path::new("rel"))).is_none());
    }
}
