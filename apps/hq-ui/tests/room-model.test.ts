import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { claudeCommands, distinctNames, effortsFor, findChoice, OMP_THINKING, ompControl, type ModelChoice } from "@/lib/room-model";
import { getToken } from "@/lib/server/auth";
import { inboxFile } from "@/lib/server/inbox";
import { modelStateFile, parseOmpModels, readRoomModel } from "@/lib/server/models";
import { stateDir } from "@/lib/server/paths";
import { ORIGIN, req, tempHome } from "./helpers";

const LIST: ModelChoice[] = [
  { selector: "anthropic/claude-opus-5-5", provider: "anthropic", name: "Claude Opus 5.5", thinking: ["low", "medium", "high", "xhigh", "max"] },
  { selector: "cloudgo-cc/claude-opus-5-5", provider: "cloudgo-cc", name: "Claude Opus 5.5", thinking: ["low", "medium", "high"] },
  { selector: "zai/glm-5.3", provider: "zai", name: "GLM-5.3", thinking: [] },
];

vi.mock("@/lib/server/models", async (orig) => ({ ...(await orig<typeof import("@/lib/server/models")>()), ompModels: async () => LIST }));
const { GET, POST } = await import("@/app/api/models/route");

const ROOM = "omp-0123456789abcdef";
let token = "";
beforeAll(() => {
  tempHome();
  token = getToken();
});

// The extension imports omp's SDK types, which hq-ui does not install (CI typechecks it apart, in
// ts-assets): load it at run time so `tsc` here never follows it. Same file the rooms run.
const EXT: string = new URL("../../../assets/extensions/8sync-inbox.ts", import.meta.url).href;
type Control = { model?: string; thinking?: string };
const { modelStateJson, parseModelControl, splitControls, roomIdFor } = (await import(EXT)) as {
  modelStateJson: (s: { model: string | null; thinking: string | null; error: string | null }, at: number) => string;
  parseModelControl: (text: string) => Control | null;
  splitControls: <T extends { text: string; messages: string[] }>(x: T) => { controls: Control[]; rest: T | { text: string; messages: string[] } | null };
  roomIdFor: (lsJson: string | null, dir: string) => string | null;
};

describe("room id of a session 8sync did not launch (Orca's omp --resume)", () => {
  const base = path.join(os.tmpdir(), "sessions", "proj");
  const ls = JSON.stringify([
    { name: "profile", inbox_id: "omp-1111111111111111", session_dir: path.join(base, "profile") },
    { name: "core", inbox_id: "omp-058138a5c9bdb509", session_dir: path.join(base, "core") },
    { name: "bad", inbox_id: "../../etc", session_dir: path.join(base, "bad") },
  ]);
  it("picks the row whose session dir holds the session, not the first row", () => {
    expect(roomIdFor(ls, path.join(base, "core") + path.sep)).toBe("omp-058138a5c9bdb509");
    if (process.platform === "win32") expect(roomIdFor(ls, path.join(base, "CORE"))).toBe("omp-058138a5c9bdb509");
  });
  it("no match, a non-room id, or output that is not the list → no id (the mod stays off)", () => {
    expect(roomIdFor(ls, path.join(base, "other"))).toBeNull();
    expect(roomIdFor(ls, path.join(base, "bad"))).toBeNull();
    expect(roomIdFor("Error: not a repo", path.join(base, "core"))).toBeNull();
    expect(roomIdFor(null, path.join(base, "core"))).toBeNull();
  });
});

