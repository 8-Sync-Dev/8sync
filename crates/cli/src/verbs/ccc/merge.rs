//! `8sync ccc auto merge [--json]`: lands every `approved` card in code, not tokens. Needs the
//! owner's project self-merge permission ([`super::grant::self_merge`]); without it, one line tells
//! the lead to ask the single `Ship` question and the verb exits non-zero.
//!
//! Per approved card, in board order: `gh pr view` → base must be the repo's default branch
//! ([`default_branch`]; a base branch that was already merged is retargeted with `gh pr edit
//! --base <default>` and the card goes back to `review`, since the diff on the default branch was
//! never reviewed), MERGEABLE, head = the reviewed SHA → `gh pr merge --squash --delete-branch
//! --match-head-commit <sha>` → card done with `merged <sha>`. A conflict, a moved head or another
//! base sends the card back to `ready` with the reason (a bounce like any return). A card stacked on
//! another approved card's branch waits for the first pass, so the root merges before its child is
//! judged.
//!
//! The guard allows a hand-typed `gh pr merge` only in the same shape ([`approved_merge`]).
use anyhow::{bail, Context, Result};
use serde_json::{json, Value};
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::Duration;

use super::target::{self, Target};

/// How long a cached default branch is trusted.
const DEFAULT_TTL_S: u64 = 24 * 3600;

/// Why nothing moved when [`default_branch`] is None.
pub(super) const NO_DEFAULT: &str = "không đọc được nhánh mặc định (gh): chạy lại sau";

/// The repo's default branch (`gh repo view --json defaultBranchRef`, 20 s timeout), cached per
/// repo in the state dir for a day; None when gh cannot tell (callers stop rather than guess).
pub fn default_branch(root: &Path) -> Option<String> {
    let cache = dirs::home_dir().filter(|h| h.is_absolute()).map(|h| super::idle::state_dir(&h).join("default-branch.json"));
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs());
    default_branch_with(root, cache.as_deref(), now, &gh_default_branch)
}

fn valid_branch(b: &str) -> bool {
    !b.is_empty() && b.len() <= 200 && !b.starts_with('-') && !b.chars().any(|c| c.is_whitespace() || c.is_control())
}

/// [`default_branch`] with the cache file, clock and lookup injected (tests).
fn default_branch_with(root: &Path, cache: Option<&Path>, now: u64, fetch: &dyn Fn(&Path) -> Option<String>) -> Option<String> {
    let key = super::auto::canon(root).to_string_lossy().into_owned();
    let mut all = cache.and_then(|c| std::fs::read_to_string(c).ok()).and_then(|s| serde_json::from_str::<Value>(&s).ok()).filter(Value::is_object).unwrap_or_else(|| json!({}));
    let hit = &all[&key];
    if let Some(b) = hit["branch"].as_str().filter(|b| valid_branch(b) && hit["at"].as_u64().is_some_and(|at| now < at + DEFAULT_TTL_S)) {
        return Some(b.to_string());
    }
    let b = fetch(root).map(|b| b.trim().to_string()).filter(|b| valid_branch(b))?;
    if let (Some(c), Some(map)) = (cache, all.as_object_mut()) {
        map.insert(key, json!({ "branch": b, "at": now }));
        if let Some(d) = c.parent() {
            let _ = std::fs::create_dir_all(d);
        }
        let _ = std::fs::write(c, all.to_string());
    }
    Some(b)
}

fn gh_default_branch(root: &Path) -> Option<String> {
    let mut c = Command::new("gh");
    c.args(["repo", "view", "--json", "defaultBranchRef", "-q", ".defaultBranchRef.name"])
        .current_dir(root)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .env("GH_PROMPT_DISABLED", "1");
    let out = crate::verbs::hq_core::agents::run_bounded(c, GH_TIMEOUT)?;
    Some(String::from_utf8_lossy(&out).trim().to_string())
}

