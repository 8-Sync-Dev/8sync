//! `8sync learn trending` — find new, popular GitHub repos for the R&D session to learn from.
//!
//! Why the official search API and not github.com/trending: scraping the trending page is
//! against GitHub's ToS and breaks whenever the HTML changes. The REST search endpoint
//! (`created:>DATE stars:>50`, sorted by stars) is documented, stable and gives a close
//! approximation. Unauthenticated (10 req/min, one request per run); no token is read.
//! The response is untrusted data: only a few typed fields are parsed and the description is
//! truncated before it reaches the markdown table.

use std::path::PathBuf;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{anyhow, bail, Context, Result};
use clap::{Args as ClapArgs, Subcommand};
use serde::{Deserialize, Serialize};

#[derive(ClapArgs, Debug)]
pub struct Args {
    #[command(subcommand)]
    pub cmd: LearnCmd,
}

#[derive(Subcommand, Debug)]
pub enum LearnCmd {
    /// Repo mới nổi bật gần đây (GitHub search API chính thức, không scrape trang trending)
    #[command(after_help = "Ví dụ:\n  8sync learn trending\n  8sync learn trending --lang rust --days 14 --top 10\n  8sync learn trending --json")]
    Trending {
        /// Ngôn ngữ GitHub (vd rust, typescript, \"c++\")
        #[arg(long)]
        lang: Option<String>,
        /// Chỉ lấy repo tạo trong N ngày qua
        #[arg(long, default_value_t = 7)]
        days: u32,
        /// Số repo tối đa (1-100)
        #[arg(long, default_value_t = 25)]
        top: u32,
        /// In JSON thay vì ghi file markdown
        #[arg(long)]
        json: bool,
        /// Thư mục ghi (mặc định <project>/su-code/research/trending)
        #[arg(long)]
        out: Option<PathBuf>,
        /// Ghi đè file của hôm nay nếu đã có
        #[arg(long)]
        force: bool,
    },
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct License {
    pub spdx_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Repo {
    pub full_name: String,
    pub html_url: String,
    #[serde(default)]
    pub stargazers_count: u64,
    pub description: Option<String>,
    pub license: Option<License>,
    pub language: Option<String>,
}

#[derive(Deserialize)]
struct SearchResp {
    items: Vec<Repo>,
}

pub fn run(a: Args) -> Result<()> {
    match a.cmd {
        LearnCmd::Trending { lang, days, top, json, out, force } => trending(lang, days, top, json, out, force),
    }
}

fn trending(lang: Option<String>, days: u32, top: u32, json: bool, out: Option<PathBuf>, force: bool) -> Result<()> {
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let today = ymd_from_days((now / 86_400) as i64);
    let top = top.clamp(1, 100);
    let url = query_url(lang.as_deref(), days, top, now / 86_400);

    let dir = match out {
        Some(p) => p,
        None => {
            let root = crate::verbs::skill::discover::detect_current_project_root()
                .or_else(|| std::env::current_dir().ok())
                .ok_or_else(|| anyhow!("không xác định được thư mục project"))?;
            root.join("su-code/research/trending")
        }
    };
    let path = dir.join(format!("{today}.md"));
    if !json && !force && path.exists() {
        println!("đã có {} (dùng --force để ghi lại)", path.display());
        return Ok(());
    }

    let mut items = fetch(&url)?;
    items.retain(|r| !is_noise(r));
    if json {
        println!("{}", serde_json::to_string_pretty(&items)?);
        return Ok(());
    }
    let desc = match &lang {
        Some(l) => format!("{days} ngày qua, ngôn ngữ {l}"),
        None => format!("{days} ngày qua"),
    };
    let md = render(&items, &desc, &today);
    std::fs::create_dir_all(&dir).with_context(|| format!("tạo {}", dir.display()))?;
    std::fs::write(&path, &md).with_context(|| format!("ghi {}", path.display()))?;
    println!("{}", path.display());
    for r in items.iter().filter(|r| valid_full_name(&r.full_name)).take(5) {
        println!("{} ⭐{} {}", r.full_name, r.stargazers_count, safe_url(r));
    }
    Ok(())
}

/// Repos the R&D session should not be handed (adult content shows up in star-sorted search).
fn is_noise(r: &Repo) -> bool {
    let hay = format!("{} {}", r.full_name, r.description.as_deref().unwrap_or("")).to_lowercase();
    ["nsfw", "porn", "hentai"].iter().any(|w| hay.contains(w))
}

/// Percent-encode a query value; spaces become `+`.
fn enc(s: &str) -> String {
    let mut o = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => o.push(b as char),
            b' ' => o.push('+'),
            _ => o.push_str(&format!("%{b:02X}")),
        }
    }
    o
}

