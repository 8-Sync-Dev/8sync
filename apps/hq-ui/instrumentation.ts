/** Server start: the power sampler counts kWh and ₫ whether or not a tab is open; the history sampler keeps the machine graph; the content digest asks for the day's post numbers once. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Dynamic on purpose: Next also bundles this file for the edge runtime, where node: modules don't exist.
  const { startPower } = await import("./lib/server/power");
  startPower();
  const { startHistory } = await import("./lib/server/history");
  startHistory();
  const { startContentDigest } = await import("./lib/server/content-digest");
  startContentDigest();
}
