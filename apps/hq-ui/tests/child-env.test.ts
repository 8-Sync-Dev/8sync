import { describe, expect, it } from "vitest";
import { binFor, childEnv } from "@/lib/server/child-env";

// Security M-A / L-C: what the HQ server passes on to 8sync, claude, tmux.
describe("childEnv", () => {
  it("drops the HQ server's own settings, keeps the rest", () => {
    const env = childEnv({
      HQ_PUBLIC_NONCE: "e".repeat(64),
      HQ_CHANNEL_FLAGS: "off",
      hq_ui_port: "8740",
      PORT: "8740",
      HOSTNAME: "127.0.0.1",
      NODE_ENV: "production",
      Path: "C:\\bin",
      HOME: "/home/u",
      EIGHTSYNC_HQ_SESSION: "hq-a",
      UNSET: undefined,
    });
    expect(env).toEqual({ Path: "C:\\bin", HOME: "/home/u", EIGHTSYNC_HQ_SESSION: "hq-a" });
  });
});

describe("binFor (contract C-E)", () => {
  it("8sync resolves to EIGHTSYNC_BIN, other commands stay", () => {
    expect(binFor("8sync", { EIGHTSYNC_BIN: "C:\\x\\8sync.exe" })).toBe("C:\\x\\8sync.exe");
    expect(binFor("8sync", { EIGHTSYNC_BIN: "" })).toBe("8sync");
    expect(binFor("8sync", {})).toBe("8sync");
    expect(binFor("tmux", { EIGHTSYNC_BIN: "C:\\x\\8sync.exe" })).toBe("tmux");
  });
});
