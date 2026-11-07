//! `8sync ccc eco scan` / `eco kill`: the evidence HQ's "Canh máy" hands an agent room, and the safe
//! kill it acts with. Owner 2026-11-07: "khi cpu ram gpu tăng bất thường không kill liền phải xem kĩ
//! do duplicate, spam open… thì kill ngay được".
//!
//! `scan` lists every process twice ([`SPAN`] apart, native Toolhelp: no WMI) and reports, without
//! touching anything:
//! - duplicate: two or more top-level copies of the same command line under the same parent (the
//!   same dev server or MCP opened twice); the oldest is the one to keep;
//! - spam: [`SPAM_N`]+ top-level copies of one program started in the last [`SPAM_S`];
//! - orphan: a language server / MCP / trail worker whose host session is gone ([`super::eco::orphans`]);
//! - hog: a program (with its own-image children) over [`HOG_CPU`]% of the machine's CPU or [`HOG_MB`] MB of RAM.
//!
//! Every process is named `pid:start` (start = unix seconds), so a kill decided minutes later never
//! hits a recycled pid. `kill` takes those ids, refuses sessions (claude / omp), Claude Desktop,
//! 8sync and HQ, the OS's own processes and its own ancestors, and kills each pid alone
//! ([`reap::kill`]); `--tree` takes what it started too.

use std::path::Path;
use std::time::Duration;

use anyhow::Result;
use serde_json::{json, Value};

use super::eco::{is_desktop_app, is_session, orphans};
use super::reap::{self, Proc};
use crate::verbs::hq_core::sampler::Sampler;

/// Between the two process listings (per-process CPU share).
const SPAN: Duration = Duration::from_millis(1500);
/// A process tree over this share of the whole machine's CPU is a hog.
const HOG_CPU: f64 = 25.0;
/// … or holding this much RAM.
const HOG_MB: u64 = 3072;
/// Spam: this many top-level copies of one program …
const SPAM_N: usize = 5;
/// … started within this many seconds.
const SPAM_S: u64 = 600;
const MIB: u64 = 1024 * 1024;

/// The OS's own processes and the desktop shell: never killed from here.
const SYSTEM: [&str; 22] = [
    "system", "idle", "registry", "smss", "csrss", "wininit", "services", "lsass", "winlogon", "svchost", "dwm", "explorer", "memory compression", "msmpeng", "fontdrvhost", "searchhost", "sihost", "taskhostw", "systemd", "init", "launchd", "kernel_task",
];
/// Programs that legitimately run as many top-level copies (terminals, shells, the OS's helpers).
const MANY_OK: [&str; 12] = ["bash", "sh", "zsh", "cmd", "powershell", "pwsh", "conhost", "openconsole", "windowsterminal", "git", "runtimebroker", "wmiprvse"];

/// Why `p` must not be killed from a scan, or None when it may be.
pub(super) fn protected(procs: &[Proc], p: &Proc, me: u32) -> Option<&'static str> {
    if p.pid <= 4 || SYSTEM.contains(&p.image.as_str()) {
        Some("tiến trình hệ thống")
    } else if is_session(p) {
        Some("phiên Claude Code / omp: đóng trong HQ")
    } else if is_desktop_app(p) || p.image == "claude" {
        Some("Claude Desktop")
    } else if p.image == "8sync" || reap::is_hq(&reap::norm(&p.cmd, true)) {
        Some("8sync / HQ")
    } else if reap::lineage(procs, me).contains(&p.pid) {
        Some("tiến trình đang chạy lệnh này")
    } else {
        None
    }
}

/// `p`'s parent when it really is its parent: listed, and started no later (a recycled pid is not).
fn parent<'a>(procs: &'a [Proc], p: &Proc) -> Option<&'a Proc> {
    procs.iter().find(|q| p.ppid != 0 && q.pid == p.ppid && q.pid != p.pid && q.started <= p.started)
}

/// A top-level copy of its program: no live parent of the same image (a browser's renderers and a
/// node server's workers fold into their root).
fn top_level(procs: &[Proc], p: &Proc) -> bool {
    !p.cmd.contains("--type=") && parent(procs, p).is_none_or(|q| q.image != p.image)
}