describe("HQ → extension control message", () => {
  it("what HQ queues is what the extension applies", () => {
    expect(parseModelControl(ompControl({ model: "nvidia/meta/llama-4", thinking: "xhigh" }))).toEqual({ model: "nvidia/meta/llama-4", thinking: "xhigh" });
    expect(parseModelControl(ompControl({ thinking: "off" }))).toEqual({ thinking: "off" });
  });
  it("ignores look-alikes: ordinary text, a bad level, a model with a thinking suffix", () => {
    expect(parseModelControl("/8sync-model is great")).toBeNull();
    expect(parseModelControl('/8sync-model {"thinking":"ultracode"}')).toBeNull();
    expect(parseModelControl('/8sync-model {"model":"anthropic/claude-opus-5-5:high"}')).toBeNull();
  });
  it("a switch sent with a message: switch applied, the message delivered as itself", () => {
    const sw = ompControl({ model: "zai/glm-5.3" });
    expect(splitControls({ text: "framed", messages: [sw] })).toEqual({ controls: [{ model: "zai/glm-5.3" }], rest: null });
    expect(splitControls({ text: "framed", messages: ["fix it", sw, "/compact"] })).toEqual({
      controls: [{ model: "zai/glm-5.3" }],
      rest: { text: "fix it\n\n/compact", messages: ["fix it", "/compact"] },
    });
    const plain = { text: "framed", messages: ["hi"] };
    expect(splitControls(plain).rest).toBe(plain);
  });
  it("the extension's state file reads back on HQ; other ids are never a path", () => {
    fs.mkdirSync(path.dirname(modelStateFile(ROOM)), { recursive: true });
    fs.writeFileSync(modelStateFile(ROOM), modelStateJson({ model: "zai/glm-5.3", thinking: "high", error: null }, 5));
    expect(readRoomModel(ROOM)).toEqual({ model: "zai/glm-5.3", thinking: "high", error: null, at: 5 });
    expect(readRoomModel("../../etc")).toBeNull();
  });
});

describe("model list helpers", () => {
  it("keeps chat models with a usable selector", () => {
    const out = parseOmpModels(
      JSON.stringify({
        models: [
          { provider: "zai", kind: "chat", selector: "zai/glm-5.3", name: "GLM-5.3", thinking: ["low", 3] },
          { provider: "x", kind: "image", selector: "x/img" },
          { provider: "x", kind: "chat", selector: "x/a:b" },
          { provider: "x", kind: "chat" },
        ],
      }),
    );
    expect(out).toEqual([{ selector: "zai/glm-5.3", provider: "zai", name: "GLM-5.3", thinking: ["low"] }]);
    expect(parseOmpModels("not json")).toEqual([]);
  });
  it("finds the room's model from `8sync ls` (bare id) or the extension (selector + level)", () => {
    expect(findChoice(LIST, "claude-opus-5-5")?.selector).toBe("anthropic/claude-opus-5-5");
    expect(findChoice(LIST, "cloudgo-cc/claude-opus-5-5:high")?.selector).toBe("cloudgo-cc/claude-opus-5-5");
    expect(findChoice(LIST, null)).toBeUndefined();
  });
  it("effort row: omp adds off, a model without levels gets only off; Claude is fixed", () => {
    expect(effortsFor("omp", LIST[1])).toEqual(["off", "low", "medium", "high"]);
    expect(effortsFor("omp", LIST[2])).toEqual(["off"]);
    expect(effortsFor("claude", undefined)).toEqual(["low", "medium", "high", "xhigh", "max"]);
    expect(claudeCommands({ model: "opus", thinking: "max" })).toEqual(["/model opus", "/effort max"]);
  });
});

