"use client";

import { AlertTriangleIcon, CheckIcon, ExternalLinkIcon, GamepadIcon, LinkIcon, Loader2Icon, PlayIcon, RefreshCwIcon, XIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { agoVi } from "@/lib/now";
import type { PlayStatus, PlayStep } from "@/lib/server/play";
import { cn } from "@/lib/utils";
import { makeApi, type Api } from "./use-hq";

const STEPS: { key: PlayStep; label: string }[] = [
  { key: "fetch", label: "Lấy origin/main mới nhất" },
  { key: "checkout", label: "Đưa worktree chơi thử về main" },
  { key: "install", label: "Cài package (chỉ khi package-lock.json đổi)" },
  { key: "build", label: "npm run build" },
];
const POLL_MS = 1500;

const short = (sha: string | null) => sha?.slice(0, 7) ?? "";
const statusOf = (api: Api, root: string, fresh: boolean) => api<{ status: PlayStatus }>(`/api/play?root=${encodeURIComponent(root)}${fresh ? "&fresh=1" : ""}`).then((r) => r.status);

/**
 * The demo link on this page's own origin: the VPS link (https://vps.8syncdev.com…, behind its
 * GitHub gate) when HQ is opened there, 127.0.0.1 locally. The path is root-absolute (`/api/play/…`),
 * which the proxy forwards at its root also when HQ itself is mounted under `/hq`.
 */
async function copyDemo(shareUrl: string) {
  const link = new URL(shareUrl, window.location.href).href;
  try {
    await navigator.clipboard.writeText(link);
    toast.success("Đã copy link demo, sống 12 giờ");
  } catch {
    toast.message(link);
  }
}

/**
 * "Chơi thử": shows only when origin/main of this project has a `build` script, and opens the play
 * viewer. Asks the server once per mount, never polls on its own.
 */
export function PlayButton({ root, name, token, className }: { root: string; name: string; token: string; className?: string }) {
  const api = useMemo(() => makeApi(token), [token]);
  const [first, setFirst] = useState<PlayStatus | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let live = true;
    statusOf(api, root, false)
      .then((s) => live && setFirst(s))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [api, root]);
  if (!first?.buildable) return null;
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className={cn("shrink-0 max-sm:h-11 max-sm:px-3", className)}
        aria-haspopup="dialog"
        title={first.state === "ready" ? `Chơi bản main ${short(first.sha)}${first.stale ? ", main đã có commit mới" : ""}` : "Build bản main rồi chơi ngay trong HQ"}
        onClick={() => setOpen(true)}
      >
        <PlayIcon aria-hidden className="fill-current" /> Chơi thử
        {first.stale && <span aria-hidden className="size-1.5 rounded-full bg-amber-500" />}
      </Button>
      {open && <PlayViewer root={root} name={name} api={api} onClose={() => setOpen(false)} />}
    </>
  );
}

/**
 * Full-screen viewer: the game in a same-origin iframe (the status call sets the cookie the file
 * route checks), a header with the commit and its age, "Build lại", "Mở tab mới" and close. A
 * project never built starts its first build on open; a build shows its steps and the log tail.
 */