/// `p` and everything it started (a child only when started after its parent); `same_only`: only
/// children of its own image (a browser's renderers, a server's workers), not the programs it ran.
fn tree_by(procs: &[Proc], pid: u32, same_only: bool) -> Vec<u32> {
    let image = procs.iter().find(|p| p.pid == pid).map(|p| p.image.as_str()).unwrap_or("");
    let mut out = vec![pid];
    let mut i = 0;
    while i < out.len() && out.len() < 4096 {
        let cur = out[i];
        for q in procs {
            if q.ppid == cur && q.pid != cur && !out.contains(&q.pid) && parent(procs, q).is_some() && (!same_only || q.image == image) {
                out.push(q.pid);
            }
        }
        i += 1;
    }
    out
}

fn tree(procs: &[Proc], pid: u32) -> Vec<u32> {
    tree_by(procs, pid, false)
}

/// What a program itself holds: it and its own-image children. Programs it started count on their
/// own, so a session's tree never claims the ffmpeg or build running under it.
fn segment(procs: &[Proc], pid: u32) -> Vec<u32> {
    tree_by(procs, pid, true)
}

pub(super) fn id(p: &Proc) -> String {
    format!("{}:{}", p.pid, p.started)
}

fn short(cmd: &str) -> String {
    let c = cmd.split_whitespace().collect::<Vec<_>>().join(" ");
    if c.chars().count() > 160 {
        format!("{}…", c.chars().take(159).collect::<String>())
    } else {
        c
    }
}

/// Per-process CPU share of the whole machine (%) between two listings `span_s` apart.
fn cpu_of(before: &[Proc], p: &Proc, span_s: f64, cores: usize) -> f64 {
    let Some(b) = before.iter().find(|b| b.pid == p.pid && b.started == p.started) else { return 0.0 };
    let used = p.cpu.saturating_sub(b.cpu) as f64 / 1e7; // 100 ns units → s
    (used / (span_s * cores.max(1) as f64) * 100.0).min(100.0)
}

