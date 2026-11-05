#!/usr/bin/env node
// hq-control: drive the local 8 Sync HQ UI API (apps/hq-ui) from an agent.
// Reads the UI token from ~/.config/8sync/hq/ui-token and never prints it.
// Usage: node hq.mjs <ls [--all] | log <id> [n] | msgs <id> [n] | send <id> <text…> | dialog <id> <permission|question> | answer <id> <1-9>
//                     | artifact add <file> [<file>…] [--title T] [--note N] [--session ID] [--content 38,16] [--link URL] [--for DIR] | artifact ls [n] [--session ID] [--content N] | artifact show <id>
//                     | metrics add --content N --platform P [--url U] [--at T] [--reach --reactions --comments --shares --views N] [--session ID] | metrics ls [--content N]>
// Permission prompts are read-only here: the owner taps Yes/No in the HQ UI. `answer` picks an
// option of a room's question, and only when the owner told you which one in this turn.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const port = Number(process.env.HQ_UI_PORT || 8740);
const base = `http://127.0.0.1:${port}`;
const tokenFile = path.join(os.homedir(), ".config", "8sync", "hq", "ui-token");
const dialogFile = (id) => path.join(os.tmpdir(), `hq-control-dialog-${id}.json`);
const KEYS = Object.fromEntries([..."123456789"].map((d) => [d, d]));

function die(msg, code = 1) {
  console.error(`hq-control: ${msg}`);
  process.exit(code);
}

let token = "";
try {
  token = fs.readFileSync(tokenFile, "utf8").trim();
} catch {
  die(`no UI token at ${tokenFile}: start HQ with \`8sync hq ui\``);
}

