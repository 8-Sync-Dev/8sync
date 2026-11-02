import { json, open } from "@/lib/server/http";
import { cachedCommands } from "@/lib/server/commands";

export const runtime = "nodejs";

/** The owner's omp and Claude Code slash commands (name + description) for the composer's "/" list. */
export async function GET(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  return json({ commands: cachedCommands() });
}
