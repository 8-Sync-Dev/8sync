"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { ChannelMode, Message, Project, Session, Task } from "./types";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * Behind the VPS login (oauth2-proxy, 12 h cookie) a lapsed session answers every call with a redirect
 * to GitHub that fetch cannot follow, so the page sat broken until a manual reload (owner 2026-10-21:
 * "chưa vô được hq ui"). HQ's API never redirects: an opaque redirect means the login lapsed, and the
 * page reloads into the sign-in, at most once per RELOGIN_MS so a stray redirect cannot loop. Text
 * typed in a box would be lost by a reload: then a toast offers the sign-in instead.
 */
export const RELOGIN_MS = 30_000;
const typing = () =>
  typeof document !== "undefined" &&
  [...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('textarea, input[type="text"], input:not([type])')].some((e) => e.value.trim() !== "");
export function loginLapsed(res: Response, now = Date.now()): boolean {
  if (res.type !== "opaqueredirect") return false;
  if (typing()) {
    toast.error("Phiên đăng nhập đã hết hạn", {
      id: "hq-relogin",
      duration: Infinity,
      description: "Chép phần đang gõ rồi đăng nhập lại.",
      action: { label: "Đăng nhập lại", onClick: () => location.reload() },
    });
    return true;
  }
  try {
    if (now - Number(sessionStorage.getItem("hq-relogin") ?? 0) > RELOGIN_MS) {
      sessionStorage.setItem("hq-relogin", String(now));
      location.reload();
    }
  } catch {
    // no storage: no reload either (it could loop); the error below still shows
  }
  return true;
}

const LAPSED = "Phiên đăng nhập đã hết hạn: đang mở lại trang đăng nhập";

export type Api = <T>(path: string, init?: { method?: string; body?: unknown; signal?: AbortSignal }) => Promise<T>;

export function makeApi(token: string): Api {
  return async (path, init = {}) => {
    const res = await fetch(path, {
      method: init.method ?? "GET",
      signal: init.signal,
      cache: "no-store",
      redirect: "manual",
      headers: {
        "x-hq-token": token,
        ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    if (loginLapsed(res)) throw new ApiError(LAPSED, 401);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError((data as { error?: string }).error ?? `HTTP ${res.status}`, res.status);
    return data as never;
  };
}

type Load<T> = { data: T; loading: boolean; error: string | null };
const init = <T,>(data: T): Load<T> => ({ data, loading: true, error: null });

/** "polling": the stream went silent (a proxy such as a Cloudflare quick tunnel holds it back). */
export type Live = "connecting" | "live" | "retrying" | "polling";

/** Poll period when SSE is not usable; the stream itself pings every 5 s, so 10 s of silence means it is buffered or dead. */
export const POLL_MS = 3000;
export const SILENT_MS = 10_000;
/** Every 10th poll reloads the whole timeline + sessions: rows changed in place (what SSE `rewrite` signals). */
const FULL_EVERY = 10;

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(t), resolve()), { once: true });
  });

/**
 * All HQ state in one place: initial loads, then one SSE stream (read with
 * fetch, since EventSource cannot send the token header) for new rows. Off
 * loopback, or once the stream stays silent for SILENT_MS, it polls the same
 * data every POLL_MS instead.
 */
