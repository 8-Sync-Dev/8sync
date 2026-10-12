#!/usr/bin/env python3
"""Snapshot Anthropic's legal texts into docs/legal/anthropic/.

Run weekly by .github/workflows/legal-sync.yml. Each file holds only the
document's own text (no fetch time), so a git diff means Anthropic changed it.
`index.md` lists every /legal/ page in anthropic.com's sitemap, so a new policy
shows up too. Exit code 1 when a source cannot be fetched or parsed: a silent
empty snapshot would read as "the policy was deleted".
"""
import html
import pathlib
import re
import datetime
import sys
import urllib.request

OUT = pathlib.Path(__file__).resolve().parent.parent / "docs" / "legal" / "anthropic"
UA = {"User-Agent": "Mozilla/5.0 (8sync legal-sync; +https://github.com/8-Sync-Dev/su-code)"}

# name -> URL. anthropic.com serves HTML; code.claude.com serves Markdown.
SOURCES = {
    "usage-policy": "https://www.anthropic.com/legal/aup",
    "commercial-terms": "https://www.anthropic.com/legal/commercial-terms",
    "consumer-terms": "https://www.anthropic.com/legal/consumer-terms",
    "privacy-policy": "https://www.anthropic.com/legal/privacy",
    "claude-code-legal-and-compliance": "https://code.claude.com/docs/en/legal-and-compliance.md",
    "claude-code-data-usage": "https://code.claude.com/docs/en/data-usage.md",
}


def fetch(url: str) -> str:
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        return r.read().decode("utf-8", "replace")


def html_text(page: str) -> str:
    """The text of the page's <main>, one block per line, headings and list items marked."""
    m = re.search(r"<main\b.*?</main>", page, re.S)
    if not m:
        raise ValueError("no <main> element")
    s = re.sub(r"<(script|style|svg|noscript)\b.*?</\1>", "", m.group(0), flags=re.S)
    s = re.sub(r"<h([1-6])\b[^>]*>", lambda h: "\n" + "#" * int(h.group(1)) + " ", s)
    s = re.sub(r"<li\b[^>]*>", "\n- ", s)
    s = re.sub(r"<br\s*/?>|</(p|div|li|h[1-6]|tr|section|ul|ol|table)>", "\n", s)
    s = html.unescape(re.sub(r"<[^>]+>", "", s))
    lines = [re.sub(r"[ \t\u00a0]+", " ", line).strip() for line in s.splitlines()]
    out = []
    for line in lines:
        if line and line not in ("-", "#") and (not out or line != out[-1]):
            out.append(line)
    return "\n".join(out)


def md_text(page: str) -> str:
    """Drop the docs-site preamble (the `> ## Documentation Index` quote block)."""
    lines = page.splitlines()
    while lines and (lines[0].startswith(">") or not lines[0].strip()):
        lines.pop(0)
    return "\n".join(line.rstrip() for line in lines).strip()


def legal_index() -> str:
    sitemap = fetch("https://www.anthropic.com/sitemap.xml")
    urls = sorted(set(re.findall(r"<loc>(https://www\.anthropic\.com/legal/[^<]+)</loc>", sitemap)))
    if not urls:
        raise ValueError("sitemap lists no /legal/ pages")
    return "\n".join(f"- {u}" for u in urls)


def stamp_index(day: str) -> None:
    """Put `Snapshot date: YYYY-MM-DD (UTC)` right under index.md's source comment."""
    path = OUT / "index.md"
    if not path.exists():
        return
    lines = [l for l in path.read_text(encoding="utf-8").splitlines() if not l.startswith("Snapshot date:")]
    while len(lines) > 1 and lines[1] == "":
        del lines[1]
    lines[1:1] = ["", f"Snapshot date: {day} (UTC)", ""]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    failed = []
    changed = False
    jobs = {name: (url, lambda url=url: (md_text if url.endswith(".md") else html_text)(fetch(url))) for name, url in SOURCES.items()}
    jobs["index"] = ("https://www.anthropic.com/sitemap.xml (every /legal/ page)", legal_index)
    for name, (url, get) in jobs.items():
        try:
            text = get()
            if len(text) < 500 and name != "index":
                raise ValueError(f"only {len(text)} chars — page layout changed?")
        except Exception as e:  # noqa: BLE001 — report every source, then fail
            failed.append(f"{name}: {e}")
            continue
        body = f"<!-- source: {url} — snapshot by scripts/legal-sync.py; do not edit -->\n\n{text}\n"
        path = OUT / f"{name}.md"
        if name == "index" and path.exists():  # keep the existing stamp so an unchanged run is a no-op
            m = re.search(r"^Snapshot date: .*$", path.read_text(encoding="utf-8"), re.M)
            if m:
                head, rest = body.split("\n\n", 1)
                body = f"{head}\n\n{m.group(0)}\n\n{rest}"
        if not path.exists() or path.read_text(encoding="utf-8") != body:
            path.write_text(body, encoding="utf-8", newline="\n")
            print(f"updated {path.relative_to(OUT.parent.parent.parent)}")
            changed = True
    if changed:  # stamp only on a real change, so unchanged runs stay byte-identical
        stamp_index(datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d"))
    for f in failed:
        print(f"error: {f}", file=sys.stderr)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
