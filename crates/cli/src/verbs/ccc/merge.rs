//! `8sync ccc auto merge [--json]`: lands every `approved` card in code, not tokens. Needs the
//! owner's project self-merge permission ([`super::grant::self_merge`]); without it the refusal
//! prints the exact `Ship` question for the lead to ask ([`ship_question`]) and exits non-zero.
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

/// How long a cached default branch or repo name is trusted.
const DEFAULT_TTL_S: u64 = 24 * 3600;

/// Why nothing moved when [`default_branch`] is None.
pub(super) const NO_DEFAULT: &str = "không đọc được nhánh mặc định (gh): chạy lại sau";

/// The repo's default branch (`gh repo view --json defaultBranchRef`, 20 s timeout), cached per
/// repo in the state dir for a day; None when gh cannot tell (callers stop rather than guess).
pub fn default_branch(root: &Path) -> Option<String> {
    default_branch_of(root, None)
}

/// [`default_branch`] of this repo (`repo` None) or of another repo `owner/repo` of the org
/// (`gh repo view owner/repo`), cached under that name.
pub(super) fn default_branch_of(root: &Path, repo: Option<&str>) -> Option<String> {
    let key = repo.map_or_else(|| super::auto::canon(root).to_string_lossy().into_owned(), str::to_string);
    cached(cache_file("default-branch.json").as_deref(), &key, now_s(), &valid_branch, &|| gh_repo_field(root, repo, "defaultBranchRef", ".defaultBranchRef.name"))
}

/// This repo's `owner/repo` on GitHub (`gh repo view --json nameWithOwner`), cached like the
/// default branch; None when gh cannot tell.
pub(super) fn origin_repo(root: &Path) -> Option<String> {
    let key = super::auto::canon(root).to_string_lossy().into_owned();
    cached(cache_file("origin-repo.json").as_deref(), &key, now_s(), &|r| valid_repo(r).is_some(), &|| gh_repo_field(root, None, "nameWithOwner", ".nameWithOwner"))
}

fn cache_file(name: &str) -> Option<std::path::PathBuf> {
    dirs::home_dir().filter(|h| h.is_absolute()).map(|h| super::idle::state_dir(&h).join(name))
}

fn now_s() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs())
}

fn valid_branch(b: &str) -> bool {
    !b.is_empty() && b.len() <= 200 && !b.starts_with('-') && !b.chars().any(|c| c.is_whitespace() || c.is_control())
}

/// `owner/repo` as GitHub names it (letters, digits, `.`, `_`, `-`; neither part empty or
/// starting with `-`), or None.
pub(super) fn valid_repo(s: &str) -> Option<&str> {
    let s = s.trim();
    let (o, r) = s.split_once('/')?;
    let part = |p: &str| !p.is_empty() && p.len() <= 100 && !p.starts_with('-') && p.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'));
    (part(o) && part(r)).then_some(s)
}

/// A gh answer for `key`, read from `cache` (one JSON object per key, `{ value, at }`) when
/// younger than [`DEFAULT_TTL_S`] and `valid`, else fetched and stored (injected in tests).
fn cached(cache: Option<&Path>, key: &str, now: u64, valid: &dyn Fn(&str) -> bool, fetch: &dyn Fn() -> Option<String>) -> Option<String> {
    let mut all = cache.and_then(|c| std::fs::read_to_string(c).ok()).and_then(|s| serde_json::from_str::<Value>(&s).ok()).filter(Value::is_object).unwrap_or_else(|| json!({}));
    let hit = &all[key];
    if let Some(b) = hit["value"].as_str().filter(|b| valid(b) && hit["at"].as_u64().is_some_and(|at| now < at + DEFAULT_TTL_S)) {
        return Some(b.to_string());
    }
    let b = fetch().map(|b| b.trim().to_string()).filter(|b| valid(b))?;
    if let (Some(c), Some(map)) = (cache, all.as_object_mut()) {
        map.insert(key.to_string(), json!({ "value": b, "at": now }));
        if let Some(d) = c.parent() {
            let _ = std::fs::create_dir_all(d);
        }
        let _ = std::fs::write(c, all.to_string());
    }
    Some(b)
}

