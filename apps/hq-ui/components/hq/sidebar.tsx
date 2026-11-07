"use client";

import {
  BotIcon,
  ChevronDownIcon,
  CircleHelpIcon,
  EllipsisIcon,
  FolderPlusIcon,
  MoonIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  SunIcon,
  UsersIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { MORE_LABEL, NAV_LABEL, isMore, moreLabel, navOf, type MoreTab, type NavItem } from "@/lib/tabs";
import { cn } from "@/lib/utils";
import { BotRoster } from "./bots/bot-list";
import { GroupsSection } from "./bots/groups-section";
import type { Roster } from "./bots/use-roster";
import { BrandMark } from "./brand-mark";
import type { Live } from "./use-hq";

/** The owner's account line (owner 2026-11-02: "Alex · 8 Sync"). HQ is one owner's local tool: no login. */
const ACCOUNT = "Alex · 8 Sync";

/** Plain rows: neutral hover, the current one a gray layer (no brand wash: lime is only the mark and the primary button). */
const row =
  "flex w-full min-w-0 items-center gap-2.5 rounded-md px-2 text-left text-[13px] outline-none transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring/60 aria-[current=page]:bg-sidebar-accent aria-[current=page]:font-medium motion-reduce:transition-none";

const NAV_ICON = { bots: BotIcon, groups: UsersIcon, search: SearchIcon, more: EllipsisIcon } as const;

/**
 * HQ's sidebar from md up (owner 2026-11-07, Grok Bot style): the brand, "Bot mới", the four places
 * (Bots · Nhóm · Tìm · Thêm), then the bots themselves (components/hq/bots/bot-list.tsx) and the groups.
 * Sessions, worktrees and subagents are not listed here: they are each bot's Lịch sử phiên, and the full
 * session tree is Thêm → Phiên & dự án.
 */
export function Sidebar({
  live,
  roster,
  tab,
  openBot,
  openGroup,
  more,
  onNav,
  onOpenBot,
  onOpenGroup,
  onNewBot,
  onNewGroup,
  onAddProject,
  onHelp,
}: {
  live: Live;
  roster: Roster;
  tab: string;
  /** The bot on screen, when Bots is open. */
  openBot: string | null;
  openGroup: string | null;
  /** Thêm's views on offer (lib/tabs moreTabs). */
  more: readonly MoreTab[];
  onNav: (to: Exclude<NavItem, "more"> | MoreTab) => void;
  onOpenBot: (key: string) => void;
  onOpenGroup: (id: string) => void;
  onNewBot: (template?: string) => void;
  onNewGroup: () => void;
  onAddProject: () => void;
  onHelp: () => void;
}) {
  const at = navOf(tab);
  const needs = roster.bots.filter((b) => b.status === "needs").length;
  return (
    <nav aria-label="HQ" className="flex h-full min-h-0 flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex h-12 shrink-0 items-center gap-2 px-3">
        {/* The mark keeps the 8 Sync lime/leaf whatever the UI accent is (brand kit: never recolour it). */}
        <BrandMark className="h-6 w-4 shrink-0 text-brand-ink dark:text-brand" />
        <span className="text-[15px] font-semibold tracking-tight">8 Sync HQ</span>
        <LiveDot live={live} />
      </div>

      <div className="shrink-0 space-y-0.5 px-2 pb-2">
        <button
          type="button"
          onClick={() => onNewBot()}
          className="mb-1.5 flex h-9 w-full items-center gap-2 rounded-full bg-primary px-3 text-[13px] font-medium text-primary-foreground shadow-xs outline-none transition-colors hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-1 focus-visible:ring-offset-sidebar motion-reduce:transition-none"
        >
          <PlusIcon className="size-4" aria-hidden /> Bot mới
        </button>
        {(["bots", "groups", "search"] as const).map((n) => {
          const Icon = NAV_ICON[n];
          return (
            <button key={n} type="button" className={cn(row, "h-8")} aria-current={at === n ? "page" : undefined} onClick={() => onNav(n)}>
              <Icon className="size-4 text-muted-foreground" aria-hidden /> {NAV_LABEL[n]}
              {n === "bots" && needs > 0 && (
                <span className="ml-auto rounded-full bg-st-needs/20 px-1.5 text-[11px] font-semibold text-[color-mix(in_oklch,var(--st-needs),black_42%)] tabular dark:text-st-needs" aria-label={`${needs} bot chờ anh`}>
                  {needs}
                </span>
              )}
              {n === "groups" && roster.groups.length > 0 && <span className="ml-auto text-[11px] text-muted-foreground tabular">{roster.groups.length}</span>}
            </button>
          );
        })}
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger className={cn(row, "h-8")} aria-current={isMore(tab) ? "page" : undefined}>
            <EllipsisIcon className="size-4 text-muted-foreground" aria-hidden />
            {moreLabel(tab)}
            <ChevronDownIcon className="ml-auto size-3.5 text-muted-foreground" aria-hidden />
          </DropdownMenuTrigger>
          {/* No exit fade (`!`: the primitive's animate-out sorts later): an item switches the view, and a
              fade stalled by a busy or hidden window left the half-transparent menu over the page (UAT 2026-11-07). */}
          <DropdownMenuContent align="start" className="max-h-[70dvh] min-w-48 data-closed:animate-none!">
            {more.map((t) => (
              <DropdownMenuItem key={t} onSelect={() => onNav(t)} className={cn(tab === t && "font-semibold")}>
                {MORE_LABEL[t]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-sidebar-border px-1.5 pt-2 pb-3">
        <BotRoster roster={roster} selected={at === "bots" ? openBot : null} onOpen={onOpenBot} onNew={onNewBot} dense />
        {!roster.loading && (
          <GroupsSection groups={roster.groups} all={roster.all} selected={at === "groups" ? openGroup : null} onOpen={onOpenGroup} onNew={onNewGroup} />
        )}
      </div>

      <Account onAddProject={onAddProject} onHelp={onHelp} onSettings={() => onNav("may")} settingsCurrent={tab === "may"} />
    </nav>
  );
}

const noop = () => () => {};

/** The theme is only known in the browser: `dark` false and the toggle disabled until it is. */
export function useDarkToggle(): { mounted: boolean; dark: boolean; toggle: () => void } {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  const dark = mounted && (theme === "system" ? resolvedTheme : theme) === "dark";
  return { mounted, dark, toggle: () => setTheme(dark ? "light" : "dark") };
}

/** Bottom: the account (add a project, theme, help) and the settings gear (the Máy view). */
function Account({ onAddProject, onHelp, onSettings, settingsCurrent }: { onAddProject: () => void; onHelp: () => void; onSettings: () => void; settingsCurrent: boolean }) {
  const theme = useDarkToggle();
  return (
    <div className="flex shrink-0 items-center gap-1 border-t border-sidebar-border p-2">
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger className={cn(row, "h-9 flex-1 gap-2")}>
          <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-full bg-foreground text-[11px] font-semibold text-background">
            A
          </span>
          <span className="min-w-0 flex-1 truncate font-medium">{ACCOUNT}</span>
          <ChevronDownIcon className="size-3.5 text-muted-foreground" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="top" className="w-56">
          <DropdownMenuItem onSelect={onAddProject}>
            <FolderPlusIcon aria-hidden /> Thêm dự án…
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!theme.mounted} onSelect={theme.toggle}>
            {theme.dark ? <SunIcon aria-hidden /> : <MoonIcon aria-hidden />} {theme.dark ? "Giao diện sáng" : "Giao diện tối"}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onHelp}>
            <CircleHelpIcon aria-hidden /> Cách dùng HQ
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <button
        type="button"
        className={cn(
          "grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground outline-none hover:bg-black/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 dark:hover:bg-white/10",
          settingsCurrent && "bg-sidebar-accent text-foreground",
        )}
        aria-label="Cài đặt máy"
        aria-current={settingsCurrent ? "page" : undefined}
        title="Cài đặt máy"
        onClick={onSettings}
      >
        <SettingsIcon className="size-4" aria-hidden />
      </button>
    </div>
  );
}

function LiveDot({ live }: { live: Live }) {
  const label = live === "live" ? "Live" : live === "polling" ? "Cập nhật 3 giây/lần" : live === "connecting" ? "Đang kết nối" : "Đang nối lại";
  return (
    <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
      <span aria-hidden className={cn("size-1.5 rounded-full", live === "live" || live === "polling" ? "bg-st-running" : "bg-st-needs motion-safe:animate-pulse")} />
      {label}
    </span>
  );
}
