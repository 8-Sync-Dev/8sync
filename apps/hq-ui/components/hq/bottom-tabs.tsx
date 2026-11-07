"use client";

import { BotIcon, CircleHelpIcon, EllipsisIcon, FolderPlusIcon, MoonIcon, SearchIcon, SunIcon, UsersIcon } from "lucide-react";
import { useState } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { MORE_LABEL, NAV, NAV_LABEL, navOf, type MoreTab, type NavItem } from "@/lib/tabs";
import { cn } from "@/lib/utils";
import { useDarkToggle } from "./sidebar";

const ICON = { bots: BotIcon, groups: UsersIcon, search: SearchIcon, more: EllipsisIcon } as const;

const sheetRow =
  "flex min-h-12 w-full min-w-0 items-center gap-3 rounded-lg px-3 text-left text-[15px] outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/60 aria-[current=page]:bg-muted aria-[current=page]:font-semibold";

/**
 * A phone's navigation (owner 2026-11-07: "mobile best", Grok Bot style): four places at the bottom,
 * in thumb reach, above the home indicator; no tab row at the top. Thêm opens a sheet with every other
 * view and the account actions (theme, add a project, help).
 */
export function BottomTabs({
  tab,
  needs,
  more,
  onNav,
  onAddProject,
  onHelp,
}: {
  tab: string;
  /** Bots waiting for the owner: a count on Bots. */
  needs: number;
  /** Thêm's views on offer (lib/tabs moreTabs). */
  more: readonly MoreTab[];
  onNav: (to: Exclude<NavItem, "more"> | MoreTab) => void;
  onAddProject: () => void;
  onHelp: () => void;
}) {
  const [open, setOpen] = useState(false);
  const theme = useDarkToggle();
  const at = navOf(tab);
  const go = (to: Exclude<NavItem, "more"> | MoreTab) => {
    setOpen(false);
    onNav(to);
  };
  return (
    <>
      <nav aria-label="HQ" className="shrink-0 border-t bg-background/95 pb-[env(safe-area-inset-bottom)]">
        <ul className="grid grid-cols-4">
          {NAV.map((n) => {
            const Icon = ICON[n];
            const current = at === n;
            return (
              <li key={n}>
                <button
                  type="button"
                  aria-current={current ? "page" : undefined}
                  aria-haspopup={n === "more" ? "dialog" : undefined}
                  onClick={() => (n === "more" ? setOpen(true) : go(n))}
                  className={cn(
                    "relative flex h-14 w-full flex-col items-center justify-center gap-0.5 text-[11px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset",
                    current ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  <span className={cn("grid h-7 w-12 place-items-center rounded-full transition-colors motion-reduce:transition-none", current && "bg-muted")}>
                    <Icon aria-hidden className="size-5" />
                  </span>
                  <span className="max-w-full truncate px-1">{n === "more" && current ? MORE_LABEL[tab as MoreTab] : NAV_LABEL[n]}</span>
                  {n === "bots" && needs > 0 && (
                    <span aria-label={`${needs} bot chờ anh`} className="absolute top-1.5 left-[calc(50%+6px)] min-w-4 rounded-full bg-st-needs px-1 text-center text-[10px] leading-4 font-semibold text-black tabular">
                      {needs}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="max-h-[85dvh] gap-0 rounded-t-2xl p-0 motion-reduce:animate-none">
          <SheetHeader className="px-4 pt-4 pb-2">
            <SheetTitle>Thêm</SheetTitle>
            <SheetDescription>Các trang khác của HQ.</SheetDescription>
          </SheetHeader>
          <div className="min-h-0 overflow-y-auto px-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <ul aria-label="Trang khác" className="grid grid-cols-2 gap-x-1">
              {more.map((t) => (
                <li key={t}>
                  <button type="button" className={sheetRow} aria-current={tab === t ? "page" : undefined} onClick={() => go(t)}>
                    {MORE_LABEL[t]}
                  </button>
                </li>
              ))}
            </ul>
            <ul aria-label="Tài khoản" className="mt-2 border-t pt-2">
              <li>
                <button
                  type="button"
                  className={sheetRow}
                  onClick={() => {
                    setOpen(false);
                    onAddProject();
                  }}
                >
                  <FolderPlusIcon aria-hidden className="size-5 text-muted-foreground" /> Thêm dự án
                </button>
              </li>
              <li>
                <button type="button" className={sheetRow} disabled={!theme.mounted} onClick={theme.toggle}>
                  {theme.dark ? <SunIcon aria-hidden className="size-5 text-muted-foreground" /> : <MoonIcon aria-hidden className="size-5 text-muted-foreground" />}
                  {theme.dark ? "Giao diện sáng" : "Giao diện tối"}
                </button>
              </li>
              <li>
                <button
                  type="button"
                  className={sheetRow}
                  onClick={() => {
                    setOpen(false);
                    onHelp();
                  }}
                >
                  <CircleHelpIcon aria-hidden className="size-5 text-muted-foreground" /> Cách dùng HQ
                </button>
              </li>
            </ul>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