/// `gh repo view [owner/repo] --json <field> -q <jq>` in `root`, trimmed; None when gh fails or hangs.
fn gh_repo_field(root: &Path, repo: Option<&str>, field: &str, jq: &str) -> Option<String> {
    let mut c = Command::new("gh");
    c.args(["repo", "view"]);
    if let Some(r) = repo {
        c.arg(r);
    }
    c.args(["--json", field, "-q", jq])
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

/// The Ship question's options, in the order the lead asks them.
const SHIP_OPTIONS: [(&str, &str); 4] = [
    ("Duyệt tất cả (Recommended)", "merge mọi card approved liệt kê ở câu hỏi"),
    ("Chỉ merge, chưa deploy", "merge các card đó, chưa tag/deploy"),
    ("Chỉ merge, tự merge 24h", "merge các card đó và cho team tự merge card đủ cổng (QA + review + đúng SHA) trong 24 giờ; chưa deploy"),
    ("Dừng", "không merge; card ở lại approved"),
];

pub(super) const NO_PERMISSION: &str = "chưa có quyền tự merge cho dự án này (hoặc đã quá 8 giờ): lead hỏi owner MỘT câu AskUserQuestion header \"Ship\" gom MỌI card approved (option \"Duyệt tất cả (Recommended)\" | \"Chỉ merge, chưa deploy\" | \"Chỉ merge, tự merge 24h\" | \"Dừng\") NGAY lượt này, trước `auto wait`, rồi chạy lại `8sync ccc auto merge`. Không tự `gh pr merge`.";

/// Pure: the refusal without permission, with the exact AskUserQuestion input (header Ship, the
/// options, every approved card and its PR) for the lead to copy. ai-game-studio 2026-10-20: the
/// lead waited a tick before asking.
pub(super) fn ship_question(approved: &[Target]) -> String {
    let list: Vec<String> = approved.iter().map(|t| format!("#{} ({})", t.id, t.pr.as_deref().and_then(pr_number).map_or_else(|| "chưa có PR".to_string(), |n| format!("PR {}", target::pr_label(&n.to_string(), t.pr_repo.as_deref()))))).collect();
    let options: Vec<Value> = SHIP_OPTIONS.iter().map(|(label, description)| json!({ "label": label, "description": description })).collect();
    let q = json!({ "questions": [{
        "header": "Ship",
        "question": format!("Merge {} card approved: {}?", approved.len(), list.join(", ")),
        "multiSelect": false,
        "options": options,
    }] });
    format!("{NO_PERMISSION}\nAskUserQuestion (copy nguyên):\n{q}")
}

/// Why a PR whose `mergeable` is still `UNKNOWN` (GitHub computes it after a push) did not move:
/// not a conflict, and no bounce. `pr` as shown (`#116`).
pub(super) fn computing(pr: &str) -> String {
    format!("GitHub đang tính mergeable của PR {pr}: thử lại sau 1 phút")
}

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

/// The whole command is one `gh pr merge <n> [--repo owner/repo] [--squash|--merge|--rebase]
/// [--delete-branch] --match-head-commit <sha>`: (pr, repo, sha). `<n>` is a bare number (no URL,
/// no `#`); the repo (`-R`/`--repo`, once) names a card's PR in another repo of the org. Other
/// flags (`--admin`, `--auto`…), chaining, substitution, redirects or a `#` anywhere → None.
pub(super) fn merge_command(cmd: &str) -> Option<(u64, Option<String>, String)> {
    if cmd.chars().any(|c| matches!(c, ';' | '&' | '|' | '\n' | '\r' | '$' | '`' | '<' | '>' | '(' | ')' | '{' | '}' | '#')) {
        return None;
    }
    let toks: Vec<&str> = cmd.split_whitespace().map(|t| t.trim_matches(|c| c == '"' || c == '\'')).collect();
    let [gh, "pr", "merge", rest @ ..] = toks.as_slice() else { return None };
    if !gh.eq_ignore_ascii_case("gh") && !gh.eq_ignore_ascii_case("gh.exe") {
        return None;
    }
    let (mut pr, mut sha, mut repo) = (None, None, None);
    let mut it = rest.iter();
    while let Some(&t) = it.next() {
        match t {
            "--squash" | "-s" | "--merge" | "-m" | "--rebase" | "-r" | "--delete-branch" | "-d" => {}
            "--match-head-commit" if sha.is_none() => sha = Some(*it.next()?),
            _ if t.starts_with("--match-head-commit=") && sha.is_none() => sha = t.split_once('=').map(|(_, v)| v),
            "--repo" | "-R" if repo.is_none() => repo = Some(valid_repo(it.next()?)?),
            _ if t.starts_with("--repo=") && repo.is_none() => repo = Some(valid_repo(t.split_once('=').map_or("", |(_, v)| v))?),
            _ if pr.is_none() && !t.starts_with('-') => pr = Some(bare_number(t)?),
            _ => return None,
        }
    }
    let sha = sha.filter(|s| (7..=40).contains(&s.len()) && s.chars().all(|c| c.is_ascii_hexdigit()))?;
    Some((pr?, repo.map(str::to_string), sha.to_ascii_lowercase()))
}

/// Guard side: the approved card a self-merge command (see [`merge_command`]) lands, when its PR
/// (number, and the same repo: this one when `repo` is None) belongs to an open `approved` card,
/// the SHA is the reviewed one and `bases` (read only then: the PR's base, that repo's default
/// branch) agree. The caller checks the permission.
pub(super) fn approved_merge(pr: u64, repo: Option<&str>, sha: &str, cards: &[Target], bases: impl FnOnce() -> Option<(String, String)>) -> Option<u64> {
    let same_repo = |t: &Target| match (t.pr_repo.as_deref(), repo) {
        (None, None) => true,
        (Some(a), Some(b)) => a.eq_ignore_ascii_case(b),
        _ => false,
    };
    let card = cards.iter().find(|t| t.state == "open" && t.lane == "approved" && same_repo(t) && t.pr.as_deref().and_then(pr_number) == Some(pr))?;
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
    /// Leave it for the next tick: GitHub has not computed mergeable yet ([`computing`]).
    Computing,
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
        return Step::Back(format!("PR có base `{base}`, không phải {main}: `gh pr edit --base {main}`, `git merge origin/{main}` vào nhánh, {}, qua qa/review lại", target::KEEP_PR));
    }
    // Only CONFLICTING is a conflict; UNKNOWN right after a push is GitHub still computing.
    match s("mergeable").as_str() {
        "MERGEABLE" => {}
        "CONFLICTING" => return Step::Back(format!("conflict với {main}: `git merge origin/{main}` vào nhánh, sửa conflict (CHANGELOG.md: giữ cả hai mục và chuyển mục của card sang `changelog.d/card-<id>.md`), {}, qua qa/review lại", target::KEEP_PR)),
        _ => return Step::Computing,
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
    /// `owner/repo` when the PR is in another repo of the org.
    repo: Option<String>,
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
    serde_json::from_str(&gh(&["pr", "view", pr, "--json", "baseRefName,mergeable,headRefOid,state,isDraft"])?).context("gh pr view: JSON lạ")
}

/// A branch that was the head of a merged PR (a stack root already landed).
fn merged_branch(gh: Gh, branch: &str) -> Result<bool> {
    let v: Value = serde_json::from_str(&gh(&["pr", "list", "--state", "merged", "--head", branch, "--json", "number", "--limit", "1"])?)?;
    Ok(v.as_array().is_some_and(|a| !a.is_empty()))
}

struct Ctx<'a> {
    home: &'a Path,
    root: &'a Path,
    who: Option<&'a str>,
    now: u64,
    /// The repo's default branch ([`default_branch`]).
    main: &'a str,
    /// Another repo's default branch, by `owner/repo` ([`default_branch_of`]).
    main_of: &'a dyn Fn(&str) -> Option<String>,
    /// This project's `owner/repo` ([`origin_repo`]), read only for a card without a PR field.
    origin: &'a dyn Fn() -> Option<String>,
    gh: Gh<'a>,
    /// Whether this run may really `gh pr merge`. The ungranted `auto merge` (owner 2026-10-22:
    /// "bị kẹt hoài vậy … auto ship chứ") still lands what needs no permission — a PR already
    /// merged is marked done, a conflict goes back to ready — and collects the rest for the one
    /// Ship question instead of stalling the whole board on it.
    merge_allowed: bool,
}

