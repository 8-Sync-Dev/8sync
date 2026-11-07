/** Server start: the power sampler counts kWh and ₫ whether or not a tab is open; the history sampler keeps the machine graph; the content digest asks for the day's post numbers once; the manual fallback hands channels that could not be scheduled to a room; the machine watch hands the owner's chosen room what eco scan found; auto-update runs `8sync up` when a newer release is out. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Dynamic on purpose: Next also bundles this file for the edge runtime, where node: modules don't exist.
  const { startPower } = await import("./lib/server/power");
  startPower();
  const { startHistory } = await import("./lib/server/history");
  startHistory();
  const { startContentDigest } = await import("./lib/server/content-digest");
  startContentDigest();
  const { startContentManual } = await import("./lib/server/content-manual");
  startContentManual();
  const { startMachineWatch } = await import("./lib/server/machine-watch");
  startMachineWatch();
  const { startAutoUpdate } = await import("./lib/server/auto-update");
  startAutoUpdate();
}
