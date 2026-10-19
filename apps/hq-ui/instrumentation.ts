/** Server start: the power sampler counts kWh and ₫ whether or not a tab is open. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startPower } = await import("./lib/server/power");
  startPower();
}
