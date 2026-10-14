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

// ── prose passwords: "mật khẩu là X", "sudo pass: X", "password is X" ──────

const TRIGGERS: [&str; 8] = ["pass", "password", "passwd", "pwd", "pin", "otp", "secret", "token"];
/// Triggers that may be followed directly by a digit-bearing value, no separator.
const BARE_OK: [&str; 6] = ["pass", "password", "passwd", "pwd", "pin", "otp"];

fn norm(w: &str) -> String {
    w.trim_matches(|c: char| !c.is_alphanumeric()).to_lowercase()
}

/// Core of a value word: no surrounding quotes/closers/sentence punctuation.
fn value_core(w: &str) -> (usize, usize) {
    let (lead, core, _) = split_value(w);
    let t = core.trim_end_matches(['.', '!', '?', ':']);
    (lead.len(), lead.len() + t.len())
}

/// Mask the value that follows a password-ish trigger word in free prose.
/// Value must be one token of 4+ chars. After `:`/`=` any token counts; after
/// `là`/`is` or no separator the token must contain a non-letter (digit/symbol),
/// so "password is wrong" / "password reset flow" stay readable.
fn mask_prose(s: &str) -> String {
    // (is_whitespace, text) segments
    let mut segs: Vec<(bool, &str)> = Vec::new();
    let mut i = 0;
    while i < s.len() {
        let ws = s[i..].starts_with(char::is_whitespace);
        let end = s[i..].find(|c: char| c.is_whitespace() != ws).map_or(s.len(), |n| i + n);
        segs.push((ws, &s[i..end]));
        i = end;
    }
    let words: Vec<usize> = (0..segs.len()).filter(|&k| !segs[k].0).collect();
    let mut hit: Vec<usize> = Vec::new(); // seg index of values to mask
    let mut wi = 0;
    while wi < words.len() {
        let w = segs[words[wi]].1;
        let n = norm(w);
        let next_n = words.get(wi + 1).map(|&k| norm(segs[k].1));
        // trigger length in words
        let (tlen, bare_ok, is_sudo) = if TRIGGERS.contains(&n.as_str()) {
            (1, BARE_OK.contains(&n.as_str()), false)
        } else if n == "apikey" || n == "sudo" {
            (1, false, n == "sudo")
        } else if (n == "api" && next_n.as_deref() == Some("key"))
            || (n == "mật" && next_n.as_deref() == Some("khẩu"))
            || (n == "mat" && next_n.as_deref() == Some("khau"))
        {
            (2, n != "api", false)
        } else {
            wi += 1;
            continue;
        };
        let last = words[wi + tlen - 1];
        let mut j = wi + tlen; // next word index to inspect
        let attached = segs[last].1.ends_with([':', '=']);
        let mut sep = attached;
        let mut weak = false; // is/là/no separator: need non-letter value
        if !sep && !is_sudo {
            // "của tôi": possessive filler
            if let Some(&k) = words.get(j) {
                if norm(segs[k].1) == "sudo" && words.get(j + 1).is_some() {
                    j += 1;
                } else if matches!(norm(segs[k].1).as_str(), "của" | "cua" | "of" | "my") && words.get(j + 1).is_some() {
                    j += if norm(segs[k].1) == "my" { 1 } else { 2 };
                }
            }
        }
        if !sep {
            if let Some(&k) = words.get(j) {
                let t = segs[k].1;
                let t_n = norm(t);
                if t == ":" || t == "=" {
                    sep = true;
                    j += 1;
                } else if matches!(t_n.as_str(), "là" | "la" | "is") {
                    sep = true;
                    weak = true;
                    j += 1;
                }
            }
        }
        if !sep && (is_sudo || !bare_ok) {
            wi += tlen;
            continue;
        }
        if !sep {
            weak = true;
        }
        if let Some(&k) = words.get(j) {
            let v = segs[k].1;
            let (a, b) = value_core(v);
            let core = &v[a..b];
            let shape_ok = !weak || core.chars().any(|c| !c.is_alphabetic());
            if core.chars().count() >= 4 && core != MASK && shape_ok && !TRIGGERS.contains(&norm(core).as_str()) {
                hit.push(k);
            }
        }
        wi = (j + 1).max(wi + tlen);
    }
    if hit.is_empty() {
        return s.to_string();
    }
    let mut out = String::with_capacity(s.len());
    for (k, (_, t)) in segs.iter().enumerate() {
        if hit.contains(&k) {
            let (a, b) = value_core(t);
            out.push_str(&t[..a]);
            out.push_str(MASK);
            out.push_str(&t[b..]);
        } else {
            out.push_str(t);
        }
    }
    out
}

pub fn mask(s: &str) -> String {
    mask_prose(&mask_basic(s))
}

fn mask_basic(s: &str) -> String {
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
    fn prose_passwords_masked() {
        for (i, o) in [
            ("1. xóa đi sudo pass: Fake-Pass-1234", "1. xóa đi sudo pass: ***"),
            ("mật khẩu là hunter2-demo", "mật khẩu là ***"),
            ("password is Demo#Secret9", "password is ***"),
            ("sudo password: example123", "sudo password: ***"),
            ("sudo password của tôi là Fake9876", "sudo password của tôi là ***"),
            ("MẬT KHẨU: Abc123!x ok", "MẬT KHẨU: *** ok"),
            ("mat khau la zz9-demo.", "mat khau la ***."),
            ("pass = tmp4567", "pass = ***"),
            ("pwd hunter2x", "pwd ***"),
            ("OTP: 123456, thanks", "OTP: ***, thanks"),
            ("api key là demo-key-77", "api key là ***"),
            ("sudo: fake1234 nhé", "sudo: *** nhé"),
            ("sudo là demo#123", "sudo là ***"),
            ("secret: \"abcd1234\"", "secret: \"***\""),
            ("Mật khẩu sudo là Xx9-fake", "Mật khẩu sudo là ***"),
        ] {
            assert_eq!(mask(i), o, "{i}");
        }
    }

    #[test]
    fn prose_normal_text_untouched() {
        for t in [
            "mật khẩu đã đổi rồi",
            "password reset flow",
            "token budget",
            "secret sauce",
            "sudo apt install x",
            "sudo systemctl restart nginx",
            "password is wrong",
            "token is expired",
            "mật khẩu là gì vậy",
            "pass the test please",
            "pin the version",
            "đổi mật khẩu sau khi đăng nhập",
            "sudo rm -rf build",
            "pass: ok",
        ] {
            assert_eq!(mask(t), t, "{t}");
        }
        assert_eq!(mask("pass: ok"), "pass: ok");
    }

    #[test]
    fn prose_utf8_safe() {
        for t in ["mật khẩu: ệệệệ", "mật khẩu là 🙂🙂🙂🙂1", "pass:ệ", "mật", "mật khẩu", "mật khẩu là", "password của", "\"mật khẩu\": \"ưu123\""] {
            let _ = mask(t);
        }
        assert_eq!(mask("mật khẩu: ưư123 xong"), "mật khẩu: *** xong");
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
