"use client";
// Văn phòng 3D (owner 2026-10-22: "ui ux … 3d nhanh nhẹ đẹp"): a WebGL office in the current HQ, one
// floor per project, one desk + avatar per room coloured by its state. three.js loads only when the
// tab opens (dynamic import); no shadows, no post-processing; the loop runs only while the tab is
// visible and stops under prefers-reduced-motion once the scene is still. The footer shows the
// measured cost (draw calls, frame time) so "nhanh nhẹ" is a number, not a claim.
import { BoxIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { NOW_LABEL, roster, type NowState } from "@/lib/now";
import { cameraDistance, deskSign, flightPoint, handoffs, holders, layoutOffice, STATE_COLOR, type Desk, type GroupIn, type Handoff } from "@/lib/office-3d";
import { groupByRepo } from "@/lib/sidebar";
import { cn } from "@/lib/utils";
import { EmptyState } from "./bits";
import type { BoardsState } from "./use-board";
import type { Room } from "./use-office";

type Three = typeof import("three");

type Hover = { key: string; label: string; state: NowState; project: string; card: string | null; x: number; y: number } | null;
type Stats = { calls: number; ms: number; rooms: number };

/** A 2-line text sprite (canvas texture): 256×96 px, always faces the camera, no font loading. */
function makeSign(T: Three, lines: [string, string], dark: boolean, loud: boolean) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 96;
  const g = canvas.getContext("2d")!;
  g.fillStyle = dark ? "rgba(20,24,28,0.85)" : "rgba(255,255,255,0.9)";
  g.beginPath();
  g.roundRect(4, 4, 248, 88, 12);
  g.fill();
  g.textAlign = "center";
  g.fillStyle = dark ? "#e8eaed" : "#1b1f24";
  g.font = "600 30px system-ui, sans-serif";
  g.fillText(lines[0].slice(0, 16), 128, 42);
  g.fillStyle = loud ? "#d9822b" : dark ? "#aab0b8" : "#5c6470";
  g.font = "500 24px system-ui, sans-serif";
  g.fillText(lines[1].slice(0, 20), 128, 76);
  const tex = new T.CanvasTexture(canvas);
  tex.colorSpace = T.SRGBColorSpace;
  const mat = new T.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sprite = new T.Sprite(mat);
  sprite.scale.set(1.6, 0.6, 1);
  return sprite;
}

