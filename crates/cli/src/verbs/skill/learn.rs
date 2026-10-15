//! `8sync skill learn <owner/repo|url|path:/dir> [--name n] [--force]` —
//! distil a public repo's README into a token-lean LOCAL skill:
//! `~/.claude/skills/<name>/{SKILL.md, refs/README.md, refs/LICENSE}`.
//! The clone's `.git` is deleted; nothing is registered or committed.
use anyhow::{anyhow, Result};
use std::path::{Path, PathBuf};

use super::spec::{git_clone_at, github_owner_repo, resolve_head_sha};
use crate::{env_detect, ui};

const BUDGET: usize = 6144;

#[derive(Debug, PartialEq)]
pub(crate) enum Licence {
    Allowed(String),
    Refused(String),
}

/// Classify a licence text by its first 40 lines.
pub(crate) fn classify_licence(text: &str) -> Licence {
    let head: String = text.lines().take(40).collect::<Vec<_>>().join("\n").to_lowercase();
    let has = |s: &str| head.contains(s);
    let ref_nc = |why: &str| Licence::Refused(format!("licence cấm dùng thương mại/dẫn xuất ({why}); xin phép tác giả hoặc dùng --force để chỉ lưu ghi chú 1 trang do bạn tự viết"));
    let ok = |id: &str| Licence::Allowed(id.to_string());
    if has("noncommercial") || has("non-commercial") { return ref_nc("NC"); }
    if has("noderivatives") || has("no derivatives") { return ref_nc("ND"); }
    if has("lesser general public") { return ok("LGPL (copyleft; đừng chép code vào sản phẩm)"); }
    if has("affero general public") { return ok("AGPL (copyleft; đừng chép code vào sản phẩm)"); }
    if has("gnu general public license") { return ok("GPL (copyleft; đừng chép code vào sản phẩm)"); }
    if has("mozilla public license") { return ok("MPL-2.0"); }
    if has("apache license") { return ok("Apache-2.0"); }
    if has("attribution-sharealike 4.0") { return ok("CC BY-SA 4.0"); }
    if has("attribution 4.0 international") { return ok("CC BY 4.0"); }
    if has("cc0") || has("creative commons zero") { return ok("CC0"); }
    if has("unlicense") || has("free and unencumbered software") { return ok("Unlicense"); }
    if has("permission is hereby granted, free of charge") { return ok("MIT"); }
    if has("permission to use, copy, modify, and/or distribute") { return ok("ISC"); }
    if has("redistribution and use in source and binary forms") {
        return ok(if has("neither the name") { "BSD-3-Clause" } else { "BSD-2-Clause" });
    }
    if has("all rights reserved") {
        return Licence::Refused("all rights reserved; xin phép tác giả hoặc dùng --force để chỉ lưu ghi chú 1 trang do bạn tự viết".into());
    }
    Licence::Refused("không nhận diện được licence; xin phép tác giả hoặc dùng --force để chỉ lưu ghi chú 1 trang do bạn tự viết".into())
}

fn find_root_file(dir: &Path, names: &[&str]) -> Option<PathBuf> {
    for e in std::fs::read_dir(dir).ok()?.flatten() {
        let f = e.file_name().to_string_lossy().to_lowercase();
        if names.contains(&f.as_str()) && e.path().is_file() {
            return Some(e.path());
        }
    }
    None
}

