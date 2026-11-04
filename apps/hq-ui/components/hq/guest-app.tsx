"use client";

import { LogOutIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { Toaster } from "@/components/ui/sonner";
import { Skeleton } from "@/components/ui/skeleton";
import type { GuestRole } from "@/lib/access";
import { AccessBadge, AccessContext } from "./access";
import { BrandMark } from "./brand-mark";

const ContentView = dynamic(() => import("./content-view").then((m) => m.ContentView), { loading: () => <Skeleton className="m-6 h-24 rounded-lg" /> });

/**
 * HQ as a "Chia sẻ" guest sees it: the Nội dung tab only, no token (every call rides the signed
 * `hq_guest` cookie the server re-checks), the role badge always in sight, and a way out.
 */
export function GuestApp({ role, label, until }: { role: GuestRole; label: string; until: number }) {
  return (
    <AccessContext.Provider value={role}>
      <div className="flex h-full flex-col pt-[env(safe-area-inset-top)]">
        <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2 sm:px-6">
          <span className="flex items-center gap-2 text-sm font-semibold">
            <BrandMark className="h-5 w-auto text-brand-ink dark:text-brand" />
            8 Sync HQ
          </span>
          <AccessBadge role={role} />
          <span className="min-w-0 truncate text-xs text-muted-foreground" title={label}>
            {label} · đến{" "}
            <time suppressHydrationWarning dateTime={new Date(until).toISOString()}>
              {new Date(until).toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
            </time>
          </span>
          {/* A full navigation: the route clears the cookie and redirects. */}
          <a href="/api/login?out=1" className="ml-auto inline-flex min-h-11 items-center gap-1 rounded px-2 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring sm:min-h-8">
            <LogOutIcon aria-hidden className="size-3.5" /> Thoát
          </a>
        </header>
        <main className="min-h-0 flex-1">
          <ContentView token="" active />
        </main>
      </div>
      <Toaster position="bottom-right" />
    </AccessContext.Provider>
  );
}
