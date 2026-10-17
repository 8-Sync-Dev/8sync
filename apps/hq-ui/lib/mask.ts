// Masks the common secret shapes in text HQ reads straight from a transcript (the room log). A
// subset of crates/ccc-core/src/secret_mask.rs, the masker of everything the CLI journals: PEM blocks,
// `name=value` / `"name": "value"` with a secret-looking name, the word after Bearer/Basic, known
// token prefixes and long opaque strings. Heuristic, not a guarantee. Tested in tests/mask.test.ts.

const MASK = "***";
const NAMES = ["token", "secret", "password", "passwd", "apikey", "accesskey", "privatekey", "authorization", "cookie"];

/** `API_KEY`, `my-token`, `GITHUB_TOKEN`, `session_id`… (separators ignored), as `is_secret_name`. */
function secretName(name: string): boolean {
  const n = name.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
  return n.length >= 3 && (NAMES.some((k) => n.includes(k)) || n.endsWith("key") || n.endsWith("bearer") || n === "session" || n === "sessionid");
}

/** `known_token`: a vendor prefix with enough after it, or the Discord bot token shape. */
function knownToken(p: string): boolean {
  const long = (pre: string, n: number) => p.startsWith(pre) && p.length >= n;
  return (
    long("sk-ant-", 10) ||
    long("sk-", 16) ||
    ["ghp_", "gho_", "ghs_", "ghu_", "ghr_"].some((x) => long(x, 12)) ||
    long("github_pat_", 16) ||
    long("glpat-", 12) ||
    /^(AKIA|ASIA)[A-Z0-9]{12,}$/.test(p) ||
    /^xox[bpas]-.{7,}$/.test(p) ||
    long("eyJ", 20) ||
    long("AIza", 30) ||
    /^[MNO][A-Za-z0-9_-]{23,25}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,}$/.test(p)
  );
}

/** 32+ base64/hex characters mixing letters and digits. */
const opaque = (w: string) => w.length >= 32 && /^[A-Za-z0-9\-_+/=]+$/.test(w) && /\d/.test(w) && /[A-Za-z]/.test(w);

/** Quadratic on one very long word: callers pass a bounded slice (the room log masks at most ~650 chars). */
export function maskSecrets(text: string): string {
  return (
    text
      // PEM block, to its END line or the end of the text when the footer is missing.
      .replace(/-----BEGIN [^\n]*?-----[\s\S]*?(-----END [^\n]*?-----|$)/g, "[REDACTED-PEM]")
      // Credentials in a URL (`postgres://user:pw@host`) and a password flag (`--password hunter2`).
      .replace(/(\/\/[^\s/:@]+:)[^\s/@]+@/g, `$1${MASK}@`)
      .replace(/(--?(?:password|passwd|token|secret|api-key)[=\s]+)\S+/gi, `$1${MASK}`)
      // Before name=value, which would take `Bearer` itself as the value of `Authorization:`.
      .replace(/\b(Bearer|Basic)(\s+)(\S+)/gi, (_m, k: string, sp: string) => `${k}${sp}${MASK}`)
      // name=value, name: value, "name": "value" (the value up to a quote, comma, brace or space).
      .replace(/([A-Za-z0-9_-]+)(["'`]?\s*[:=]\s*["'`]?)([^\s"'`,;}\])]+)/g, (m, name: string, sep: string) => (secretName(name) ? `${name}${sep}${MASK}` : m))
      // Each word: a known token or an opaque string.
      .replace(/[A-Za-z0-9._\-+/=]{10,}/g, (w) => {
        const core = w.replace(/^[._-]+|[.]+$/g, "");
        return knownToken(core) || opaque(core) ? w.replace(core, MASK) : w;
      })
  );
}