/// The suspects (pure). `before`/`procs`: two listings `span_s` apart; `now`: unix s; `me`: this
/// process (its ancestors are never offered).
pub(super) fn suspects(before: &[Proc], procs: &[Proc], span_s: f64, cores: usize, now: u64, me: u32) -> Vec<Value> {
    let cpu = |p: &Proc| cpu_of(before, p, span_s, cores);
    let row = |p: &Proc| {
        let t = segment(procs, p.pid);
        let members = procs.iter().filter(|q| t.contains(&q.pid));
        let (mb, c) = members.fold((0u64, 0f64), |(m, c), q| (m + q.rss, c + cpu(q)));
        json!({ "id": id(p), "pid": p.pid, "image": p.image, "mb": mb / MIB, "cpu": (c * 10.0).round() / 10.0, "procs": t.len(), "ageMin": now.saturating_sub(p.started) / 60, "cmd": short(&p.cmd) })
    };
    let may = |p: &Proc| protected(procs, p, me).is_none();
    let mut out = Vec::new();
    let tops: Vec<&Proc> = procs.iter().filter(|p| p.started > 0 && top_level(procs, p) && !MANY_OK.contains(&p.image.as_str()) && !SYSTEM.contains(&p.image.as_str())).collect();

    // Duplicates: the same command line, word for word, started by the same parent (or by none left).
    // Copies under different parents are each their own session's (every omp room runs its MCPs).
    let owner = |p: &Proc| parent(procs, p).map_or_else(|| "-".to_string(), id);
    let key = |p: &Proc| format!("{}\0{}\0{}", p.image, owner(p), reap::norm(&p.cmd, true));
    let mut seen: Vec<String> = Vec::new();
    for p in &tops {
        let k = key(p);
        if p.cmd.trim().is_empty() || seen.contains(&k) {
            continue;
        }
        let mut same: Vec<&Proc> = tops.iter().copied().filter(|q| key(q) == k).collect();
        seen.push(k);
        if same.len() < 2 {
            continue;
        }
        same.sort_by_key(|q| q.started);
        let kill: Vec<String> = same[1..].iter().filter(|q| may(q)).map(|q| id(q)).collect();
        out.push(json!({
            "kind": "duplicate", "image": p.image,
            "reason": format!("{} bản {} cùng một dòng lệnh: giữ bản cũ nhất, các bản sau là mở trùng", same.len(), p.image),
            "keep": id(same[0]), "kill": kill, "canKill": same[1..].iter().all(|q| may(q)),
            "procs": same.iter().map(|q| row(q)).collect::<Vec<_>>(),
        }));
    }

    // Spam: many fresh top-level copies of one program, past what a duplicate above already names.
    let named: Vec<String> = out.iter().flat_map(|x| x["procs"].as_array().into_iter().flatten().filter_map(|r| r["id"].as_str().map(str::to_string))).collect();
    let mut images: Vec<&str> = tops.iter().map(|p| p.image.as_str()).collect();
    images.sort_unstable();
    images.dedup();
    for img in images {
        let fresh: Vec<&Proc> = tops.iter().copied().filter(|p| p.image == img && now.saturating_sub(p.started) <= SPAM_S && !named.contains(&id(p))).collect();
        if fresh.len() < SPAM_N {
            continue;
        }
        out.push(json!({
            "kind": "spam", "image": img,
            "reason": format!("{} bản {} mở trong {} phút qua", fresh.len(), img, SPAM_S / 60),
            "kill": fresh.iter().filter(|q| may(q)).map(|q| id(q)).collect::<Vec<_>>(), "canKill": fresh.iter().all(|q| may(q)),
            "procs": fresh.iter().map(|q| row(q)).collect::<Vec<_>>(),
        }));
    }

    for o in orphans(procs, now, me) {
        let Some(p) = procs.iter().find(|p| p.pid == o.pid) else { continue };
        out.push(json!({
            "kind": "orphan", "image": p.image,
            "reason": format!("{} mồ côi: phiên mở nó đã đóng", o.kind),
            "kill": [id(p)], "canKill": may(p), "procs": [row(p)],
        }));
    }

    // Hogs: top-level trees over the CPU or RAM line, heaviest first, at most 6.
    let mut hogs: Vec<(f64, u64, &Proc)> = tops
        .iter()
        .map(|p| {
            let t = segment(procs, p.pid);
            let members = procs.iter().filter(|q| t.contains(&q.pid));
            let (mb, c) = members.fold((0u64, 0f64), |(m, c), q| (m + q.rss, c + cpu(q)));
            (c, mb / MIB, *p)
        })
        .filter(|(c, mb, _)| *c >= HOG_CPU || *mb >= HOG_MB)
        .collect();
    hogs.sort_by(|a, b| (b.0 + b.1 as f64 / 100.0).total_cmp(&(a.0 + a.1 as f64 / 100.0)));
    for (c, mb, p) in hogs.into_iter().take(6) {
        out.push(json!({
            "kind": "hog", "image": p.image,
            "reason": format!("{}: {:.0}% CPU máy, {:.1} GB RAM", p.image, c, mb as f64 / 1024.0),
            "kill": if may(p) { vec![id(p)] } else { vec![] }, "canKill": may(p), "procs": [row(p)],
        }));
    }
    out
}

/// The heaviest programs by image (all copies summed): `[{image, n, cpu, mb}]`, CPU first, at most 8.
fn top_images(before: &[Proc], procs: &[Proc], span_s: f64, cores: usize) -> Vec<Value> {
    let mut by: Vec<(String, usize, f64, u64)> = Vec::new();
    for p in procs {
        let c = cpu_of(before, p, span_s, cores);
        match by.iter_mut().find(|e| e.0 == p.image) {
            Some(e) => {
                e.1 += 1;
                e.2 += c;
                e.3 += p.rss;
            }
            None => by.push((p.image.clone(), 1, c, p.rss)),
        }
    }
    by.retain(|e| !matches!(e.0.as_str(), "idle" | "system" | "memory compression"));
    by.sort_by(|a, b| b.2.total_cmp(&a.2).then(b.3.cmp(&a.3)));
    by.into_iter().take(8).map(|(image, n, c, b)| json!({ "image": image, "n": n, "cpu": (c * 10.0).round() / 10.0, "mb": b / MIB })).collect()
}