describe("/api/models", () => {
  const post = (body: unknown) => POST(req("/api/models", { method: "POST", token, origin: ORIGIN, body }));
  beforeEach(() => fs.rmSync(path.join(stateDir(), "inbox"), { recursive: true, force: true }));

  it("an omp room on an old extension (no state) cannot switch: nothing queued", async () => {
    const other = "omp-ffffffffffffffff";
    const g = await (await GET(req(`/api/models?session=${other}`, { token }))).json();
    expect(g).toMatchObject({ engine: "omp", apply: null, current: null });
    expect((await post({ session: other, thinking: "high" })).status).toBe(409);
    expect(fs.existsSync(inboxFile(other))).toBe(false);
  });
  it("queues one control message for a known model and level", async () => {
    const g = await (await GET(req(`/api/models?session=${ROOM}`, { token }))).json();
    expect(g).toMatchObject({ engine: "omp", apply: "inbox", current: { model: "zai/glm-5.3" } });
    expect((await post({ session: ROOM, model: "anthropic/claude-opus-5-5", thinking: "max" })).status).toBe(202);
    const lines = fs.readFileSync(inboxFile(ROOM), "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(parseModelControl(JSON.parse(lines[0]).text)).toEqual({ model: "anthropic/claude-opus-5-5", thinking: "max" });
  });
  it("rejects a model omp does not list, a bad level, an empty change", async () => {
    expect((await post({ session: ROOM, model: "openai/gpt-9" })).status).toBe(422);
    expect((await post({ session: ROOM, thinking: "ultracode" })).status).toBe(422);
    expect((await post({ session: ROOM })).status).toBe(422);
    expect(fs.existsSync(inboxFile(ROOM))).toBe(false);
  });
  it("a Claude session reached only by inbox cannot switch; Claude aliases are checked", async () => {
    const uuid = "2c40ff62-99dd-4c88-b060-9ff5877a2ed2";
    expect(await (await GET(req(`/api/models?session=${uuid}`, { token }))).json()).toMatchObject({ engine: "claude", apply: null });
    expect((await post({ session: uuid, model: "opus" })).status).toBe(422);
    expect((await post({ session: "hq-a", model: "gpt-5" })).status).toBe(422);
  });
  it("?engine=omp without a session: the list a new omp bot picks from", async () => {
    const g = await (await GET(req("/api/models?engine=omp", { token }))).json();
    expect(g).toEqual({ engine: "omp", models: LIST, efforts: [...OMP_THINKING], current: null, apply: null });
  });
  it("is owner only", async () => {
    expect((await GET(req(`/api/models?session=${ROOM}`))).status).toBe(401);
  });
});

describe("distinctNames: same-named models get told apart", () => {
  const m = (selector: string, name: string): ModelChoice => ({ selector, provider: selector.slice(0, selector.indexOf("/")), name, thinking: [] });
  const fixture = [
    m("anthropic/claude-haiku-4-5", "Claude Haiku 4.5"),
    m("8sync-api/claude-haiku-4-5", "Claude Haiku 4.5"),
    m("anthropic/claude-opus-4-5", "Claude Opus 4.5"),
    m("anthropic/claude-opus-4-5-20251101", "Claude Opus 4.5"),
    m("anthropic/claude-sonnet-4-5", "Claude Sonnet 4.5"),
    m("anthropic/claude-sonnet-4-5-20250929", "Claude Sonnet 4.5"),
    m("8sync-api/claude-sonnet-4-5", "Claude Sonnet 4.5"),
    m("zai/glm-5.3", "GLM 5.3"),
  ];

  it("suffixes the provider, or the model id when the provider is shared; unique names unchanged", () => {
    const out = distinctNames(fixture);
    expect(out.map((x) => x.name)).toEqual([
      "Claude Haiku 4.5 · anthropic",
      "Claude Haiku 4.5 · 8sync-api",
      "Claude Opus 4.5 · claude-opus-4-5",
      "Claude Opus 4.5 · claude-opus-4-5-20251101",
      "Claude Sonnet 4.5 · claude-sonnet-4-5",
      "Claude Sonnet 4.5 · claude-sonnet-4-5-20250929",
      "Claude Sonnet 4.5 · 8sync-api",
      "GLM 5.3",
    ]);
    expect(new Set(out.map((x) => x.name)).size).toBe(fixture.length);
    expect(out.map((x) => x.selector)).toEqual(fixture.map((x) => x.selector));
    expect(out[7]).toBe(fixture[7]);
  });

  it("leaves a list without collisions as it is and is idempotent", () => {
    const plain = [fixture[0]!, fixture[2]!, fixture[7]!];
    expect(distinctNames(plain)).toEqual(plain);
    expect(distinctNames(distinctNames(fixture))).toEqual(distinctNames(fixture));
  });
});
