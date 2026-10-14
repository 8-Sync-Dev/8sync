//! `8sync ccc secret`: hand a secret to a provider's secret store without the value ever
//! reaching the transcript, argv, a file we write, or git.
//!
//! - `secret keys <env-file>`: key names only (never values), so Claude knows what exists.
//! - `secret set <encore|vercel|gh> <NAME> (--from <env-file> [--key K] | --generate)`:
//!   the value goes from the owner's local file (or `getrandom`) straight to the provider
//!   CLI's stdin. Output shows the name and the result; anything the CLI prints is masked
//!   and the value is scrubbed from it.
//!
//! Third-party keys (Mistral, PayOS, …) still come from the owner: this moves a value the
//! owner already has, it never invents one for an outside service.
use anyhow::{bail, Context, Result};
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use super::super::secret_mask;

const ENCORE_TYPES: [&str; 4] = ["prod", "dev", "pr", "local"];
const VERCEL_ENVS: [&str; 3] = ["production", "preview", "development"];
const USAGE: &str = "usage:
  8sync ccc secret keys <env-file>
  8sync ccc secret set encore <NAME> (--from <env-file> [--key K] | --generate) --type prod,dev[,pr,local] [--cwd DIR]
  8sync ccc secret set vercel <NAME> (--from … | --generate) --env production[,preview,development] [--cwd DIR]
  8sync ccc secret set gh     <NAME> (--from … | --generate) [--repo owner/name] [--cwd DIR]
  add --dry-run to print the provider command without running it";

/// `A_B1`: env-var shaped names only (they become argv words of the provider CLI).
fn valid_name(n: &str) -> bool {
    let b = n.as_bytes();
    (1..=128).contains(&b.len()) && (b[0].is_ascii_alphabetic() || b[0] == b'_') && b.iter().all(|c| c.is_ascii_alphanumeric() || *c == b'_')
}

/// `KEY=value` lines of a dotenv file: `export ` prefix, comments and blank lines skipped,
/// one layer of matching quotes removed. Values never leave this module except to a child's stdin.
pub(super) fn parse_env(text: &str) -> Vec<(String, String)> {
    text.lines()
        .filter_map(|l| {
            let l = l.trim();
            if l.is_empty() || l.starts_with('#') {
                return None;
            }
            let l = l.strip_prefix("export ").unwrap_or(l);
            let (k, v) = l.split_once('=')?;
            let k = k.trim();
            if !valid_name(k) {
                return None;
            }
            let v = v.trim();
            let v = if v.len() >= 2 && ((v.starts_with('"') && v.ends_with('"')) || (v.starts_with('\'') && v.ends_with('\''))) {
                &v[1..v.len() - 1]
            } else {
                // An unquoted value ends at an inline comment.
                v.split(" #").next().unwrap_or(v).trim_end()
            };
            Some((k.to_string(), v.to_string()))
        })
        .collect()
}

/// 48 random bytes from the OS, hex: 384 bits, safe in any env var or JWT HMAC key.
fn generate() -> Result<String> {
    let mut b = [0u8; 48];
    getrandom::getrandom(&mut b).map_err(|e| anyhow::anyhow!("no OS randomness: {e}"))?;
    Ok(b.iter().map(|x| format!("{x:02x}")).collect())
}

fn flag<'a>(args: &'a [String], name: &str) -> Option<&'a str> {
    args.windows(2).find(|w| w[0] == name).map(|w| w[1].as_str())
}