/// Pure: the PR a card without a `pr` field names in its notes, newest note first: `zus-backend#19
/// @b6d1e81`, `8-Sync-Dev/zus-backend#19`, or `#19` (this repo). With a reviewed `sha`, a note that
/// carries a commit must match it. The repo goes through [`target::pr_repo_for`]: this repo → None,
/// another repo of the same org → `Some`, another org → skipped. Owner 2026-10-21: 8 cards reviewed
/// `[review] OK zus-backend#N @sha` before 0.110.30 (no `--pr owner/repo#N` yet) sat in Approved
/// for 9 hours under a live Ship grant with "card không có PR".
pub(super) fn infer_pr(notes: &[target::Note], sha: Option<&str>, origin: &str) -> Option<(u64, Option<String>)> {
    let own_owner = origin.split('/').next().unwrap_or_default();
    // `strict`: only a note whose commit matches the reviewed sha. First that, then any note that
    // names a PR without a commit (a note with a different commit never counts).
    let scan = |strict: bool| -> Option<(u64, Option<String>)> {
        for n in notes.iter().rev() {
            let text = n.text.as_str();
            let mut i = 0;
            while let Some(off) = text[i..].find('#') {
                let at = i + off;
                i = at + 1;
                let digits: String = text[at + 1..].chars().take_while(char::is_ascii_digit).collect();
                if digits.is_empty() || digits.len() > 10 {
                    continue;
                }
                // The word glued to the left of `#`: `repo`, `owner/repo`, or nothing.
                let left = text[..at].rsplit(|c: char| c.is_whitespace() || matches!(c, '(' | '[' | ',' | ';' | ':')).next().unwrap_or_default();
                let repo = match left {
                    "" => None,
                    w if w.contains('/') => Some(w.to_string()),
                    w => Some(format!("{own_owner}/{w}")),
                };
                if repo.as_deref().is_some_and(|r| valid_repo(r).is_none()) {
                    continue;
                }
                let rest = &text[at + 1 + digits.len()..];
                let commit = rest.trim_start().strip_prefix('@').map(|r| r.trim_start().chars().take_while(char::is_ascii_hexdigit).collect::<String>()).filter(|c| c.len() >= 7);
                let matches = match (sha, commit.as_deref()) {
                    (Some(want), Some(got)) => want.starts_with(got) || got.starts_with(want),
                    (Some(_), None) => !strict,
                    (None, _) => true,
                };
                if !matches {
                    continue;
                }
                let Ok(repo) = repo.map_or(Ok(None), |r| target::pr_repo_for(&r, origin)) else { continue };
                return digits.parse().ok().map(|n| (n, repo));
            }
        }
        None
    };
    scan(true).or_else(|| sha.is_some().then(|| scan(false)).flatten())
}

