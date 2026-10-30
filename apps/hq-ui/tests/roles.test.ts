import { describe, expect, it } from "vitest";
import { MODELS, ROLES, ROLE_IDS, isModelId, isRoleId, modelShort, ompModelLabel, roleOf, roomModelLabel } from "@/lib/roles";
import { tmuxStartArgs } from "@/lib/server/proc";

const off = { channel: { args: [], mode: "off" as const, reason: null } };

describe("roles", () => {
  it("every role is complete and unique", () => {
    expect(ROLES.map((r) => r.id)).toEqual([...ROLE_IDS]);
    for (const r of ROLES) {
      expect(r.labelVi && r.icon && r.agentHint).toBeTruthy();
      expect(isModelId(r.model)).toBe(true);
      expect(["high", "mid", "low"]).toContain(r.costTier);
    }
  });
  it("maps roles to the default models", () => {
    const m = (id: string) => roleOf(id)?.model;
    for (const id of ["rd", "plan", "architect"]) expect(m(id)).toBe("claude-opus-5-5");
    for (const id of ["fullstack", "ai", "reviewer"]) expect(m(id)).toBe("claude-sonnet-5-5");
    for (const id of ["tester", "quick"]) expect(m(id)).toBe("claude-haiku-5-5");
  });
  it("allowlist is exactly the 3 models", () => {
    expect([...MODELS]).toEqual(["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"]);
    for (const bad of ["claude-opus-4", "gpt-5", "", "claude-opus-5-5 --x", null, 5]) expect(isModelId(bad)).toBe(false);
    expect(isRoleId("nope")).toBe(false);
    expect(modelShort("claude-opus-5-5")).toBe("Opus 5.5");
  });
  it("tmux argv carries --model and EIGHTSYNC_HQ_ROLE, and refuses others", () => {
    const a = tmuxStartArgs("hq-x-1", "/r", { ...off, role: "tester", model: "claude-haiku-5-5" });
    expect(a).toContain("EIGHTSYNC_HQ_ROLE=tester");
    expect(a.slice(a.indexOf("claude"))).toEqual(["claude", "--model", "claude-haiku-5-5"]);
    expect(() => tmuxStartArgs("hq-x-1", "/r", { ...off, model: "claude-opus-4" })).toThrow();
    expect(() => tmuxStartArgs("hq-x-1", "/r", { ...off, role: "a;b" })).toThrow();
  });
  it("a first prompt goes last, after --, so a leading dash is not a flag", () => {
    const a = tmuxStartArgs("hq-x-1", "/r", { ...off, prompt: "--help me" });
    expect(a.slice(-2)).toEqual(["--", "--help me"]);
    expect(tmuxStartArgs("hq-x-1", "/r", { ...off, prompt: "  " }).at(-1)).toBe("claude");
  });
});

describe("omp model label", () => {
  it("names an omp session's model: null → omp's default, provider dropped, GLM/GPT upper-cased", () => {
    for (const v of [null, undefined, "", "  "]) expect(ompModelLabel(v), String(v)).toBe("omp mặc định");
    expect(ompModelLabel("zai/glm-5.3")).toBe("GLM-5.3");
    expect(ompModelLabel("zai/glm-5.3:max"), "thinking level dropped").toBe("GLM-5.3");
    expect(ompModelLabel("glm-5.3-flash"), "no slash").toBe("GLM-5.3-flash");
    expect(ompModelLabel("openai/gpt-5.6-sol")).toBe("GPT-5.6-sol");
    expect(ompModelLabel("gpt-5.6")).toBe("GPT-5.6");
    expect(ompModelLabel("anthropic/claude-sonnet-5-5")).toBe("Sonnet 5.5");
    expect(ompModelLabel("nvidia/qwen3-coder-480b"), "unknown: the id after the slash").toBe("qwen3-coder-480b");
    expect(ompModelLabel("openrouter/moonshot/kimi-k3")).toBe("kimi-k3");
    expect(ompModelLabel("mistral-large")).toBe("mistral-large");
  });
  it("a room card: an omp or Claude room's own model, or nothing when unknown", () => {
    expect(roomModelLabel({ engine: "omp", label: "omp-lead", model: "zai/glm-5.3" })).toBe("GLM-5.3");
    expect(roomModelLabel({ engine: "omp", label: "core", model: null })).toBeNull();
    expect(roomModelLabel({ engine: "omp", label: "vps", model: "openai/gpt-5.6" })).toBe("GPT-5.6");
    expect(roomModelLabel({ label: "dev", model: "claude-sonnet-5-5" })).toBe("Sonnet 5.5");
    expect(roomModelLabel({ engine: "claude", label: "lead", model: null })).toBeNull();
  });
});
