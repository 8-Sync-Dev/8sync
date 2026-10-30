import { useState } from "react";
import { rootKey } from "@/lib/preview";

/**
 * A tab with its own project picker follows the repo the owner picked in the sidebar: when that
 * changes, the picker jumps to it (owner 2026-10-21: a tab showed `ide` under a `platform` header,
 * Văn phòng showed every project). The owner's later picks inside the tab still win until the
 * sidebar changes again. Adjusted during render, the React way to react to a changed prop.
 */
export function useFollowRepo(repo: string | null, setPick: (root: string) => void): void {
  const [followed, setFollowed] = useState(repo);
  if (repo !== followed) {
    setFollowed(repo);
    if (repo) setPick(repo);
  }
}

/** The list entry for `repo` (by root), when it has one. */
export function entryFor<T extends { root: string }>(list: T[], repo: string | null): T | undefined {
  if (!repo) return undefined;
  const k = rootKey(repo);
  return list.find((b) => rootKey(b.root) === k);
}