/// Land one card; `first` defers a card stacked on a branch that is not merged yet. A card whose
/// PR is in another repo of the org (`pr_repo`) runs every `gh pr …` with `--repo` and lands into
/// that repo's default branch.
fn land(t: &Target, c: &Ctx, first: bool) -> Outcome {
    // No PR field: the review note may still name it ([`infer_pr`]); land with that.
    let inferred = t.pr.is_none().then(|| (c.origin)()).flatten().and_then(|o| infer_pr(&t.notes, t.sha.as_deref(), &o));
    let owned;
    let t = match inferred {
        Some((n, repo)) => {
            owned = Target { pr: Some(n.to_string()), pr_repo: repo, ..t.clone() };
            &owned
        }
        None => t,
    };
    let pr = t.pr.as_deref().and_then(pr_number);
    let repo = t.pr_repo.as_deref();
    let mut out = Outcome { id: t.id, pr, repo: t.pr_repo.clone(), action: "failed", sha: None, why: None };
    let Some(n) = pr else {
        out.action = "wait";
        out.why = Some("card không có PR và ghi chú không nêu `repo#N`: lead đặt `auto move <id> approved --pr …`".into());
        return out;
    };
    let main = match repo {
        None => c.main.to_string(),
        Some(r) => match (c.main_of)(r) {
            Some(m) => m,
            None => {
                out.action = "wait";
                out.why = Some(format!("không đọc được nhánh mặc định của {r} (gh): chạy lại sau"));
                return out;
            }
        },
    };
    let main = main.as_str();
    // Every gh call for a cross-repo PR names the repo.
    let gh = |args: &[&str]| -> Result<String> {
        let mut all: Vec<&str> = args.to_vec();
        if let Some(r) = repo {
            all.extend(["--repo", r]);
        }
        (c.gh)(&all)
    };
    let gh = &gh;
    let n = n.to_string();
    let label = target::pr_label(&n, repo);
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
        let evidence = |head: &str| {
            let short: String = head.chars().take(12).collect();
            match repo {
                Some(_) => format!("merged {label} @{short}"),
                None => format!("merged {short}"),
            }
        };
        Ok(match decide(&sha, &v, base_merged, main) {
            Step::Merge(head) if !c.merge_allowed => ("ask", None, Some("PR mở, chờ owner Duyệt tất cả (Ship)".into())),
            Step::Merge(head) => {
                // GitHub refuses to merge a draft; review already approved this head (4 failed
                // merges on 3d-game, 2026-10-20).
                if v["isDraft"] == true {
                    gh(&["pr", "ready", &n])?;
                }
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
            // GitHub computes `mergeable` lazily after every merge to main, so each landing left the
            // other approved cards on UNKNOWN for a minute (3d-game: 6 approved waited on 1 merge per
            // 2-min tick). The merge call itself decides: still the reviewed head (`--match-head-commit`)
            // and no conflict → it lands; otherwise GitHub refuses and the card waits for the verdict.
            Step::Computing => {
                let head = v["headRefOid"].as_str().unwrap_or_default().to_string();
                let tried = same_commit(&sha, &head) && v["isDraft"] != true && gh(&["pr", "merge", &n, "--squash", "--delete-branch", "--match-head-commit", &head]).is_ok();
                if tried || view(gh, &n).ok().is_some_and(|v| v["state"] == "MERGED") {
                    target::close(c.home, c.root, t.id, Some(&evidence(&head)), c.who, c.now)?;
                    ("merged", Some(head), None)
                } else {
                    ("wait", None, Some(computing(&label)))
                }
            }
        })
    })();
    match r {
        Ok((action, sha, why)) => (out.action, out.sha, out.why) = (action, sha, why),
        Err(e) => out.why = Some(format!("{e:#}")),
    }
    out
}

fn line(o: &Outcome) -> String {
    let pr = o.pr.map_or_else(|| "-".to_string(), |n| format!("PR {}", target::pr_label(&n.to_string(), o.repo.as_deref()).trim_start_matches('#')));
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
    // Landing is the lead's (it asks Ship). A lane room would merge on GitHub and then be refused
    // closing an owner card ([`target::close`]), leaving the card in approved for good.
    if let Some(lane) = who.and_then(super::room::find).and_then(|r| r.lane).filter(|l| *l != "backlog") {
        bail!("`auto merge` là việc của phòng lead, không phải phòng cột {lane}");
    }
    // Never guess `main`: on a master repo that would merge stacked PRs into the wrong branch.
    let Some(main) = default_branch(root) else { bail!(NO_DEFAULT) };
    let gh = |args: &[&str]| gh(root, args);
    let main_of = |repo: &str| default_branch_of(root, Some(repo));
    let origin = || origin_repo(root);
    if super::grant::self_merge(&super::grant::dir(home), root, now).is_none() {
        let approved: Vec<Target> = target::list(home, root)?.into_iter().filter(|t| t.state == "open" && t.lane == "approved").collect();
        if approved.is_empty() {
            println!("không có card approved");
            return Ok(());
        }
        // Free outcomes first (owner 2026-10-22: 19 of 27 approved cards on zus/ide had PRs merged
        // on GitHub the day before and sat in approved because one unmergeable card made the whole
        // run bail): done / back / retarget need no merge permission. What really needs
        // `gh pr merge` (or has no PR at all) goes into the owner's ONE Ship question.
        let c = Ctx { home, root, who: Some("lead"), now, main: &main, main_of: &main_of, origin: &origin, gh: &gh, merge_allowed: false };
        let mut left: Vec<Target> = Vec::new();
        for t in &approved {
            let mut o = land(t, &c, true);
            if o.action == "deferred" {
                o = land(t, &c, false);
            }
            match o.action.as_ref() {
                "ask" | "wait" | "failed" => left.push(t.clone()),
                a => println!("{a}: {}", line(&o)),
            }
        }
        if left.is_empty() {
            return Ok(());
        }
        bail!("{}", ship_question(&left));
    }
    run_with(as_json, &Ctx { home, root, who, now, main: &main, main_of: &main_of, origin: &origin, gh: &gh, merge_allowed: true })
}