/// The provider command (no value in it: the value goes to stdin).
pub(super) fn provider_cmd(provider: &str, name: &str, args: &[String]) -> Result<Vec<String>> {
    let list = |f: &str| flag(args, f).map(|s| s.split(',').map(str::trim).filter(|x| !x.is_empty()).map(String::from).collect::<Vec<_>>());
    Ok(match provider {
        "encore" => {
            let types = list("--type").context("encore needs --type prod,dev[,pr,local]")?;
            if let Some(bad) = types.iter().find(|t| !ENCORE_TYPES.contains(&t.as_str())) {
                bail!("encore type `{bad}` is not one of prod, dev, pr, local (`preview` is `pr`)");
            }
            vec!["encore".into(), "secret".into(), "set".into(), "--type".into(), types.join(","), name.into()]
        }
        "vercel" => {
            let envs = list("--env").context("vercel needs --env production[,preview,development]")?;
            if envs.len() != 1 {
                bail!("vercel env add takes one environment per call: run once per --env");
            }
            if !VERCEL_ENVS.contains(&envs[0].as_str()) {
                bail!("vercel env `{}` is not one of production, preview, development", envs[0]);
            }
            vec!["vercel".into(), "env".into(), "add".into(), name.into(), envs[0].clone()]
        }
        "gh" => {
            let mut c: Vec<String> = vec!["gh".into(), "secret".into(), "set".into(), name.into()];
            if let Some(r) = flag(args, "--repo") {
                if !r.split_once('/').is_some_and(|(o, n)| valid_slug(o) && valid_slug(n)) {
                    bail!("--repo must be owner/name");
                }
                c.extend(["--repo".into(), r.into()]);
            }
            c
        }
        _ => bail!("provider must be encore, vercel or gh\n{USAGE}"),
    })
}

fn valid_slug(s: &str) -> bool {
    !s.is_empty() && s.len() <= 100 && s.bytes().all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_' | b'.'))
}

/// Child output for the transcript: the value scrubbed, anything key-shaped masked.
pub(super) fn scrub(out: &str, value: &str) -> String {
    let s = if value.len() >= 4 { out.replace(value, "***") } else { out.to_string() };
    secret_mask::mask(&s)
}

fn read_value(args: &[String], name: &str, cwd: &Path) -> Result<(String, String)> {
    if args.iter().any(|a| a == "--generate") {
        return Ok((generate()?, "generated (48 random bytes, hex)".into()));
    }
    let file = flag(args, "--from").context("give --from <env-file> or --generate")?;
    let path = resolve(cwd, file);
    let text = std::fs::read_to_string(&path).with_context(|| format!("cannot read {}", path.display()))?;
    let key = flag(args, "--key").unwrap_or(name);
    let Some((_, v)) = parse_env(&text).into_iter().rev().find(|(k, _)| k == key) else {
        bail!("{key} is not in {} (see `8sync ccc secret keys {file}`)", path.display());
    };
    if v.is_empty() {
        bail!("{key} is empty in {}", path.display());
    }
    Ok((v, format!("from {} ({key})", path.display())))
}

fn resolve(cwd: &Path, p: &str) -> PathBuf {
    let p = Path::new(p);
    if p.is_absolute() {
        p.to_path_buf()
    } else {
        cwd.join(p)
    }
}

