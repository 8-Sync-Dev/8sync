/** Server start: the power sampler counts kWh and ₫ whether or not a tab is open; the cleanup loop re-measures projects every 6 h. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Dynamic on purpose: Next also bundles this file for the edge runtime, where node: modules don't exist.
  const { startPower } = await import("./lib/server/power");
  startPower();
  const { startCleanupLoop } = await import("./lib/server/cleanup-loop");
  startCleanupLoop();
}
