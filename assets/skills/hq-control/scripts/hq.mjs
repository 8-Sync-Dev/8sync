#!/usr/bin/env node
// hq-control: drive the local 8 Sync HQ UI API (apps/hq-ui) from an agent.
// Reads the UI token from ~/.config/8sync/hq/ui-token and never prints it.
// Usage: node hq.mjs <ls [--all] | log <id> [n] | msgs <id> [n] | send <id> <text…> | dialog <id> <permission|question> | answer <id> <1-9>
//                     | artifact add <file> [--title T] [--note N] [--session ID] | artifact ls [n] [--session ID]>
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
    const text = need(rest.join(" ").trim(), "message text");
    const r = await call("POST", "/api/messages", { session: need(id, "session id"), text });
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
      const m = /^--(title|note|session)$/.exec(rest[i]);
      if (m) flags[m[1]] = need(rest[++i], `value for --${m[1]}`);
      else pos.push(rest[i]);
    }
    if (id === "add") {
      // HQ takes an absolute path inside a project it knows; it keeps the path, never a copy.
      const file = path.resolve(need(pos[0], "file path"));
      const r = await call("POST", "/api/artifacts", { path: file, ...flags });
      const a = r.artifact;
      console.log(JSON.stringify({ id: a.id, created: r.created, title: a.title, kind: a.kind, project: a.project, size: a.size }));
    } else if (id === "ls") {
      const q = new URLSearchParams({ limit: String(Number(pos[0]) || 20) });
      if (flags.session) q.set("session", flags.session);
      const { artifacts } = await call("GET", `/api/artifacts?${q}`);
      for (const a of artifacts) console.log(`${a.id}\t${a.project}\t${a.kind}\t${a.missing ? "MISSING" : (a.size ?? "")}\t${one(a.title, 80)}\t${a.path}`);
    } else die("artifact add <file> [--title T] [--note N] [--session ID] | artifact ls [n] [--session ID]");
    break;
  }
  default:
    die("usage: hq.mjs ls [--all] | log <id> [n] | msgs <id> [n] | send <id> <text…> | dialog <id> <permission|question> | answer <id> <1-9> | artifact add <file> [--title T] [--note N] [--session ID] | artifact ls [n] [--session ID]");
}
