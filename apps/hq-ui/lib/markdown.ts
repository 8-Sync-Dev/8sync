// The remark plugins every HQ markdown view renders with (components/ai-elements/message MessageResponse,
// components/hq/path-open pathMarkdown): Streamdown's own set, with GFM told to strike only `~~text~~`.
// A single tilde is how rooms write "about" ("~0 tokens (~$0.00)"); remark-gfm's default struck it through.
import { defaultRemarkPlugins } from "streamdown";

type Pluggable = (typeof defaultRemarkPlugins)[string];

function noSingleTilde(p: Pluggable): Pluggable {
  if (!Array.isArray(p)) return [p, { singleTilde: false }] as Pluggable;
  const [plugin, opts] = p as [unknown, unknown];
  return [plugin, { ...(opts && typeof opts === "object" ? opts : {}), singleTilde: false }] as Pluggable;
}

export const hqRemarkPlugins: Pluggable[] = Object.entries(defaultRemarkPlugins).map(([name, p]) => (name === "gfm" ? noSingleTilde(p) : p));
