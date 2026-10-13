//! One masker for everything 8sync shows or journals that came from a
//! transcript or a hook payload (`8sync ls/show`, the HQ event journal).
//!
//! Heuristic, not a guarantee: it masks the common shapes below and nothing
//! else. Rules, applied in order:
//! 1. PEM blocks (from the `BEGIN` line to the `END` line, or to the end of the
//!    text when the footer is missing) become `[REDACTED-PEM]`.
//! 2. Text is split on any whitespace (spaces, tabs, newlines are kept as-is).
//!    A word `name<sep>value` with `<sep>` = `:` or `=` and a secret-looking name
//!    (token, secret, password, passwd, api_key, apikey, access_key, private_key,
//!    authorization, bearer, cookie, session, anything ending in `key`) has its
//!    value replaced by `***`. This covers `key=value`, `key: value` (value is
//!    the next word) and JSON `"key":"value"` / `"key": "value"`.
//! 3. The word after `Bearer` / `Basic` is masked.
//! 4. Known token prefixes and shapes: `sk-ant-`, `sk-`, `ghp_`/`gho_`/`ghs_`/
//!    `ghu_`/`ghr_`, `github_pat_`, `glpat-`, `AKIA`/`ASIA`, `xox[bpas]-`, `eyJ`
//!    (JWT), `AIza`, the Discord bot token shape `id.ts.hmac`, and any opaque
//!    string of 32+ base64/hex characters mixing letters and digits.
//!
//! Limits: a value that itself contains spaces is masked only up to its first
//! space; a secret with no name and no known shape is not recognised.

const NAMES: [&str; 9] = ["token", "secret", "password", "passwd", "apikey", "accesskey", "privatekey", "authorization", "cookie"];
const MASK: &str = "***";
const PEM_BEGIN: &str = "-----BEGIN ";
const PEM_END: &str = "-----END ";

/// `API_KEY`, `my-token`, `GITHUB_TOKEN`, `session_id`… (separators ignored).
fn is_secret_name(name: &str) -> bool {
    let n: String = name.chars().filter(|c| c.is_ascii_alphanumeric()).collect::<String>().to_ascii_lowercase();
    n.len() >= 3 && (NAMES.iter().any(|k| n.contains(k)) || n.ends_with("key") || n.ends_with("bearer") || n == "session" || n == "sessionid")
}

fn is_quote(c: char) -> bool {
    matches!(c, '"' | '\'' | '`')
}

fn is_closer(c: char) -> bool {
    matches!(c, '"' | '\'' | '`' | '}' | ']' | ')' | '>' | ',' | ';')
}

/// `"abc"}` -> (`"`, `abc`, `"}`): leading quotes, core, trailing closers.
fn split_value(v: &str) -> (&str, &str, &str) {
    let core_start = v.len() - v.trim_start_matches(is_quote).len();
    let rest = &v[core_start..];
    let core_len = rest.trim_end_matches(is_closer).len();
    (&v[..core_start], &rest[..core_len], &rest[core_len..])
}

fn mask_value(v: &str) -> String {
    let (lead, core, trail) = split_value(v);
    if core.is_empty() { v.to_string() } else { format!("{lead}{MASK}{trail}") }
}

/// Redact PEM blocks.
fn strip_pem(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(i) = rest.find(PEM_BEGIN) {
        out.push_str(&rest[..i]);
        out.push_str("[REDACTED-PEM]");
        let after = &rest[i + PEM_BEGIN.len()..];
        match after.find(PEM_END) {
            Some(e) => {
                let tail = &after[e + PEM_END.len()..];
                rest = tail.find("-----").map_or("", |f| &tail[f + 5..]);
            }
            None => rest = "",
        }
    }
    out.push_str(rest);
    out
}

fn is_word_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.')
}

fn all_alnum_dash(s: &str) -> bool {
    s.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'))
}

/// Discord bot token: `<id b64, starts M/N/O>.<6>.<27+>`.
fn discord_shape(p: &str) -> bool {
    let mut it = p.split('.');
    let (Some(a), Some(b), Some(c), None) = (it.next(), it.next(), it.next(), it.next()) else { return false };
    (24..=26).contains(&a.len()) && a.starts_with(['M', 'N', 'O']) && b.len() == 6 && c.len() >= 27 && [a, b, c].iter().all(|x| all_alnum_dash(x))
}