/// How long a `gh` lookup may take before it counts as failed.
pub(super) const GH_TIMEOUT: Duration = Duration::from_secs(20);

pub(super) const NO_PERMISSION: &str = "chưa có quyền tự merge cho dự án này (hoặc đã quá 8 giờ): lead hỏi owner MỘT câu AskUserQuestion header \"Ship\" gom MỌI card approved (option \"Duyệt tất cả (Recommended)\" | \"Chỉ merge, chưa deploy\" | \"Dừng\"), rồi chạy lại `8sync ccc auto merge`. Không tự `gh pr merge`.";

/// A card's PR field (`81`, `#81`, `https://github.com/o/r/pull/81`) as a number.
pub(super) fn pr_number(s: &str) -> Option<u64> {
    let s = s.trim();
    let tail = s.rsplit_once("/pull/").map_or(s, |(_, t)| t).trim_start_matches('#');
    let digits: String = tail.chars().take_while(char::is_ascii_digit).collect();
    let rest = &tail[digits.len()..];
    (!digits.is_empty() && (rest.is_empty() || rest.starts_with(['/', '?', '#']))).then(|| digits.parse().ok()).flatten()
}

/// A bare PR number (`81`), the only PR form the guard's merge command takes.
fn bare_number(s: &str) -> Option<u64> {
    (!s.is_empty() && s.len() <= 10 && s.chars().all(|c| c.is_ascii_digit())).then(|| s.parse().ok()).flatten()
}

/// `head` is the commit the review approved (`card_sha`, 7+ hex, may be short).
fn same_commit(card_sha: &str, head: &str) -> bool {
    let c = card_sha.trim().to_ascii_lowercase();
    c.len() >= 7 && c.chars().all(|ch| ch.is_ascii_hexdigit()) && head.trim().to_ascii_lowercase().starts_with(&c)
}

/// The whole command is one `gh pr merge <n> [--squash|--merge|--rebase] [--delete-branch]
/// --match-head-commit <sha>`: (pr, sha). `<n>` is a bare number (no URL, no `#`: a URL could name
/// another repo). Other flags (`--admin`, `--repo`, `--auto`…), chaining, substitution, redirects
/// or a `#` anywhere → None.
pub(super) fn merge_command(cmd: &str) -> Option<(u64, String)> {
    if cmd.chars().any(|c| matches!(c, ';' | '&' | '|' | '\n' | '\r' | '$' | '`' | '<' | '>' | '(' | ')' | '{' | '}' | '#')) {
        return None;
    }
    let toks: Vec<&str> = cmd.split_whitespace().map(|t| t.trim_matches(|c| c == '"' || c == '\'')).collect();
    let [gh, "pr", "merge", rest @ ..] = toks.as_slice() else { return None };
    if !gh.eq_ignore_ascii_case("gh") && !gh.eq_ignore_ascii_case("gh.exe") {
        return None;
    }
    let (mut pr, mut sha) = (None, None);
    let mut it = rest.iter();
    while let Some(&t) = it.next() {
        match t {
            "--squash" | "-s" | "--merge" | "-m" | "--rebase" | "-r" | "--delete-branch" | "-d" => {}
            "--match-head-commit" if sha.is_none() => sha = Some(*it.next()?),
            _ if t.starts_with("--match-head-commit=") && sha.is_none() => sha = t.split_once('=').map(|(_, v)| v),
            _ if pr.is_none() && !t.starts_with('-') => pr = Some(bare_number(t)?),
            _ => return None,
        }
    }
    let sha = sha.filter(|s| (7..=40).contains(&s.len()) && s.chars().all(|c| c.is_ascii_hexdigit()))?;
    Some((pr?, sha.to_ascii_lowercase()))
}

