"use client";

// The omp half of "Hạn mức": every account omp holds with its limit windows, the API keys members call models
// with, and the log of their calls (docs/hq-quota-keys.md). Data: /api/omp/accounts, /api/omp/keys.
import { KeyRoundIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { resetClock } from "@/lib/office";
import type { ApiKey, CallView, KeyStats } from "@/lib/server/api-keys";
import type { OmpAccount, OmpAccounts, OmpLimit } from "@/lib/server/omp-accounts";
import { cn } from "@/lib/utils";
import { EmptyState, ErrorNote } from "./bits";
import { CopyButton } from "./copy-button";
import { Bar, dayTime, level, span, text } from "./machine-chip";
import { makeApi, type Api } from "./use-hq";
import { usePoll } from "./use-poll";

/** omp reads usage when it uses an account, so numbers older than this are flagged. */
const STALE_MS = 6 * 3600_000;
const ACCOUNTS_POLL_MS = 120_000;
const KEYS_POLL_MS = 30_000;

const PROVIDER: Record<string, string> = {
  anthropic: "Claude (Anthropic)",
  "openai-codex": "ChatGPT Codex",
  "google-antigravity": "Google Antigravity",
  "google-gemini-cli": "Gemini CLI",
  cursor: "Cursor",
  nvidia: "NVIDIA",
  zai: "Z.ai",
  openrouter: "OpenRouter",
  "github-copilot": "GitHub Copilot",
};

type KeysReport = {
  keys: ApiKey[];
  calls: CallView[];
  stats: KeyStats[];
  gateway: { state: "up" | "down"; url: string };
  base_path: string;
  public_host: string | null;
};

const num = (n: number) => n.toLocaleString("vi-VN");
/** `span` ("4 giờ 23 phút"), but whole days past two days: monthly windows and old reads stay readable. */
const ago = (s: number) => (s >= 172_800 ? `${Math.round(s / 86_400)} ngày` : span(s));

/** omp accounts, member API keys, member calls. */
export function OmpSections({ token, now }: { token: string; now: number }) {
  const api = useMemo(() => makeApi(token), [token]);
  const accounts = usePoll<OmpAccounts>(api, "/api/omp/accounts", ACCOUNTS_POLL_MS, true);
  const keys = usePoll<KeysReport>(api, "/api/omp/keys", KEYS_POLL_MS, true);
  return (
    <>
      <AccountsSection {...accounts} now={now} />
      <KeysSection report={keys.data} error={keys.error} reload={keys.reload} api={api} now={now} />
      {keys.data && <CallsSection calls={keys.data.calls} />}
    </>
  );
}

function AccountsSection({ data, error, reload, now }: { data: OmpAccounts | null; error: string | null; reload: () => void; now: number }) {
  const groups = useMemo(() => {
    const m = new Map<string, OmpAccount[]>();
    for (const a of data?.accounts ?? []) m.set(a.provider, [...(m.get(a.provider) ?? []), a]);
    return [...m.entries()];
  }, [data]);
  return (
    <section aria-labelledby="omp-accounts-h" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="omp-accounts-h" className="text-sm font-semibold">
          Tài khoản omp {data?.available && <span className="font-normal text-muted-foreground">· {data.accounts.length} tài khoản</span>}
        </h2>
        <p className="text-xs text-muted-foreground">Số do omp tự ghi mỗi lần dùng tài khoản, đọc từ ~/.omp/agent (không gọi provider).</p>
      </div>
      {error && !data && <ErrorNote what="tài khoản omp" error={error} onRetry={reload} />}
      {data && !data.available && (
        <p className="rounded-lg border px-3 py-3 text-sm text-muted-foreground">Máy này chưa có omp (không thấy ~/.omp/agent/agent.db), hoặc omp đang khoá file. Đăng nhập bằng `omp` rồi mở lại tab này.</p>
      )}
      {data?.available && data.accounts.length === 0 && <p className="rounded-lg border px-3 py-3 text-sm text-muted-foreground">omp chưa đăng nhập tài khoản nào.</p>}
      {groups.map(([provider, list]) => (
        <div key={provider} className="space-y-2">
          <h3 className="text-xs font-medium text-muted-foreground">{PROVIDER[provider] ?? provider}</h3>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {list.map((a) => (
              <AccountCard key={a.id} a={a} now={now} />
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

function AccountCard({ a, now }: { a: OmpAccount; now: number }) {
  const readAt = a.limits.reduce<number | null>((m, l) => (m == null || l.read_at > m ? l.read_at : m), null);
  return (
    <article className={cn("space-y-2 rounded-lg border px-3 py-3", a.broken && "border-destructive/40")}>
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 truncate text-sm font-medium" title={a.who ?? undefined}>
          {a.who ?? `Tài khoản #${a.id}`}
        </p>
        <Badge variant="outline">{a.kind === "api_key" ? "API key" : a.kind === "oauth" ? "OAuth" : a.kind}</Badge>
      </div>
      {a.broken && <p className="text-xs text-destructive">omp ngừng dùng: {a.broken}</p>}
      {a.limits.length === 0 ? (
        <p className="text-xs text-muted-foreground">Chưa có số hạn mức: provider này không báo usage, hoặc omp chưa dùng tài khoản.</p>
      ) : (
        <ul className="space-y-2">
          {a.limits.map((l) => (
            <LimitRow key={l.id} l={l} now={now} />
          ))}
        </ul>
      )}
      {readAt != null && (
        <p className={cn("text-[11px]", now - readAt > STALE_MS ? "text-st-needs" : "text-muted-foreground")}>
          Đọc lúc {dayTime(readAt)} ({ago((now - readAt) / 1000)} trước)
        </p>
      )}
    </article>
  );
}

function LimitRow({ l, now }: { l: OmpLimit; now: number }) {
  const past = l.resets_at != null && l.resets_at <= now;
  const pct = l.used_fraction == null ? null : past ? 0 : Math.min(100, Math.max(0, Math.round(l.used_fraction * 100)));
  const lv = level(pct);
  const name = l.window && !l.label.includes(l.window) ? `${l.label} · ${l.window}` : l.label;
  return (
    <li className="space-y-1">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="min-w-0 truncate text-muted-foreground" title={name}>
          {name}
        </span>
        <span className={cn("tabular font-medium", text[lv])}>{pct == null ? "?" : `${pct}%`}</span>
      </div>
      <div role="meter" aria-label={`${name} đã dùng`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? 0} className="grid">
        <Bar pct={pct} l={lv} />
      </div>
      <p className="text-[11px] text-muted-foreground">
        {past ? "Đã reset, chờ số mới" : l.resets_at != null ? `Reset ${resetClock(l.resets_at, now)}, còn ${ago((l.resets_at - now) / 1000)}` : "Không rõ giờ reset"}
      </p>
    </li>
  );
}

function KeysSection({ report, error, reload, api, now }: { report: KeysReport | null; error: string | null; reload: () => void; api: Api; now: number }) {
  const [creating, setCreating] = useState(false);
  const [revealed, setRevealed] = useState<{ key: ApiKey; token: string } | null>(null);
  const [revoking, setRevoking] = useState<ApiKey | null>(null);
  // `report` only exists after a client fetch, so `window` is there whenever `base` is used.
  const base = report ? (report.public_host ? `https://${report.public_host}${report.base_path}` : `${window.location.origin}${report.base_path}`) : "";
  const stats = useMemo(() => new Map((report?.stats ?? []).map((s) => [s.key_id, s])), [report]);

  const revoke = async (k: ApiKey) => {
    try {
      await api(`/api/omp/keys/${k.id}`, { method: "DELETE" });
      toast.success(`Đã thu hồi key "${k.label}"`);
      setRevoking(null);
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <section aria-labelledby="omp-keys-h" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 id="omp-keys-h" className="text-sm font-semibold">
          API key cho thành viên
        </h2>
        <Button size="sm" onClick={() => setCreating(true)} disabled={!report}>
          <PlusIcon /> Tạo key
        </Button>
      </div>
      <p className="max-w-[80ch] text-xs text-pretty text-muted-foreground">
        Thành viên gọi model (OpenAI-compatible) qua HQ bằng key riêng, kèm header <code className="font-mono">X-8sync-Root</code> là thư mục gốc dự án. Mỗi lượt gọi từ máy khác được
        ghi lại: dự án, yêu cầu (tóm tắt 200 ký tự), model, kết quả, token. Lượt gọi từ chính máy này không ghi. Không bao giờ cấp model Claude.
      </p>
      {error && !report && <ErrorNote what="API key" error={error} onRetry={reload} />}
      {report && (
        <div className="space-y-1 rounded-lg border px-3 py-2 text-xs">
          <p className="flex flex-wrap items-center gap-2">
            <span className={cn("size-2 rounded-full", report.gateway.state === "up" ? "bg-st-running" : "bg-destructive")} aria-hidden />
            {report.gateway.state === "up" ? "Gateway omp đang chạy" : "Gateway omp chưa chạy: chạy `omp auth-gateway serve` trên máy này để tạo key và nhận lượt gọi."}
          </p>
          <p className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground">Base URL</span>
            <code className="font-mono break-all">{base}</code>
            <CopyButton value={base} label="Chép base URL" />
          </p>
          {!report.public_host && <p className="text-muted-foreground">Thành viên ở máy khác cần link công khai: chạy `8sync hq ui --public`, base URL sẽ đổi theo.</p>}
        </div>
      )}
      {report && report.keys.length === 0 && (
        <EmptyState icon={<KeyRoundIcon />} title="Chưa có key nào" className="py-6">
          Tạo một key cho mỗi thành viên để biết ai gọi gì, cho dự án nào.
        </EmptyState>
      )}
      {report && report.keys.length > 0 && (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[640px] text-left text-xs">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Key</th>
                <th className="px-3 py-2 font-medium">Model</th>
                <th className="px-3 py-2 text-right font-medium">Lượt gọi 7 ngày</th>
                <th className="px-3 py-2 text-right font-medium">Dự án</th>
                <th className="px-3 py-2 text-right font-medium">Token in / out</th>
                <th className="px-3 py-2 font-medium">Lần cuối</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {report.keys.map((k) => {
                const s = stats.get(k.id);
                return (
                  <tr key={k.id} className="border-t">
                    <td className="px-3 py-2">
                      <p className="font-medium">{k.label}</p>
                      <p className="font-mono text-muted-foreground">{k.prefix}…</p>
                    </td>
                    <td className="px-3 py-2" title={k.models.join("\n")}>
                      {k.models.length === 1 ? k.models[0] : `${k.models.length} model`}
                    </td>
                    <td className="px-3 py-2 text-right tabular">
                      {s ? num(s.calls) : 0}
                      {s && s.ok < s.calls && <span className="text-destructive"> · {num(s.calls - s.ok)} lỗi</span>}
                    </td>
                    <td className="px-3 py-2 text-right tabular">{s?.projects ?? 0}</td>
                    <td className="px-3 py-2 text-right tabular">{s ? `${num(s.input_tokens)} / ${num(s.output_tokens)}` : "0 / 0"}</td>
                    <td className="px-3 py-2 text-muted-foreground">{k.last_used_at ? `${ago((now - k.last_used_at) / 1000)} trước` : "chưa dùng"}</td>
                    <td className="px-3 py-2 text-right">
                      <Button size="xs" variant="destructive" onClick={() => setRevoking(k)} aria-label={`Thu hồi key ${k.label}`}>
                        <Trash2Icon /> Thu hồi
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {creating && (
        <CreateKeyDialog
          api={api}
          onClose={() => setCreating(false)}
          onCreated={(r) => {
            setCreating(false);
            setRevealed(r);
            reload();
          }}
        />
      )}
      {revealed && <RevealDialog apiKey={revealed.key} token={revealed.token} base={base} onClose={() => setRevealed(null)} />}
      <Dialog open={revoking !== null} onOpenChange={(o) => !o && setRevoking(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Thu hồi key “{revoking?.label}”?</DialogTitle>
            <DialogDescription>Lượt gọi kế tiếp bằng key này bị từ chối ngay (401). Nhật ký các lượt đã gọi vẫn giữ.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevoking(null)}>
              Huỷ
            </Button>
            <Button variant="destructive" onClick={() => revoking && void revoke(revoking)}>
              Thu hồi
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function CreateKeyDialog({ api, onClose, onCreated }: { api: Api; onClose: () => void; onCreated: (r: { key: ApiKey; token: string }) => void }) {
  const [models, setModels] = useState<string[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ models: string[] }>("/api/omp/keys/models")
      .then((r) => setModels(r.models))
      .catch((e: Error) => setLoadError(e.message));
  }, [api]);

  const toggle = (m: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(m)) n.delete(m);
      else n.add(m);
      return n;
    });

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      onCreated(await api<{ key: ApiKey; token: string }>("/api/omp/keys", { method: "POST", body: { label: label.trim(), models: [...picked] } }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Tạo API key</DialogTitle>
          <DialogDescription>Mỗi thành viên một key. Key chỉ hiện một lần sau khi tạo.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="key-label">Tên (ai dùng key này)</Label>
          <Input id="key-label" value={label} maxLength={40} onChange={(e) => setLabel(e.target.value)} placeholder="vd: Minh - frontend" autoFocus />
        </div>
        <fieldset className="space-y-1.5">
          <div className="flex items-center justify-between">
            <legend className="text-sm font-medium">Model được gọi</legend>
            {models && models.length > 0 && (
              <Button size="xs" variant="ghost" onClick={() => setPicked(picked.size === models.length ? new Set() : new Set(models))}>
                {picked.size === models.length ? "Bỏ hết" : "Chọn hết"}
              </Button>
            )}
          </div>
          {loadError && <p className="text-xs text-destructive">{loadError}</p>}
          {!models && !loadError && <p className="text-xs text-muted-foreground">Đang hỏi gateway omp…</p>}
          {models?.length === 0 && <p className="text-xs text-st-needs">Gateway omp chưa chạy hoặc không có model nào cấp được (Claude không bao giờ được cấp).</p>}
          {models && models.length > 0 && (
            <div className="max-h-56 space-y-0.5 overflow-y-auto rounded-md border p-2">
              {models.map((m) => (
                <label key={m} className="flex min-h-8 cursor-pointer items-center gap-2 rounded px-1 text-xs hover:bg-muted">
                  <input type="checkbox" className="size-4 accent-primary" checked={picked.has(m)} onChange={() => toggle(m)} />
                  <span className="font-mono">{m}</span>
                </label>
              ))}
            </div>
          )}
        </fieldset>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Huỷ
          </Button>
          <Button onClick={() => void submit()} disabled={busy || !label.trim() || picked.size === 0}>
            {busy ? "Đang tạo…" : "Tạo key"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RevealDialog({ apiKey: k, token, base, onClose }: { apiKey: ApiKey; token: string; base: string; onClose: () => void }) {
  const snippet = [
    `curl ${base}/chat/completions \\`,
    `  -H "Authorization: Bearer ${token}" \\`,
    `  -H "X-8sync-Root: D:/work/ten-du-an" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '{"model":"${k.models[0] ?? ""}","messages":[{"role":"user","content":"Xin chào"}]}'`,
  ].join("\n");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Key “{k.label}” đã tạo</DialogTitle>
          <DialogDescription>Chép ngay: HQ chỉ giữ mã băm, đóng hộp này là không xem lại được. Gửi riêng cho thành viên.</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-2 py-1.5">
          <code className="min-w-0 flex-1 font-mono text-xs break-all">{token}</code>
          <CopyButton value={token} label="Chép key" />
        </div>
        <div className="min-w-0 space-y-1">
          <p className="text-xs text-muted-foreground">
            Cách gọi (OpenAI-compatible; công cụ nào cho đặt base URL và header là dùng được). <code className="font-mono">X-8sync-Root</code> là bắt buộc: thư mục gốc dự án đang làm.
          </p>
          <div className="relative">
            <pre className="overflow-x-auto rounded-md border bg-muted/40 p-2 pr-10 font-mono text-[11px]">{snippet}</pre>
            <div className="absolute top-1 right-1">
              <CopyButton value={snippet} label="Chép lệnh mẫu" />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Đã chép, đóng</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CallsSection({ calls }: { calls: CallView[] }) {
  return (
    <section aria-labelledby="omp-calls-h" className="space-y-3">
      <h2 id="omp-calls-h" className="text-sm font-semibold">
        Lượt gọi của thành viên <span className="font-normal text-muted-foreground">· 100 lượt gần nhất, giữ 90 ngày</span>
      </h2>
      {calls.length === 0 ? (
        <p className="rounded-lg border px-3 py-3 text-sm text-muted-foreground">Chưa có lượt gọi nào bằng API key từ máy khác.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[860px] text-left text-xs">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Lúc</th>
                <th className="px-3 py-2 font-medium">Key</th>
                <th className="px-3 py-2 font-medium">Dự án</th>
                <th className="px-3 py-2 font-medium">Yêu cầu</th>
                <th className="px-3 py-2 font-medium">Model</th>
                <th className="px-3 py-2 text-right font-medium">Kết quả</th>
                <th className="px-3 py-2 text-right font-medium">Token in / out</th>
                <th className="px-3 py-2 text-right font-medium">Thời gian</th>
              </tr>
            </thead>
            <tbody>
              {calls.map((c) => {
                const ok = c.status >= 200 && c.status < 300;
                return (
                  <tr key={c.id} className="border-t align-top">
                    <td className="px-3 py-2 whitespace-nowrap tabular">{dayTime(c.at)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{c.label}</td>
                    <td className="px-3 py-2" title={c.root}>
                      <p className="font-medium">{c.project}</p>
                      <p className="max-w-[16rem] truncate font-mono text-[11px] text-muted-foreground">{c.root}</p>
                    </td>
                    <td className="max-w-[22rem] px-3 py-2 text-pretty">{c.summary ?? <span className="text-muted-foreground">{c.route}</span>}</td>
                    <td className="px-3 py-2 font-mono text-[11px]">{c.model ?? "—"}</td>
                    <td className={cn("px-3 py-2 text-right tabular", ok ? "text-foreground" : "text-destructive")}>{c.status}</td>
                    <td className="px-3 py-2 text-right tabular">{c.input_tokens == null && c.output_tokens == null ? "—" : `${num(c.input_tokens ?? 0)} / ${num(c.output_tokens ?? 0)}`}</td>
                    <td className="px-3 py-2 text-right tabular">{c.ms < 1000 ? `${c.ms} ms` : `${(c.ms / 1000).toFixed(1)} s`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
