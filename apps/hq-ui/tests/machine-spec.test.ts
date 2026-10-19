import { describe, expect, it } from "vitest";
import { parseCores, parseGpuSpec, spec, windowsName } from "@/lib/server/machine";

describe("machine spec", () => {
  it("Windows 11 is named from the build, not the registry's old name", () => {
    expect(windowsName("Windows 10 Pro", "10.0.26100")).toBe("Windows 11 Pro");
    expect(windowsName("Windows 10 Pro", "10.0.19045")).toBe("Windows 10 Pro");
    expect(windowsName("Windows Server 2022 Datacenter", "10.0.20348")).toBe("Windows Server 2022 Datacenter");
  });

  it("physical cores per OS", () => {
    expect(parseCores("win32", "8\r\n")).toBe(8);
    expect(parseCores("darwin", "10\n")).toBe(10);
    expect(parseCores("linux", "# The following is the parsable format\n# Core,Socket\n0,0\n0,0\n1,0\n1,0\n")).toBe(2);
    expect(parseCores("win32", "")).toBeNull();
    expect(parseCores("win32", null)).toBeNull();
  });

  it("GPU name and VRAM from nvidia-smi", () => {
    expect(parseGpuSpec("NVIDIA GeForce RTX 5080, 16303\nbad line\n")).toEqual([{ name: "NVIDIA GeForce RTX 5080", vramMb: 16303 }]);
  });

  it("read once, with fakes for every probe", async () => {
    let calls = 0;
    const run = async (cmd: string) => {
      calls += 1;
      return cmd === "nvidia-smi" ? "RTX A, 8192\n" : cmd === "lscpu" ? "0,0\n1,0\n" : null;
    };
    const s = await spec("linux", run);
    expect(s.gpus).toEqual([{ name: "RTX A", vramMb: 8192 }]);
    expect(s.cpu.cores).toBe(2);
    expect(s.cpu.threads).toBeGreaterThan(0);
    expect(s.memTotalMb).toBeGreaterThan(0);
    expect(s.os.arch).toBeTruthy();
    await spec("linux", run);
    expect(calls).toBe(2); // cached: no second probe
  });
});