fn query_url(lang: Option<&str>, days: u32, top: u32, today_days: u64) -> String {
    let days = days.clamp(1, 3650);
    let since = ymd_from_days(today_days as i64 - days as i64);
    let mut q = format!("created:>{since}+stars:>50");
    if let Some(l) = lang.map(str::trim).filter(|l| !l.is_empty()) {
        q.push_str(&format!("+language:{}", enc(l)));
    }
    format!("https://api.github.com/search/repositories?q={q}&sort=stars&order=desc&per_page={top}")
}

/// Days since 1970-01-01 → `YYYY-MM-DD` (Howard Hinnant's civil_from_days).
fn ymd_from_days(days: i64) -> String {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!("{y:04}-{m:02}-{d:02}")
}

fn fetch(url: &str) -> Result<Vec<Repo>> {
    let out = Command::new("curl")
        .args([
            "-s", "--proto", "=https", "--max-time", "12", "-A", "8sync-learn",
            "-H", "Accept: application/vnd.github+json",
            "-H", "X-GitHub-Api-Version: 2022-11-28",
            url,
        ])
        .output()
        .context("không chạy được curl")?;
    if !out.status.success() {
        bail!("không gọi được GitHub API (curl thoát {}) — kiểm tra mạng rồi thử lại", out.status);
    }
    parse_response(&out.stdout)
}

fn parse_response(body: &[u8]) -> Result<Vec<Repo>> {
    let v: serde_json::Value =
        serde_json::from_slice(body).map_err(|e| anyhow!("GitHub API trả về dữ liệu không hợp lệ: {e}"))?;
    if v.get("items").is_none() {
        let msg = v.get("message").and_then(|m| m.as_str()).unwrap_or("không rõ lỗi");
        if msg.to_ascii_lowercase().contains("rate limit") {
            bail!("GitHub API đang giới hạn tốc độ (rate limit, 10 req/phút khi chưa đăng nhập) — đợi ~1 phút rồi chạy lại");
        }
        bail!("GitHub API từ chối yêu cầu: {}", msg.chars().take(200).collect::<String>());
    }
    Ok(serde_json::from_value::<SearchResp>(v).map_err(|e| anyhow!("GitHub API trả về dữ liệu không hợp lệ: {e}"))?.items)
}

fn truncate(s: &str, max: usize) -> String {
    let one: String = s.split_whitespace().collect::<Vec<_>>().join(" ");
    if one.chars().count() > max {
        format!("{}…", one.chars().take(max).collect::<String>())
    } else {
        one
    }
}

/// `owner/repo` made only of GitHub-legal characters; anything else is dropped as untrusted.
pub(crate) fn valid_full_name(n: &str) -> bool {
    let ok = |s: &str| !s.is_empty() && s.len() <= 100 && s.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'));
    matches!(n.split_once('/'), Some((o, r)) if ok(o) && ok(r))
}

/// A table cell: no pipes, no link/image/HTML syntax, no control characters (the file is read by an agent).
fn cell(s: &str) -> String {
    let flat: String = s
        .chars()
        .filter(|c| !c.is_control() && !matches!(c, '[' | ']' | '(' | ')' | '<' | '>' | '!' | '`' | '\\'))
        .map(|c| if c == '|' { '¦' } else { c })
        .collect();
    // No URLs in free text either: renderers auto-link them and the agent would follow.
    flat.split_whitespace().filter(|w| !w.contains("://") && !w.starts_with("www.")).collect::<Vec<_>>().join(" ")
}

/// The only link we emit: GitHub's own URL when it is plain, else one rebuilt from the validated name.
fn safe_url(r: &Repo) -> String {
    let plain = r.html_url.starts_with("https://github.com/") && r.html_url.chars().all(|c| c.is_ascii_alphanumeric() || "/-_.:".contains(c));
    if plain { r.html_url.clone() } else { format!("https://github.com/{}", r.full_name) }
}

