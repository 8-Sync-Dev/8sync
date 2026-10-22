// Shared by the Preview route (lib/server/preview.ts) and the views: item shape and pure helpers.
import type { Board, Card, Closed, LaneKey } from "./lanes";

export type PreviewItem = {
  id: string;
  project: string;
  root: string;
  /** Path relative to the project root, `/`-separated; for an image read from `ref`, its path in that tree. */
  rel: string;
  /** Worktree folder name under `.claude/worktrees`, null for the root itself and for a ref. */
  worktree: string | null;
  branch: string | null;
  /** Set when no checkout has the image and HQ reads it from this ref (`origin/main`). */
  ref: string | null;
  /** The board card the image belongs to (its name or path says `card-<n>`, or the card worktree it was made in). */
  card: number | null;
  /** True time (ms): its last commit when tracked and unmodified, else the file's mtime. */
  at: number;
  /** "commit": `at` is a commit time; "file": an untracked or modified file's mtime. */
  timeFrom: "commit" | "file";
  size: number;
};

/** The newest main branch tip the repo knows (local or `origin`). */
export type MainHead = { ref: string; sha: string; at: number; subject: string };

/** `eye`: when "Tự soi ảnh" went on for this project (lib/server/eye.ts), null/absent = off. */
export type ProjectPreviews = { root: string; name: string; main: MainHead | null; items: PreviewItem[]; eye?: number | null };

const CARD_RE = /(?:^|[^a-z0-9])card[-_]?(\d{1,9})(?!\d)/i;

/** `card-7`, `card_7`, `card7`: the board card a shot belongs to. The file name wins over its folder. */
export function cardOf(rel: string): number | null {
  const m = CARD_RE.exec(rel.split("/").pop() ?? "") ?? CARD_RE.exec(rel);
  return m ? Number(m[1]) : null;
}

/** The card a worktree works on: its branch says it (folders get reused), else its folder name. */
export const worktreeCard = (folder: string, branch: string | null): number | null => (branch ? cardOf(branch) : null) ?? cardOf(folder);

/** A worktree path (`<root>/.claude/worktrees/<name>/…`) belongs to its repo root. */
export function mainRoot(root: string): string {
  const m = /^(.*?)[\\/]\.claude[\\/]worktrees[\\/][^\\/]+/.exec(root);
  return m ? m[1] : root;
}

/** Same folder across `\` vs `/`, case and the `\\?\` prefix Rust adds on Windows. */
export function rootKey(p: string): string {
  return mainRoot(p)
    .replace(/\\/g, "/")
    .replace(/^\/\/\?\//, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

/** "home.png" from "qa/evidence/card-7-home.png". */
export const fileName = (rel: string) => rel.split("/").pop() ?? rel;

/** Lanes whose cards are being worked on right now, in board order. */
export const WORK_LANES = ["building", "qa", "review", "approved"] as const satisfies readonly LaneKey[];

/** The last thing that happened to a card: its latest note, its claim, or its creation. */
export const lastActivity = (c: Card): number => Math.max(c.note?.at ?? 0, c.claim?.at ?? 0, c.added);

export type WorkRow = { card: Card; items: PreviewItem[] };
export type DoneRow = { card: Closed; items: PreviewItem[] };
export type PreviewSections = {
  /** Open cards in WORK_LANES: lane by lane, most recently active first; each with its images, newest first. */
  working: WorkRow[];
  /** Done cards, last closed first. */
  done: DoneRow[];
  /** Images of no card, or of a card neither list shows; newest first. */
  other: PreviewItem[];
  /** Done cards closed in the last 24 h. */
  done24h: number;
};

const DAY_MS = 24 * 3600 * 1000;
const newestFirst = (a: PreviewItem, b: PreviewItem) => b.at - a.at;

/** The Preview tab's three lists, from the board's truth and each image's true time. */
export function previewSections(items: PreviewItem[], board: Board | null, now: number): PreviewSections {
  const byCard = new Map<number, PreviewItem[]>();
  for (const i of items) if (i.card != null) (byCard.get(i.card) ?? byCard.set(i.card, []).get(i.card)!).push(i);
  const shotsOf = (id: number) => [...(byCard.get(id) ?? [])].sort(newestFirst);
  const working: WorkRow[] = board
    ? WORK_LANES.flatMap((l) => [...board.lanes[l]].sort((a, b) => lastActivity(b) - lastActivity(a)).map((card) => ({ card, items: shotsOf(card.id) })))
    : [];
  const done: DoneRow[] = board
    ? board.closed
        .filter((c) => c.state === "done")
        .sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
        .map((card) => ({ card, items: shotsOf(card.id) }))
    : [];
  const shown = new Set([...working.map((w) => w.card.id), ...done.map((d) => d.card.id)]);
  return {
    working,
    done,
    other: items.filter((i) => i.card == null || !shown.has(i.card)).sort(newestFirst),
    done24h: done.filter((d) => d.card.at != null && now - d.card.at < DAY_MS).length,
  };
}

/** A demo video the rooms recorded (owner 2026-10-22: "xem ảnh, xem video demo"). */
export const isVideo = (rel: string): boolean => /\.(mp4|webm)$/i.test(rel);

/**
 * Real demo links in a card's notes ("link demo thật"): http(s) URLs, trailing punctuation dropped,
 * GitHub left out (the PR has its own chip), each once, at most 3. Pure.
 */
export function demoLinks(texts: (string | null | undefined)[]): string[] {
  const out: string[] = [];
  for (const t of texts) {
    for (const m of (t ?? "").matchAll(/https?:\/\/[^\s<>"'`)\]]+/g)) {
      const u = m[0].replace(/[.,;:!?]+$/, "");
      let host = "";
      try {
        host = new URL(u).hostname.toLowerCase();
      } catch {
        continue;
      }
      if (host === "github.com" || host.endsWith(".github.com")) continue;
      if (!out.includes(u)) out.push(u);
      if (out.length === 3) return out;
    }
  }
  return out;
}

/** A row worth showing in Preview: something to look at (an image, a video) or a demo to open. */
export const viewableRow = (items: PreviewItem[], links: string[]): boolean => items.length > 0 || links.length > 0;