async function call(method, route, body) {
  let res;
  try {
    res = await fetch(base + route, {
      method,
      headers: { "x-hq-token": token, ...(body ? { "content-type": "application/json", origin: base } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    die(`HQ is not answering on ${base}: start it with \`8sync hq ui\` (or set HQ_UI_PORT)`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) die(`${method} ${route} → ${res.status} ${data.error ?? ""}${data.dialog ? ` (dialog: ${JSON.stringify(data.dialog)})` : ""}`, 2);
  return data;
}

const one = (s, n = 160) => String(s ?? "").replace(/\s+/g, " ").slice(0, n);
const need = (v, what) => v || die(`missing ${what}`);
const [cmd, id, ...rest] = process.argv.slice(2);
const enc = (v) => encodeURIComponent(v);

switch (cmd) {
  case "ls": {
    const all = id === "--all";
    const { sessions } = await call("GET", "/api/sessions");
    for (const s of sessions.filter((x) => all || x.status !== "ended")) {
      const wait = s.waiting ? ` · WAITING ${one(JSON.stringify(s.waiting), 120)}` : "";
      console.log(`${s.session_id}\t${s.label ?? s.name}\t${s.status}\t${s.engine ?? (s.tmux ? "tmux" : "ccc")}\t${s.cwd ?? ""}\t${one(s.detail, 80)}${wait}`);
    }
    break;
  }
  case "log": {
    const { events } = await call("GET", `/api/sessions/${enc(need(id, "session id"))}/activity?limit=${Number(rest[0]) || 20}`);
    for (const e of events) console.log(one(JSON.stringify(e), 300));
    break;
  }
  case "msgs": {
    const { messages } = await call("GET", `/api/messages?session=${enc(need(id, "session id"))}&limit=${Number(rest[0]) || 20}`);
    for (const m of messages) console.log(one(JSON.stringify(m), 300));
    break;
  }
  case "send": {
    // HQ delivers it under `[8 Sync HQ · phòng <from> → …]`, never the owner's header: a room's
    // message is not the owner's prompt (no `/solo`, `/autopilot`… ship grant from it).
    const text = need(rest.join(" ").trim(), "message text");
    const r = await call("POST", "/api/messages", { session: need(id, "session id"), text, from: path.basename(process.cwd()) });
    console.log(JSON.stringify({ delivery: r.delivery, live: r.live ?? null, error: r.error ?? null, id: r.message?.id ?? null }));
    break;
  }
  case "dialog": {
    const kind = rest[0];
    if (kind !== "permission" && kind !== "question") die("dialog kind: permission | question");
    const r = await call("POST", `/api/sessions/${enc(need(id, "session id"))}/answer`, { kind, keys: [] });
    if (kind === "question") fs.writeFileSync(dialogFile(id), JSON.stringify({ kind, text: r.dialog.text }));
    console.log(JSON.stringify(r.dialog));
    if (kind === "permission") console.log("read-only: show this to the owner; they approve or deny it in the HQ UI (Trả lời) or the room's terminal.");
    break;
  }
  case "answer": {
    const key = KEYS[String(rest[0] ?? "")] ?? die("answer takes the option number (1-9) of a question; permission prompts are the owner's to answer in the HQ UI");
    let seen;
    try {
      seen = JSON.parse(fs.readFileSync(dialogFile(need(id, "session id")), "utf8"));
    } catch {
      die(`run \`dialog ${id} question\` first: HQ only answers the question you have read`);
    }
    const r = await call("POST", `/api/sessions/${enc(id)}/answer`, { kind: seen.kind, keys: [key], text: seen.text });
    fs.rmSync(dialogFile(id), { force: true });
    console.log(JSON.stringify({ ok: r.ok, answered: r.dialog }));
    break;
  }
  case "artifact": {
    // Flags take the next argument as their value; the rest are positional.
    const flags = {};
    const pos = [];
    for (let i = 0; i < rest.length; i++) {
      const m = /^--(title|note|session|content|link|for)$/.exec(rest[i]);
      // `--content ""` clears the links to content items; every other flag needs a value.
      if (m) flags[m[1]] = m[1] === "content" && rest[i + 1] === "" ? rest[++i] : need(rest[++i], `value for --${m[1]}`);
      else pos.push(rest[i]);
    }
    // --for names the project the file is about (its artifact group), when it sits in another repo.
    if (flags.for) flags.for = path.resolve(flags.for);
    if (id === "add") {
      // HQ takes an absolute path inside a project it knows; it keeps the path, never a copy. Several files
      // (the proof screenshots of one post) take the same flags: same --link = one report in the room's Báo cáo.
      need(pos[0], "file path");
      for (const p of pos) {
        const r = await call("POST", "/api/artifacts", { path: path.resolve(p), ...flags });
        const a = r.artifact;
        console.log(JSON.stringify({ id: a.id, created: r.created, title: a.title, kind: a.kind, project: a.for_project ?? a.project, size: a.size, content: a.content, link: a.link }));
      }
    } else if (id === "ls") {
      const q = new URLSearchParams({ limit: String(Number(pos[0]) || 20) });
      if (flags.session) q.set("session", flags.session);
      if (flags.content) q.set("content", flags.content);
      const { artifacts } = await call("GET", `/api/artifacts?${q}`);
      for (const a of artifacts) console.log(`${a.id}\t${a.for_project ?? a.project}\t${a.kind}\t${a.missing ? "MISSING" : (a.size ?? "")}\t${one(a.title, 80)}\t${a.path}${a.content?.length ? `\t#${a.content.join(",#")}` : ""}`);
    } else if (id === "show") {
      // Metadata from the list, then the bytes through HQ (by id, never by path). Text kinds print inline;
      // image/video/pdf/html print where the file is, for the agent's own reader.
      const aid = need(pos[0], "artifact id (first column of `artifact ls`)");
      const { artifacts } = await call("GET", "/api/artifacts?limit=500");
      const a = artifacts.find((x) => x.id === aid) ?? die(`no artifact ${aid}: see \`artifact ls\``, 2);
      console.log(`${a.id}\t${a.project}\t${a.kind}\t${a.missing ? "MISSING" : (a.size ?? "")}\t${one(a.title, 120)}\t${a.path}${a.note ? `\nnote: ${one(a.note, 400)}` : ""}`);
      if (a.missing) break;
      if (a.kind !== "markdown" && a.kind !== "text") {
        console.log(`(${a.kind}: open ${a.path} with your image/PDF reader, or in HQ tab Kết quả)`);
        break;
      }
      const res = await fetch(`${base}/api/artifacts/${enc(a.id)}/file`, { headers: { "x-hq-token": token } }).catch(() => die(`HQ is not answering on ${base}`));
      if (!res.ok) die(`GET /api/artifacts/${a.id}/file → ${res.status}`, 2);
      const text = await res.text();
      const MAX = 40_000;
      console.log(text.length > MAX ? `${text.slice(0, MAX)}\n… (${text.length - MAX} more chars: read ${a.path})` : text);
    } else die("artifact add <file> [<file>…] [--title T] [--note N] [--session ID] [--content 38,16] [--link URL] [--for DIR] | artifact ls [n] [--session ID] [--content N] | artifact show <id>");
    break;
  }
  case "metrics": {
    // One reading of a published post. Each `add` is kept as its own snapshot (never overwritten);
    // Nội dung shows the newest per post and platform.
    const flags = {};
    for (let i = 0; i < rest.length; i++) {
      const m = /^--(content|platform|url|at|reach|reactions|comments|shares|views|session)$/.exec(rest[i]);
      if (!m) die(`unknown argument ${rest[i]}`);
      flags[m[1]] = need(rest[++i], `value for --${m[1]}`);
    }
    if (id === "add") {
      const { content, ...body } = flags;
      const r = await call("POST", "/api/content/metrics", { content_id: need(content, "--content <id>"), ...body, platform: need(body.platform, "--platform <facebook|tiktok|…>") });
      console.log(JSON.stringify(r.metric ?? r));
    } else if (id === "ls") {
      const q = flags.content ? `?content=${enc(flags.content)}` : "";
      const { metrics } = await call("GET", `/api/content/metrics${q}`);
      for (const m of metrics) console.log(`#${m.content_id}\t${m.platform}\t${new Date(m.captured_at).toISOString()}\treach=${m.reach ?? "-"} reactions=${m.reactions ?? "-"} comments=${m.comments ?? "-"} shares=${m.shares ?? "-"} views=${m.views ?? "-"}\t${m.readings} lần\t${m.url ?? ""}`);
    } else die("metrics add --content N --platform P [--url U] [--at T] [--reach N] [--reactions N] [--comments N] [--shares N] [--views N] [--session ID] | metrics ls [--content N]");
    break;
  }
  default:
    die("usage: hq.mjs ls [--all] | log <id> [n] | msgs <id> [n] | send <id> <text…> | dialog <id> <permission|question> | answer <id> <1-9> | artifact add <file> [<file>…] [--title T] [--note N] [--session ID] [--content 38,16] [--link URL] [--for DIR] | artifact ls [n] [--session ID] [--content N] | artifact show <id> | metrics add --content N --platform P [--url U] [--at T] [--reach N …] | metrics ls [--content N]");
}