export function Office3D({ rooms, boards, now, repo, active, onOpen }: { rooms: Room[]; boards: BoardsState; now: number; repo: string | null; active: boolean; onOpen: (room: Room) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<Hover>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  // Rooms → floors and desks (the same grouping and states the office and overview use).
  const groups: GroupIn[] = useMemo(() => {
    const live = rooms.filter((r) => r.status !== "ended" && (!repo || (r.project && r.project.root.toLowerCase() === repo.toLowerCase())));
    const rows = new Map(roster(live, boards.boards ?? [], now).map((r) => [r.key, r]));
    return groupByRepo(live).map((g) => ({
      project: { root: g.project.root, name: g.project.name },
      rooms: g.rooms.map((r) => {
        const row = rows.get(r.key);
        const c = row?.card;
        return { key: r.key, label: r.label, state: row?.state ?? "idle", role: row?.role ?? null, card: c ? { id: c.id, lane: c.lane, text: c.text } : null };
      }),
    }));
  }, [rooms, boards.boards, now, repo]);
  const layout = useMemo(() => layoutOffice(groups), [groups]);
  // The scene reads the newest layout, rooms and handler through refs (updated in effects, never in render).
  const layoutRef = useRef(layout);
  const roomsRef = useRef(rooms);
  const openRef = useRef(onOpen);
  useEffect(() => {
    layoutRef.current = layout;
    roomsRef.current = rooms;
    openRef.current = onOpen;
  }, [layout, rooms, onOpen]);

  useEffect(() => {
    const el = host.current;
    if (!active || !el) return;
    let stop = false;
    let cleanup = () => {};
    (async () => {
      let T: Three;
      try {
        T = await import("three");
      } catch (e) {
        setFailed(e instanceof Error ? e.message : "three");
        return;
      }
      if (stop) return;
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const dark = document.documentElement.classList.contains("dark");
      const renderer = new T.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      el.appendChild(renderer.domElement);
      const scene = new T.Scene();
      const camera = new T.PerspectiveCamera(40, 1, 0.1, 200);
      scene.add(new T.HemisphereLight(0xffffff, dark ? 0x1b1f24 : 0xcfd6dd, dark ? 1.4 : 1.8));
      const sun = new T.DirectionalLight(0xffffff, dark ? 1.2 : 1.6);
      sun.position.set(6, 12, 8);
      scene.add(sun);

      const floorMat = new T.MeshStandardMaterial({ color: dark ? 0x2a2f36 : 0xe9ecef, roughness: 0.95 });
      const deskMat = new T.MeshStandardMaterial({ color: dark ? 0x4b4034 : 0xb08968, roughness: 0.8 });
      const deskGeo = new T.BoxGeometry(1.3, 0.12, 0.8);
      const legGeo = new T.BoxGeometry(1.2, 0.5, 0.7);
      const bodyGeo = new T.CapsuleGeometry(0.22, 0.4, 4, 10);
      const headGeo = new T.SphereGeometry(0.19, 12, 10);
      const matByState = new Map<NowState, InstanceType<Three["MeshStandardMaterial"]>>();
      const mat = (s: NowState) => {
        let m = matByState.get(s);
        if (!m) {
          m = new T.MeshStandardMaterial({ color: STATE_COLOR[s], roughness: 0.6, emissive: STATE_COLOR[s], emissiveIntensity: s === "needs" ? 0.35 : 0.08 });
          matByState.set(s, m);
        }
        return m;
      };

      const office = new T.Group();
      scene.add(office);
      const avatars: { mesh: InstanceType<Three["Group"]>; desk: Desk }[] = [];
      const labels = new T.Group();
      scene.add(labels);
      // Cards changing hands (owner 2026-10-22: "realistic working day"): a small card flies from the
      // desk that handed it over to the one that took it, 1.2 s, then disappears. Not under reduced motion.
      const FLIGHT_MS = 1200;
      const cardGeo = new T.BoxGeometry(0.42, 0.04, 0.3);
      const cardMat = new T.MeshStandardMaterial({ color: 0xf5f1e8, emissive: 0x85d840, emissiveIntensity: 0.35, roughness: 0.5 });
      const flights: { h: Handoff; mesh: InstanceType<Three["Mesh"]>; at: number }[] = [];
      let held: Map<number, string> | null = null;

      function build() {
        office.clear();
        avatars.length = 0;
        const l = layoutRef.current;
        for (const f of l.floors) {
          const plate = new T.Mesh(new T.BoxGeometry(f.w, 0.2, f.d), floorMat);
          plate.position.set(f.x, -0.1, f.z);
          office.add(plate);
        }
        for (const d of l.desks) {
          const top = new T.Mesh(deskGeo, deskMat);
          top.position.set(d.x, 0.56, d.z);
          const legs = new T.Mesh(legGeo, deskMat);
          legs.position.set(d.x, 0.25, d.z);
          office.add(top, legs);
          const a = new T.Group();
          const body = new T.Mesh(bodyGeo, mat(d.state));
          body.position.y = 0.45;
          const head = new T.Mesh(headGeo, mat(d.state));
          head.position.y = 0.95;
          a.add(body, head);
          a.position.set(d.x, 0, d.z + 0.75);
          a.userData.key = d.key;
          office.add(a);
          avatars.push({ mesh: a, desk: d });
          // The desk sign: room name and its card (owner 2026-10-22: a realistic working day, not just colours).
          const sign = makeSign(T, deskSign(d), dark, d.state === "needs");
          sign.position.set(d.x, 1.35, d.z);
          office.add(sign);
        }
        const dist = cameraDistance(l);
        camera.position.set(dist * 0.55, dist * 0.75, dist * 0.8);
        camera.lookAt(0, 0, 0);
      }

      const ray = new T.Raycaster();
      const ptr = new T.Vector2();
      let hovered: string | null = null;
      const onMove = (e: PointerEvent) => {
        const r = renderer.domElement.getBoundingClientRect();
        ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
        ray.setFromCamera(ptr, camera);
        const hit = ray.intersectObjects(avatars.map((a) => a.mesh), true)[0];
        const key = hit ? (hit.object.parent?.userData.key as string | undefined) ?? null : null;
        if (key !== hovered) {
          hovered = key;
          renderer.domElement.style.cursor = key ? "pointer" : "";
          const a = avatars.find((x) => x.desk.key === key);
          const l = layoutRef.current;
          setHover(a ? { key: a.desk.key, label: a.desk.label, state: a.desk.state, project: l.floors.find((f) => f.root === a.desk.root)?.name ?? "", card: a.desk.card ? `#${a.desk.card.id} ${a.desk.card.text}` : null, x: e.clientX - r.left, y: e.clientY - r.top } : null);
        } else if (key) {
          setHover((h) => (h ? { ...h, x: e.clientX - r.left, y: e.clientY - r.top } : h));
        }
      };
      const onClick = () => {
        if (!hovered) return;
        const room = roomsRef.current.find((r) => r.key === hovered);
        if (room) openRef.current(room);
      };
      renderer.domElement.addEventListener("pointermove", onMove);
      renderer.domElement.addEventListener("pointerleave", () => { hovered = null; setHover(null); });
      renderer.domElement.addEventListener("click", onClick);

      const resize = () => {
        const w = el.clientWidth;
        const h = el.clientHeight;
        if (!w || !h) return;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      };
      const ro = new ResizeObserver(resize);
      ro.observe(el);
      resize();
      build();
      held = holders(layoutRef.current.desks);

      let lastLayout = layoutRef.current;
      let frames = 0;
      let acc = 0;
      let last = performance.now();
      let raf = 0;
      const tick = (t: number) => {
        if (stop) return;
        if (layoutRef.current !== lastLayout) {
          lastLayout = layoutRef.current;
          build();
          if (!reduced) {
            for (const h of handoffs(held, lastLayout.desks)) {
              const mesh = new T.Mesh(cardGeo, cardMat);
              scene.add(mesh);
              flights.push({ h, mesh, at: t });
            }
          }
          held = holders(lastLayout.desks);
        }
        for (let i = flights.length - 1; i >= 0; i--) {
          const f = flights[i];
          const p = (t - f.at) / FLIGHT_MS;
          if (p >= 1) {
            scene.remove(f.mesh);
            flights.splice(i, 1);
            continue;
          }
          const q = flightPoint(f.h, p);
          f.mesh.position.set(q.x, q.y, q.z);
          f.mesh.rotation.y = p * Math.PI * 2;
        }
        const dt = t - last;
        last = t;
        if (!reduced) {
          // Rooms waiting on the owner breathe; working rooms nod a little. Cheap: two transforms per avatar.
          for (const { mesh, desk } of avatars) {
            if (desk.state === "needs") mesh.scale.setScalar(1 + 0.06 * Math.sin(t / 350));
            else if (desk.state === "working") mesh.rotation.y = 0.15 * Math.sin(t / 900);
          }
        }
        const t0 = performance.now();
        renderer.render(scene, camera);
        acc += performance.now() - t0;
        frames++;
        if (frames >= 30) {
          setStats({ calls: renderer.info.render.calls, ms: acc / frames, rooms: avatars.length });
          frames = 0;
          acc = 0;
        }
        void dt;
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);

      cleanup = () => {
        cancelAnimationFrame(raf);
        ro.disconnect();
        renderer.domElement.removeEventListener("pointermove", onMove);
        renderer.domElement.removeEventListener("click", onClick);
        scene.traverse((o) => {
          const m = o as { geometry?: { dispose: () => void }; material?: { dispose: () => void } };
          m.geometry?.dispose();
          m.material?.dispose();
        });
        renderer.dispose();
        renderer.domElement.remove();
      };
    })();
    return () => {
      stop = true;
      cleanup();
    };
  }, [active]);

  if (failed) {
    return (
      <div className="p-4 sm:px-6">
        <EmptyState icon={<BoxIcon />} title="Không mở được WebGL">
          {failed}. Dùng tab Văn phòng (2D).
        </EmptyState>
      </div>
    );
  }
  if (groups.length === 0) {
    return (
      <div className="p-4 sm:px-6">
        <EmptyState icon={<BoxIcon />} title="Chưa có phòng nào đang chạy">
          Mở team ở tab Văn phòng rồi quay lại.
        </EmptyState>
      </div>
    );
  }
  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div ref={host} className="relative min-h-0 flex-1 overflow-hidden" aria-label="Văn phòng 3D: mỗi dự án một sàn, mỗi phòng một bàn; màu = trạng thái" role="img">
        {hover && (
          <div className="pointer-events-none absolute z-10 rounded-md border bg-background/95 px-2 py-1 text-xs shadow-sm" style={{ left: hover.x + 12, top: hover.y + 12 }}>
            <span className="font-medium">{hover.label}</span>
            <span className="text-muted-foreground"> · {hover.project} · </span>
            <span className={cn(hover.state === "needs" && "text-st-needs", hover.state === "working" && "text-st-running")}>{NOW_LABEL[hover.state]}</span>
            {hover.card && <span className="block max-w-[40ch] truncate text-muted-foreground">{hover.card}</span>}
          </div>
        )}
      </div>
      <p className="shrink-0 border-t px-4 py-1.5 text-[11px] text-muted-foreground tabular sm:px-6">
        {stats ? `${stats.rooms} phòng · ${stats.calls} draw call · ${stats.ms.toFixed(1)} ms/khung (GPU thấp, không bóng)` : "Đang dựng cảnh…"} · bấm một người để mở phòng
      </p>
    </div>
  );
}
