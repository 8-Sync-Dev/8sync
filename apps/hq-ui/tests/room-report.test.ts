import { describe, expect, it } from "vitest";
import { httpsLink, isRoomRef, openLabel, reportsOf, roomRefs, type Artifact } from "@/lib/artifacts";

const art = (id: string, at: number, over: Partial<Artifact> = {}): Artifact => ({
  id,
  path: `C:\\cpa\\proof\\${id}.png`,
  root: "C:\\cpa",
  project: "cpa",
  branch: null,
  session: "hq-core",
  title: id,
  note: null,
  kind: "image",
  content: [],
  link: null,
  for_root: null,
  for_project: null,
  created_at: at,
  updated_at: at,
  missing: false,
  size: 1,
  mtime: at,
  ...over,
});

describe("room report", () => {
  it("folds the files of one post (same https link) into one report, newest first, with its newest note and every post id once", () => {
    const meta = "https://business.facebook.com/latest/posts/scheduled_posts?id=1";
    const list = [
      art("p2", 30, { link: meta, title: "FB · Bài 38 (permalink)", content: [38] }),
      art("notes", 20, { kind: "markdown", path: "C:\\cpa\\notes.md" }),
      art("p1", 10, { link: meta, note: "đã lên lịch 20:00", content: [16, 38] }),
      art("gone", 5, { link: "https://x.com/post/1", missing: true }),
      art("bad", 4, { link: "javascript:alert(1)" }),
    ];
    const r = reportsOf(list);
    expect(r.map((x) => x.key)).toEqual([`link:${meta}`, "id:notes", "link:https://x.com/post/1", "id:bad"]);
    expect(r[0]).toMatchObject({ title: "FB · Bài 38 (permalink)", at: 30, link: meta, note: "đã lên lịch 20:00", content: [16, 38] });
    expect(r[0].proofs.map((a) => a.id)).toEqual(["p2", "p1"]);
    expect(r[1].files.map((a) => a.id)).toEqual(["notes"]);
    expect(r[2]).toMatchObject({ proofs: [], files: [expect.objectContaining({ id: "gone" })] });
    expect(r[3].link).toBeNull();
  });

  it("labels the open button by where it goes and opens only https", () => {
    expect(openLabel("https://business.facebook.com/latest/posts")).toBe("Mở trên Meta");
    expect(openLabel("https://www.facebook.com/588402817683765/posts/1")).toBe("Mở trên Meta");
    expect(openLabel("https://www.instagram.com/p/abc")).toBe("Mở trên Meta");
    expect(openLabel("https://www.linkedin.com/feed/update/1")).toBe("Mở trên linkedin.com");
    expect(httpsLink("http://facebook.com/x")).toBeNull();
    expect(httpsLink("javascript:alert(1)")).toBeNull();
    expect(httpsLink("https://fb.com/x")).toBe("https://fb.com/x");
  });

  it("asks for a room by the names --session takes, each once", () => {
    expect(roomRefs({ name: "hq-cpa", session_id: "0f0e0d0c-0b0a-4908-8706-050403020100" })).toEqual(["hq-cpa", "0f0e0d0c-0b0a-4908-8706-050403020100"]);
    expect(roomRefs({ name: "omp-0123456789abcdef", session_id: "omp-0123456789abcdef" })).toEqual(["omp-0123456789abcdef"]);
    expect(roomRefs({ name: "core", session_id: null })).toEqual([]);
    expect(isRoomRef("hq-core")).toBe(true);
    expect(isRoomRef("rm -rf")).toBe(false);
  });
});
