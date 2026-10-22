"use client";
// Văn phòng 3D (owner 2026-10-22: "ui ux … 3d nhanh nhẹ đẹp"): a WebGL office in the current HQ, one
// floor per project, one desk + avatar per room coloured by its state. three.js loads only when the
// tab opens (dynamic import); no shadows, no post-processing; the loop runs only while the tab is
// visible and stops under prefers-reduced-motion once the scene is still. The footer shows the
// measured cost (draw calls, frame time) so "nhanh nhẹ" is a number, not a claim.
import { BoxIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { NOW_LABEL, roster, type NowState } from "@/lib/now";
import { cameraDistance, layoutOffice, STATE_COLOR, type Desk, type GroupIn } from "@/lib/office-3d";
import { groupByRepo } from "@/lib/sidebar";
import { cn } from "@/lib/utils";
import { EmptyState } from "./bits";
import type { BoardsState } from "./use-board";
import type { Room } from "./use-office";

type Three = typeof import("three");

type Hover = { key: string; label: string; state: NowState; project: string; x: number; y: number } | null;
type Stats = { calls: number; ms: number; rooms: number };

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
      rooms: g.rooms.map((r) => ({ key: r.key, label: r.label, state: rows.get(r.key)?.state ?? "idle", role: rows.get(r.key)?.role ?? null })),
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
          setHover(a ? { key: a.desk.key, label: a.desk.label, state: a.desk.state, project: l.floors.find((f) => f.root === a.desk.root)?.name ?? "", x: e.clientX - r.left, y: e.clientY - r.top } : null);
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
          </div>
        )}
      </div>
      <p className="shrink-0 border-t px-4 py-1.5 text-[11px] text-muted-foreground tabular sm:px-6">
        {stats ? `${stats.rooms} phòng · ${stats.calls} draw call · ${stats.ms.toFixed(1)} ms/khung (GPU thấp, không bóng)` : "Đang dựng cảnh…"} · bấm một người để mở phòng
      </p>
    </div>
  );
}
