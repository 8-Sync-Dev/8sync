/** Server start: the power sampler counts kWh and ₫ whether or not a tab is open; the cleanup loop re-measures projects every 6 h; the guard trigger reacts to CPU/RAM/VRAM within seconds; the sweep loop keeps one `sweep` room in every running team. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Dynamic on purpose: Next also bundles this file for the edge runtime, where node: modules don't exist.
  const { startPower } = await import("./lib/server/power");
  startPower();
  const { startCleanupLoop } = await import("./lib/server/cleanup-loop");
  startCleanupLoop();
  const { startGuardTrigger } = await import("./lib/server/guard-trigger");
  startGuardTrigger();
  const { startSweepLoop } = await import("./lib/server/sweep");
  startSweepLoop();
}