pub fn render(items: &[Repo], query_desc: &str, date: &str) -> String {
    let mut s = format!("# GitHub trending (xấp xỉ) — {date}\n\n");
    s.push_str(&format!(
        "Repo tạo trong {query_desc}, ≥50 sao, sắp theo sao — API search chính thức, không phải trang trending.\n\n"
    ));
    s.push_str("| # | Repo | ⭐ | Licence | Mô tả | Có ích cho 8sync vì |\n|---|---|---|---|---|---|\n");
    for (i, r) in items.iter().filter(|r| valid_full_name(&r.full_name)).enumerate() {
        let lic = cell(r.license.as_ref().and_then(|l| l.spdx_id.as_deref()).filter(|l| !l.is_empty()).unwrap_or("—"));
        let d = cell(&truncate(r.description.as_deref().unwrap_or(""), 100));
        // The API answer is data: the only link is a github.com URL made of safe characters.
        let url = safe_url(r);
        s.push_str(&format!(
            "| {} | [{}]({}) | {} | {} | {} | |\n",
            i + 1,
            r.full_name,
            url,
            r.stargazers_count,
            lic,
            d
        ));
    }
    s.push_str("\n## Cách dùng: `8sync skill learn <owner/repo>` để chắt lọc thành skill (chỉ repo có licence).\n");
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> String {
        let long = "x".repeat(200);
        format!(
            r#"{{"total_count":3,"items":[
 {{"full_name":"a/one","html_url":"https://github.com/a/one","stargazers_count":900,"description":"First","license":{{"spdx_id":"MIT"}},"language":"Rust"}},
 {{"full_name":"b/two","html_url":"https://github.com/b/two","stargazers_count":500,"description":null,"license":null,"language":null}},
 {{"full_name":"c/three","html_url":"https://github.com/c/three","stargazers_count":60,"description":"{long}","license":{{"spdx_id":"Apache-2.0"}},"language":"Go"}}
]}}"#
        )
    }

    #[test]
    fn learn_renders_fixture() {
        let items = parse_response(fixture().as_bytes()).unwrap();
        let md = render(&items, "7 ngày qua", "2026-10-15");
        assert!(md.starts_with("# GitHub trending (xấp xỉ) — 2026-10-15"));
        let rows = md.lines().filter(|l| l.starts_with("| ") && l.contains("github.com")).count();
        assert_eq!(rows, 3);
        assert!(md.contains("| — |"));
        let long_row = md.lines().find(|l| l.contains("c/three")).unwrap();
        assert!(long_row.contains("…"));
        assert!(!long_row.contains(&"x".repeat(101)));
    }

    #[test]
    fn learn_render_only_links_github_urls() {
        let mut items = parse_response(fixture().as_bytes()).unwrap();
        items[0].html_url = "javascript:alert(1)".into();
        items[1].html_url = "https://github.com/b/two)[x](https://evil".into();
        let md = render(&items, "7 ngày qua", "2026-10-15");
        assert!(!md.contains("javascript:") && !md.contains("evil"), "{md}");
        assert!(md.contains("[a/one](https://github.com/a/one)"));
    }

    #[test]
    fn learn_filters_noise() {
        let mut items = parse_response(fixture().as_bytes()).unwrap();
        items[1].description = Some("NSFW pose pack".into());
        items.retain(|r| !is_noise(r));
        assert_eq!(items.iter().map(|r| r.full_name.as_str()).collect::<Vec<_>>(), ["a/one", "c/three"]);
    }

    #[test]
    fn learn_render_neutralises_hostile_fields() {
        let mut items = parse_response(fixture().as_bytes()).unwrap();
        items[0].description = Some("see [here](http://evil.test) <img src=x onerror=1> ![i](http://x) `rm` \u{1b}[31m| x".into());
        items[0].license = Some(License { spdx_id: Some("[MIT](http://evil.test)".into()) });
        items[1].full_name = "bad name/with space](http://evil.test)".into();
        items[2].full_name = "../../etc/passwd".into();
        let full = render(&items, "7 ngày qua", "2026-01-01");
        let md: String = full.lines().filter(|l| l.starts_with("| ")).collect::<Vec<_>>().join("\n");
        assert!(!md.contains("evil.test"), "{md}");
        assert!(!md.contains("<img") && !md.contains("![") && !md.contains('\u{1b}') && !md.contains('`'), "{md}");
        assert!(md.contains("| 1 | [a/one](https://github.com/a/one) |"), "{md}");
        assert!(!md.contains("passwd") && !md.contains("with space"));
        assert_eq!(md.lines().count(), 2, "header + the one valid row: {md}");
        assert!(valid_full_name("a-b.c_d/e.f-g_h") && !valid_full_name("a//b") && !valid_full_name("a/b/c") && !valid_full_name("ab"));
    }

    #[test]
    fn learn_date_math() {
        assert_eq!(ymd_from_days(0), "1970-01-01");
        assert_eq!(ymd_from_days(19_723), "2024-01-01");
        assert_eq!(ymd_from_days(19_723 - 7), "2023-12-25");
        assert_eq!(ymd_from_days(19_782), "2024-02-29");
    }

    #[test]
    fn learn_query_string() {
        assert_eq!(
            query_url(Some("c++ x"), 7, 25, 19_723),
            "https://api.github.com/search/repositories?q=created:>2023-12-25+stars:>50+language:c%2B%2B+x&sort=stars&order=desc&per_page=25"
        );
        assert!(!query_url(None, 7, 25, 19_723).contains("language"));
    }

    #[test]
    fn learn_rate_limit_message() {
        let e = parse_response(br#"{"message":"API rate limit exceeded for 1.2.3.4"}"#).unwrap_err();
        assert!(e.to_string().contains("rate limit"));
    }
}