/// Guard side: the approved card a self-merge command (see [`merge_command`]) lands, when its PR
/// belongs to an open `approved` card, the SHA is the reviewed one and `bases` (read only then:
/// the PR's base, the repo's default branch) agree. The caller checks the permission.
pub(super) fn approved_merge(pr: u64, sha: &str, cards: &[Target], bases: impl FnOnce() -> Option<(String, String)>) -> Option<u64> {
    let card = cards.iter().find(|t| t.state == "open" && t.lane == "approved" && t.pr.as_deref().and_then(pr_number) == Some(pr))?;
    same_commit(card.sha.as_deref()?, sha).then_some(())?;
    let (base, main) = bases()?;
    (base.trim() == main.trim() && !main.trim().is_empty()).then_some(card.id)
}

/// What to do with one approved card, given its PR (`gh pr view --json
/// baseRefName,mergeable,headRefOid,state`).
#[derive(Debug, PartialEq)]
pub(super) enum Step {
    /// Merge with `--match-head-commit <head>`.
    Merge(String),
    /// The base branch is already merged: `gh pr edit --base <default>`, then back to `review`.
    Retarget,
    /// The PR is already in main: close the card with this head.
    Done(String),
    /// Back to `ready`, with why.
    Back(String),
    /// Leave it for the next tick (GitHub has not computed mergeable yet).
    Wait(String),
}

/// Pure: [`Step`] for a card approved at `card_sha` whose PR is `pr`, into the default branch
/// `main`. `base_merged`: the PR's base branch (not `main`) was the head of a merged PR.
pub(super) fn decide(card_sha: &str, pr: &Value, base_merged: bool, main: &str) -> Step {
    let s = |k: &str| pr[k].as_str().unwrap_or_default().to_string();
    let (base, head) = (s("baseRefName"), s("headRefOid"));
    match s("state").as_str() {
        "OPEN" => {}
        "MERGED" if base == main => return Step::Done(head),
        "MERGED" => return Step::Back(format!("PR đã merge vào `{base}`, chưa vào {main}: mở PR mới từ origin/{main}")),
        other => return Step::Back(format!("PR đang {}: mở lại hoặc tạo PR mới", if other.is_empty() { "?" } else { other })),
    }
    if base != main {
        if base_merged {
            return Step::Retarget;
        }
        return Step::Back(format!("PR có base `{base}`, không phải {main}: rebase lên origin/{main}, `gh pr edit --base {main}`, qua qa/review lại"));
    }
    match s("mergeable").as_str() {
        "MERGEABLE" => {}
        "CONFLICTING" => return Step::Back(format!("conflict với {main}: rebase lên origin/{main} rồi qua qa/review lại")),
        _ => return Step::Wait("GitHub chưa tính xong mergeable: nhịp sau thử lại".into()),
    }
    if !same_commit(card_sha, &head) {
        let short = &head[..head.len().min(12)];
        return Step::Back(format!("head PR đã đổi sang {short}, review duyệt {card_sha}: commit mới chưa được review"));
    }
    Step::Merge(head)
}

/// One card's result, as `--json` lists it.
#[derive(Debug)]
struct Outcome {
    id: u64,
    pr: Option<u64>,
    /// `merged`, `done`, `ready`, `review`, `blocked`, `wait`, `deferred` (first pass only) or `failed`.
    action: &'static str,
    sha: Option<String>,
    why: Option<String>,
}

fn gh(root: &Path, args: &[&str]) -> Result<String> {
    let o = Command::new("gh")
        .args(args)
        .current_dir(root)
        .stdin(Stdio::null())
        .output()
        .context("không chạy được `gh` (cài GitHub CLI, `gh auth login`)")?;
    if !o.status.success() {
        bail!("gh {}: {}", args.join(" "), String::from_utf8_lossy(&o.stderr).trim());
    }
    Ok(String::from_utf8_lossy(&o.stdout).into_owned())
}

/// `gh` in the repo, args → stdout (injected in tests).
type Gh<'a> = &'a dyn Fn(&[&str]) -> Result<String>;

fn view(gh: Gh, pr: &str) -> Result<Value> {
    serde_json::from_str(&gh(&["pr", "view", pr, "--json", "baseRefName,mergeable,headRefOid,state"])?).context("gh pr view: JSON lạ")
}

