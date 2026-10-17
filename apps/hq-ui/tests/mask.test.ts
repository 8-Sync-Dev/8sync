import { describe, expect, it } from "vitest";
import { maskSecrets } from "@/lib/mask";

// Fixtures are built at runtime so secret scanners do not flag this file.
const j = (...p: string[]) => p.join("");
const ANT = j("sk-", "ant-api03-", "abcdefghijklmnopqrstuvwxyz0123456789");
const GH = j("gh", "p_", "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8");
const AWS = j("AK", "IA", "ABCDEFGHIJKLMNOP");
const OPAQUE = j("a1B2c3D4e5F6g7H8", "i9J0k1L2m3N4o5P6q7");
const DASH = "-".repeat(5);
const LABEL = j("PRIV", "ATE ", "K", "EY");

describe("maskSecrets", () => {
  it("masks known tokens wherever they sit in a sentence", () => {
    const out = maskSecrets(`Used ${ANT} then (${GH}), key ${AWS}. Also ${OPAQUE}.`);
    for (const s of [ANT, GH, AWS, OPAQUE]) expect(out).not.toContain(s);
    expect(out).toBe("Used *** then (***), key ***. Also ***.");
  });

  it("masks the value of a secret-looking name, the word after Bearer, and PEM blocks", () => {
    expect(maskSecrets(j("GITHUB_TOKEN", "=abc123 next"))).toBe("GITHUB_TOKEN=*** next");
    expect(maskSecrets(j('{"api_key": "', "hunter2", '", "name": "game"}'))).toBe('{"api_key": "***", "name": "game"}');
    expect(maskSecrets(j("password: ", "hunter2"))).toBe("password: ***");
    expect(maskSecrets(j("postgres://app:", "hunter2", "@db:5432/x"))).toBe("postgres://app:***@db:5432/x");
    expect(maskSecrets(j("psql --password ", "hunter2", " -h db"))).toBe("psql --password *** -h db");
    expect(maskSecrets(j("Authorization: Bearer ", "abc.def"))).not.toContain("abc.def");
    const pem = `${DASH}BEGIN ${LABEL}${DASH}\nzzzz\n${DASH}END ${LABEL}${DASH}`;
    expect(maskSecrets(`before ${pem} after`)).toBe("before [REDACTED-PEM] after");
    expect(maskSecrets(`cut ${DASH}BEGIN ${LABEL}${DASH}\nzzzz`)).toBe("cut [REDACTED-PEM]");
  });

  it("leaves everyday text alone", () => {
    for (const s of [
      "pnpm test passed: 41 tests, 6 files",
      "card #12 moved ready → building (dev)",
      "src/components/hq/lanes-view.tsx:120",
      "name: game, branch: card-7-battle-view",
      "https://github.com/8-Sync-Dev/su-code/pull/84",
      "commit 3e133df on card-7-battle-view",
    ])
      expect(maskSecrets(s)).toBe(s);
  });

  it("masks any 32+ id mixing letters and digits, like the Rust masker (accepted false positive)", () => {
    expect(maskSecrets("on worktree-agent-aeaceed7476b7eb97")).toBe("on ***");
  });
});