/// HQ's revive tick (every 2 min): land approved cards in code while the owner's self-merge grant
/// holds, so the lead does not poll GitHub. 3d-game 2026-10-20: the lead looped `auto merge; sleep
/// 70` up to 16 times waiting on "mergeable UNKNOWN", splitting no card meanwhile. Without the grant,
/// or with nothing approved, nothing runs (no gh call). Lines for what happened, `wait` ones left out.
pub(super) fn background(home: &Path, root: &Path, now: u64) -> Result<Vec<String>> {
    if super::grant::self_merge(&super::grant::dir(home), root, now).is_none() {
        return Ok(Vec::new());
    }
    if !target::list(home, root)?.iter().any(|t| t.state == "open" && t.lane == "approved") {
        return Ok(Vec::new());
    }
    let Some(main) = default_branch(root) else { return Ok(Vec::new()) };
    let gh = |args: &[&str]| gh(root, args);
    let main_of = |repo: &str| default_branch_of(root, Some(repo));
    let origin = || origin_repo(root);
    let c = Ctx { home, root, who: Some("lead"), now, main: &main, main_of: &main_of, origin: &origin, gh: &gh, merge_allowed: true };
    // HQ kills a revive that runs past 120 s and each card is several gh calls (≤ 20 s each): start
    // no card after [`BACKGROUND_BUDGET`]. A card stacked on an approved card not landed yet is
    // deferred, not bounced: try the next.
    let mut cards: Vec<Target> = target::list(home, root)?.into_iter().filter(|t| t.state == "open" && t.lane == "approved").collect();
    cards.sort_by_key(|t| t.prio.unwrap_or(2));
    let started = std::time::Instant::now();
    let mut out = Vec::new();
    for t in &cards {
        if started.elapsed() > BACKGROUND_BUDGET {
            break;
        }
        let o = land(t, &c, true);
        if o.action != "deferred" && o.action != "wait" {
            out.push(format!("merge nền: {}", line(&o)));
        }
    }
    Ok(out)
}

/// How long one background pass keeps starting cards.
// Revive runs reap (≤ 15 s) and room checks first and a started card can take several gh calls:
// 20 s keeps the whole run inside HQ's 120 s revive timeout.
const BACKGROUND_BUDGET: std::time::Duration = std::time::Duration::from_secs(20);

/// Every approved card, most urgent first; one whose base is still landing goes after the rest.
fn land_all(c: &Ctx) -> Result<Vec<Outcome>> {
    let mut cards: Vec<Target> = target::list(c.home, c.root)?.into_iter().filter(|t| t.state == "open" && t.lane == "approved").collect();
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
    Ok(done)
}

