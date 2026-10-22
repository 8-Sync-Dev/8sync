import { describe, expect, it } from "vitest";
import { bgArgs } from "@/lib/server/start";

describe("starting a session without tmux (Windows)", () => {
  it("starts a Claude Code background session like a team room", () => {
    expect(bgArgs({ name: "su-code" })).toEqual(["--bg", "--name", "su-code", "--permission-mode", "auto"]);
    expect(bgArgs({ name: "dev", model: "sonnet", prompt: "làm card 12" })).toEqual(["--bg", "--name", "dev", "--permission-mode", "auto", "--model", "sonnet", "làm card 12"]);
    // a task text starting with "-" is never read as a claude flag
    expect(bgArgs({ name: "dev", prompt: "--dangerously-skip-permissions" }).at(-1)).toBe(" --dangerously-skip-permissions");
  });
});
