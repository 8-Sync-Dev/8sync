// "Tự soi ảnh" (Preview tab): while on for a project, HQ's preview poll hands new screenshots of open
// cards to the `eye` room (crates/cli/src/verbs/ccc/team.rs `eye_prompt`), one message per card once
// the card has had no new image for EYE_DEBOUNCE_MS. The room answers with one `[soi ảnh]` card note.
// Pure: lib/server/eye.ts reads the board, sends and stores what was sent.
import { cardParts } from "./card-tags";
import { LANES, type Board, type Closed, type Card, type LaneKey, type Step } from "./lanes";
import { fileName, type PreviewItem } from "./preview";

export const EYE_ROOM = "eye";
/** A card's images go out this long after its last new one (a QA run saves several in a row). */
export const EYE_DEBOUNCE_MS = 90_000;
/** Images per message, newest first. */
export const EYE_SHOTS = 6;
/** How the eye room starts its note (team.rs `eye_prompt`). */
export const EYE_TAG = "[soi ảnh]";
const TITLE_MAX = 80;

/**
 * One shot of one card: its name and size, not its path or time. The same image in a worktree and
 * in the root, or its mtime turning into a commit time once committed, is still one image.
 */
export const imageKey = (i: PreviewItem) => `${i.card}|${fileName(i.rel)}|${i.size}`;

/** The eye's latest note on a card (open or closed), from the notes the board keeps. */
export function eyeNote(c: Pick<Card, "history" | "note"> | Pick<Closed, "history"> | null | undefined): Step | null {
  if (!c) return null;
  const steps: Step[] = c.history?.length ? c.history : "note" in c && c.note ? [c.note] : [];
  for (let i = steps.length - 1; i >= 0; i--) if (steps[i].text.trimStart().startsWith(EYE_TAG)) return steps[i];
  return null;
}

/** Card #id wherever it is on the board. */
export function boardCard(board: Board | null, id: number): { card: Card | Closed; lane: LaneKey | null } | null {
  if (!board) return null;
  for (const l of LANES) {
    const c = board.lanes[l.key].find((x) => x.id === id);
    if (c) return { card: c, lane: l.key };
  }
  const c = board.closed.find((x) => x.id === id);
  return c ? { card: c, lane: null } : null;
}

/** Per card: when HQ last saw a new unsent image and which ones it has seen. Memory only. */
export type EyePending = Map<number, { last: number; keys: Set<string> }>;

export type EyeSend = { card: number; lane: LaneKey; text: string; keys: string[] };

/** Absolute path the room can Read; null for an image only in a ref (no file on disk). */
export function shotPath(i: PreviewItem): string | null {
  if (i.ref) return null;
  const sep = i.root.includes("\\") ? "\\" : "/";
  return `${i.root.replace(/[\\/]+$/, "")}${sep}${i.rel.split("/").join(sep)}`;
}

export function eyeMessage(card: number, lane: LaneKey, text: string, paths: string[]): string {
  const t = cardParts(text).title.replace(/\s+/g, " ").trim();
  const title = t.length > TITLE_MAX ? `${t.slice(0, TITLE_MAX - 1)}…` : t;
  return `[ảnh mới] card #${card} (lane ${lane}): "${title}" · ảnh: ${paths.join(", ")}`;
}

/** A card whose new images had no newer one for EYE_DEBOUNCE_MS. */
export type EyeDue = { card: number; items: PreviewItem[] };

/**
 * Cards due now, no board needed. An image counts when it has a card, is newer than the switch
 * (`since`), has a file on disk and was never sent; a card is due EYE_DEBOUNCE_MS after HQ first saw
 * its newest such image. `skip`: cards backing off (closed, a failed send). `pending` is updated in place.
 */
export function eyeDue(p: { items: PreviewItem[]; since: number; sent: Set<string>; pending: EyePending; now: number; skip?: (card: number) => boolean }): EyeDue[] {
  const byCard = new Map<number, PreviewItem[]>();
  for (const i of p.items) {
    if (i.card == null || i.at < p.since || !shotPath(i) || p.sent.has(imageKey(i)) || p.skip?.(i.card)) continue;
    const list = byCard.get(i.card) ?? [];
    if (!list.some((x) => imageKey(x) === imageKey(i))) list.push(i);
    byCard.set(i.card, list);
  }
  for (const id of [...p.pending.keys()]) if (!byCard.has(id)) p.pending.delete(id);
  const out: EyeDue[] = [];
  for (const [card, list] of byCard) {
    const seen = p.pending.get(card) ?? { last: p.now, keys: new Set<string>() };
    if (list.some((i) => !seen.keys.has(imageKey(i)))) {
      seen.last = p.now;
      for (const i of list) seen.keys.add(imageKey(i));
    }
    p.pending.set(card, seen);
    if (p.now - seen.last >= EYE_DEBOUNCE_MS) out.push({ card, items: list });
  }
  return out;
}

/** The one message for a due card, with its ≤ EYE_SHOTS newest images (`keys`: those only); null when the card is not open. */
export function eyeSend(d: EyeDue, board: Board): EyeSend | null {
  const hit = boardCard(board, d.card);
  if (!hit?.lane) return null;
  const shots = [...d.items].sort((a, b) => b.at - a.at).slice(0, EYE_SHOTS);
  return { card: d.card, lane: hit.lane, text: eyeMessage(d.card, hit.lane, hit.card.text, shots.map((i) => shotPath(i)!)), keys: shots.map(imageKey) };
}
