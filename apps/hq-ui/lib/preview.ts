// Shared by the Preview route (lib/server/preview.ts) and the views: item shape and pure helpers.

export type PreviewItem = {
  id: string;
  project: string;
  root: string;
  /** Path relative to the project root, `/`-separated. */
  rel: string;
  /** Worktree folder name under `.claude/worktrees`, null for the root itself. */
  worktree: string | null;
  branch: string | null;
  /** `card-<n>` in the file name, else in the path (worktree name). */
  card: number | null;
  mtime: number;
  size: number;
};

export type ProjectPreviews = { root: string; name: string; items: PreviewItem[] };

const CARD_RE = /(?:^|[^a-z0-9])card[-_]?(\d{1,9})(?!\d)/i;

/** `card-7`, `card_7`, `card7`: the board card a shot belongs to. The file name wins over its folder. */
export function cardOf(rel: string): number | null {
  const m = CARD_RE.exec(rel.split("/").pop() ?? "") ?? CARD_RE.exec(rel);
  return m ? Number(m[1]) : null;
}

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

/** Image cards grouped by card id (null = not tied to a card), newest group first. */
export function groupByCard(items: PreviewItem[]): { card: number | null; items: PreviewItem[]; at: number }[] {
  const map = new Map<number | null, PreviewItem[]>();
  for (const i of items) (map.get(i.card) ?? map.set(i.card, []).get(i.card)!).push(i);
  return [...map.entries()]
    .map(([card, xs]) => {
      const sorted = [...xs].sort((a, b) => b.mtime - a.mtime);
      return { card, items: sorted, at: sorted[0]?.mtime ?? 0 };
    })
    .sort((a, b) => b.at - a.at);
}

/** "home.png" from "qa/evidence/card-7-home.png". */
export const fileName = (rel: string) => rel.split("/").pop() ?? rel;
