#!/usr/bin/env node
// hq-control: drive the local 8 Sync HQ UI API (apps/hq-ui) from an agent. `node hq.mjs help` lists the commands.
// Reads the UI token from ~/.config/8sync/hq/ui-token and never prints it. Lists are compact (one line each,
// long text cut with a pointer); `--full` and `msg` print whole texts.
// Permission prompts are read-only here: the owner taps Yes/No in the HQ UI. `answer` picks an
// option of a room's question, and only when the owner told you which one in this turn.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const USAGE = `usage: node hq.mjs <command>
  ls [--all]                         rooms, one line each (--all: ended ones too)
  log <id> [n] [--full]              n latest steps of a room (default 20, max 200)
  turns <bot> [n] [--full]           n latest turns of a bot: prompt -> its whole final reply (default 5, max 20; bot = id, label or name)
  digest [bot]                       who is doing what now (≤10 lines) + shared facts (no bot: this room's own)
  facts                              the owner's shared facts, and proposals waiting for the owner
  fact <text...>                     propose a shared fact: it waits until the owner approves it in HQ
  msgs <id> [n] [--full]             n latest messages to/from a room (default 20, max 500)
  msg <id> <messageId>               one message in full (messageId = #id of msgs)
  send <id> <text...>                message a room (one whole message per send)
  brief [id]                         what a room is on: project, branch, doing, waiting, last ask/reply, files (no id: every live room)
  roster                             live rooms, one line each: id · label · status · engine · project · doing
  dialog <id> <permission|question>  read the dialog blocking a background Claude Code room
  answer <id> <1-9>                  pick an option of the question just read with dialog
  artifact add <file> [<file>...] [--title T] [--note N] [--session ID] [--content 38,16] [--link URL] [--for DIR]
  artifact ls [n] [--session ID] [--content N]
  artifact show <id>
  metrics add --content N --platform P [--url U] [--at T] [--reach N] [--reactions N] [--comments N] [--shares N] [--views N] [--session ID]
  metrics ls [--content N]
env: HQ_UI_PORT (default 8740)`;

const port = Number(process.env.HQ_UI_PORT || 8740);
const base = `http://127.0.0.1:${port}`;
const tokenFile = path.join(os.homedir(), ".config", "8sync", "hq", "ui-token");
const dialogFile = (id) => path.join(os.tmpdir(), `hq-control-dialog-${id}.json`);
const KEYS = Object.fromEntries([..."123456789"].map((d) => [d, d]));
const TIMEOUT_MS = 60_000;

function die(msg, code = 1) {
  console.error(`hq-control: ${msg}`);
  process.exit(code);
}

// Read on first call, so `help` and usage errors work while HQ is down.
let token = null;
function uiToken() {
  if (token === null) {
    try {
      token = fs.readFileSync(tokenFile, "utf8").trim();
    } catch {
      token = "";
    }
    if (!token) die(`no UI token at ${tokenFile}: ask the owner to start HQ with \`8sync hq ui\``);
  }
  return token;
}

// What a failed call means for the agent, past the route's own error text.
function hint(status, data) {
  if (status === 401) return `the token in ${tokenFile} is not the one the HQ on ${base} uses (another HQ on this port, or HQ restarted): ask the owner to restart \`8sync hq ui\`, or set HQ_UI_PORT`;
  if (status === 404 && !data.error) return "this HQ has no such route: it is older than this skill, ask the owner to run `8sync up`";
  // Loop guard (lib/server/group-send.ts roomSend): rooms talked to each other enough; resending only repeats it.
  if (status === 409 && (data.error === "hop-limit" || data.error === "pair-limit")) return "stop: do not resend, tell the owner and wait for them";
  return "";
}

async function fetchHq(method, route, body) {
  try {
    return await fetch(base + route, {
      method,
      // The HQ refuses a mutating call without the UI's own Origin (lib/server/auth.ts checkAuth).
      headers: { "x-hq-token": uiToken(), ...(method !== "GET" ? { origin: base } : {}), ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    if (e?.name === "TimeoutError") die(`HQ on ${base} did not answer ${method} ${route} within ${TIMEOUT_MS / 1000} s`);
    die(`HQ is not answering on ${base}: ask the owner to start it with \`8sync hq ui\` (or set HQ_UI_PORT)`);
  }
}

async function call(method, route, body) {
  const res = await fetchHq(method, route, body);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const why = [data.error, data.detail, data.dialog ? `dialog: ${JSON.stringify(data.dialog)}` : "", hint(res.status, data)].filter(Boolean).join(" · ");
    die(`${method} ${route} → ${res.status} ${why || res.statusText}`, 2);
  }
  return data;
}

/** A path as this machine's node sees it: `~` expanded; on Windows, Git Bash `/c/...` and WSL `/mnt/c/...` as `C:/...`. */
function localPath(p) {
  let s = String(p);
  if (s === "~" || s.startsWith("~/") || s.startsWith("~\\")) s = path.join(os.homedir(), s.slice(1));
  if (process.platform === "win32") {
    const m = /^\/(?:mnt\/)?([a-zA-Z])(\/.*)?$/.exec(s);
    if (m) s = `${m[1].toUpperCase()}:${m[2] ?? "/"}`;
  }
  return path.resolve(s);
}

const one = (s, n = 160) => String(s ?? "").replace(/\s+/g, " ").slice(0, n);
/** One line of `s`, cut at n with how much is left and where to read it whole. */
const cut = (s, n, more) => {
  const flat = String(s ?? "").replace(/\s+/g, " ").trim();
  return flat.length > n ? `${flat.slice(0, n)}… (+${flat.length - n} chars: ${more})` : flat;
};
const when = (ms) => (ms ? new Date(ms).toLocaleString("sv-SE").slice(5, 16) : "--");
const need = (v, what) => v || die(`missing ${what}\n${USAGE}`);
/** `n` within 1..max, else the default. */
const count = (v, def, max) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 ? Math.min(n, max) : def;
};
const [cmd, id, ...rest] = process.argv.slice(2);
const enc = (v) => encodeURIComponent(v);
const full = rest.includes("--full");
const args = rest.filter((a) => a !== "--full");

const msgFrom = (m) => `${m.from_name ?? m.from_ ?? "?"}→${m.to_name ?? m.to_ ?? "?"}`;
const msgDelivery = (m) => `${m.delivery ?? "-"}${m.picked_up_at ? " picked" : ""}`;
const msgHead = (m) => `#${m.id}\t${when(m.ts)}\t${msgFrom(m)}\t${m.kind}\t${msgDelivery(m)}`;

switch (cmd) {
  case "help":
  case "--help":
  case "-h":
    console.log(USAGE);
    break;
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
    // Server caps a step's text at 4 000 chars; a turn's final reply reads longer in `turns`.
    const n = count(args[0], 20, 200);
    const { events } = await call("GET", `/api/sessions/${enc(need(id, "session id"))}/activity?limit=${n}`);
    for (const e of events) {
      const head = `${when(e.at)}\t${e.kind}${e.tool ? `\t${e.tool}${e.status ? ` ${e.status}` : ""}` : ""}${e.error ? `\terror: ${one(e.error, 200)}` : ""}`;
      console.log(full ? `${head}\n${e.text}\n` : `${head}\t${cut(e.text, 200, `log ${id} ${n} --full`)}`);
    }
    break;
  }
  case "turns": {
    // Each turn: the prompt and the reply it ended with ("Kết quả"), up to 8 000 chars server side.
    // `id` may be a label or the name HQ's Bots view shows ("clean"), not only an id.
    const n = count(args[0], 5, 20);
    const { room, turns } = await call("GET", `/api/turns?room=${enc(need(id, "bot (id, label or name)"))}&n=${n}`);
    if (room) console.log(`# ${room.label} (${room.id})`);
    for (const t of turns) {
      const head = `${when(t.at)}\t${t.live ? "live" : "done"}\t${t.steps} steps${t.errors ? ` · ${t.errors} errors` : ""}${t.agents ? ` · ${t.agents} agents` : ""}`;
      const reply = t.output ?? (t.live ? "(no reply yet)" : "(no reply)");
      if (full) console.log(`${head}\n> ${t.prompt ?? "(prompt before the log tail)"}\n${reply}\n`);
      else console.log(`${head}\t${cut(t.prompt ?? "", 100, `turns ${id} ${n} --full`)}\t→ ${cut(reply, 200, `turns ${id} ${n} --full`)}`);
    }
    break;
  }
  case "digest": {
    // The same text HQ puts under the owner's next message when it changed; pulling it counts as got.
    const sid = process.env.CLAUDE_CODE_SESSION_ID;
    const r = await call("POST", "/api/digest", { ...(id ? { room: id } : {}), from_cwd: process.cwd(), ...(sid ? { from_session: sid } : {}) });
    console.log(r.text ?? "no other bot live, no shared fact");
    break;
  }
  case "facts": {
    const { facts, pending, broken } = await call("GET", "/api/facts");
    if (broken) console.log("(facts.json is broken: the owner re-saves it in HQ)");
    for (const f of facts) console.log(`- ${f.text}`);
    if (!facts.length) console.log("no shared fact yet");
    if (pending.length) console.log(`${pending.length} proposal(s) wait for the owner in HQ`);
    break;
  }
  case "fact": {
    // Never applied by itself: the owner approves or drops it in HQ (Bot này đang biết gì).
    const text = need([id, ...rest].filter(Boolean).join(" ").trim(), "fact text");
    const sid = process.env.CLAUDE_CODE_SESSION_ID;
    const r = await call("POST", "/api/facts", { text, from: path.basename(process.cwd()), from_cwd: process.cwd(), ...(sid ? { from_session: sid } : {}) });
    console.log(r.created ? `proposed ${r.pending.id}: waits for the owner's approval in HQ` : `already waiting as ${r.pending.id}`);
    break;
  }
  case "msgs": {
    const n = count(args[0], 20, 500);
    const { messages } = await call("GET", `/api/messages?session=${enc(need(id, "session id"))}&limit=${n}`);
    for (const m of messages) console.log(full ? `${msgHead(m)}\n${m.text ?? ""}\n` : `${msgHead(m)}\t${cut(m.text, 200, `msg ${id} ${m.id}`)}`);
    break;
  }
  case "msg": {
    // No by-id route: the room's messages from that id on, newest 500, and pick it.
    const mid = Number(need(args[0], "message id (#id column of `msgs`)").replace(/^#/, ""));
    if (!Number.isInteger(mid) || mid < 1) die("message id: the number in the #id column of `msgs`");
    const { messages } = await call("GET", `/api/messages?session=${enc(need(id, "session id"))}&after=${mid - 1}&limit=500`);
    const m = messages.find((x) => x.id === mid) ?? die(`no message #${mid} in ${id} (or 500+ newer ones): see \`msgs ${id}\``, 2);
    console.log(`${msgHead(m)}\n${m.text ?? ""}`);
    break;
  }
  case "send": {
    // HQ delivers it under `[phòng <from> → …]`, never the owner's header (`[owner …]`): a room's
    // message is not the owner's prompt (no `/solo`, `/autopilot`… ship grant from it). `from_session`
    // and `from_cwd` let HQ find this room and add `[từ phòng <label> · <project> · đang: <step>]` under it.
    const text = need(rest.join(" ").trim(), "message text");
    const sid = process.env.CLAUDE_CODE_SESSION_ID;
    const r = await call("POST", "/api/messages", { session: need(id, "session id"), text, from: path.basename(process.cwd()), from_cwd: process.cwd(), ...(sid ? { from_session: sid } : {}) });
    // `dropped`: the same text already went to this room under a minute ago (HQ's dedupe): not resent.
    console.log(JSON.stringify({ delivery: r.delivery, live: r.live ?? null, error: r.error ?? null, id: r.message?.id ?? null }));
    break;
  }
  case "brief": {
    const show = (b) =>
      [
        `${b.id}\t${b.label}\t${b.status}\t${b.engine}`,
        `  project: ${b.project ? `${b.project.name}${b.project.branch ? ` @ ${b.project.branch}` : ""}` : (b.cwd ?? "-")}`,
        `  doing: ${b.doing ?? "-"}`,
        ...(b.waiting ? [`  WAITING: ${b.waiting}`] : []),
        `  last ask: ${b.lastAsk ?? "-"}`,
        `  last reply: ${b.lastReply ?? "-"}`,
        ...(b.files.length ? [`  files: ${b.files.join(", ")}`] : []),
        `  updated: ${when(b.updatedAt)}  (full: turns ${b.id} 1 --full)`,
      ].join("\n");
    if (id) console.log(show((await call("GET", `/api/brief?room=${enc(id)}`)).brief));
    else console.log((await call("GET", "/api/brief")).rooms.map(show).join("\n\n") || "no live rooms");
    break;
  }
  case "roster": {
    const { rooms } = await call("GET", "/api/brief");
    for (const b of rooms) {
      const project = b.project ? `${b.project.name}${b.project.branch ? `@${b.project.branch}` : ""}` : "-";
      console.log(`${b.id}\t${b.label}\t${b.status}\t${b.engine}\t${project}\t${one(b.doing ?? "-", 100)}${b.waiting ? ` · WAITING ${one(b.waiting, 100)}` : ""}`);
    }
    break;
  }
  case "dialog": {
    const kind = rest[0];
    if (kind !== "permission" && kind !== "question") die("usage: dialog <id> <permission|question>");
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
    const ARTIFACT_USAGE = "usage: artifact add <file> [<file>…] [--title T] [--note N] [--session ID] [--content 38,16] [--link URL] [--for DIR] | artifact ls [n] [--session ID] [--content N] | artifact show <id>";
    // Flags take the next argument as their value; the rest are positional.
    const flags = {};
    const pos = [];
    for (let i = 0; i < rest.length; i++) {
      const m = /^--(title|note|session|content|link|for)$/.exec(rest[i]);
      // `--content ""` clears the links to content items; every other flag needs a value.
      if (m) flags[m[1]] = m[1] === "content" && rest[i + 1] === "" ? rest[++i] : need(rest[++i], `value for --${m[1]}`);
      else if (rest[i].startsWith("--")) die(`unknown flag ${rest[i]}\n${ARTIFACT_USAGE}`);
      else pos.push(rest[i]);
    }
    // --for names the project the file is about (its artifact group), when it sits in another repo.
    if (flags.for) flags.for = localPath(flags.for);
    if (id === "add") {
      // HQ takes an absolute path inside a project it knows; it keeps the path, never a copy. Several files
      // (the proof screenshots of one post) take the same flags: same --link = one report in the room's Báo cáo.
      need(pos[0], "file path");
      for (const p of pos) {
        const r = await call("POST", "/api/artifacts", { path: localPath(p), ...flags });
        const a = r.artifact;
        console.log(JSON.stringify({ id: a.id, created: r.created, title: a.title, kind: a.kind, project: a.for_project ?? a.project, size: a.size, content: a.content, link: a.link }));
      }
    } else if (id === "ls") {
      const q = new URLSearchParams({ limit: String(count(pos[0], 20, 500)) });
      if (flags.session) q.set("session", flags.session);
      if (flags.content) q.set("content", flags.content);
      const { artifacts } = await call("GET", `/api/artifacts?${q}`);
      for (const a of artifacts) console.log(`${a.id}\t${a.for_project ?? a.project}\t${a.kind}\t${a.missing ? "MISSING" : (a.size ?? "")}\t${one(a.title, 80)}\t${a.path}${a.content?.length ? `\t#${a.content.join(",#")}` : ""}`);
    } else if (id === "show") {
      // Metadata from the list, then the bytes through HQ (by id, never by path). Text kinds print inline;
      // other kinds print where the file is, for the agent's own reader.
      const aid = need(pos[0], "artifact id (first column of `artifact ls`)");
      const { artifacts } = await call("GET", "/api/artifacts?limit=500");
      const a = artifacts.find((x) => x.id === aid) ?? die(`no artifact ${aid} among the newest 500: see \`artifact ls\``, 2);
      console.log(`${a.id}\t${a.for_project ?? a.project}\t${a.kind}\t${a.missing ? "MISSING" : (a.size ?? "")}\t${one(a.title, 120)}\t${a.path}${a.link ? `\nlink: ${a.link}` : ""}${a.note ? `\nnote: ${a.note}` : ""}`);
      if (a.missing) break;
      if (a.kind !== "markdown" && a.kind !== "text") {
        console.log(`(${a.kind}: open ${a.path} with your image/PDF reader, or in HQ tab Kết quả)`);
        break;
      }
      const res = await fetchHq("GET", `/api/artifacts/${enc(a.id)}/file`);
      if (!res.ok) die(`GET /api/artifacts/${a.id}/file → ${res.status} ${res.statusText}`, 2);
      const text = await res.text();
      const MAX = 40_000;
      console.log(text.length > MAX ? `${text.slice(0, MAX)}\n… (${text.length - MAX} more chars: read ${a.path})` : text);
    } else die(ARTIFACT_USAGE);
    break;
  }
  case "metrics": {
    const METRICS_USAGE = "usage: metrics add --content N --platform P [--url U] [--at T] [--reach N] [--reactions N] [--comments N] [--shares N] [--views N] [--session ID] | metrics ls [--content N]";
    // One reading of a published post. Each `add` is kept as its own snapshot (never overwritten);
    // Nội dung shows the newest per post and platform.
    const flags = {};
    for (let i = 0; i < rest.length; i++) {
      const m = /^--(content|platform|url|at|reach|reactions|comments|shares|views|session)$/.exec(rest[i]);
      if (!m) die(`unknown argument ${rest[i]}\n${METRICS_USAGE}`);
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
    } else die(METRICS_USAGE);
    break;
  }
  default:
    die(cmd ? `unknown command ${cmd}\n${USAGE}` : USAGE);
}