fn run_with(as_json: bool, c: &Ctx) -> Result<()> {
    let approved = target::list(c.home, c.root)?.into_iter().filter(|t| t.state == "open" && t.lane == "approved").count();
    let done = land_all(c)?;
    let count = |a: &str| done.iter().filter(|o| o.action == a).count();
    let (merged, back) = (count("merged") + count("done"), count("ready") + count("blocked") + count("review"));
    if as_json {
        let list: Vec<Value> = done.iter().map(|o| json!({ "id": o.id, "pr": o.pr, "pr_repo": o.repo, "action": o.action, "sha": o.sha, "why": o.why })).collect();
        println!("{}", json!({ "cards": list, "merged": merged, "returned": back, "approved": approved }));
        return Ok(());
    }
    if approved == 0 {
        println!("không có card approved");
        return Ok(());
    }
    for o in &done {
        println!("{}", line(o));
    }
    println!("merge {merged}/{approved} card approved · {back} về ready/review · {} chờ/lỗi", approved - merged - back);
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
    fn a_card_without_a_pr_field_lands_the_pr_its_review_note_names() {
        let note = |text: &str| target::Note { at: 1, room: Some("review".into()), text: text.into() };
        let origin = "8-Sync-Dev/zus";
        // The owner's 8 cards (2026-10-21): `[review] OK zus-backend#19 @b6d1e81 (base main, không stack)`.
        let notes = vec![note("ready → review: PR lên"), note("[review] OK zus-backend#19 @b6d1e81 (base main, không stack): text-only")];
        assert_eq!(infer_pr(&notes, Some("b6d1e810f5cbf53f94fbc8198fcd9b0f9848866e"), origin), Some((19, Some("8-Sync-Dev/zus-backend".into()))));
        assert_eq!(infer_pr(&notes, Some("deadbeef0000"), origin), None, "a note for another commit is not this card's PR");
        assert_eq!(infer_pr(&notes, None, origin), Some((19, Some("8-Sync-Dev/zus-backend".into()))), "no reviewed sha: the newest note wins");
        // Newest note first; `owner/repo#N`; this repo's own PR → no repo; another org → skipped.
        let many = vec![note("[review] OK #41 @abc1234"), note("[qa] pass 8-Sync-Dev/zus-backend#7"), note("thấy evil/zus-backend#9 @abc1234 nhưng không phải của ta")];
        assert_eq!(infer_pr(&many, Some("abc1234"), origin), Some((41, None)), "the evil-org note is skipped, then #41 matches the sha");
        assert_eq!(infer_pr(&many, None, origin), Some((7, Some("8-Sync-Dev/zus-backend".into()))), "newest usable note: the org PR without a commit (the evil one is skipped)");
        assert_eq!(infer_pr(&[note("card #2 con của #1: xong")], Some("abc"), origin), Some((2, None)), "a bare `#N` is this repo's PR (the first in the note; no commit anywhere → the lax pass)");
        assert_eq!(infer_pr(&[note("không có gì")], None, origin), None);
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
        assert_eq!(d("0123456", &pr("main", "UNKNOWN", HEAD, "OPEN"), false), Step::Computing, "UNKNOWN is no conflict");
        assert_eq!(d("0123456", &pr("main", "", HEAD, "OPEN"), false), Step::Computing);
        assert_eq!(computing("#116"), "GitHub đang tính mergeable của PR #116: thử lại sau 1 phút");
        assert_eq!(d("0123456", &pr("main", "UNKNOWN", HEAD, "MERGED"), false), Step::Done(HEAD.into()));
        assert!(matches!(d("0123456", &pr("card-125-ui", "UNKNOWN", HEAD, "MERGED"), false), Step::Back(w) if w.contains("card-125-ui")));
        assert!(matches!(d("0123456", &pr("main", "MERGEABLE", HEAD, "CLOSED"), false), Step::Back(_)));
        // A master repo: master is the base, main is just another branch.
        assert_eq!(decide("0123456", &pr("master", "MERGEABLE", HEAD, "OPEN"), false, "master"), Step::Merge(HEAD.into()));
        assert!(matches!(decide("0123456", &pr("main", "MERGEABLE", HEAD, "OPEN"), false, "master"), Step::Back(_)));
    }

    #[test]
    fn only_a_plain_match_head_merge_command_parses() {
        assert_eq!(merge_command(&format!("gh pr merge 81 --squash --delete-branch --match-head-commit {HEAD}")), Some((81, None, HEAD.into())));
        let cross = Some((8, Some("8-Sync-Dev/zus-backend".to_string()), HEAD.to_string()));
        assert_eq!(merge_command(&format!("gh pr merge 8 --repo 8-Sync-Dev/zus-backend --squash --delete-branch --match-head-commit {HEAD}")), cross);
        assert_eq!(merge_command(&format!("gh pr merge 8 -R 8-Sync-Dev/zus-backend --match-head-commit {HEAD}")), cross);
        assert_eq!(merge_command(&format!("gh pr merge 8 --repo=8-Sync-Dev/zus-backend --match-head-commit {HEAD}")), cross);
        for bad in [
            format!("gh pr merge #81 --match-head-commit {HEAD}"),
            format!("gh pr merge https://github.com/evil/x/pull/81 --match-head-commit {HEAD}"),
            format!("gh pr merge 81 --match-head-commit {HEAD} # note"),
            format!("gh pr merge 81x --match-head-commit {HEAD}"),
            format!("gh pr merge 8 --repo zus-backend --match-head-commit {HEAD}"),
            format!("gh pr merge 8 --repo o/r --repo o/x --match-head-commit {HEAD}"),
            format!("gh pr merge 8 --repo --match-head-commit {HEAD}"),
        ] {
            assert_eq!(merge_command(&bad), None, "{bad}");
        }
        for bad in [
            "gh pr merge 81 --squash".to_string(),
            format!("gh pr merge 81 --admin --match-head-commit {HEAD}"),
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
        assert_eq!(approved_merge(81, None, HEAD, &cards, main), Some(5));
        assert_eq!(approved_merge(81, None, "fedcba9876", &cards, main), None, "another commit");
        assert_eq!(approved_merge(82, None, HEAD, &cards, main), None, "not approved");
        assert_eq!(approved_merge(83, None, HEAD, &cards, main), None, "no card");
        assert_eq!(approved_merge(81, Some("o/x"), HEAD, &cards, main), None, "another repo than the card's");
        assert_eq!(approved_merge(81, None, HEAD, &cards, || Some(("card-125-ui".into(), "main".into()))), None, "stacked base");
        assert_eq!(approved_merge(81, None, HEAD, &cards, || None), None, "gh failed");
        assert_eq!(approved_merge(81, None, HEAD, &cards, || Some(("master".into(), "master".into()))), Some(5), "master repo");
        assert_eq!(approved_merge(81, None, HEAD, &cards, || Some(("main".into(), "master".into()))), None, "main is not the default");
        // A card whose PR lives in another repo of the org: only that repo, number and SHA.
        let mut cross = card(9, "approved", "8", "0123456");
        cross.pr_repo = Some("8-Sync-Dev/zus-backend".into());
        let cards = vec![cross];
        let develop = || Some(("develop".to_string(), "develop".to_string()));
        assert_eq!(approved_merge(8, Some("8-Sync-Dev/zus-backend"), HEAD, &cards, develop), Some(9));
        assert_eq!(approved_merge(8, Some("8-sync-dev/ZUS-backend"), HEAD, &cards, develop), Some(9), "GitHub names are case-insensitive");
        assert_eq!(approved_merge(8, None, HEAD, &cards, develop), None, "same number in this repo is another PR");
        assert_eq!(approved_merge(8, Some("8-Sync-Dev/other"), HEAD, &cards, develop), None);
        assert_eq!(approved_merge(8, Some("8-Sync-Dev/zus-backend"), "fedcba9876", &cards, develop), None, "another commit");
        assert_eq!(approved_merge(8, Some("8-Sync-Dev/zus-backend"), HEAD, &cards, || Some(("main".into(), "develop".into()))), None, "not that repo's default branch");
    }

    /// Owner 2026-10-22 ("bị kẹt hoài"): without the grant, `auto merge` still lands what needs
    /// no permission — a card whose PR is already merged is done — and the OPEN one is only "ask",
    /// never `gh pr merge`.
    #[test]
    fn ungranted_lands_merged_prs_and_never_merges_open_ones() {
        let h = std::env::temp_dir().join(format!("8sync-merge-declog-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&h);
        let root = h.join("r");
        std::fs::create_dir_all(&root).unwrap();
        // `move_to` validates a `--pr` against the real gh; the fixture sets the sha on the card
        // (what approved requires) and the PR number in memory, which is all `land` reads.
        let mk = |pr: &str| {
            let (t, _) = target::add(&h, &root, &format!("việc {pr}"), Some("true"), None, false, None, 1).unwrap();
            for lane in ["building", "qa", "review", "approved"] {
                target::move_to(&h, &root, t.id, lane, &target::Move { sha: Some("0d596904e5cbf53f94fbc8198fcd9b0f9848866e".into()), ..Default::default() }, None, 2).unwrap();
            }
            let mut c = target::list(&h, &root).unwrap().into_iter().find(|c| c.id == t.id).unwrap();
            c.pr = Some(pr.into());
            c
        };
        let a = mk("61");
        let b = mk("62");
        let merged = json!({ "state": "MERGED", "baseRefName": "main", "headRefOid": "0d596904e5cbf53f94fbc8198fcd9b0f9848866e", "mergeable": "MERGEABLE", "isDraft": false });
        let open = json!({ "state": "OPEN", "baseRefName": "main", "headRefOid": "0d596904e5cbf53f94fbc8198fcd9b0f9848866e", "mergeable": "MERGEABLE", "isDraft": false });
        let main_of = |r: &str| (r == "main").then(|| "main".to_string()).or_else(|| Some("main".to_string()));
        let origin = || Some("o/r".to_string());
        let gh_merged = |_: &[&str]| Ok(merged.to_string());
        let gh_open = |args: &[&str]| {
            assert!(!args.contains(&"merge"), "no gh pr merge without the grant: {args:?}");
            Ok(open.to_string())
        };
        let c1 = Ctx { home: &h, root: &root, who: Some("lead"), now: 1_000, main: "main", main_of: &main_of, origin: &origin, gh: &gh_merged, merge_allowed: false };
        let o = land(&a, &c1, true);
        assert_eq!(o.action, "done", "{:?} - a merged PR needs no permission", o.why);
        assert_eq!(target::list(&h, &root).unwrap().into_iter().find(|c| c.id == a.id).unwrap().state, "done");
        let c2 = Ctx { home: &h, root: &root, who: Some("lead"), now: 1_000, main: "main", main_of: &main_of, origin: &origin, gh: &gh_open, merge_allowed: false };
        let o = land(&b, &c2, true);
        assert_eq!(o.action, "ask", "{:?}", o.why);
        let _ = std::fs::remove_dir_all(&h);
    }

    #[test]
    fn the_ship_refusal_carries_the_exact_question() {
        let mut other = card(7, "approved", "https://github.com/o/r/pull/90", "0123456");
        other.pr_repo = Some("o/zus-backend".into());
        let cards = vec![card(5, "approved", "81", "0123456"), other];
        let out = ship_question(&cards);
        assert!(out.starts_with(NO_PERMISSION) && NO_PERMISSION.contains("trước `auto wait`"), "{out}");
        let q: Value = serde_json::from_str(out.lines().last().unwrap()).unwrap();
        let q = &q["questions"][0];
        assert_eq!(q["header"], "Ship");
        assert_eq!(q["question"], "Merge 2 card approved: #5 (PR #81), #7 (PR zus-backend#90)?");
        let labels: Vec<&str> = q["options"].as_array().unwrap().iter().map(|o| o["label"].as_str().unwrap()).collect();
        assert_eq!(labels, ["Duyệt tất cả (Recommended)", "Chỉ merge, chưa deploy", "Chỉ merge, tự merge 24h", "Dừng"]);
    }

    #[test]
    fn default_branch_asks_gh_once_caches_it_and_never_guesses() {
        let d = std::env::temp_dir().join(format!("8sync-defbranch-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        let cache = d.join("state/default-branch.json");
        let calls = std::cell::Cell::new(0);
        let master = || {
            calls.set(calls.get() + 1);
            Some("master\n".to_string())
        };
        assert_eq!(cached(Some(&cache), "k", 100, &valid_branch, &master).as_deref(), Some("master"));
        assert_eq!(cached(Some(&cache), "k", 200, &valid_branch, &master).as_deref(), Some("master"));
        assert_eq!(calls.get(), 1, "cached");
        assert_eq!(cached(Some(&cache), "8-Sync-Dev/zus-backend", 200, &valid_branch, &|| Some("develop".into())).as_deref(), Some("develop"), "another repo, its own key");
        assert_eq!(cached(Some(&cache), "k", 200, &valid_branch, &|| None).as_deref(), Some("master"), "the first key is untouched");
        assert_eq!(cached(Some(&cache), "k", 100 + DEFAULT_TTL_S, &valid_branch, &|| None), None, "stale cache, gh down: no guess");
        assert_eq!(cached(None, "k", 0, &valid_branch, &|| Some("--evil".into())), None);
        assert_eq!(valid_repo(" 8-Sync-Dev/zus-backend "), Some("8-Sync-Dev/zus-backend"));
        for bad in ["zus-backend", "a/b/c", "-a/b", "a/-b", "a/b c", "/b", "a/"] {
            assert_eq!(valid_repo(bad), None, "{bad}");
        }
        let _ = std::fs::remove_dir_all(&d);
    }

    /// [`landed_pr`] with a mergeable, non-draft PR on `base`.
    fn landed(base: &str, main: &str) -> (Vec<String>, Target) {
        landed_pr(pr(base, "MERGEABLE", HEAD, "OPEN"), main)
    }

    /// A board in a temp home with one approved card (PR 81 at 0123456), `gh pr view` answering `view`.
    fn landed_pr(view: Value, main: &str) -> (Vec<String>, Target) {
        landed_in(view, main, None)
    }

    /// [`landed_pr`] whose card's PR is `pr_repo` (number 8 there; default branch `develop`).
    fn landed_in(view: Value, main: &str, pr_repo: Option<&str>) -> (Vec<String>, Target) {
        let tag = format!("{}-{}-{main}-{}", view["baseRefName"].as_str().unwrap_or(""), view["isDraft"], pr_repo.is_some());
        let home = std::env::temp_dir().join(format!("8sync-merge-land-{}-{tag}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        let root = home.join("game");
        std::fs::create_dir_all(root.join(".git")).unwrap();
        let key = super::super::auto::canon(&root).to_string_lossy().into_owned();
        let board = super::super::idle::state_dir(&home).parent().unwrap().join("targets.json");
        std::fs::create_dir_all(board.parent().unwrap()).unwrap();
        let mut c = json!({ "id": 1, "text": "x", "added": 0, "state": "open", "lane": "approved", "pr": "81", "sha": "0123456", "check": "true" });
        if let Some(r) = pr_repo {
            c["pr"] = json!("8");
            c["pr_repo"] = json!(r);
        }
        std::fs::write(&board, json!({ "projects": { key: { "next_id": 2, "items": [c] } } }).to_string()).unwrap();
        let calls = std::cell::RefCell::new(Vec::new());
        let gh = |args: &[&str]| -> Result<String> {
            calls.borrow_mut().push(args.join(" "));
            Ok(match args[..2] {
                ["pr", "view"] => view.to_string(),
                ["pr", "list"] => "[{\"number\":80}]".into(),
                _ => String::new(),
            })
        };
        let main_of = |r: &str| (r == "8-Sync-Dev/zus-backend").then(|| "develop".to_string());
        let origin = || Some("8-Sync-Dev/zus".to_string());
        let ctx = Ctx { home: &home, root: &root, who: None, now: 1_000, main, main_of: &main_of, origin: &origin, gh: &gh, merge_allowed: true };
        run_with(true, &ctx).unwrap();
        let card = target::list(&home, &root).unwrap().into_iter().find(|t| t.id == 1).unwrap();
        let _ = std::fs::remove_dir_all(&home);
        (calls.into_inner(), card)
    }

    #[test]
    fn a_cross_repo_card_merges_in_that_repo_into_its_default_branch() {
        let (calls, card) = landed_in(pr("develop", "MERGEABLE", HEAD, "OPEN"), "main", Some("8-Sync-Dev/zus-backend"));
        assert_eq!(calls[0], "pr view 8 --json baseRefName,mergeable,headRefOid,state,isDraft --repo 8-Sync-Dev/zus-backend");
        assert!(calls.iter().any(|c| c == &format!("pr merge 8 --squash --delete-branch --match-head-commit {HEAD} --repo 8-Sync-Dev/zus-backend")), "{calls:?}");
        assert_eq!(card.state, "done");
        assert_eq!(card.evidence.as_deref(), Some("merged zus-backend#8 @0123456789ab"));
        // Into this repo's main instead: a stacked PR there, retargeted to develop with --repo.
        let (calls, card) = landed_in(pr("main", "MERGEABLE", HEAD, "OPEN"), "main", Some("8-Sync-Dev/zus-backend"));
        assert!(!calls.iter().any(|c| c.starts_with("pr merge")) && calls.iter().any(|c| c == "pr edit 8 --base develop --repo 8-Sync-Dev/zus-backend"), "{calls:?}");
        assert_eq!(card.lane, "review");
        // That repo's default branch unknown: the card waits, no gh pr call.
        let (calls, card) = landed_in(pr("main", "MERGEABLE", HEAD, "OPEN"), "main", Some("8-Sync-Dev/other"));
        assert!(calls.is_empty(), "{calls:?}");
        assert_eq!((card.state.as_str(), card.lane.as_str()), ("open", "approved"));
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

    #[test]
    fn an_approved_draft_is_marked_ready_before_the_merge() {
        let mut draft = pr("main", "MERGEABLE", HEAD, "OPEN");
        draft["isDraft"] = json!(true);
        let (calls, card) = landed_pr(draft, "main");
        let at = |p: &str| calls.iter().position(|c| c.starts_with(p));
        assert!(at("pr ready 81").is_some() && at("pr ready 81") < at("pr merge 81"), "{calls:?}");
        assert_eq!(card.state, "done");
        let (calls, _) = landed("main", "main");
        assert!(!calls.iter().any(|c| c.starts_with("pr ready")) && calls.iter().any(|c| c.starts_with("pr merge 81")), "a ready PR is merged as is: {calls:?}");
    }

    #[test]
    fn only_the_backlog_rooms_land_cards() {
        let d = std::env::temp_dir().join(format!("8sync-merge-who-{}", std::process::id()));
        for who in ["review", "dev2", "qa"] {
            let e = run(false, &d, &d, Some(who), 0).unwrap_err().to_string();
            assert!(e.contains("phòng lead"), "{who}: {e}");
        }
    }
}
