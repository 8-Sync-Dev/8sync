"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChannelMode, Message, Project, Session, Task } from "./types";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export type Api = <T>(path: string, init?: { method?: string; body?: unknown; signal?: AbortSignal }) => Promise<T>;

export function makeApi(token: string): Api {
  return async (path, init = {}) => {
    const res = await fetch(path, {
      method: init.method ?? "GET",
      signal: init.signal,
      cache: "no-store",
      headers: {
        "x-hq-token": token,
        ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError((data as { error?: string }).error ?? `HTTP ${res.status}`, res.status);
    return data as never;
  };
}

type Load<T> = { data: T; loading: boolean; error: string | null };
const init = <T,>(data: T): Load<T> => ({ data, loading: true, error: null });

export type Live = "connecting" | "live" | "retrying";

/**
 * All HQ state in one place: initial loads, then one SSE stream (read with
 * fetch, since EventSource cannot send the token header) for new rows.
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

  // Initial loads, then the session list every 10 s (channel beats age out).
  useEffect(() => {
    // Async loaders set state after their fetch resolves, not synchronously.
    void Promise.all([loadProjects(), loadSessions(), loadTasks(), loadMessages()]);
    const t = setInterval(loadSessions, 10_000);
    return () => clearInterval(t);
  }, [loadProjects, loadSessions, loadTasks, loadMessages]);

  // SSE over fetch, reconnecting with a short backoff.
  useEffect(() => {
    const ac = new AbortController();
    let backoff = 1000;
    const connect = async () => {
      while (!ac.signal.aborted) {
        try {
          const res = await fetch(`/api/stream?after=${lastMsg.current}`, {
            headers: { "x-hq-token": token },
            signal: ac.signal,
            cache: "no-store",
          });
          if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
          setLive("live");
          backoff = 1000;
          const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
          let buf = "";
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
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
          if (ac.signal.aborted) return;
        }
        setLive("retrying");
        await new Promise((r) => setTimeout(r, backoff));
        backoff = Math.min(backoff * 2, 15_000);
      }
    };
    void connect();
    return () => ac.abort();
  }, [token, mergeMessages, mergeTasks, loadSessions, loadProjects, loadMessages, loadTasks]);

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