/// A `[A-Za-z0-9_.-]` piece that is a known token prefix/shape.
fn known_token(p: &str) -> bool {
    let long = |pre: &str, n: usize| p.starts_with(pre) && p.len() >= n;
    let aws = (p.starts_with("AKIA") || p.starts_with("ASIA")) && p.len() >= 16 && p.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit());
    let slack = p.len() >= 12 && p.starts_with("xox") && matches!(p.as_bytes()[3], b'b' | b'p' | b'a' | b's') && p.as_bytes()[4] == b'-';
    long("sk-ant-", 10)
        || long("sk-", 16)
        || ["ghp_", "gho_", "ghs_", "ghu_", "ghr_"].iter().any(|x| long(x, 12))
        || long("github_pat_", 16)
        || long("glpat-", 12)
        || aws
        || slack
        || long("eyJ", 20)
        || long("AIza", 30)
        || discord_shape(p)
}

/// Opaque base64/hex string: 32+ chars, letters and digits both.
fn opaque(w: &str) -> bool {
    w.len() >= 32
        && w.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '+' | '/' | '='))
        && w.chars().any(|c| c.is_ascii_digit())
        && w.chars().any(|c| c.is_ascii_alphabetic())
}

/// Mask known token shapes inside one word, keeping everything around them.
fn mask_tokens(w: &str) -> String {
    let trimmed = w.trim_matches(|c: char| !c.is_ascii_alphanumeric());
    if !trimmed.is_empty() && opaque(trimmed) {
        return w.replacen(trimmed, MASK, 1);
    }
    let mut out = String::with_capacity(w.len());
    let mut start: Option<usize> = None;
    let flush = |out: &mut String, piece: &str| {
        let p = piece.trim_start_matches(['.', '-', '_']);
        let (p, dots) = (p.trim_end_matches('.'), &piece[piece.trim_end_matches('.').len()..]);
        if !p.is_empty() && known_token(p.trim_end_matches(['-', '_'])) {
            out.push_str(&piece[..piece.len() - p.len() - dots.len()]);
            out.push_str(MASK);
            out.push_str(dots);
        } else {
            out.push_str(piece);
        }
    };
    for (i, c) in w.char_indices() {
        if is_word_char(c) {
            start.get_or_insert(i);
        } else {
            if let Some(s) = start.take() {
                flush(&mut out, &w[s..i]);
            }
            out.push(c);
        }
    }
    if let Some(s) = start {
        flush(&mut out, &w[s..]);
    }
    out
}

/// `name<sep>value` inside one word. `Ok(masked)` = value was inline;
/// `Err(())` = the name is secret but the value is the next word.
fn inline_pair(w: &str) -> Option<Result<String, ()>> {
    for (i, c) in w.char_indices() {
        if c != ':' && c != '=' {
            continue;
        }
        let left = w[..i].trim_end_matches(is_quote);
        // Start of the trailing ASCII name; step over the boundary char by its UTF-8
        // length (a non-ASCII char before `:`/`=`, e.g. "Lưu ý:", used to panic here).
        let start = left
            .char_indices()
            .rev()
            .find(|&(_, c)| !(c.is_ascii_alphanumeric() || c == '_' || c == '-'))
            .map_or(0, |(p, c)| p + c.len_utf8());
        let name = &left[start..];
        if !is_secret_name(name) {
            continue;
        }
        let right = &w[i + 1..];
        let (_, core, _) = split_value(right);
        return Some(if core.is_empty() { Err(()) } else { Ok(format!("{}{c}{}", &w[..i], mask_value(right))) });
    }
    None
}

