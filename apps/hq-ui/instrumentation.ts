/** Server start: the power sampler counts kWh and ₫ whether or not a tab is open; the history sampler keeps the machine graph. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Dynamic on purpose: Next also bundles this file for the edge runtime, where node: modules don't exist.
  const { startPower } = await import("./lib/server/power");
  startPower();
  const { startHistory } = await import("./lib/server/history");
  startHistory();
}
