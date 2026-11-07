//! KNOWLEDGE v2 curator: deterministic (no model) bookkeeping for the lessons in
//! su-code/KNOWLEDGE.md, run by `consolidate_learnings` (`harness up`/`auto`).
//!
//! Entry = a top-level bullet whose text starts with `validated`/`failure`
//! (optionally bold), plus the indented lines right under it. Canonical form:
//! `- [k-<id>] (+helped/-harmful) validated|failure YYYY-MM-DD: …`.
//! A line `used: k-12+ k-40-` (own line, column 0, anywhere outside the
//! `8sync:harness` block) records that an agent leaned on k-12 (it helped) and
//! k-40 (it misled). The curator only touches prefixes and whole entries:
//! 1. gives every entry lacking one the next free id and `(+0/-0)`;
//! 2. applies and deletes `used:` lines (unknown ids are reported, ignored);
//! 3. drops exact duplicates (same text after the prefix) into the oldest id,
//!    summing counters;
//! 4. moves entries with harmful > helpful out (to su-code/archive/).
//!
//! Opt-in (AGENTS.md §8 "Default KHÔNG ĐÈ"): a file with no `[k-<n>]` entry and
//! no `used:` line is left byte-identical unless `force` (`harness up --curate`)
//! is set; that first forced pass assigns ids, which opts the repo in for good.
//!
//! Entry text is never rewritten. Removed blocks keep their id in the archive, and
//! new ids start above every id in the archive, so an id is never reused.
use std::collections::{hash_map::Entry as Slot, HashMap};
use std::path::Path;

const HARNESS_BEGIN: &str = "<!-- 8sync:harness:begin -->";
const HARNESS_END: &str = "<!-- 8sync:harness:end -->";

#[derive(Default)]
pub(crate) struct Curated {
    /// The new file content (byte-equal to the input when nothing applied).
    pub text: String,
    /// Removed entry blocks (duplicates, harmful > helpful), prefix included.
    pub archived: String,
    /// Ids named in `used:` lines that match no entry (sorted, unique).
    pub unknown: Vec<u32>,
    pub assigned: usize,
    pub marks: usize,
    pub merged: usize,
    pub harmful: usize,
}

struct Entry {
    /// 0 = none yet.
    id: u32,
    h: u32,
    x: u32,
    /// Head line index; continuation lines run to `end` (exclusive).
    head: usize,
    end: usize,
    /// Byte offset in the head line where the entry text starts.
    rest: usize,
    gone: bool,
}

fn strip_eol(l: &str) -> &str {
    l.trim_end_matches(['\n', '\r'])
}

/// `- [k-N] (+h/-x) validated…` → (id, h, x, text offset). Id and counters
/// are optional; the text must start with `validated`/`failure` as a word.
fn parse_head(t: &str) -> Option<(u32, u32, u32, usize)> {
    let mut r = t.strip_prefix("- ")?;
    let (mut id, mut h, mut x) = (0, 0, 0);
    if let Some(s) = r.strip_prefix("[k-") {
        let (n, s) = s.split_once("] ")?;
        id = n.parse().ok()?;
        r = s;
        if let Some(s) = r.strip_prefix("(+") {
            let (c, s) = s.split_once(") ")?;
            let (a, b) = c.split_once("/-")?;
            h = a.parse().ok()?;
            x = b.parse().ok()?;
            r = s;
        }
    }
    let w = r.trim_start_matches("**");
    let tail = w.strip_prefix("validated").or_else(|| w.strip_prefix("failure"))?;
    if tail.chars().next().is_some_and(char::is_alphanumeric) {
        return None;
    }
    Some((id, h, x, t.len() - r.len()))
}