/// A branch that was the head of a merged PR (a stack root already landed).
fn merged_branch(gh: Gh, branch: &str) -> Result<bool> {
    let v: Value = serde_json::from_str(&gh(&["pr", "list", "--state", "merged", "--head", branch, "--json", "number", "--limit", "1"])?)?;
    Ok(v.as_array().is_some_and(|a| !a.is_empty()))
}

/// Where one card lands.
struct Ctx<'a> {
    home: &'a Path,
    root: &'a Path,
    who: Option<&'a str>,
    now: u64,
    /// The repo's default branch ([`default_branch`]).
    main: &'a str,
    gh: Gh<'a>,
}

/// Land one card; `first` defers a card stacked on a branch that is not merged yet.
fn land(t: &Target, c: &Ctx, first: bool) -> Outcome {
    let (gh, main) = (c.gh, c.main);
    let pr = t.pr.as_deref().and_then(pr_number);
    let mut out = Outcome { id: t.id, pr, action: "failed", sha: None, why: None };
    let Some(n) = pr else {
        out.action = "wait";
        out.why = Some("card không có PR: lead xem (`auto note`)".into());
        return out;
    };
    let n = n.to_string();
    let sha = t.sha.clone().unwrap_or_default();
    let back = |lane: &str, why: String| -> Result<(&'static str, Option<String>, Option<String>)> {
        let note = format!("[merge] {why}");
        let m = target::Move { note: Some(&note), ..Default::default() };
        let card = target::move_to(c.home, c.root, t.id, lane, &m, c.who, c.now)?;
        Ok((if card.lane == "blocked" { "blocked" } else if lane == "review" { "review" } else { "ready" }, None, Some(why)))
    };
    let r = (|| -> Result<(&'static str, Option<String>, Option<String>)> {
        let v = view(gh, &n)?;
        let base = v["baseRefName"].as_str().unwrap_or_default().to_string();
        let base_merged = v["state"] == "OPEN" && base != main && merged_branch(gh, &base)?;
        if first && v["state"] == "OPEN" && base != main && !base_merged {
            return Ok(("deferred", None, None));
        }
        // A full 40-hex SHA reads as a token to the board's secret mask; 12 chars still prove it.
        let evidence = |head: &str| format!("merged {}", head.chars().take(12).collect::<String>());
        Ok(match decide(&sha, &v, base_merged, main) {
            Step::Merge(head) => {
                if let Err(e) = gh(&["pr", "merge", &n, "--squash", "--delete-branch", "--match-head-commit", &head]) {
                    // gh merges remotely, then may fail deleting a local branch a worktree holds.
                    if view(gh, &n).ok().is_none_or(|v| v["state"] != "MERGED") {
                        return Err(e);
                    }
                }
                target::close(c.home, c.root, t.id, Some(&evidence(&head)), c.who, c.now)?;
                ("merged", Some(head), None)
            }
            Step::Done(head) => {
                target::close(c.home, c.root, t.id, Some(&evidence(&head)), c.who, c.now)?;
                ("done", Some(head), Some(format!("PR đã ở {main}")))
            }
            // The diff against the default branch is not the one review approved: never merge it in
            // the same run.
            Step::Retarget => {
                gh(&["pr", "edit", &n, "--base", main])?;
                back("review", format!("đổi base sang {main}: review lại diff trên {main}"))?
            }
            Step::Back(why) => back("ready", why)?,
            Step::Wait(why) => ("wait", None, Some(why)),
        })
    })();
    match r {
        Ok((action, sha, why)) => (out.action, out.sha, out.why) = (action, sha, why),
        Err(e) => out.why = Some(format!("{e:#}")),
    }
    out
}