function PlayViewer({ root, name, api, onClose }: { root: string; name: string; api: Api; onClose: () => void }) {
  const [st, setSt] = useState<PlayStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const autoStarted = useRef(false);
  const frame = useRef<HTMLIFrameElement>(null);

  const build = async () => {
    setStarting(true);
    setError(null);
    try {
      setSt((await api<{ status: PlayStatus }>("/api/play", { method: "POST", body: { root } })).status);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStarting(false);
    }
  };

  // Open: fetch origin/main once, then poll only while a build runs.
  const building = st?.state === "building";
  useEffect(() => {
    let live = true;
    let t: number | undefined;
    const tick = async (fresh: boolean) => {
      try {
        const s = await statusOf(api, root, fresh);
        if (!live) return;
        setSt(s);
        setNow(Date.now());
        setError(null);
        if (s.state === "building") t = window.setTimeout(() => void tick(false), POLL_MS);
      } catch (e) {
        if (live) setError((e as Error).message);
      }
    };
    void tick(!building);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [api, root, building]);

  // Never built: the click on "Chơi thử" already said "build it".
  useEffect(() => {
    if (st?.state !== "none" || !st.buildable || autoStarted.current) return;
    autoStarted.current = true;
    void build();
  });

  // The age and elapsed labels move once a second while building, else every 30 s.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), building ? 1000 : 30_000);
    return () => clearInterval(t);
  }, [building]);

  const ready = st?.state === "ready";
  const line = !st
    ? "Đang hỏi trạng thái…"
    : building
      ? `Đang build main ${short(st.mainSha)} · ${elapsed(st.startedAt, now)}`
      : st.state === "failed"
        ? `Build lỗi${st.mainSha ? ` · main ${short(st.mainSha)}` : ""}`
        : ready
          ? `main ${short(st.sha)} · build ${agoVi(st.builtAt, now)}`
          : st.buildable
            ? "Chưa có bản build"
            : (st.reason ?? "Không build được");

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="top-0 left-0 grid h-dvh w-screen max-w-none translate-x-0 translate-y-0 grid-rows-[auto_minmax(0,1fr)] gap-0 rounded-none p-0 ring-0 sm:max-w-none data-open:zoom-in-100 data-closed:zoom-out-100"
      >
        <header className="flex min-w-0 items-center gap-2 border-b bg-popover px-3 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] sm:px-4">
          <GamepadIcon aria-hidden className="size-4 shrink-0 text-muted-foreground max-sm:hidden" />
          <div className="min-w-0 flex-1">
            <DialogTitle className="truncate text-sm font-semibold">{name}</DialogTitle>
            <DialogDescription className="flex min-w-0 flex-wrap items-center gap-x-2 text-xs text-muted-foreground tabular">
              <span className="font-mono">{line}</span>
              {ready && st.stale && (
                <span className="text-amber-700 dark:text-amber-400">main đã có {short(st.mainSha)}</span>
              )}
            </DialogDescription>
          </div>
          {st?.buildable && (
            <Button
              type="button"
              size="sm"
              variant={ready && st.stale ? "default" : "outline"}
              className="shrink-0 max-sm:size-11 max-sm:px-0"
              disabled={building || starting}
              onClick={() => void build()}
              aria-label="Build lại từ origin/main"
            >
              {building || starting ? <Loader2Icon className="animate-spin motion-reduce:animate-none" /> : <RefreshCwIcon />}
              <span className="max-sm:sr-only">Build lại</span>
            </Button>
          )}
          {ready && (
            <>
              <Button type="button" size="sm" variant="outline" className="shrink-0 max-sm:size-11 max-sm:px-0" onClick={() => void copyDemo(st.shareUrl)} aria-label="Copy link demo, sống 12 giờ">
                <LinkIcon />
                <span className="max-sm:sr-only">Copy link demo</span>
              </Button>
              <Button asChild size="sm" variant="outline" className="shrink-0 max-sm:size-11 max-sm:px-0">
                <a href={st.url} target="_blank" rel="noopener noreferrer" aria-label="Mở bản chơi thử trong tab mới">
                  <ExternalLinkIcon />
                  <span className="max-sm:sr-only">Mở tab mới</span>
                </a>
              </Button>
            </>
          )}
          <DialogClose asChild>
            <Button type="button" size="icon-sm" variant="ghost" className="shrink-0 max-sm:size-11" aria-label="Đóng chơi thử">
              <XIcon />
            </Button>
          </DialogClose>
        </header>

        {ready ? (
          <div className="relative min-h-0 bg-black">
            <iframe
              key={st.sha}
              ref={frame}
              src={st.url}
              title={`${name}: bản chơi thử của main ${short(st.sha)}`}
              className="absolute inset-0 size-full border-0"
              allow="fullscreen; autoplay; gamepad; xr-spatial-tracking"
              allowFullScreen
              // Keys go to the game as soon as it loads.
              onLoad={() => frame.current?.contentWindow?.focus()}
            />
          </div>
        ) : (
          <div className="min-h-0 overflow-y-auto">
            <div className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
              {error && (
                <p role="alert" className="flex items-start gap-2 text-sm text-destructive">
                  <AlertTriangleIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
                  {error}
                </p>
              )}
              {st && <BuildPanel st={st} starting={starting} onBuild={() => void build()} />}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function elapsed(from: number | null, now: number): string {
  if (!from) return "";
  const s = Math.max(0, Math.floor((now - from) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Not playable yet: the build steps, the error, the last lines of output. */
function BuildPanel({ st, starting, onBuild }: { st: PlayStatus; starting: boolean; onBuild: () => void }) {
  const at = st.step ? STEPS.findIndex((s) => s.key === st.step) : -1;
  const pre = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (pre.current) pre.current.scrollTop = pre.current.scrollHeight;
  }, [st.log.length]);

  if (st.state === "none" && !st.buildable) {
    return <p className="text-sm text-muted-foreground">{st.reason ?? "Dự án này chưa build được."}</p>;
  }
  return (
    <>
      {st.state === "building" && (
        <ol className="space-y-1.5 text-sm" aria-label="Các bước build">
          {STEPS.map((s, i) => (
            <li key={s.key} className={cn("flex items-center gap-2", i > at && "text-muted-foreground")} aria-current={i === at ? "step" : undefined}>
              {i < at ? (
                <CheckIcon aria-hidden className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              ) : i === at ? (
                <Loader2Icon aria-hidden className="size-4 shrink-0 animate-spin motion-reduce:animate-none" />
              ) : (
                <span aria-hidden className="grid size-4 shrink-0 place-items-center">
                  <span className="size-1.5 rounded-full bg-muted-foreground/50" />
                </span>
              )}
              {s.label}
            </li>
          ))}
        </ol>
      )}
      {st.state === "failed" && (
        <div role="alert" className="space-y-2">
          <p className="flex items-start gap-2 text-sm font-medium text-destructive">
            <AlertTriangleIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
            {st.error ?? "Build lỗi"}
          </p>
          <Button type="button" size="sm" className="max-sm:h-11" disabled={starting} onClick={onBuild}>
            <RefreshCwIcon /> Build lại
          </Button>
        </div>
      )}
      {st.state === "none" && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
          Đang bắt đầu build lần đầu…
        </p>
      )}
      {st.log.length > 0 && (
        <pre
          ref={pre}
          tabIndex={0}
          aria-label="Log build, 200 dòng cuối"
          className="max-h-[50dvh] overflow-auto rounded-lg bg-muted px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-all text-foreground"
        >
          {st.log.join("\n")}
        </pre>
      )}
    </>
  );
}
