// The leading `[...]` tags of a board card (`[#1 v1][art-director] Art bible …`): the lead writes the
// epic/version and the role the card is for in front of the title. Pure. Tested in tests/card-tags.test.ts.
import { roomRole } from "./now";
import { LANES, rankOf, type Board, type Card } from "./lanes";
import type { RoleId } from "./roles";

export type CardTag = { text: string; kind: "epic" | "role" | "tag"; role: RoleId | null };
export type CardParts = { title: string; tags: CardTag[] };

/** Epic or version: `#1`, `#1 v1`, `v2`, `v1.2`, `epic 3`. */
const EPIC = /^(#\d+(\s+v\d+(\.\d+)*)?|v\d+(\.\d+)*|epic\s*\d+)$/i;
/** Specialist role names leads write that `roomRole` (room names) does not know. */
const ROLE_WORDS = /^(art|director|designer|artist|writer|copy|content|sound|audio|game|level|ops|devops|infra|data|ml|ai|pm|po|ba|lead|rd|qa|qc|review|dev|core)([-_ ].*)?$/i;

/** Splits the leading `[...]` groups off the title; a text with no tags is all title. */
export function cardParts(text: string): CardParts {
  const tags: CardTag[] = [];
  let rest = text.trimStart();
  for (let m = /^\[([^\]\n]{1,40})\]\s*/.exec(rest); m; m = /^\[([^\]\n]{1,40})\]\s*/.exec(rest)) {
    const t = m[1].trim();
    if (t) {
      const role = roomRole(t)?.role ?? null;
      const kind = EPIC.test(t) ? "epic" : role || ROLE_WORDS.test(t) ? "role" : "tag";
      tags.push({ text: t, kind, role: kind === "role" ? role : null });
    }
    rest = rest.slice(m[0].length);
  }
  return { title: rest.trim() || text.trim(), tags };
}

/** The card this one was split off: its first `[#N]` tag (`[#10] player …`), never itself; target.rs `parent`. */
export function parentOf(c: Pick<Card, "id" | "text">): number | null {
  for (const t of cardParts(c.text).tags) {
    const m = /^#(\d+)/.exec(t.text);
    if (m) return Number(m[1]) === c.id ? null : Number(m[1]);
  }
  return null;
}

/** An open card split off an idea, and the lane it is in. */
export type Kid = { id: number; lane: string };

/** Open cards split off each card, by its id: an idea that waits in Backlog while these are built. */
export function splitInto(lanes: Board["lanes"]): Map<number, Kid[]> {
  const out = new Map<number, Kid[]>();
  for (const l of LANES) {
    for (const c of lanes[l.key]) {
      const p = parentOf(c);
      if (p != null) out.set(p, [...(out.get(p) ?? []), { id: c.id, lane: l.key }]);
    }
  }
  return out;
}

/**
 * The card a builder claims next: the most urgent free card of Ready (P0 first, unset counts as P2),
 * queue order within a priority, the same pick as target.rs `claim` (`auto add --now` puts a card at
 * the head of the queue).
 */
export function nextUp(ready: Card[]): number | null {
  let best: Card | null = null;
  for (const c of ready) if (!c.claim && c.label !== "qa" && (!best || rankOf(c) < rankOf(best))) best = c;
  return best?.id ?? null;
}

/** `#81` / `81` / a pull URL → what to print and, for a URL, where it goes. */
export function prRef(pr: string): { text: string; href: string | null } {
  // Only GitHub pull URLs become links: a card's text is written by rooms, not by the owner.
  const url = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/(\d+)\/?$/i.exec(pr);
  if (url) return { text: `#${url[1]}`, href: pr };
  const n = /^#?(\d+)$/.exec(pr.trim());
  return { text: n ? `#${n[1]}` : pr, href: null };
}