/// `eco scan`: machine numbers, heaviest programs and suspects, nothing touched.
pub(super) fn scan() -> Value {
    let sampler = Sampler::new();
    if let Some(s) = &sampler {
        s.get(Duration::ZERO);
    }
    let t0 = std::time::Instant::now();
    let before = reap::list(now_s());
    std::thread::sleep(SPAN);
    let now = now_s();
    let procs = reap::list(now);
    let span = t0.elapsed().as_secs_f64().max(0.5);
    let s = sampler.map(|s| s.get(Duration::ZERO)).unwrap_or_default();
    let cores = if s.cores > 0 { s.cores } else { std::thread::available_parallelism().map_or(1, |n| n.get()) };
    json!({
        "at": now,
        "ram": reap::ram_pct(s.mem), "memMb": s.mem.map(|(t, u)| json!({ "total": t, "used": u })),
        "cpu": s.cpu_pct,
        "gpus": s.gpus.iter().flatten().map(|g| json!({ "name": g.name, "util": g.util, "memUsed": g.mem_used, "memTotal": g.mem_total })).collect::<Vec<_>>(),
        "procs": procs.len(),
        "top": top_images(&before, &procs, span, cores),
        "suspects": suspects(&before, &procs, span, cores, now, std::process::id()),
    })
}

/// What `kill` does with one id (pure): the pids to kill, or why not.
pub(super) fn kill_plan(procs: &[Proc], target: &str, with_tree: bool, me: u32) -> Result<Vec<u32>, String> {
    let (pid, started) = target.split_once(':').and_then(|(a, b)| Some((a.parse::<u32>().ok()?, b.parse::<u64>().ok()?))).ok_or("cần dạng pid:start")?;
    let p = procs.iter().find(|p| p.pid == pid).ok_or("không còn chạy")?;
    if p.started != started {
        return Err("pid đã thuộc tiến trình khác (start khác): không kill".into());
    }
    if let Some(why) = protected(procs, p, me) {
        return Err(format!("không kill {why}"));
    }
    if !with_tree {
        return Ok(vec![pid]);
    }
    let keep = reap::lineage(procs, me);
    let t: Vec<u32> = tree(procs, pid).into_iter().filter(|q| !keep.contains(q) && procs.iter().find(|x| x.pid == *q).is_some_and(|x| protected(procs, x, me).is_none())).collect();
    Ok(t)
}

/// `eco kill <pid:start>… [--tree]`: one row per id `{id, ok, killed, error}`; each kill is logged.
pub(super) fn kill(home: &Path, ids: &[&str], with_tree: bool) -> Vec<Value> {
    let now = now_s();
    let procs = reap::list(now);
    let me = std::process::id();
    let mut log = String::new();
    let rows = ids
        .iter()
        .map(|t| match kill_plan(&procs, t, with_tree, me) {
            Ok(pids) => {
                let ok = reap::kill(&pids);
                let killed = ok.iter().filter(|x| **x).count();
                let p = procs.iter().find(|p| Some(p.pid) == pids.first().copied());
                log.push_str(&format!("{now} kill {t} {} ({killed}/{} pids) {}\n", p.map_or("", |p| p.image.as_str()), pids.len(), p.map_or(String::new(), |p| short(&p.cmd))));
                json!({ "id": t, "ok": killed > 0, "killed": killed, "error": if killed > 0 { Value::Null } else { json!("taskkill/kill không thành công") } })
            }
            Err(e) => json!({ "id": t, "ok": false, "killed": 0, "error": e }),
        })
        .collect();
    if !log.is_empty() {
        use std::io::Write;
        let path = home.join(".config/8sync/eco-reap.log");
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
            let _ = f.write_all(log.as_bytes());
        }
    }
    rows
}

fn now_s() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs())
}

