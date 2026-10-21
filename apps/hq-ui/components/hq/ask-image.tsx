"use client";

import { ImageOffIcon, PlusIcon, XIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { toBase64 } from "@/lib/attach";
import { fileName, rootKey, type PreviewItem } from "@/lib/preview";
import { askText, containRect, imageRoom, pinPx, pinRadius, pointToPin, roomGroups, suggestion, type Pin, type Size } from "@/lib/room-send";
import type { ProjectBoard } from "@/lib/server/board";
import { RoomSend, type Upload } from "./room-send";
import type { Api } from "./use-hq";
import type { Room } from "./use-office";
import { previewFileUrl, useAuthedImage } from "./use-poll";

const PINS_MAX = 20;
/** A pointer that moved more than this between down and up was a pan or scroll, not a pin. */
const TAP_SLOP_PX = 8;
const UPLOAD_MAX = 10 * 1024 * 1024;

/** The numbered marker color on the exported PNG and on screen: reads on light and dark screenshots. */
const PIN_FILL = "#e11d48";

/**
 * Preview "Hỏi về ảnh này": pins on the image (tap / click, or keyboard: add one in the middle,
 * arrows move it, Delete removes it), a note per pin, and the shared composer. On send the pins are
 * drawn onto a full-size copy of the image (PNG) that goes with the message as an attachment.
 */
export function AskImage({ item, path, token, api, rooms, boards, onDone }: { item: PreviewItem; path: string; token: string; api: Api; rooms: Room[]; boards: ProjectBoard[] | null; onDone: () => void }) {
  const [pins, setPins] = useState<Pin[]>([]);
  const [nat, setNat] = useState<Size | null>(null);
  const notes = useRef<(HTMLInputElement | null)[]>([]);
  const markers = useRef<(HTMLButtonElement | null)[]>([]);
  /** A marker added from the keyboard takes focus once it is on screen (after the next render). */
  const focusMarker = useRef<number | null>(null);

  // The room that saved the shot (card holder, worktree, lane), else the project's lead.
  const { preferRoom, preferRoot } = useMemo(() => {
    const g = roomGroups(rooms).find((x) => rootKey(x.root) === rootKey(item.root));
    return { preferRoom: imageRoom(item, rooms, boards ?? [])?.key ?? (g ? suggestion(g.rooms)?.room : null) ?? null, preferRoot: g?.root ?? null };
  }, [item, rooms, boards]);

  useEffect(() => {
    if (focusMarker.current == null) return;
    const el = markers.current[focusMarker.current];
    if (!el) return;
    el.focus();
    focusMarker.current = null;
  });

  function add(p: { fx: number; fy: number }) {
    if (pins.length >= PINS_MAX) {
      toast.warning(`Tối đa ${PINS_MAX} ghim mỗi ảnh`);
      return;
    }
    setPins((xs) => [...xs, { ...p, note: "" }]);
  }

  function remove(n: number) {
    setPins((xs) => xs.filter((_, i) => i !== n));
  }

  async function prepare(question: string): Promise<{ text: string; files: Upload[] }> {
    if (pins.length === 0 || !nat) return { text: askText({ path, pins, img: nat, question }), files: [] };
    const up = await uploadMarked(api, token, item, pins);
    return { text: askText({ path, pins, img: up.size, question }), files: [up.file] };
  }

  return (
    <div className="grid gap-3 lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_24rem]">
      <PinSurface
        item={item}
        token={token}
        pins={pins}
        nat={nat}
        onNat={setNat}
        onAdd={add}
        onMove={(n, p) => setPins((xs) => xs.map((x, i) => (i === n ? { ...x, ...p } : x)))}
        onRemove={remove}
        onPick={(n) => notes.current[n]?.focus()}
        markers={markers}
      />
      <div className="min-w-0 space-y-3 lg:min-h-0 lg:overflow-y-auto lg:pr-1">
        <section aria-labelledby="ask-pins-title" className="space-y-1.5">
          <div className="flex items-center gap-2">
            <h3 id="ask-pins-title" className="text-xs font-medium">
              Ghim trên ảnh{pins.length ? ` (${pins.length})` : ""}
            </h3>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="ml-auto h-7 text-xs max-sm:h-11"
              disabled={!nat || pins.length >= PINS_MAX}
              onClick={() => {
                focusMarker.current = pins.length;
                add({ fx: 0.5, fy: 0.5 });
              }}
            >
              <PlusIcon /> Thêm ghim giữa ảnh
            </Button>
          </div>
          {pins.length === 0 ? (
            <p className="text-xs text-muted-foreground">Chạm hoặc bấm vào ảnh để ghim chỗ cần hỏi, ghim nhiều chỗ cũng được. Bàn phím: thêm ghim giữa ảnh, rồi dùng mũi tên để dời.</p>
          ) : (
            <ol className="space-y-1.5">
              {pins.map((p, n) => (
                <li key={n} className="flex items-center gap-1.5">
                  <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold text-white tabular" style={{ background: PIN_FILL }}>
                    {n + 1}
                  </span>
                  <label htmlFor={`ask-pin-${n}`} className="sr-only">
                    Ghi chú ghim {n + 1}
                  </label>
                  <Input
                    id={`ask-pin-${n}`}
                    ref={(el) => {
                      notes.current[n] = el;
                    }}
                    value={p.note}
                    maxLength={140}
                    onChange={(e) => setPins((xs) => xs.map((x, i) => (i === n ? { ...x, note: e.target.value } : x)))}
                    placeholder={`Ghi chú ghim ${n + 1} (không bắt buộc)`}
                    className="h-8 min-w-0 flex-1 text-xs max-sm:h-11"
                  />
                  <Button type="button" size="icon-sm" variant="ghost" className="shrink-0 max-sm:size-11" aria-label={`Bỏ ghim ${n + 1}`} onClick={() => remove(n)}>
                    <XIcon />
                  </Button>
                </li>
              ))}
            </ol>
          )}
        </section>
        <RoomSend
          key={item.id}
          api={api}
          token={token}
          rooms={rooms}
          id="ask-image"
          preferRoom={preferRoom}
          preferRoot={preferRoot}
          placeholder="Câu hỏi về ảnh, vd: nút này lệch so với thiết kế? (Ctrl+Enter để gửi)"
          prepare={prepare}
          allowEmpty={pins.length > 0}
          reserve={pins.length > 0 ? 1 : 0}
          onSent={() => {
            setPins([]);
            onDone();
          }}
        />
      </div>
    </div>
  );
}

/** The image with its pins; a tap or click on the picture (not the letterbox) drops the next pin. */
function PinSurface({
  item,
  token,
  pins,
  nat,
  onNat,
  onAdd,
  onMove,
  onRemove,
  onPick,
  markers,
}: {
  item: PreviewItem;
  token: string;
  pins: Pin[];
  nat: Size | null;
  onNat: (s: Size) => void;
  onAdd: (p: { fx: number; fy: number }) => void;
  onMove: (n: number, p: { fx: number; fy: number }) => void;
  onRemove: (n: number) => void;
  onPick: (n: number) => void;
  markers: { current: (HTMLButtonElement | null)[] };
}) {
  const { src, failed } = useAuthedImage(token, previewFileUrl(item.id), true);
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size | null>(null);
  const down = useRef<{ x: number; y: number; id: number } | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  function onDown(e: PointerEvent<HTMLDivElement>) {
    if (!e.isPrimary || e.button > 0) return;
    down.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
  }

  function onUp(e: PointerEvent<HTMLDivElement>) {
    const d = down.current;
    down.current = null;
    if (!d || d.id !== e.pointerId || !nat || !box.current) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > TAP_SLOP_PX) return;
    const r = box.current.getBoundingClientRect();
    const p = pointToPin({ x: e.clientX - r.left, y: e.clientY - r.top }, { w: r.width, h: r.height }, nat);
    if (p) onAdd(p);
  }

  function onMarkerKey(e: KeyboardEvent<HTMLButtonElement>, n: number) {
    const step = e.shiftKey ? 0.05 : 0.01;
    const d: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      onRemove(n);
      return;
    }
    const m = d[e.key];
    if (!m) return;
    e.preventDefault();
    e.stopPropagation();
    const clamp = (v: number) => Math.min(1, Math.max(0, v));
    onMove(n, { fx: clamp(pins[n].fx + m[0]), fy: clamp(pins[n].fy + m[1]) });
  }

  const rect = size && nat ? containRect(size, nat) : null;

  return (
    <div
      ref={box}
      onPointerDown={onDown}
      onPointerUp={onUp}
      onPointerCancel={() => (down.current = null)}
      /* Below lg the box takes the image's own shape (little letterbox to miss), capped at half the screen. */
      style={nat ? { aspectRatio: `${nat.w} / ${nat.h}` } : undefined}
      className="relative max-h-[50dvh] min-h-48 w-full cursor-crosshair touch-manipulation overflow-hidden rounded-lg bg-muted select-none lg:h-[min(72dvh,900px)] lg:max-h-none"
    >
      {src ? (
        // An object URL from an authed fetch: next/image cannot load it, a plain img is right here.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={`${fileName(item.rel)}: chạm để ghim`}
          className="absolute inset-0 size-full object-contain"
          draggable={false}
          onLoad={(e) => onNat({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
        />
      ) : failed ? (
        <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-xs text-muted-foreground">
          <ImageOffIcon aria-hidden className="size-4" />
          Không mở được ảnh
        </span>
      ) : (
        <Skeleton className="absolute inset-0 rounded-none" />
      )}
      {rect &&
        pins.map((p, n) => (
          <button
            key={n}
            type="button"
            ref={(el) => {
              markers.current[n] = el;
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onPointerUp={(e) => e.stopPropagation()}
            onClick={() => onPick(n)}
            onKeyDown={(e) => onMarkerKey(e, n)}
            aria-label={`Ghim ${n + 1}${p.note.trim() ? `: ${p.note.trim()}` : ""}. Mũi tên để dời, Delete để bỏ`}
            style={{ left: rect.x + p.fx * rect.w, top: rect.y + p.fy * rect.h, background: PIN_FILL }}
            className="absolute grid size-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full text-xs font-semibold text-white tabular ring-2 ring-white outline-none transition-[left,top] duration-150 focus-visible:ring-4 focus-visible:ring-ring motion-reduce:transition-none max-sm:size-9"
          >
            {n + 1}
          </button>
        ))}
    </div>
  );
}

/**
 * The image at its natural size with the numbered pins drawn on it, uploaded as one attachment.
 * PNG; a shot whose PNG passes the 10 MB upload cap goes as JPEG instead.
 */
async function uploadMarked(api: Api, token: string, item: PreviewItem, pins: Pin[]): Promise<{ file: Upload; size: Size }> {
  const res = await fetch(`/api/preview/file?id=${encodeURIComponent(item.id)}`, { headers: { "x-hq-token": token }, cache: "no-store" });
  if (!res.ok) throw new Error(`không tải được ảnh gốc (HTTP ${res.status})`);
  const bmp = await createImageBitmap(await res.blob());
  const size = { w: bmp.width, h: bmp.height };
  const canvas = document.createElement("canvas");
  canvas.width = size.w;
  canvas.height = size.h;
  const g = canvas.getContext("2d");
  if (!g) throw new Error("trình duyệt không vẽ được ảnh");
  g.drawImage(bmp, 0, 0);
  bmp.close();
  const r = pinRadius(size);
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = `600 ${Math.round(r * 1.1)}px system-ui, sans-serif`;
  pins.forEach((p, i) => {
    const { x, y } = pinPx(p, size);
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fillStyle = PIN_FILL;
    g.fill();
    g.lineWidth = Math.max(2, r * 0.18);
    g.strokeStyle = "#fff";
    g.stroke();
    g.fillStyle = "#fff";
    g.fillText(String(i + 1), x, y + r * 0.05);
  });
  const blob = (type: string, q?: number) => new Promise<Blob | null>((ok) => canvas.toBlob(ok, type, q));
  let out = await blob("image/png");
  let ext = "png";
  if (!out || out.size > UPLOAD_MAX) {
    out = await blob("image/jpeg", 0.9);
    ext = "jpg";
  }
  if (!out) throw new Error("không xuất được ảnh đã ghim");
  const base = fileName(item.rel).replace(/\.[^.]+$/, "");
  const file = await api<Upload>("/api/uploads", { method: "POST", body: { name: `ghim-${base}.${ext}`, data: await toBase64(out) } });
  return { file, size };
}