/// `used: k-12+ k-40-` (optionally bulleted) → [(12, helped), (40, harmful)].
/// Any malformed token means "not a usage line" so prose is never eaten.
fn parse_used(t: &str) -> Option<Vec<(u32, bool)>> {
    let s = t.strip_prefix("- ").unwrap_or(t).strip_prefix("used:")?;
    let mut v = Vec::new();
    for tok in s.split_whitespace() {
        let tok = tok.strip_prefix("k-")?;
        let (n, good) = match tok.strip_suffix('+') {
            Some(n) => (n, true),
            None => (tok.strip_suffix('-')?, false),
        };
        if !n.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        v.push((n.parse().ok()?, good));
    }
    (!v.is_empty()).then_some(v)
}

fn push_entry(out: &mut String, lines: &[&str], e: &Entry, id: u32, h: u32, x: u32) {
    use std::fmt::Write;
    let _ = write!(out, "- [k-{id}] (+{h}/-{x}) {}", &lines[e.head][e.rest..]);
    for l in &lines[e.head + 1..e.end] {
        out.push_str(l);
    }
    if !out.ends_with('\n') {
        out.push('\n');
    }
}

/// Largest `[k-N]` id in `text`.
pub(crate) fn max_id(text: &str) -> u32 {
    text.split("[k-")
        .skip(1)
        .filter_map(|s| s.split_once(']')?.0.parse().ok())
        .max()
        .unwrap_or(0)
}

/// Largest id in any su-code/archive/*.md (0 when none), so ids stay unique.
pub(crate) fn archived_max_id(dir: &Path) -> u32 {
    let Ok(rd) = std::fs::read_dir(dir) else { return 0 };
    rd.flatten()
        .filter(|e| e.path().extension().is_some_and(|x| x == "md"))
        .filter_map(|e| std::fs::read_to_string(e.path()).ok())
        .map(|s| max_id(&s))
        .max()
        .unwrap_or(0)
}

