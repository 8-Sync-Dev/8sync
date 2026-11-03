"use client";

import { useEffect, useState } from "react";

type Start = { id: string; userCode: string; verificationUri: string; interval: number };

/**
 * GitHub device-flow sign-in on the public link (app/api/login/github): show the code, open
 * github.com/login/device, poll until GitHub answers, then reload HQ with the login cookie.
 */
export function GithubLogin() {
  const [flow, setFlow] = useState<Start | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/login/github", { method: "POST" });
      const v = await r.json();
      if (!r.ok) throw new Error(v?.error ?? `HTTP ${r.status}`);
      setFlow(v);
      window.open(v.verificationUri, "_blank", "noopener");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!flow) return;
    let stop = false;
    const tick = async () => {
      if (stop) return;
      const r = await fetch(`/api/login/github?f=${flow.id}`, { cache: "no-store" }).catch(() => null);
      if (stop) return;
      if (r?.status === 200) {
        window.location.replace("/");
        return;
      }
      if (r && r.status !== 202) {
        const v = await r.json().catch(() => null);
        setFlow(null);
        setError(v?.error ?? `HTTP ${r.status}`);
        return;
      }
      timer = setTimeout(tick, flow.interval * 1000);
    };
    let timer = setTimeout(tick, flow.interval * 1000);
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [flow]);

  return (
    <div className="flex flex-col items-center gap-3 text-foreground">
      {flow ? (
        <>
          <p className="text-muted-foreground">
            Nhập mã này ở{" "}
            <a href={flow.verificationUri} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
              github.com/login/device
            </a>
            , HQ tự vào khi GitHub xác nhận:
          </p>
          <button
            type="button"
            onClick={() => navigator.clipboard?.writeText(flow.userCode)}
            className="rounded-md border border-border px-4 py-2 font-mono text-2xl tracking-widest"
            title="Bấm để chép"
          >
            {flow.userCode}
          </button>
          <p className="text-xs text-muted-foreground">Đang chờ GitHub…</p>
        </>
      ) : (
        <button
          type="button"
          onClick={start}
          disabled={busy}
          className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-60"
        >
          {busy ? "Đang mở GitHub…" : "Đăng nhập bằng GitHub"}
        </button>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
