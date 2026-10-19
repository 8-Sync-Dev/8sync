import { json, open } from "@/lib/server/http";
import { SHELL_KEY, termOpen } from "@/lib/server/term";
import { uiVersion } from "@/lib/server/version";

export const runtime = "nodejs";

/**
 * `{ui, shell}`: the UI version this server runs (a page rendered by another one reloads), and whether
 * the owner's shell is open — `8sync hq ui` holds a self-restart onto a new binary until it closes,
 * since the restart would kill whatever runs in it.
 */
export async function GET(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  return json({ ui: uiVersion(), shell: termOpen(SHELL_KEY) });
}