export function useHq(token: string) {
  const api = useMemo(() => makeApi(token), [token]);
  const [projects, setProjects] = useState<Load<Project[]>>(init([]));
  const [sessions, setSessions] = useState<Load<Session[]>>(init([]));
  const [channelMode, setChannelMode] = useState<ChannelMode | null>(null);
  const [tasks, setTasks] = useState<Load<Task[]>>(init([]));
  const [messages, setMessages] = useState<Load<Message[]>>(init([]));
  const [live, setLive] = useState<Live>("connecting");
  const lastMsg = useRef(0);

  const loadProjects = useCallback(async () => {
    try {
      const r = await api<{ projects: Project[] }>("/api/projects");
      setProjects({ data: r.projects, loading: false, error: null });
    } catch (e) {
      setProjects((p) => ({ ...p, loading: false, error: (e as Error).message }));
    }
  }, [api]);

  const loadSessions = useCallback(async () => {
    try {
      const r = await api<{ sessions: Session[]; channel_mode: ChannelMode }>("/api/sessions");
      setSessions({ data: r.sessions, loading: false, error: null });
      setChannelMode(r.channel_mode);
    } catch (e) {
      setSessions((p) => ({ ...p, loading: false, error: (e as Error).message }));
    }
  }, [api]);

  const loadTasks = useCallback(async () => {
    try {
      const r = await api<{ tasks: Task[] }>("/api/tasks");
      setTasks({ data: r.tasks, loading: false, error: null });
    } catch (e) {
      setTasks((p) => ({ ...p, loading: false, error: (e as Error).message }));
    }
  }, [api]);

  const loadMessages = useCallback(async () => {
    try {
      const r = await api<{ messages: Message[] }>("/api/messages?limit=1000");
      lastMsg.current = Math.max(lastMsg.current, r.messages.at(-1)?.id ?? 0);
      setMessages({ data: r.messages, loading: false, error: null });
    } catch (e) {
      setMessages((p) => ({ ...p, loading: false, error: (e as Error).message }));
    }
  }, [api]);

  const mergeMessages = useCallback((rows: Message[]) => {
    if (!rows.length) return;
    lastMsg.current = Math.max(lastMsg.current, rows.at(-1)!.id);
    setMessages((m) => {
      const seen = new Set(m.data.map((x) => x.id));
      const add = rows.filter((r) => !seen.has(r.id));
      return add.length ? { ...m, data: [...m.data, ...add].slice(-3000) } : m;
    });
  }, []);

  const mergeTasks = useCallback((rows: Task[]) => {
    setTasks((t) => {
      const byId = new Map(t.data.map((x) => [x.task_id, x]));
      for (const r of rows) byId.set(r.task_id, r);
      return { ...t, data: [...byId.values()].sort((a, b) => b.updated_at - a.updated_at) };
    });
  }, []);

  // Initial loads, then the session list every 10 s (channel beats age out) while the tab is visible.
  useEffect(() => {
    // Async loaders set state after their fetch resolves, not synchronously.
    void Promise.all([loadProjects(), loadSessions(), loadTasks(), loadMessages()]);
    const t = setInterval(() => {
      if (!document.hidden) void loadSessions();
    }, 10_000);
    return () => clearInterval(t);
  }, [loadProjects, loadSessions, loadTasks, loadMessages]);

  // SSE over fetch, reconnecting with a short backoff; polling when SSE cannot work.
  useEffect(() => {
    const ac = new AbortController();
    let backoff = 1000;
    /** Resolves "silent" when the stream gave no byte for SILENT_MS (tunnel buffering): switch to polling. */
    const stream = async (): Promise<"silent" | "aborted"> => {
      while (!ac.signal.aborted) {
        const conn = new AbortController();
        const stop = () => conn.abort();
        ac.signal.addEventListener("abort", stop, { once: true });
        let silent = false;
        let dog: ReturnType<typeof setTimeout> | undefined;
        const fed = () => {
          clearTimeout(dog);
          dog = setTimeout(() => {
            silent = true;
            conn.abort();
          }, SILENT_MS);
        };
        fed();
        try {
          const res = await fetch(`/api/stream?after=${lastMsg.current}`, {
            headers: { "x-hq-token": token },
            signal: conn.signal,
            cache: "no-store",
            redirect: "manual",
          });
          if (loginLapsed(res)) throw new Error(LAPSED);
          if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
          const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
          let buf = "";
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            fed();
            setLive("live");
            backoff = 1000;
            buf += value;
            let i: number;
            while ((i = buf.indexOf("\n\n")) >= 0) {
              const block = buf.slice(0, i);
              buf = buf.slice(i + 2);
              let event = "message";
              let data = "";
              for (const line of block.split("\n")) {
                if (line.startsWith("event: ")) event = line.slice(7);
                else if (line.startsWith("data: ")) data += line.slice(6);
              }
              if (!data) continue;
              const payload = JSON.parse(data);
              if (event === "messages") mergeMessages(payload);
              else if (event === "tasks") mergeTasks(payload);
              else if (event === "sessions") void loadSessions();
              else if (event === "projects") void loadProjects();
              // Rows changed in place (retried delivery, uuid rows renamed): reload them.
              else if (event === "rewrite") void Promise.all([loadMessages(), loadTasks(), loadSessions()]);
            }
          }
        } catch {
          /* reconnect below, or poll when silent */
        } finally {
          clearTimeout(dog);
          ac.signal.removeEventListener("abort", stop);
        }
        if (ac.signal.aborted) return "aborted";
        if (silent) return "silent";
        setLive("retrying");
        await sleep(backoff, ac.signal);
        backoff = Math.min(backoff * 2, 15_000);
      }
      return "aborted";
    };
    const poll = async () => {
      setLive("polling");
      for (let n = 1; !ac.signal.aborted; n++) {
        if (!document.hidden) {
          try {
            const r = await api<{ messages: Message[] }>(`/api/messages?after=${lastMsg.current}&limit=1000`, { signal: ac.signal });
            mergeMessages(r.messages);
          } catch {
            /* next round */
          }
          await (n % FULL_EVERY === 0 ? Promise.all([loadTasks(), loadMessages(), loadSessions(), loadProjects()]) : loadTasks());
        }
        await sleep(POLL_MS, ac.signal);
      }
    };
    void (async () => {
      // Off loopback too: a proxy that passes the stream (the VPS gate) gets it live; one that holds it
      // back (a Cloudflare quick tunnel) goes silent for SILENT_MS and falls back to polling.
      if ((await stream()) === "aborted") return;
      if (!ac.signal.aborted) await poll();
    })();
    return () => ac.abort();
  }, [token, api, mergeMessages, mergeTasks, loadSessions, loadProjects, loadMessages, loadTasks]);

  return {
    api,
    live,
    projects,
    sessions,
    channelMode,
    tasks,
    messages,
    reload: { projects: loadProjects, sessions: loadSessions, tasks: loadTasks, messages: loadMessages },
    mergeMessages,
    mergeTasks,
  };
}

export type Hq = ReturnType<typeof useHq>;