pub fn mask(s: &str) -> String {
    let s = strip_pem(s);
    let mut out = String::with_capacity(s.len());
    let mut pending = false; // previous word was a secret name / Bearer: mask this one
    let mut i = 0;
    while i < s.len() {
        let ws = s[i..].starts_with(char::is_whitespace);
        let end = s[i..].find(|c: char| c.is_whitespace() != ws).map_or(s.len(), |n| i + n);
        let w = &s[i..end];
        i = end;
        if ws {
            out.push_str(w);
            continue;
        }
        let bare = w.trim_matches(|c: char| !c.is_ascii_alphabetic()).to_ascii_lowercase();
        if pending {
            if matches!(bare.as_str(), "bearer" | "basic") || split_value(w).1.is_empty() {
                out.push_str(w); // scheme word or lone punctuation: keep waiting
            } else {
                out.push_str(&mask_value(w));
                pending = false;
            }
        } else if bare == "bearer" {
            out.push_str(w);
            pending = true;
        } else if let Some(r) = inline_pair(w) {
            match r {
                Ok(m) => out.push_str(&m),
                Err(()) => {
                    out.push_str(w);
                    pending = true;
                }
            }
        } else {
            out.push_str(&mask_tokens(w));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn newline_split_and_prefixes() {
        assert_eq!(mask("Here:\nsk-ant-api03-…"), "Here:\n***…");
        for t in [
            "sk-ant-api03-abcdefghijkl",
            "sk-proj1234567890abcdef",
            "ghp_abcdefghijklmnop",
            "gho_abcdefghijklmnop",
            "github_pat_11ABCDEFG0abcdefgh",
            "AKIAIOSFODNN7EXAMPLE",
            "ASIAIOSFODNN7EXAMPLE",
            "xoxb-123456789012-abcdef",
            "xoxp-123456789012-abcdef",
            "xoxa-123456789012-abcdef",
            "xoxs-123456789012-abcdef",
            "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc",
            "AIzaSyA-1234567890abcdefghijklmnopqrstu",
            concat!("MTA2NTQzMj", "EwOTg3NjU0MzIx.GabcDE.abcdefghijklmnopqrstuvwxyzA"),
        ] {
            assert_eq!(mask(&format!("a\t{t}\nb")), "a\t***\nb", "{t}");
            assert_eq!(mask(&format!("({t}),")), "(***),", "{t}");
        }
    }

    #[test]
    fn key_value_shapes() {
        assert_eq!(mask("token: abc123def456"), "token: ***");
        assert_eq!(mask("password: hunter2"), "password: ***");
        assert_eq!(mask("Password:\nhunter2 ok"), "Password:\n*** ok");
        assert_eq!(mask("API_KEY=hunter2 x"), "API_KEY=*** x");
        assert_eq!(mask("--passwd=hunter2"), "--passwd=***");
        assert_eq!(mask(r#"{"api_key":"hunter2abc"}"#), r#"{"api_key":"***"}"#);
        assert_eq!(mask(r#"{"api_key": "hunter2abc", "n": 1}"#), r#"{"api_key": "***", "n": 1}"#);
        for k in ["apikey", "access_key", "private_key", "secret", "cookie", "session", "GITHUB_TOKEN"] {
            assert_eq!(mask(&format!("{k}=v1v2v3")), format!("{k}=***"), "{k}");
            assert_eq!(mask(&format!("{k}: v1v2v3")), format!("{k}: ***"), "{k}");
        }
        assert_eq!(mask("Authorization: Bearer abc.def"), "Authorization: Bearer ***");
        assert_eq!(mask("curl -H 'Authorization: Basic dXNlcjpwYXNz'"), "curl -H 'Authorization: Basic ***'");
        assert_eq!(mask("Bearer abc123"), "Bearer ***");
    }

    #[test]
    fn pem_block_redacted() {
        let kind = ["PRIV", "ATE KEY-----"].concat();
        let (b, e) = (format!("{PEM_BEGIN}RSA {kind}"), format!("{PEM_END}RSA {kind}"));
        let m = mask(&format!("cert:\n{b}\nMIIabc\nxyz\n{e}\nafter"));
        assert!(!m.contains("MIIabc") && !m.contains("BEGIN") && m.contains("[REDACTED-PEM]") && m.ends_with("\nafter"), "{m}");
        assert_eq!(mask(&format!("x {b}\nMIIabc")), "x [REDACTED-PEM]");
    }

    #[test]
    fn normal_text_untouched() {
        for t in [
            "normal words here",
            "src/verbs/session_view.rs",
            "sessions: 3",
            "https://example.com/a?b=c",
            "sk-learn is a library",
            "two\nlines  with\ttabs",
            "ok: done",
        ] {
            assert_eq!(mask(t), t);
        }
        assert_eq!(mask(&"a1".repeat(20)), "***");
        assert_eq!(mask("é…ü"), "é…ü");
    }
    #[test]
    fn non_ascii_before_separator_does_not_panic() {
        for t in ["Lưu ý: xong", "việc=ok", "Kết quả:token=x", "mật khẩu: abc123", "tên: sk-ant-api03-abcdefghijklmnopqrstu", "ê:", "🙂=1", "ý:token: abc123def456"] {
            let _ = mask(t);
        }
        assert_eq!(mask("Lưu ý: xong"), "Lưu ý: xong");
        assert!(!mask("tên: sk-ant-api03-abcdefghijklmnopqrstu").contains("sk-ant-api03-abc"));
        assert!(!mask("Kết quả:token=x9y8z7w6v5").contains("x9y8z7w6v5"));
    }

    #[test]
    fn fuzz_mixed_unicode_never_panics() {
        let parts = ["ư", "ý", "ệ", "🙂", ":", "=", "\"", "'", " ", "\n", "token", "sk-ant-", "Bearer", "eyJ", "abc123", "-", "_", "{", "}", "ghp_", "Kết"];
        let mut seed: u64 = 0x9e3779b97f4a7c15;
        for _ in 0..4000 {
            let mut t = String::new();
            for _ in 0..(seed % 12 + 1) {
                seed ^= seed << 13;
                seed ^= seed >> 7;
                seed ^= seed << 17;
                t.push_str(parts[(seed % parts.len() as u64) as usize]);
            }
            let _ = mask(&t);
        }
    }

}
