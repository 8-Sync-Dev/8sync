"use client";
// Văn phòng 3D (owner 2026-10-22: "ui ux … 3d nhanh nhẹ đẹp"): a WebGL office in the current HQ, one
// floor per project, one desk + avatar per room coloured by its state. three.js loads only when the
// tab opens (dynamic import); no shadows, no post-processing; the loop runs only while the tab is
// visible and stops under prefers-reduced-motion once the scene is still. The footer shows the
// measured cost (draw calls, frame time) so "nhanh nhẹ" is a number, not a claim.
import { BoxIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { NOW_LABEL, roster, type NowState } from "@/lib/now";
import { cameraDistance, deskSign, flightPoint, handoffs, holders, layoutOffice, shirtOf, STATE_COLOR, type Desk, type GroupIn, type Handoff } from "@/lib/office-3d";
import { groupByRepo } from "@/lib/sidebar";
import { cn } from "@/lib/utils";
import { EmptyState } from "./bits";
import type { BoardsState } from "./use-board";
import type { Room } from "./use-office";

type Three = typeof import("three");

type Hover = { key: string; label: string; state: NowState; project: string; card: string | null; x: number; y: number } | null;
type Stats = { calls: number; ms: number; rooms: number };

/** A 2-line text sprite (canvas texture): 256×96 px, always faces the camera, no font loading. */
function makeSign(T: Three, lines: [string, string], dark: boolean, loud: boolean, dot: number) {
  // Owner 2026-10-22 ("qúa xấu"): a small crisp name tag (2x canvas), a state dot, the card under it.
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const g = canvas.getContext("2d")!;
  g.fillStyle = dark ? "rgba(16,19,23,0.78)" : "rgba(255,255,255,0.88)";
  g.beginPath();
  g.roundRect(8, 8, 496, 112, 56);
  g.fill();
  g.fillStyle = `#${dot.toString(16).padStart(6, "0")}`;
  g.beginPath();
  g.arc(58, 64, 14, 0, Math.PI * 2);
  g.fill();
  g.textAlign = "left";
  g.fillStyle = dark ? "#f1f3f5" : "#14171b";
  g.font = "600 40px system-ui, sans-serif";
  g.fillText(lines[0].slice(0, 18), 92, 58);
  g.fillStyle = loud ? "#e08a2c" : dark ? "#9aa3ad" : "#5c6470";
  g.font = "500 30px system-ui, sans-serif";
  g.fillText(lines[1].slice(0, 26), 92, 98);
  const tex = new T.CanvasTexture(canvas);
  tex.colorSpace = T.SRGBColorSpace;
  tex.anisotropy = 4;
  const mat = new T.SpriteMaterial({ map: tex, transparent: true, depthTest: false, fog: false, toneMapped: false });
  const sprite = new T.Sprite(mat);
  sprite.scale.set(2, 0.5, 1);
  return sprite;
}

/** A warm oak plank floor, drawn once on a canvas (no image asset). */
function woodTexture(T: Three, dark: boolean) {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 512;
  const g = c.getContext("2d")!;
  const base = dark ? [74, 58, 44] : [196, 162, 120];
  for (let i = 0; i < 8; i++) {
    const v = ((i * 37) % 9) - 4;
    g.fillStyle = `rgb(${base[0] + v * 3},${base[1] + v * 2},${base[2] + v * 2})`;
    g.fillRect(0, i * 64, 512, 64);
    g.fillStyle = dark ? "rgba(0,0,0,0.35)" : "rgba(60,40,20,0.25)";
    g.fillRect(0, i * 64, 512, 2);
    g.fillRect(((i * 173) % 448) + 32, i * 64, 2, 64);
    for (let k = 0; k < 14; k++) {
      g.fillStyle = dark ? "rgba(255,255,255,0.025)" : "rgba(90,60,30,0.06)";
      g.fillRect(0, i * 64 + 4 + ((k * 29 + i * 11) % 56), 512, 1);
    }
  }
  const tex = new T.CanvasTexture(c);
  tex.colorSpace = T.SRGBColorSpace;
  tex.wrapS = T.RepeatWrapping;
  tex.wrapT = T.RepeatWrapping;
  return tex;
}

/** A little variety so a floor of people is not one clone. */
const SKINS = [0xe0b18c, 0xc68d65, 0xf1c9a5, 0x9c6b4a];
const HAIRS = [0x2a2019, 0x3b2a1d, 0x111111, 0x5a3a22];

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
      // Owner 2026-10-22: "3d phòng chưa đẹp quá xấu chưa realistic": filmic light, soft shadows,
      // real workstations (desk on legs, monitor, keyboard, chair) and seated people.
      renderer.toneMapping = T.ACESFilmicToneMapping;
      renderer.toneMappingExposure = dark ? 1.3 : 1.15;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = T.PCFSoftShadowMap;
      el.appendChild(renderer.domElement);
      const scene = new T.Scene();
      const bg = dark ? 0x15181d : 0xeceff2;
      scene.background = new T.Color(bg);
      const camera = new T.PerspectiveCamera(38, 1, 0.1, 200);
      scene.add(new T.HemisphereLight(dark ? 0xeef1f6 : 0xffffff, dark ? 0x1d1f22 : 0xd8d2c8, dark ? 1.3 : 1.5));
      const sun = new T.DirectionalLight(dark ? 0xdfe6ff : 0xfff3e0, dark ? 1.6 : 2.2);
      sun.position.set(7, 14, 9);
      sun.castShadow = true;
      sun.shadow.mapSize.set(1024, 1024);
      sun.shadow.bias = -0.0005;
      sun.shadow.radius = 4;
      scene.add(sun, sun.target);

      const std = (color: number, roughness = 0.8, metalness = 0) => new T.MeshStandardMaterial({ color, roughness, metalness });
      const wood = woodTexture(T, dark);
      const floorMat = new T.MeshStandardMaterial({ map: wood, roughness: 0.7 });
      const rugMat = std(dark ? 0x2f3540 : 0xc9d1d8, 1);
      const deskMat = std(dark ? 0xd9d3c7 : 0xf1ece3, 0.45);
      const wallMat = std(dark ? 0x2a2e35 : 0xf4f1ec, 0.95);
      const windowMat = new T.MeshStandardMaterial({ color: dark ? 0x1e2b3a : 0xbfd9ee, emissive: dark ? 0x3b5f86 : 0x9cc7ea, emissiveIntensity: dark ? 0.55 : 0.35, roughness: 0.15 });
      const blobMat = new T.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: dark ? 0.35 : 0.18, depthWrite: false });
      const ringMats = new Map<NowState, InstanceType<Three["MeshBasicMaterial"]>>();
      const ringMat = (s: NowState) => {
        let m = ringMats.get(s);
        if (!m) {
          m = new T.MeshBasicMaterial({ color: STATE_COLOR[s], transparent: true, opacity: s === "idle" || s === "waiting" ? 0.35 : 0.85, depthWrite: false });
          ringMats.set(s, m);
        }
        return m;
      };
      const shirts = new Map<number, InstanceType<Three["MeshStandardMaterial"]>>();
      const solid = (c: number, r = 0.7) => {
        let m = shirts.get(c);
        if (!m) shirts.set(c, (m = std(c, r)));
        return m;
      };
      const metalMat = std(dark ? 0x3a3f46 : 0x5b6168, 0.4, 0.6);
      const plasticMat = std(0x1d2024, 0.5);
      const keyMat = std(dark ? 0x8a9099 : 0xd9dde1, 0.6);
      const chairMat = std(dark ? 0x23272d : 0x2f343b, 0.7);
      const pantsMat = std(dark ? 0x2c3442 : 0x37425a, 0.85);
      const mugMat = std(0xf2efe9, 0.4);
      const potMat = std(dark ? 0x7a5a45 : 0xa8765a, 0.8);
      const leafMat = std(0x4f8a3c, 0.75);
      const box = (w: number, h: number, d: number) => new T.BoxGeometry(w, h, d);
      const deskGeo = box(1.4, 0.05, 0.8);
      const deskLegGeo = box(0.05, 0.72, 0.05);
      const screenGeo = box(0.62, 0.38, 0.03);
      const standGeo = box(0.05, 0.2, 0.05);
      const baseGeo = box(0.22, 0.02, 0.16);
      const kbGeo = box(0.46, 0.02, 0.15);
      const mugGeo = new T.CylinderGeometry(0.04, 0.035, 0.1, 12);
      const seatGeo = box(0.48, 0.07, 0.46);
      const backGeo = box(0.46, 0.5, 0.05);
      const postGeo = new T.CylinderGeometry(0.03, 0.03, 0.4, 8);
      const footGeo = new T.CylinderGeometry(0.26, 0.26, 0.04, 16);
      const torsoGeo = new T.CapsuleGeometry(0.17, 0.3, 8, 20);
      const headGeo = new T.SphereGeometry(0.15, 24, 18);
      const hairGeo = new T.SphereGeometry(0.157, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2);
      const armGeo = new T.CapsuleGeometry(0.05, 0.32, 6, 12);
      const wallGeo = box(1, 1, 1);
      const blobGeo = new T.CircleGeometry(0.5, 24);
      const ringGeo = new T.RingGeometry(0.36, 0.44, 32);
      const thighGeo = box(0.13, 0.12, 0.42);
      const shinGeo = box(0.11, 0.42, 0.11);
      const potGeo = new T.CylinderGeometry(0.16, 0.12, 0.3, 14);
      const leafGeo = new T.SphereGeometry(0.24, 12, 10);
      const rugGeo = box(1.9, 0.01, 1.9);
      /** The glow of a monitor by the room's state. */
      const screenMats = new Map<NowState, InstanceType<Three["MeshStandardMaterial"]>>();
      const screenMat = (s: NowState) => {
        let m = screenMats.get(s);
        if (!m) {
          const c = s === "working" ? 0x6aa9ff : s === "needs" ? STATE_COLOR.needs : s === "blocked" ? STATE_COLOR.blocked : 0x223040;
          m = new T.MeshStandardMaterial({ color: 0x0b0f14, emissive: c, emissiveIntensity: s === "idle" || s === "waiting" ? 0.25 : 0.9, roughness: 0.3 });
          screenMats.set(s, m);
        }
        return m;
      };

      const office = new T.Group();
      scene.add(office);
      type Part = InstanceType<Three["Object3D"]>;
      const avatars: { mesh: InstanceType<Three["Group"]>; desk: Desk; torso: Part; armL: Part; armR: Part; head: Part; seed: number }[] = [];
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
        const add = (parent: InstanceType<Three["Object3D"]>, geo: ConstructorParameters<Three["Mesh"]>[0], m: ConstructorParameters<Three["Mesh"]>[1], x: number, y: number, z: number, cast = true) => {
          const mesh = new T.Mesh(geo, m);
          mesh.position.set(x, y, z);
          mesh.castShadow = cast;
          mesh.receiveShadow = true;
          parent.add(mesh);
          return mesh;
        };
        let span = 4;
        for (const f of l.floors) {
          const plateMat = floorMat.clone();
          plateMat.map = wood.clone();
          plateMat.map.repeat.set(f.w / 3, f.d / 3);
          plateMat.map.needsUpdate = true;
          const plate = new T.Mesh(new T.BoxGeometry(f.w, 0.2, f.d), plateMat);
          plate.position.set(f.x, -0.1, f.z);
          plate.receiveShadow = true;
          office.add(plate);
          // Two walls (back and left) with a row of daylight windows: a room, not a slab in the void.
          const H = 2.2;
          const back = add(office, wallGeo, wallMat, f.x, H / 2, f.z - f.d / 2 - 0.06, false);
          back.scale.set(f.w, H, 0.12);
          const left = add(office, wallGeo, wallMat, f.x - f.w / 2 - 0.06, H / 2, f.z, false);
          left.scale.set(0.12, H, f.d + 0.12);
          for (let wx = f.x - f.w / 2 + 1.2; wx < f.x + f.w / 2 - 0.6; wx += 1.8) {
            const w = add(office, wallGeo, windowMat, wx, 1.35, f.z - f.d / 2 + 0.005, false);
            w.scale.set(1.2, 0.9, 0.02);
          }
          for (let wz = f.z - f.d / 2 + 1.2; wz < f.z + f.d / 2 - 0.6; wz += 1.8) {
            const w = add(office, wallGeo, windowMat, f.x - f.w / 2 + 0.005, 1.35, wz, false);
            w.scale.set(0.02, 0.9, 1.2);
          }
          span = Math.max(span, Math.abs(f.x) + f.w / 2, Math.abs(f.z) + f.d / 2);
          // A plant at each corner of the project's floor.
          for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
            const px = f.x + sx * (f.w / 2 - 0.35);
            const pz = f.z + sz * (f.d / 2 - 0.35);
            add(office, potGeo, potMat, px, 0.15, pz);
            add(office, leafGeo, leafMat, px, 0.5, pz);
            add(office, leafGeo, leafMat, px + 0.08, 0.72, pz - 0.05).scale.setScalar(0.7);
          }
        }
        // Shadows cover the whole office, no more.
        const cam = sun.shadow.camera;
        cam.left = -span - 1;
        cam.right = span + 1;
        cam.top = span + 1;
        cam.bottom = -span - 1;
        cam.far = 60;
        cam.updateProjectionMatrix();
        for (const d of l.desks) {
          // Workstation: rug, desk on four legs, monitor (glows by state), keyboard, mug, chair.
          add(office, rugGeo, rugMat, d.x, 0.005, d.z + 0.35, false);
          // Soft contact shadows that work even where shadow maps are off, and the state ring on the floor.
          const blob = add(office, blobGeo, blobMat, d.x, 0.012, d.z + 0.1, false);
          blob.rotation.x = -Math.PI / 2;
          blob.scale.set(1.6, 1.1, 1);
          const chairBlob = add(office, blobGeo, blobMat, d.x, 0.013, d.z + 0.78, false);
          chairBlob.rotation.x = -Math.PI / 2;
          chairBlob.scale.setScalar(0.7);
          const ring = add(office, ringGeo, ringMat(d.state), d.x, 0.016, d.z + 0.78, false);
          ring.rotation.x = -Math.PI / 2;
          add(office, deskGeo, deskMat, d.x, 0.745, d.z);
          for (const [lx, lz] of [[-0.65, -0.35], [0.65, -0.35], [-0.65, 0.35], [0.65, 0.35]] as const) add(office, deskLegGeo, metalMat, d.x + lx, 0.36, d.z + lz);
          add(office, baseGeo, plasticMat, d.x, 0.78, d.z - 0.22);
          add(office, standGeo, plasticMat, d.x, 0.88, d.z - 0.24);
          add(office, screenGeo, plasticMat, d.x, 1.1, d.z - 0.26).scale.set(1.04, 1.06, 1);
          add(office, screenGeo, screenMat(d.state), d.x, 1.1, d.z - 0.243, false);
          add(office, kbGeo, keyMat, d.x, 0.785, d.z + 0.12);
          add(office, mugGeo, mugMat, d.x + 0.48, 0.82, d.z + 0.05);
          add(office, footGeo, metalMat, d.x, 0.03, d.z + 0.78);
          add(office, postGeo, metalMat, d.x, 0.24, d.z + 0.78);
          add(office, seatGeo, chairMat, d.x, 0.47, d.z + 0.78);
          add(office, backGeo, chairMat, d.x, 0.8, d.z + 1.0);
          // The person, seated facing the screen; the shirt says the role, the ring/screen/tag the state.
          const a = new T.Group();
          a.position.set(d.x, 0, d.z + 0.72);
          const pick = Math.abs(Math.round(d.x * 13 + d.z * 7));
          const shirt = solid(shirtOf(d.role, d.label), 0.75);
          const skinMat = solid(SKINS[pick % SKINS.length], 0.6);
          const hairMat = solid(HAIRS[(pick >> 1) % HAIRS.length], 0.9);
          const torso = new T.Group();
          torso.position.set(0, 0.52, 0.06);
          add(torso, torsoGeo, shirt, 0, 0.3, 0);
          const head = new T.Group();
          head.position.set(0, 0.72, -0.02);
          add(head, headGeo, skinMat, 0, 0, 0);
          add(head, hairGeo, hairMat, 0, 0.02, 0.01);
          torso.add(head);
          const arm = (side: number) => {
            const g = new T.Group();
            g.position.set(side * 0.22, 0.48, 0);
            add(g, armGeo, shirt, 0, -0.2, 0);
            g.rotation.x = -1.05;
            torso.add(g);
            return g;
          };
          const armL = arm(-1);
          const armR = arm(1);
          a.add(torso);
          for (const side of [-1, 1]) {
            add(a, thighGeo, pantsMat, side * 0.09, 0.53, -0.16);
            add(a, shinGeo, pantsMat, side * 0.09, 0.27, -0.36);
          }
          a.traverse((o) => {
            o.userData.key = d.key;
          });
          office.add(a);
          avatars.push({ mesh: a, desk: d, torso, armL, armR, head, seed: (d.x * 7.3 + d.z * 3.1) % 6.28 });
          // The desk sign: room name and its card (owner 2026-10-22: a realistic working day, not just colours).
          const sign = makeSign(T, deskSign(d), dark, d.state === "needs", STATE_COLOR[d.state]);
          sign.position.set(d.x, 1.75, d.z - 0.2);
          office.add(sign);
        }
        const dist = cameraDistance(l);
        scene.fog = new T.Fog(bg, dist * 1.1, dist * 2.4);
        // Closer than the plain fit: the workstations are the point, the floor edges may crop.
        camera.position.set(dist * 0.42, dist * 0.55, dist * 0.6);
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
        const key = hit ? ((hit.object.userData.key as string | undefined) ?? null) : null;
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
          // A working day: working rooms type (arms tap, head follows the screen), a room waiting on the
          // owner raises a hand and waves, idle and waiting rooms lean back. A few transforms per person.
          for (const { desk, torso, armL, armR, head, seed } of avatars) {
            const s = t / 1000 + seed;
            if (desk.state === "working") {
              armL.rotation.x = -1.05 + 0.08 * Math.sin(s * 14);
              armR.rotation.x = -1.05 + 0.08 * Math.sin(s * 14 + 1.7);
              head.rotation.y = 0.12 * Math.sin(s * 0.7);
              torso.rotation.x = 0;
            } else if (desk.state === "needs") {
              armR.rotation.x = -2.9;
              armR.rotation.z = -0.25 + 0.25 * Math.sin(s * 6);
              armL.rotation.x = -1.05;
              head.rotation.y = 0.5;
              torso.rotation.x = 0;
            } else if (desk.state === "blocked") {
              armL.rotation.x = -2.2;
              armR.rotation.x = -2.2;
              head.rotation.x = 0.25;
              torso.rotation.x = -0.05;
            } else {
              torso.rotation.x = 0.16;
              armL.rotation.x = -0.5;
              armR.rotation.x = -0.5;
              head.rotation.y = 0.2 * Math.sin(s * 0.3);
            }
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
        {stats ? `${stats.rooms} phòng · ${stats.calls} draw call · ${stats.ms.toFixed(1)} ms/khung` : "Đang dựng cảnh…"} · bấm một người để mở phòng
      </p>
    </div>
  );
}