/// Pure curator pass. `floor` (ids already burned, e.g. in the archive) is
/// only consulted when an entry needs a new id.
pub(crate) fn curate(src: &str, force: bool, floor: impl FnOnce() -> u32) -> Curated {
    let lines: Vec<&str> = src.split_inclusive('\n').collect();
    let mut drop = vec![false; lines.len()];
    let mut head_of: Vec<Option<usize>> = vec![None; lines.len()];
    let mut ents: Vec<Entry> = Vec::new();
    let mut used = Vec::new();
    let (mut managed, mut fence) = (false, false);
    for (i, l) in lines.iter().enumerate() {
        let t = strip_eol(l);
        if let Some(e) = ents.last_mut().filter(|e| e.end == i) {
            if t.starts_with([' ', '\t']) && !t.trim().is_empty() {
                e.end = i + 1;
                continue;
            }
        }
        if t.starts_with(HARNESS_BEGIN) {
            managed = true;
        } else if t.starts_with(HARNESS_END) {
            managed = false;
        } else if t.starts_with("```") {
            fence = !fence;
        } else if managed || fence {
        } else if let Some(u) = parse_used(t) {
            used.extend(u);
            drop[i] = true;
        } else if let Some((id, h, x, rest)) = parse_head(t) {
            head_of[i] = Some(ents.len());
            ents.push(Entry { id, h, x, head: i, end: i + 1, rest, gone: false });
        }
    }
    if !force && used.is_empty() && ents.iter().all(|e| e.id == 0) {
        return Curated { text: src.to_string(), ..Curated::default() };
    }

    let mut out = Curated::default();
    // 1. Ids: keep the first holder of an id, re-number later collisions.
    let mut max = 0;
    let mut seen = std::collections::HashSet::new();
    for e in &mut ents {
        if e.id != 0 && !seen.insert(e.id) {
            e.id = 0;
        }
        max = max.max(e.id);
    }
    if ents.iter().any(|e| e.id == 0) {
        let mut next = max.max(floor());
        for e in ents.iter_mut().filter(|e| e.id == 0) {
            next += 1;
            e.id = next;
            out.assigned += 1;
        }
    }
    // 2. Usage marks.
    let by_id: HashMap<u32, usize> = ents.iter().enumerate().map(|(i, e)| (e.id, i)).collect();
    for (n, good) in used {
        match by_id.get(&n) {
            Some(&i) if good => ents[i].h = ents[i].h.saturating_add(1),
            Some(&i) => ents[i].x = ents[i].x.saturating_add(1),
            None => {
                out.unknown.push(n);
                continue;
            }
        }
        out.marks += 1;
    }
    out.unknown.sort_unstable();
    out.unknown.dedup();
    // 3. Exact duplicates fold into the first occurrence (oldest id wins).
    let mut first: HashMap<String, usize> = HashMap::new();
    for i in 0..ents.len() {
        let e = &ents[i];
        let mut key = strip_eol(lines[e.head])[e.rest..].trim_end().to_string();
        for l in &lines[e.head + 1..e.end] {
            key.push('\n');
            key.push_str(strip_eol(l).trim_end());
        }
        match first.entry(key) {
            Slot::Vacant(v) => {
                v.insert(i);
            }
            Slot::Occupied(o) => {
                let j = *o.get();
                let (a, b) = (ents[j].id, ents[i].id);
                push_entry(&mut out.archived, &lines, &ents[i], a.max(b), ents[i].h, ents[i].x);
                let (h, x) = (ents[i].h, ents[i].x);
                let k = &mut ents[j];
                k.id = a.min(b);
                k.h = k.h.saturating_add(h);
                k.x = k.x.saturating_add(x);
                ents[i].gone = true;
                out.merged += 1;
            }
        }
    }
    // 4. Harmful > helpful leaves the file.
    for e in ents.iter_mut().filter(|e| !e.gone && e.x > e.h) {
        push_entry(&mut out.archived, &lines, e, e.id, e.h, e.x);
        e.gone = true;
        out.harmful += 1;
    }
    for e in ents.iter().filter(|e| e.gone) {
        drop[e.head..e.end].fill(true);
    }

    out.text.reserve(src.len() + 16 * ents.len());
    for (i, l) in lines.iter().enumerate() {
        if drop[i] {
            continue;
        }
        match head_of[i] {
            Some(n) => {
                use std::fmt::Write;
                let e = &ents[n];
                let _ = write!(out.text, "- [k-{}] (+{}/-{}) {}", e.id, e.h, e.x, &l[e.rest..]);
            }
            None => out.text.push_str(l),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Forced pass (`--curate`), so the rules below are tested without the gate.
    fn run(src: &str) -> Curated {
        curate(src, true, || 0)
    }

    /// AGENTS.md §8: a repo that never opted in is left byte-identical; a
    /// `[k-N]` entry, a `used:` line, or `--curate` opts it in.
    #[test]
    fn not_opted_in_is_a_no_op_until_ids_used_or_forced() {
        let src = "## Learnings\n- validated: a\n- validated: a\n- failure: b\n";
        let c = curate(src, false, || 0);
        assert_eq!(c.text, src);
        assert!(c.archived.is_empty() && c.assigned + c.merged == 0);
        let forced = curate(src, true, || 0);
        assert_eq!(forced.text, "## Learnings\n- [k-1] (+0/-0) validated: a\n- [k-3] (+0/-0) failure: b\n");
        assert_eq!(curate(&forced.text, false, || 0).text, forced.text, "ids keep it opted in, nothing left to do");
        let used_only = curate("- validated: x\nused: k-1+\n", false, || 0);
        assert_eq!(used_only.text, "- [k-1] (+1/-0) validated: x\n", "a used: line opts in");
        let with_id = curate("- [k-3] validated: y\n- failure: z\n", false, || 0);
        assert_eq!(with_id.text, "- [k-3] (+0/-0) validated: y\n- [k-4] (+0/-0) failure: z\n");
    }

    /// End to end: no ids → `consolidate_learnings` writes nothing (no archive
    /// dir either); `force` assigns ids; an agent's concurrent append wins.
    #[test]
    fn consolidate_respects_opt_in_and_skips_on_concurrent_change() {
        let d = std::env::temp_dir().join(format!("8sync-know-gate-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(d.join("su-code")).unwrap();
        let know = d.join("su-code/KNOWLEDGE.md");
        let src = "# K\r\n\r\n## Learnings\r\n- validated: a\r\n- validated: a\r\n";
        std::fs::write(&know, src).unwrap();
        crate::verbs::harness::memory::consolidate_learnings(&d, false).unwrap();
        assert_eq!(std::fs::read_to_string(&know).unwrap(), src);
        assert!(!d.join("su-code/archive").exists(), "no archive for a repo that never opted in");
        crate::verbs::harness::memory::consolidate_learnings(&d, true).unwrap();
        assert_eq!(std::fs::read_to_string(&know).unwrap(), "# K\r\n\r\n## Learnings\r\n- [k-1] (+0/-0) validated: a\r\n");

        let appended = "# K\r\n\r\n## Learnings\r\n- [k-1] (+0/-0) validated: a\r\n- failure: new\r\n";
        std::fs::write(&know, appended).unwrap();
        let arch = d.join("su-code/archive/x.md");
        let wrote = crate::verbs::harness::memory::write_if_unchanged(&know, src, "clobber", &[(arch.clone(), "a".into())]).unwrap();
        assert!(!wrote);
        assert_eq!(std::fs::read_to_string(&know).unwrap(), appended);
        assert!(!arch.exists(), "no archive when the main write is skipped");
        assert!(crate::verbs::harness::memory::write_if_unchanged(&know, appended, "ok", &[(arch.clone(), "a".into())]).unwrap());
        assert!(arch.exists() && std::fs::read_to_string(&know).unwrap() == "ok");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn ids_go_to_entry_bullets_only_and_continue_after_the_max() {
        let src = "# KNOWLEDGE\n\n## validated: heading stays\nvalidated: prose stays\n\
- note: not an entry\n- validatedness is prose\n- [k-7] (+1/-0) validated: a\n\
- validated 2026-11-07: b\n  continuation\n- **failure: c**\n- [k-3] failure: no counter\n";
        let c = run(src);
        assert_eq!(c.assigned, 2);
        assert!(c.text.contains("## validated: heading stays\nvalidated: prose stays\n- note: not an entry\n- validatedness is prose\n"));
        assert!(c.text.contains("- [k-7] (+1/-0) validated: a\n"));
        assert!(c.text.contains("- [k-8] (+0/-0) validated 2026-11-07: b\n  continuation\n"));
        assert!(c.text.contains("- [k-9] (+0/-0) **failure: c**\n"));
        assert!(c.text.contains("- [k-3] (+0/-0) failure: no counter\n"));
        // The archive floor wins over the file's own max, so archived ids stay burned.
        assert!(curate("- validated: z\n", true, || 40).text.starts_with("- [k-41] (+0/-0) "));
    }

    #[test]
    fn harness_block_and_code_fences_are_never_entries() {
        let src = "<!-- 8sync:harness:begin -->\n- validated: managed\n<!-- 8sync:harness:end -->\n\
```\n- failure: sample\nused: k-1+\n```\n";
        let c = run(src);
        assert_eq!(c.text, src);
        assert_eq!((c.assigned, c.marks), (0, 0));
    }

    #[test]
    fn used_lines_count_repeats_report_unknown_and_disappear() {
        let src = "- [k-1] (+0/-0) validated: a\n- [k-2] (+2/-0) failure: b\n\
used: k-1+ k-1+ k-2- k-99+ k-99-\n- used: k-2+\nused: maybe later\n";
        let c = run(src);
        assert_eq!(c.marks, 4);
        assert_eq!(c.unknown, vec![99]);
        assert_eq!(
            c.text,
            "- [k-1] (+2/-0) validated: a\n- [k-2] (+3/-1) failure: b\nused: maybe later\n"
        );
    }

    /// End to end through `consolidate_learnings`: harmful entry lands in
    /// su-code/archive/, CRLF survives the budget cut too, a rerun writes nothing.
    #[test]
    fn consolidate_archives_harmful_keeps_crlf_and_reruns_clean() {
        let d = std::env::temp_dir().join(format!("8sync-know-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(d.join("su-code/archive")).unwrap();
        std::fs::write(d.join("su-code/archive/KNOWLEDGE-1.md"), "- [k-30] (+0/-0) validated: old\n").unwrap();
        let mut src = String::from("# K\r\n\r\n## Learnings\r\n- [k-2] (+0/-1) failure: bad advice\r\nused: k-2- k-77+\r\n");
        for i in 0..205 {
            src.push_str(&format!("- validated: lesson {i}\r\n"));
        }
        let know = d.join("su-code/KNOWLEDGE.md");
        std::fs::write(&know, &src).unwrap();
        crate::verbs::harness::memory::consolidate_learnings(&d, false).unwrap();
        let after = std::fs::read_to_string(&know).unwrap();
        assert!(!after.contains("bad advice") && !after.contains("used:"));
        assert!(after.contains("- [k-235] (+0/-0) validated: lesson 204\r\n"), "ids start above the archive max");
        assert!(after.contains(".md)_\r\n- [k-"), "pointer keeps CRLF");
        assert_eq!(after.matches('\n').count(), after.matches("\r\n").count());
        let archives = || std::fs::read_dir(d.join("su-code/archive")).unwrap().count();
        let curated = std::fs::read_dir(d.join("su-code/archive"))
            .unwrap()
            .flatten()
            .find(|e| e.file_name().to_string_lossy().ends_with("-curated.md"))
            .map(|e| std::fs::read_to_string(e.path()).unwrap())
            .expect("curated archive written");
        assert!(curated.contains("- [k-2] (+0/-2) failure: bad advice\r\n"));
        let n = archives();
        crate::verbs::harness::memory::consolidate_learnings(&d, false).unwrap();
        assert_eq!(std::fs::read_to_string(&know).unwrap(), after);
        assert_eq!(archives(), n, "second run archives nothing");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn duplicates_merge_into_the_oldest_id_with_summed_counters() {
        let src = "- [k-5] (+1/-0) validated: same\n- [k-2] (+2/-1) validated: same\n- validated: same\n- validated: other\n";
        let c = run(src);
        assert_eq!(c.merged, 2);
        assert_eq!(c.text, "- [k-2] (+3/-1) validated: same\n- [k-7] (+0/-0) validated: other\n");
        assert!(c.archived.contains("- [k-5] (+2/-1) validated: same\n"));
        assert!(c.archived.contains("- [k-6] (+0/-0) validated: same\n"));
    }

    #[test]
    fn harmful_entries_leave_with_their_continuation() {
        let src = "- [k-1] (+1/-2) failure: misleading\n  detail\n- [k-2] (+1/-1) validated: tie stays\n";
        let c = run(src);
        assert_eq!(c.harmful, 1);
        assert_eq!(c.text, "- [k-2] (+1/-1) validated: tie stays\n");
        assert_eq!(c.archived, "- [k-1] (+1/-2) failure: misleading\n  detail\n");
    }

    #[test]
    fn second_pass_is_a_no_op_and_crlf_survives() {
        let src = "# K\r\n\r\n- validated: a\r\n  more\r\n- failure: a\r\nused: k-1+\r\n- validated: a\r\n  more\r\n";
        let c = run(src);
        assert_eq!(c.text, "# K\r\n\r\n- [k-1] (+1/-0) validated: a\r\n  more\r\n- [k-2] (+0/-0) failure: a\r\n");
        assert_eq!(c.archived, "- [k-3] (+0/-0) validated: a\r\n  more\r\n");
        let again = run(&c.text);
        assert_eq!(again.text, c.text);
        assert!(again.archived.is_empty() && again.assigned + again.marks + again.merged == 0);
    }

    #[test]
    fn max_id_reads_archived_ids() {
        assert_eq!(max_id("x [k-4] y [k-12] (+0/-0) [k-x] [k-"), 12);
        assert_eq!(max_id("none"), 0);
    }
}