/// Remove HTML tags, images, link targets and anchors; collapse whitespace.
fn clean(s: &str) -> String {
    let mut out = String::new();
    let mut in_tag = false;
    for c in s.chars() {
        match c {
            '<' => in_tag = true,
            '>' if in_tag => in_tag = false,
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    // images ![alt](url) → dropped; links [t](url) → t
    let ch: Vec<char> = out.chars().collect();
    let mut r = String::new();
    let mut i = 0;
    while i < ch.len() {
        let img = ch[i] == '!' && ch.get(i + 1) == Some(&'[');
        if img || ch[i] == '[' {
            let st = if img { i + 1 } else { i };
            if let Some(cb) = (st..ch.len()).find(|&j| ch[j] == ']') {
                if ch.get(cb + 1) == Some(&'(') {
                    if let Some(cp) = (cb + 2..ch.len()).find(|&j| ch[j] == ')') {
                        if !img {
                            r.extend(&ch[st + 1..cb]);
                        }
                        i = cp + 1;
                        continue;
                    }
                }
            }
        }
        r.push(ch[i]);
        i += 1;
    }
    r.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn trunc(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let t: String = s.chars().take(max.saturating_sub(1)).collect();
    format!("{}…", t.trim_end())
}

/// Real sentences, not a "English ∙ 日本語 ∙ …" language bar or a row of badges: mostly ASCII
/// letters, at least four words, no `∙`/`|` separators.
fn is_prose(p: &str) -> bool {
    let letters = p.chars().filter(|c| c.is_ascii_alphabetic()).count();
    let total = p.chars().filter(|c| !c.is_whitespace()).count().max(1);
    p.split_whitespace().count() >= 4 && letters * 2 >= total && !p.contains('∙') && !p.contains(" | ")
}

fn first_sentence(s: &str, max: usize) -> String {
    let cut = s.find(". ").map(|i| &s[..=i]).unwrap_or(s);
    trunc(cut, max)
}

fn skip_heading(h: &str) -> bool {
    let l = h.to_lowercase();
    ["contribut", "license", "licence", "credit", "contact", "acknowledg", "table of contents"]
        .iter()
        .any(|k| l.contains(k))
}

/// Deterministic distilled SKILL.md (≤ 6144 bytes).
pub(crate) fn distil(readme: &str, name: &str, source: &str, licence: &str, sha: Option<&str>) -> String {
    let lines: Vec<&str> = readme.trim_start_matches('\u{feff}').lines().collect();
    // Description: first paragraph that is not a heading/badge/code.
    let mut desc = String::new();
    let mut in_code = false;
    let mut para = String::new();
    for l in lines.iter().chain(std::iter::once(&"")) {
        if l.trim_start().starts_with("```") {
            in_code = !in_code;
            continue;
        }
        if in_code {
            continue;
        }
        if l.trim().is_empty() {
            if !para.is_empty() {
                if is_prose(&para) {
                    break;
                }
                para.clear(); // a language bar / badge row / separator line is not a description
            }
            continue;
        }
        if l.trim_start().starts_with('#') {
            para.clear();
            continue;
        }
        let c = clean(l);
        if !c.is_empty() {
            if !para.is_empty() {
                para.push(' ');
            }
            para.push_str(&c);
        }
    }
    if !para.is_empty() {
        desc = para;
    }
    let desc: String = desc
        .chars()
        .filter(|c| !matches!(c, '#' | '[' | ']' | '"' | '\\' | '`'))
        .collect();
    let desc = trunc(&desc, 200);
    let short_src = github_owner_repo(source)
        .map(|(o, r)| format!("{o}/{r}"))
        .unwrap_or_else(|| source.to_string());
    let lic_id = licence.split(" (").next().unwrap_or(licence);
    let sha7: String = sha.map(|s| s.chars().take(7).collect()).unwrap_or_else(|| "HEAD".into());

    let mut out = format!(
        "---\nname: {name}\ndescription: \"{desc} (nguồn: {short_src}, {lic_id})\"\n---\n\n# {name}\n\n\
         Source: {source}@{sha7} · Licence: {licence} · bản gốc: refs/README.md, refs/LICENSE\n\n\
         Nội dung dưới đây là bản mục lục distil từ {source} (© tác giả gốc, giấy phép {lic_id}); \
         khi trích dẫn phải ghi nguồn và giữ attribution.\n\n## Mục lục\n\n"
    );
    let usage = "\n## Cách dùng\n\n\
        - Chỉ đọc phần cần: `Read refs/README.md` với offset/limit theo số dòng ở mục lục.\n\
        - Trích dẫn ngắn, không dán nguyên văn; luôn ghi nguồn và giấy phép.\n\
        - Mục lục chỉ là chỉ dẫn; sự thật nằm ở refs/README.md.\n";

    // Collect headings (## / ###) outside code fences.
    let mut entries: Vec<String> = Vec::new();
    let mut in_code = false;
    for (i, l) in lines.iter().enumerate() {
        let t = l.trim_start();
        if t.starts_with("```") || t.starts_with("~~~") {
            in_code = !in_code;
            continue;
        }
        if in_code || !(t.starts_with("## ") || t.starts_with("### ")) {
            continue;
        }
        let h = clean(t.trim_start_matches('#'));
        if h.is_empty() || skip_heading(&h) {
            continue;
        }
        let mut summary = String::new();
        let mut code = false;
        for nl in &lines[i + 1..] {
            let nt = nl.trim_start();
            if nt.starts_with("```") {
                code = !code;
                continue;
            }
            if code {
                continue;
            }
            if nt.starts_with('#') {
                break;
            }
            let c = clean(nt.trim_start_matches(['-', '*', '>', ' ']));
            if !c.is_empty() {
                summary = first_sentence(&c, 110);
                break;
            }
        }
        let mut e = format!("- **{}** (refs/README.md:{})", trunc(&h, 60), i + 1);
        if !summary.is_empty() {
            e.push_str(" — ");
            e.push_str(&summary);
        }
        e.push('\n');
        entries.push(e);
    }
    let total = entries.len();
    let tail_reserve = 80; // "- … (còn N mục, xem refs/README.md)\n" + slack
    let mut added = 0;
    for e in &entries {
        if out.len() + e.len() + usage.len() + tail_reserve > BUDGET {
            break;
        }
        out.push_str(e);
        added += 1;
    }
    if added < total {
        out.push_str(&format!("- … (còn {} mục, xem refs/README.md)\n", total - added));
    }
    out.push_str(usage);
    out
}

fn valid_name(n: &str) -> bool {
    !n.is_empty() && n.chars().all(|c| matches!(c, 'a'..='z' | '0'..='9' | '-'))
}

fn kebab(s: &str) -> String {
    let mut o = String::new();
    for c in s.to_lowercase().chars() {
        if c.is_ascii_alphanumeric() { o.push(c) } else if !o.ends_with('-') { o.push('-') }
    }
    o.trim_matches('-').to_string()
}

/// Core: returns (skill_dir, work_dir). Errors on licence refusal without --force.
pub(crate) fn learn_into(home: &Path, spec: &str, name: Option<&str>, force: bool) -> Result<(PathBuf, PathBuf)> {
    if spec.starts_with('-') || spec.is_empty() {
        return Err(anyhow!("spec không hợp lệ: `{spec}` (dùng owner/repo, URL GitHub hoặc path:/dir)"));
    }
    let local: Option<PathBuf> = match spec.strip_prefix("path:") {
        Some(p) => Some(PathBuf::from(p)),
        None if Path::new(spec).is_dir() => Some(PathBuf::from(spec)),
        None => None,
    };
    let (url, default_name) = if let Some(p) = &local {
        let n = p.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
        (p.display().to_string(), n)
    } else if let Some((o, r)) = github_owner_repo(spec) {
        (format!("https://github.com/{o}/{r}"), r)
    } else if spec.matches('/').count() == 1 && !spec.contains(':') && !spec.starts_with('/') {
        let (o, r) = spec.split_once('/').unwrap();
        (format!("https://github.com/{o}/{r}"), r.to_string())
    } else if ["https://", "ssh://", "git://", "file://"].iter().any(|p| spec.starts_with(p)) {
        // Only real transport URLs: a spec like `--upload-pack=…` or `ext::…` would otherwise reach `git clone` as an option / command.
        let last = spec.trim_end_matches('/').trim_end_matches(".git").rsplit('/').next().unwrap_or("");
        (spec.to_string(), last.to_string())
    } else {
        return Err(anyhow!("spec không hợp lệ: `{spec}` (dùng owner/repo, URL GitHub hoặc path:/dir)"));
    };
    let name = match name {
        Some(n) => n.to_string(),
        None => kebab(&default_name),
    };
    if !valid_name(&name) {
        return Err(anyhow!("tên skill `{name}` không hợp lệ (chỉ [a-z0-9-])"));
    }
    let target = home.join(".claude/skills").join(&name);
    if target.exists() && !force {
        return Err(anyhow!("{} đã tồn tại; dùng --force để ghi đè", target.display()));
    }

    let work = home.join(".cache/8sync/skill-learn").join(&name);
    let mut sha = None;
    let root: PathBuf = if let Some(p) = local {
        p
    } else {
        if work.exists() {
            std::fs::remove_dir_all(&work)?;
        }
        std::fs::create_dir_all(work.parent().unwrap())?;
        git_clone_at(&url, &work, None)?;
        sha = resolve_head_sha(&work);
        let _ = std::fs::remove_dir_all(work.join(".git"));
        work.clone()
    };

    let lic_file = find_root_file(&root, &["license", "license.md", "license.txt", "copying"]);
    let lic_text = lic_file.as_ref().and_then(|p| std::fs::read_to_string(p).ok());
    let verdict = match &lic_text {
        Some(t) => classify_licence(t),
        None => Licence::Refused("không có licence = all rights reserved; xin phép tác giả hoặc dùng --force để chỉ lưu ghi chú 1 trang do bạn tự viết".into()),
    };
    let licence = match verdict {
        Licence::Allowed(id) => id,
        Licence::Refused(why) => {
            if !force {
                return Err(anyhow!("từ chối: {why}"));
            }
            ui::warn(&format!("--force: KHÔNG chép README ({why}); chỉ ghi stub trỏ tới URL"));
            std::fs::create_dir_all(&target)?;
            let stub = format!(
                "---\nname: {name}\ndescription: \"Ghi chú tự viết về {url} (licence chưa cho phép chép nội dung)\"\n---\n\n# {name}\n\nSource: {url}\n\nChưa chép nội dung vì licence: {why}\nTự viết ghi chú của bạn ở đây.\n"
            );
            std::fs::write(target.join("SKILL.md"), stub)?;
            ui::ok(&format!("stub → {} — local only — không commit vào repo", target.display()));
            return Ok((target, work));
        }
    };

    let readme_p = find_root_file(&root, &["readme.md", "readme", "readme.markdown", "readme.rst", "readme.txt"])
        .ok_or_else(|| anyhow!("không thấy README ở root repo"))?;
    let readme = std::fs::read_to_string(&readme_p)?;
    let skill = distil(&readme, &name, &url, &licence, sha.as_deref());

    if target.exists() {
        std::fs::remove_dir_all(&target)?;
    }
    std::fs::create_dir_all(target.join("refs"))?;
    std::fs::write(target.join("refs/README.md"), &readme)?;
    std::fs::write(target.join("refs/LICENSE"), lic_text.unwrap_or_default())?;
    std::fs::write(target.join("SKILL.md"), &skill)?;
    ui::ok(&format!(
        "{} ({} bytes, README gốc {} bytes) — local only — không commit vào repo",
        target.display(),
        skill.len(),
        readme.len()
    ));
    Ok((target, work))
}

pub(crate) fn run(env: &env_detect::Env, args: &[String]) -> Result<()> {
    let force = args.iter().any(|a| a == "--force" || a == "-f");
    let mut name: Option<&str> = None;
    let mut spec: Option<&str> = None;
    let mut it = args.iter();
    while let Some(a) = it.next() {
        if a == "--name" {
            name = it.next().map(|s| s.as_str());
        } else if !a.starts_with('-') && spec.is_none() {
            spec = Some(a);
        }
    }
    let Some(spec) = spec else {
        return Err(anyhow!("usage: 8sync skill learn <owner/repo|github url|path:/dir> [--name <n>] [--force]"));
    };
    learn_into(&env.home, spec, name, force).map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    fn fixture() -> String {
        let mut s = String::from("# Title\n\n<p align=\"center\"><img src=\"x.png\"></p>\n\n[![Build](https://x/y.svg)](https://x)\n\nA [great](http://a.b) primer #1 about things. More text.\n\n");
        for i in 0..40 {
            s.push_str(&format!("## Section {i} <a id=\"s{i}\"></a>\n\nThis is the first sentence of section {i}. And a second one that is long enough to pad the file out a bit more for the test.\n\n```\n## not a heading {i}\n```\n\n", ));
            for _ in 0..3 {
                s.push_str("Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore.\n");
            }
            s.push('\n');
        }
        s.push_str("## License\n\nCC BY 4.0\n");
        s
    }

    #[test]
    fn skill_learn_description_skips_language_bar() {
        let readme = "# Primer\n\n*English ∙ 日本語 ∙ 简体中文 ∙ tiếng Việt*\n\n[![badge](x.svg)](y)\n\nLearn how to design large-scale systems. Prep for the interview.\n\n## Motivation\n\nText.\n";
        let out = distil(readme, "primer", "https://github.com/a/primer", "CC BY 4.0", None);
        let desc = out.lines().find(|l| l.starts_with("description:")).unwrap();
        assert!(desc.contains("Learn how to design large-scale systems"), "{desc}");
        assert!(!desc.contains('∙'), "{desc}");
        assert!(is_prose("Learn how to design large-scale systems.") && !is_prose("*English ∙ 日本語*"));
    }

    #[test]
    fn skill_learn_rejects_option_like_specs() {
        let home = std::env::temp_dir().join(format!("8sync-skill-learn-spec-{}", std::process::id()));
        for bad in ["--upload-pack=touch /tmp/x", "-c", "ext::sh -c id", "", "owner/repo/extra:bad"] {
            assert!(learn_into(&home, bad, None, false).is_err(), "{bad}");
        }
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn skill_learn_distil_fits_budget() {
        let r = fixture();
        assert!(r.len() > 12_000, "{}", r.len());
        let o = distil(&r, "demo", "https://github.com/o/demo", "CC BY 4.0", Some("abcdef123456"));
        assert!(o.len() <= BUDGET, "{}", o.len());
        assert!(o.starts_with("---\nname: demo\n"));
        assert!(o.contains("refs/README.md:"));
        assert!(o.contains("@abcdef1"));
        assert!(!o.contains("not a heading"));
        assert!(!o.contains("License**"));
        let d = o.lines().find(|l| l.starts_with("description:")).unwrap();
        assert!(!d.contains('#') && !d.contains('['), "{d}");
        assert!(d.contains("nguồn: o/demo"));
        assert_eq!(o, distil(&r, "demo", "https://github.com/o/demo", "CC BY 4.0", Some("abcdef123456")));
    }

    #[test]
    fn skill_learn_licence_gate() {
        let mit = "MIT License\n\nCopyright (c) 2020 X\nAll rights reserved\n\nPermission is hereby granted, free of charge, to any person";
        assert_eq!(classify_licence(mit), Licence::Allowed("MIT".into()));
        let by = "Attribution 4.0 International\n\n=====\nCreative Commons Corporation";
        assert_eq!(classify_licence(by), Licence::Allowed("CC BY 4.0".into()));
        let nc = "Attribution-NonCommercial 4.0 International\n";
        assert!(matches!(classify_licence(nc), Licence::Refused(_)));
        assert!(matches!(classify_licence("Copyright me. All rights reserved."), Licence::Refused(_)));
        let tmp = std::env::temp_dir().join(format!("skilllearn-none-{}", std::process::id()));
        let repo = tmp.join("nolic");
        std::fs::create_dir_all(&repo).unwrap();
        std::fs::write(repo.join("README.md"), "# x\n\nhello\n").unwrap();
        let home = tmp.join("home");
        let r = learn_into(&home, repo.to_str().unwrap(), None, false);
        assert!(r.is_err());
        assert!(!home.join(".claude/skills/nolic").exists());
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn skill_learn_local_repo_drops_git() {
        if Command::new("git").arg("--version").output().is_err() {
            return;
        }
        let tmp = std::env::temp_dir().join(format!("skilllearn-git-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        let repo = tmp.join("fixture-repo");
        std::fs::create_dir_all(&repo).unwrap();
        std::fs::write(repo.join("README.md"), fixture()).unwrap();
        std::fs::write(repo.join("LICENSE"), "MIT License\n\nPermission is hereby granted, free of charge, to any person\n").unwrap();
        let g = |args: &[&str]| {
            Command::new("git").arg("-C").arg(&repo).args(["-c", "user.name=t", "-c", "user.email=t@t"]).args(args).output().unwrap().status.success()
        };
        assert!(g(&["init", "-q"]) && g(&["add", "."]) && g(&["commit", "-q", "-m", "i"]));
        let home = tmp.join("home");
        let url = format!("file://{}", repo.display());
        let (skill, work) = learn_into(&home, &url, None, false).unwrap();
        assert!(!work.join(".git").exists());
        assert!(work.join("README.md").exists());
        let md = std::fs::metadata(skill.join("SKILL.md")).unwrap();
        assert!(md.len() as usize <= BUDGET);
        assert!(skill.join("refs/README.md").exists() && skill.join("refs/LICENSE").exists());
        assert!(learn_into(&home, &url, None, false).is_err(), "no overwrite without --force");
        let _ = std::fs::remove_dir_all(&tmp);
    }
}