/// `eco scan` without `--json`.
pub(super) fn scan_text(v: &Value) -> String {
    let mut s = format!("RAM {}% · CPU {}%", v["ram"], v["cpu"]);
    for g in v["gpus"].as_array().into_iter().flatten() {
        s.push_str(&format!(" · GPU {}% ({}/{} MB)", g["util"], g["memUsed"], g["memTotal"]));
    }
    let top: Vec<String> = v["top"].as_array().into_iter().flatten().map(|t| format!("{}({}x)={}%", t["image"].as_str().unwrap_or("?"), t["n"], t["cpu"])).collect();
    s.push_str(&format!("\ntop: {}", top.join(" ")));
    let sus = v["suspects"].as_array().cloned().unwrap_or_default();
    if sus.is_empty() {
        s.push_str("\nKhông có nghi vấn.");
    }
    for x in sus {
        s.push_str(&format!("\n[{}] {} · kill: {}", x["kind"].as_str().unwrap_or("?"), x["reason"].as_str().unwrap_or(""), x["kill"].as_array().map(|a| a.iter().filter_map(Value::as_str).collect::<Vec<_>>().join(" ")).unwrap_or_default()));
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(pid: u32, ppid: u32, image: &str, started: u64, cmd: &str) -> Proc {
        Proc { pid, ppid, started, image: image.into(), name: format!("{image}.exe"), cmd: cmd.into(), rss: 100 * MIB, ..Proc::default() }
    }

    const NOW: u64 = 1_000_000;

    #[test]
    fn duplicates_keep_the_oldest_and_fold_children_into_their_root() {
        let procs = vec![
            p(10, 1, "explorer", 1, "explorer.exe"),
            p(20, 10, "node", NOW - 3600, "node vite preview --port 4173"),
            p(21, 20, "node", NOW - 3600, "node worker.js"),
            p(30, 10, "node", NOW - 60, "node vite preview --port 4173"),
            p(40, 10, "node", NOW - 60, "node vite preview --port 5000"),
            p(50, 10, "msedge", NOW - 900, "msedge.exe"),
            p(51, 50, "msedge", NOW - 900, "msedge.exe --type=renderer"),
            p(52, 50, "msedge", NOW - 900, "msedge.exe --type=renderer"),
        ];
        let s = suspects(&procs, &procs, 1.5, 8, NOW, 9999);
        let dups: Vec<&Value> = s.iter().filter(|x| x["kind"] == "duplicate").collect();
        assert_eq!(dups.len(), 1, "{s:#?}");
        assert_eq!(dups[0]["keep"], format!("20:{}", NOW - 3600));
        assert_eq!(dups[0]["kill"], json!([format!("30:{}", NOW - 60)]));
        // The kept copy's row counts its worker.
        assert_eq!(dups[0]["procs"][0]["procs"], 2);
    }

    #[test]
    fn the_same_server_under_two_sessions_is_not_a_duplicate() {
        let procs = vec![
            p(10, 1, "explorer", 1, ""),
            p(20, 10, "omp", NOW - 900, "omp a"),
            p(30, 10, "omp", NOW - 900, "omp b"),
            p(21, 20, "node", NOW - 800, "node zai-mcp-server"),
            p(31, 30, "node", NOW - 800, "node zai-mcp-server"),
        ];
        assert!(suspects(&procs, &procs, 1.5, 8, NOW, 9999).iter().all(|x| x["kind"] != "duplicate"));
    }

    #[test]
    fn duplicate_sessions_are_reported_but_never_offered_for_kill() {
        let procs = vec![p(10, 1, "explorer", 1, ""), p(20, 10, "omp", NOW - 600, "omp --session-dir X"), p(30, 10, "omp", NOW - 60, "omp --session-dir X")];
        let s = suspects(&procs, &procs, 1.5, 8, NOW, 9999);
        assert_eq!(s.len(), 1);
        assert_eq!(s[0]["canKill"], false);
        assert_eq!(s[0]["kill"], json!([]));
    }

    #[test]
    fn spam_is_many_fresh_top_level_copies_and_shells_never_count() {
        let mut procs = vec![p(10, 1, "explorer", 1, "")];
        for i in 0..6 {
            procs.push(p(100 + i, 10, "chrome", NOW - 30 * u64::from(i), &format!("chrome --headless --user-data-dir=t{i}")));
            procs.push(p(200 + i, 10, "bash", NOW - 10, &format!("bash -c x{i}")));
        }
        procs.push(p(300, 10, "chrome", NOW - 3 * SPAM_S, "chrome --headless --user-data-dir=old"));
        // Six copies of one command under one parent are a duplicate, not spam on top of it.
        let mut same = vec![p(10, 1, "explorer", 1, "")];
        same.extend((0..6).map(|i| p(400 + i, 10, "ping", NOW - 10, "ping -n 300 127.0.0.1")));
        let kinds: Vec<Value> = suspects(&same, &same, 1.5, 8, NOW, 9999).iter().map(|x| x["kind"].clone()).collect();
        assert_eq!(kinds, vec![json!("duplicate")]);
        let s = suspects(&procs, &procs, 1.5, 8, NOW, 9999);
        assert_eq!(s.iter().filter(|x| x["kind"] == "spam").count(), 1, "{s:#?}");
        let spam = s.iter().find(|x| x["kind"] == "spam").unwrap();
        assert_eq!(spam["image"], "chrome");
        assert_eq!(spam["kill"].as_array().unwrap().len(), 6);
    }

    #[test]
    fn hogs_sum_the_tree_cpu_between_the_two_listings() {
        let before = vec![p(10, 1, "explorer", 1, ""), Proc { cpu: 0, ..p(20, 10, "python", NOW - 600, "python train.py") }, Proc { cpu: 0, ..p(21, 20, "python", NOW - 600, "python -c w") }];
        // 8 cores, 1.5 s: 12 core-seconds of budget; 3 s + 3 s = 6 s used = 50%.
        let after = vec![before[0].clone(), Proc { cpu: 30_000_000, ..before[1].clone() }, Proc { cpu: 30_000_000, ..before[2].clone() }];
        let s = suspects(&before, &after, 1.5, 8, NOW, 9999);
        let hog = s.iter().find(|x| x["kind"] == "hog").expect("hog");
        assert_eq!(hog["image"], "python");
        assert_eq!(hog["procs"][0]["cpu"], 50.0);
        assert_eq!(hog["canKill"], true);
        // Under a session: the hog is the program, not the session above it.
        let mut before2 = before.clone();
        before2.insert(1, p(5, 10, "omp", 1, "omp"));
        before2[2].ppid = 5;
        let mut after2 = after.clone();
        after2.insert(1, before2[1].clone());
        after2[2].ppid = 5;
        let s2 = suspects(&before2, &after2, 1.5, 8, NOW, 9999);
        let hogs: Vec<&Value> = s2.iter().filter(|x| x["kind"] == "hog").collect();
        assert_eq!(hogs.len(), 1);
        assert_eq!(hogs[0]["image"], "python");
    }

    #[test]
    fn kill_needs_the_same_start_and_refuses_protected_processes() {
        let procs = vec![
            p(10, 1, "explorer", 1, ""),
            p(20, 10, "node", 500, "node server.js"),
            p(21, 20, "node", 501, "node child.js"),
            p(30, 10, "omp", 400, "omp"),
            p(40, 1, "svchost", 2, "svchost.exe -k x"),
        ];
        assert_eq!(kill_plan(&procs, "20:500", false, 9999), Ok(vec![20]));
        assert_eq!(kill_plan(&procs, "20:500", true, 9999), Ok(vec![20, 21]));
        assert!(kill_plan(&procs, "20:499", false, 9999).unwrap_err().contains("start khác"));
        assert!(kill_plan(&procs, "30:400", false, 9999).unwrap_err().contains("phiên"));
        assert!(kill_plan(&procs, "40:2", false, 9999).unwrap_err().contains("hệ thống"));
        assert!(kill_plan(&procs, "99:1", false, 9999).is_err());
        assert!(kill_plan(&procs, "20", false, 9999).is_err());
        // Never the process running the kill, nor its ancestors.
        assert!(kill_plan(&procs, "20:500", false, 21).unwrap_err().contains("đang chạy"));
    }
}