fn line(o: &Outcome) -> String {
    let pr = o.pr.map_or_else(|| "-".to_string(), |n| format!("PR {n}"));
    let why = o.why.as_deref().unwrap_or_default();
    match o.action {
        "merged" => format!("#{} {pr}: merged {}", o.id, o.sha.as_deref().map_or("", |s| &s[..s.len().min(12)])),
        "done" => format!("#{} {pr}: {why} → done", o.id),
        "ready" => format!("#{} {pr} → ready: {why}", o.id),
        "review" => format!("#{} {pr} → review: {why}", o.id),
        "blocked" => format!("#{} {pr} → blocked (bị trả quá số lần): {why}", o.id),
        "wait" => format!("#{} {pr}: chờ — {why}", o.id),
        _ => format!("#{} {pr}: lỗi — {why}", o.id),
    }
}

/// `auto merge [--json]` in `root`; `who` closes and returns cards as that room.
pub(super) fn run(as_json: bool, home: &Path, root: &Path, who: Option<&str>, now: u64) -> Result<()> {
    if super::grant::self_merge(&super::grant::dir(home), root, now).is_none() {
        bail!(NO_PERMISSION);
    }
    // Never guess `main`: on a master repo that would merge stacked PRs into the wrong branch.
    let Some(main) = default_branch(root) else { bail!(NO_DEFAULT) };
    let gh = |args: &[&str]| gh(root, args);
    run_with(as_json, &Ctx { home, root, who, now, main: &main, gh: &gh })
}