pub(super) fn run(args: &[String]) -> Result<()> {
    let here = std::env::current_dir().context("no cwd")?;
    match args.first().map(String::as_str) {
        Some("keys") => {
            let file = args.get(1).context(USAGE)?;
            let text = std::fs::read_to_string(resolve(&here, file)).with_context(|| format!("cannot read {file}"))?;
            for (k, v) in parse_env(&text) {
                println!("{k}{}", if v.is_empty() { "  (empty)" } else { "" });
            }
            Ok(())
        }
        Some("set") => {
            let (provider, name) = (args.get(1).context(USAGE)?, args.get(2).context(USAGE)?);
            if !valid_name(name) {
                bail!("secret name must look like an env var (letters, digits, _)");
            }
            let rest = &args[3..];
            let cmd = provider_cmd(provider, name, rest)?;
            let cwd = flag(rest, "--cwd").map_or(here.clone(), |d| resolve(&here, d));
            if rest.iter().any(|a| a == "--dry-run") {
                println!("would run in {}: {} < (value)", cwd.display(), cmd.join(" "));
                return Ok(());
            }
            let (value, source) = read_value(rest, name, &here)?;
            let mut child = Command::new(&cmd[0])
                .args(&cmd[1..])
                .current_dir(&cwd)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .with_context(|| format!("cannot run `{}` (installed and on PATH?)", cmd[0]))?;
            child.stdin.take().context("no stdin")?.write_all(value.as_bytes())?;
            let out = child.wait_with_output()?;
            let text = scrub(&format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr)), &value);
            if !out.status.success() {
                bail!("{} failed for {name}: {}", cmd[..3].join(" "), text.trim());
            }
            println!("ok: {name} -> {} ({source}); value not shown", cmd[..3].join(" "));
            if !text.trim().is_empty() {
                println!("{}", text.trim());
            }
            Ok(())
        }
        _ => bail!("{USAGE}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(v: &[&str]) -> Vec<String> {
        v.iter().map(|x| x.to_string()).collect()
    }

    #[test]
    fn env_file_parsing_keeps_values_out_of_names() {
        let env = parse_env("# c\nexport JWT_SECRET=\"a b#c\"\nMistralApiKey=xyz # note\nEMPTY=\nbad-key=1\n PAYOS_CLIENT_ID='q'\n");
        let names: Vec<&str> = env.iter().map(|(k, _)| k.as_str()).collect();
        assert_eq!(names, ["JWT_SECRET", "MistralApiKey", "EMPTY", "PAYOS_CLIENT_ID"]);
        assert_eq!(env[0].1, "a b#c");
        assert_eq!(env[1].1, "xyz");
        assert_eq!(env[3].1, "q");
    }

    #[test]
    fn provider_commands_never_carry_the_value_and_validate_targets() {
        assert_eq!(provider_cmd("encore", "JWT_SECRET", &s(&["--type", "prod,dev,pr"])).unwrap().join(" "), "encore secret set --type prod,dev,pr JWT_SECRET");
        assert!(provider_cmd("encore", "X", &s(&["--type", "prod,preview"])).unwrap_err().to_string().contains("`preview` is `pr`"));
        assert!(provider_cmd("encore", "X", &[]).is_err());
        assert_eq!(provider_cmd("vercel", "X", &s(&["--env", "production"])).unwrap().join(" "), "vercel env add X production");
        assert!(provider_cmd("vercel", "X", &s(&["--env", "production,preview"])).is_err());
        assert_eq!(provider_cmd("gh", "X", &s(&["--repo", "8-Sync-Dev/su-code"])).unwrap().join(" "), "gh secret set X --repo 8-Sync-Dev/su-code");
        assert!(provider_cmd("gh", "X", &s(&["--repo", "a;rm -rf /"])).is_err());
        assert!(provider_cmd("curl", "X", &[]).is_err());
        assert!(!valid_name("A B") && !valid_name("1A") && !valid_name("A;B") && valid_name("PAYOS_API_KEY"));
    }

    #[test]
    fn output_is_scrubbed_and_generated_values_are_strong() {
        let v = format!("sk-ant-api03-{}", "Zq8vR2xLk9pW4mN7tB1cY6hJ3sD5fG0aQe".repeat(2));
        let out = scrub(&format!("Successfully created secret value {v}\n"), &v);
        assert!(!out.contains("Zq8vR2xLk9") && out.contains("Successfully created"), "{out}");
        let (a, b) = (generate().unwrap(), generate().unwrap());
        assert!(a.len() == 96 && a != b && a.bytes().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn read_value_finds_the_key_and_reports_missing_ones_without_values() {
        let d = std::env::temp_dir().join(format!("8sync-secret-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        std::fs::write(d.join(".env.local"), "JWT_SECRET=one\nJWT_SECRET=two\nEMPTY=\n").unwrap();
        let (v, src) = read_value(&s(&["--from", ".env.local"]), "JWT_SECRET", &d).unwrap();
        assert_eq!(v, "two", "last definition wins, like dotenv");
        assert!(src.contains("(JWT_SECRET)") && !src.contains("two"));
        let e = read_value(&s(&["--from", ".env.local"]), "PAYOS_API_KEY", &d).unwrap_err().to_string();
        assert!(e.contains("PAYOS_API_KEY is not in"));
        assert!(read_value(&s(&["--from", ".env.local", "--key", "EMPTY"]), "X", &d).unwrap_err().to_string().contains("empty"));
        let _ = std::fs::remove_dir_all(&d);
    }
}
