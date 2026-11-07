// Shared facts (BRIEF section 3, Grok Bot's facts "chung cho mọi Bot"): short lines about the owner and the
// projects every bot gets with its digest (lib/digest.ts). Local-first: ~/.config/8sync/hq/facts.json,
// written whole (tmp + rename). Only the owner's page writes the list (PUT /api/facts); a bot may only
// propose one (POST, `hq.mjs fact`), which waits in `pending` until the owner approves it: a bot's text is
// never a fact by itself. A line that looks like a secret (lib/mask.ts) is refused, never stored masked.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { maskSecrets } from "../mask";
import { configDir } from "./paths";

export type Fact = { id: string; text: string; at: number };
export type PendingFact = Fact & { from: string | null };
export type Facts = { facts: Fact[]; pending: PendingFact[]; broken: boolean };

export const FACTS_MAX = 12;
export const FACT_MAX = 160;
export const PENDING_MAX = 20;
const FROM_MAX = 48;
const ID = /^f_[0-9a-f]{8}$/;

export const factsFile = () => path.join(configDir(), "facts.json");
const newId = () => `f_${crypto.randomBytes(4).toString("hex")}`;
const fold = (s: string) => s.toLowerCase().replace(/\s+/g, " ");

type Norm<T> = { ok: true; value: T } | { ok: false; error: string };

/** One fact line from the owner or a bot: one line, ≤ FACT_MAX, no secret. */
export function normFact(v: unknown): Norm<string> {
  if (typeof v !== "string") return { ok: false, error: "text: một dòng chữ" };
  const t = v.replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim();
  if (!t) return { ok: false, error: "text: trống" };
  if ([...t].length > FACT_MAX) return { ok: false, error: `text: tối đa ${FACT_MAX} ký tự` };
  if (maskSecrets(t) !== t) return { ok: false, error: "text: trông như token/secret, không lưu" };
  return { ok: true, value: t };
}

function stored<T extends Fact>(v: unknown, extra: (r: Record<string, unknown>) => Omit<T, keyof Fact> | null): T | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  const text = normFact(r.text);
  if (typeof r.id !== "string" || !ID.test(r.id) || !text.ok || typeof r.at !== "number") return null;
  const more = extra(r);
  return more ? ({ id: r.id, text: text.value, at: r.at, ...more } as T) : null;
}

/** The file as stored: a missing file is empty; a broken one is empty with `broken` (the UI says so, the next write keeps a `.bad` copy). */
export function readFacts(file = factsFile()): Facts {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return { facts: [], pending: [], broken: false };
  }
  try {
    const v = JSON.parse(raw) as { facts?: unknown; pending?: unknown };
    if (!v || typeof v !== "object" || !Array.isArray(v.facts) || !Array.isArray(v.pending)) throw new Error("shape");
    const facts = v.facts.map((f) => stored<Fact>(f, () => ({}))).filter((f): f is Fact => f !== null);
    const pending = v.pending
      .map((f) => stored<PendingFact>(f, (r) => ({ from: typeof r.from === "string" ? r.from.slice(0, FROM_MAX) : null })))
      .filter((f): f is PendingFact => f !== null);
    return { facts: facts.slice(0, FACTS_MAX), pending: pending.slice(-PENDING_MAX), broken: false };
  } catch {
    return { facts: [], pending: [], broken: true };
  }
}

export function writeFacts(f: Pick<Facts, "facts" | "pending">, file = factsFile()): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (readFacts(file).broken) fs.copyFileSync(file, `${file}.bad`);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify({ facts: f.facts, pending: f.pending }, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

/** The owner's list in place of the stored one: a line kept as it was keeps its id and time. */
export function replaceFacts(cur: Facts, lines: unknown, now = Date.now()): Norm<Fact[]> {
  if (!Array.isArray(lines)) return { ok: false, error: "facts: danh sách dòng chữ" };
  if (lines.length > FACTS_MAX) return { ok: false, error: `facts: tối đa ${FACTS_MAX} dòng` };
  const out: Fact[] = [];
  for (const l of lines) {
    const t = normFact(l);
    if (!t.ok) return t;
    if (out.some((f) => fold(f.text) === fold(t.value))) continue;
    out.push(cur.facts.find((f) => f.text === t.value) ?? { id: newId(), text: t.value, at: now });
  }
  return { ok: true, value: out };
}

/** A bot's proposal: pending until the owner approves it. The same line again (or one already a fact) is not added twice. */
export function proposeFact(cur: Facts, text: unknown, from: string | null, now = Date.now()): Norm<{ facts: Facts; pending: PendingFact; created: boolean }> {
  const t = normFact(text);
  if (!t.ok) return t;
  if (cur.facts.some((f) => fold(f.text) === fold(t.value))) return { ok: false, error: "đã là fact chung" };
  const same = cur.pending.find((f) => fold(f.text) === fold(t.value));
  if (same) return { ok: true, value: { facts: cur, pending: same, created: false } };
  if (cur.pending.length >= PENDING_MAX) return { ok: false, error: `đã có ${PENDING_MAX} fact chờ anh duyệt` };
  const p: PendingFact = { id: newId(), text: t.value, at: now, from: from ? from.slice(0, FROM_MAX) : null };
  return { ok: true, value: { facts: { ...cur, pending: [...cur.pending, p] }, pending: p, created: true } };
}

/** The owner's answer to a proposal: approved moves it to the list (422 when the list is full), rejected drops it. */
export function decideFact(cur: Facts, id: unknown, approve: boolean, now = Date.now()): Norm<Facts> {
  const p = cur.pending.find((f) => f.id === id);
  if (!p) return { ok: false, error: "không có fact chờ duyệt này" };
  const pending = cur.pending.filter((f) => f.id !== p.id);
  if (!approve) return { ok: true, value: { ...cur, pending } };
  if (cur.facts.length >= FACTS_MAX) return { ok: false, error: `tối đa ${FACTS_MAX} fact chung: bỏ bớt một dòng trước` };
  return { ok: true, value: { ...cur, pending, facts: [...cur.facts, { id: p.id, text: p.text, at: now }] } };
}