fn run_with(as_json: bool, c: &Ctx) -> Result<()> {
    let mut cards: Vec<Target> = target::list(c.home, c.root)?.into_iter().filter(|t| t.state == "open" && t.lane == "approved").collect();
    // Board order: most urgent first, queue order within a priority.
    cards.sort_by_key(|t| t.prio.unwrap_or(2));
    let mut done = Vec::new();
    let mut later = Vec::new();
    for t in &cards {
        let o = land(t, c, true);
        if o.action == "deferred" {
            later.push(t);
        } else {
            done.push(o);
        }
    }
    for t in later {
        done.push(land(t, c, false));
    }
    let count = |a: &str| done.iter().filter(|o| o.action == a).count();
    let (merged, back) = (count("merged") + count("done"), count("ready") + count("blocked") + count("review"));
    if as_json {
        let list: Vec<Value> = done.iter().map(|o| json!({ "id": o.id, "pr": o.pr, "action": o.action, "sha": o.sha, "why": o.why })).collect();
        println!("{}", json!({ "cards": list, "merged": merged, "returned": back, "approved": cards.len() }));
        return Ok(());
    }
    if cards.is_empty() {
        println!("không có card approved");
        return Ok(());
    }
    for o in &done {
        println!("{}", line(o));
    }
    println!("merge {merged}/{} card approved · {back} về ready/review · {} chờ/lỗi", cards.len(), cards.len() - merged - back);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn card(id: u64, lane: &str, pr: &str, sha: &str) -> Target {
        serde_json::from_value(json!({ "id": id, "text": "x", "added": 0, "state": "open", "lane": lane, "pr": pr, "sha": sha })).unwrap()
    }

    const HEAD: &str = "0123456789abcdef0123456789abcdef01234567";

    fn pr(base: &str, mergeable: &str, head: &str, state: &str) -> Value {
        json!({ "baseRefName": base, "mergeable": mergeable, "headRefOid": head, "state": state })
    }

    #[test]
    fn decide_merges_only_a_mergeable_main_pr_at_the_reviewed_sha() {
        let d = |sha: &str, p: &Value, merged: bool| decide(sha, p, merged, "main");
        assert_eq!(d("0123456", &pr("main", "MERGEABLE", HEAD, "OPEN"), false), Step::Merge(HEAD.into()));
        assert_eq!(d(HEAD, &pr("main", "MERGEABLE", HEAD, "OPEN"), false), Step::Merge(HEAD.into()));
        assert_eq!(d("0123456", &pr("card-125-ui", "MERGEABLE", HEAD, "OPEN"), true), Step::Retarget, "merged base: retarget");
        assert!(matches!(d("0123456", &pr("card-125-ui", "MERGEABLE", HEAD, "OPEN"), false), Step::Back(w) if w.contains("card-125-ui")));
        assert!(matches!(d("0123456", &pr("main", "CONFLICTING", HEAD, "OPEN"), false), Step::Back(w) if w.contains("conflict")));
        assert!(matches!(d("fedcba9", &pr("main", "MERGEABLE", HEAD, "OPEN"), false), Step::Back(w) if w.contains("chưa được review")));
        assert!(matches!(d("0123456", &pr("main", "UNKNOWN", HEAD, "OPEN"), false), Step::Wait(_)));
        assert_eq!(d("0123456", &pr("main", "UNKNOWN", HEAD, "MERGED"), false), Step::Done(HEAD.into()));
        assert!(matches!(d("0123456", &pr("card-125-ui", "UNKNOWN", HEAD, "MERGED"), false), Step::Back(w) if w.contains("card-125-ui")));
        assert!(matches!(d("0123456", &pr("main", "MERGEABLE", HEAD, "CLOSED"), false), Step::Back(_)));
        // A master repo: master is the base, main is just another branch.
        assert_eq!(decide("0123456", &pr("master", "MERGEABLE", HEAD, "OPEN"), false, "master"), Step::Merge(HEAD.into()));
        assert!(matches!(decide("0123456", &pr("main", "MERGEABLE", HEAD, "OPEN"), false, "master"), Step::Back(_)));
    }

    #[test]
    fn only_a_plain_match_head_merge_command_parses() {
        assert_eq!(merge_command(&format!("gh pr merge 81 --squash --delete-branch --match-head-commit {HEAD}")), Some((81, HEAD.into())));
        for bad in [
            format!("gh pr merge #81 --match-head-commit {HEAD}"),
            format!("gh pr merge https://github.com/evil/x/pull/81 --match-head-commit {HEAD}"),
            format!("gh pr merge 81 --match-head-commit {HEAD} # note"),
            format!("gh pr merge 81x --match-head-commit {HEAD}"),
        ] {
            assert_eq!(merge_command(&bad), None, "{bad}");
        }
        for bad in [
            "gh pr merge 81 --squash".to_string(),
            format!("gh pr merge 81 --admin --match-head-commit {HEAD}"),
            format!("gh pr merge 81 --repo o/x --match-head-commit {HEAD}"),
            format!("gh pr merge 81 --match-head-commit {HEAD} && git push"),
            format!("gh pr merge 81 82 --match-head-commit {HEAD}"),
            "gh pr merge 81 --match-head-commit HEAD".to_string(),
            format!("gh pr view 81 --match-head-commit {HEAD}"),
        ] {
            assert_eq!(merge_command(&bad), None, "{bad}");
        }
        assert_eq!(pr_number("https://github.com/8syncdev/ai-game-studio/pull/132"), Some(132));
        assert_eq!(pr_number("132x"), None);
    }

    #[test]
    fn the_guard_path_needs_an_approved_card_its_sha_and_base_main() {
        let cards = vec![card(5, "approved", "81", "0123456"), card(6, "review", "82", "0123456")];
        let main = || Some(("main\n".to_string(), "main".to_string()));
        assert_eq!(approved_merge(81, HEAD, &cards, main), Some(5));
        assert_eq!(approved_merge(81, "fedcba9876", &cards, main), None, "another commit");
        assert_eq!(approved_merge(82, HEAD, &cards, main), None, "not approved");
        assert_eq!(approved_merge(83, HEAD, &cards, main), None, "no card");
        assert_eq!(approved_merge(81, HEAD, &cards, || Some(("card-125-ui".into(), "main".into()))), None, "stacked base");
        assert_eq!(approved_merge(81, HEAD, &cards, || None), None, "gh failed");
        assert_eq!(approved_merge(81, HEAD, &cards, || Some(("master".into(), "master".into()))), Some(5), "master repo");
        assert_eq!(approved_merge(81, HEAD, &cards, || Some(("main".into(), "master".into()))), None, "main is not the default");
    }

    #[test]
    fn default_branch_asks_gh_once_caches_it_and_never_guesses() {
        let d = std::env::temp_dir().join(format!("8sync-defbranch-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        let cache = d.join("state/default-branch.json");
        let calls = std::cell::Cell::new(0);
        let master = |_: &Path| {
            calls.set(calls.get() + 1);
            Some("master\n".to_string())
        };
        assert_eq!(default_branch_with(&d, Some(&cache), 100, &master).as_deref(), Some("master"));
        assert_eq!(default_branch_with(&d, Some(&cache), 200, &master).as_deref(), Some("master"));
        assert_eq!(calls.get(), 1, "cached");
        assert_eq!(default_branch_with(&d, Some(&cache), 100 + DEFAULT_TTL_S, &|_| None), None, "stale cache, gh down: no guess");
        assert_eq!(default_branch_with(&d, None, 0, &|_| Some("--evil".into())), None);
        let _ = std::fs::remove_dir_all(&d);
    }

    /// A board in a temp home with one approved card (PR 81 at 0123456) and a `gh` stub.
    fn landed(base: &str, main: &str) -> (Vec<String>, Target) {
        let home = std::env::temp_dir().join(format!("8sync-merge-land-{}-{base}-{main}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        let root = home.join("game");
        std::fs::create_dir_all(root.join(".git")).unwrap();
        let key = super::super::auto::canon(&root).to_string_lossy().into_owned();
        let board = super::super::idle::state_dir(&home).parent().unwrap().join("targets.json");
        std::fs::create_dir_all(board.parent().unwrap()).unwrap();
        let c = json!({ "id": 1, "text": "x", "added": 0, "state": "open", "lane": "approved", "pr": "81", "sha": "0123456", "check": "true" });
        std::fs::write(&board, json!({ "projects": { key: { "next_id": 2, "items": [c] } } }).to_string()).unwrap();
        let calls = std::cell::RefCell::new(Vec::new());
        let gh = |args: &[&str]| -> Result<String> {
            calls.borrow_mut().push(args.join(" "));
            Ok(match args[..2] {
                ["pr", "view"] => pr(base, "MERGEABLE", HEAD, "OPEN").to_string(),
                ["pr", "list"] => "[{\"number\":80}]".into(),
                _ => String::new(),
            })
        };
        let ctx = Ctx { home: &home, root: &root, who: None, now: 1_000, main, gh: &gh };
        run_with(true, &ctx).unwrap();
        let card = target::list(&home, &root).unwrap().into_iter().find(|t| t.id == 1).unwrap();
        let _ = std::fs::remove_dir_all(&home);
        (calls.into_inner(), card)
    }

    #[test]
    fn a_retargeted_pr_goes_back_to_review_unmerged() {
        let (calls, card) = landed("card-80-ui", "main");
        assert!(calls.iter().any(|c| c == "pr edit 81 --base main"), "{calls:?}");
        assert!(!calls.iter().any(|c| c.starts_with("pr merge")), "{calls:?}");
        assert_eq!((card.state.as_str(), card.lane.as_str()), ("open", "review"));
    }

    #[test]
    fn a_master_repo_merges_into_master() {
        let (calls, card) = landed("master", "master");
        assert!(calls.iter().any(|c| c == &format!("pr merge 81 --squash --delete-branch --match-head-commit {HEAD}")), "{calls:?}");
        assert_eq!(card.state, "done");
        // On a master repo a PR into main is a stacked PR: retargeted to master, back to review.
        let (calls, card) = landed("main", "master");
        assert!(!calls.iter().any(|c| c.starts_with("pr merge")) && calls.iter().any(|c| c == "pr edit 81 --base master"), "{calls:?}");
        assert_eq!(card.lane, "review");
    }
}
