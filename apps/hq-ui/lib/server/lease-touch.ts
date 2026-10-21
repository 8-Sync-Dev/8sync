// "Lease liên tục" on a subscription: the owner using HQ is the fresh owner action that renews the
// lease (`8sync ccc auto lease renew`, owner-only: HQ's children carry no room env). Only a browser
// POST counts (an Origin header: the channel's local Node process sends none), never a GET poll or a
// stream, and at most once per TOUCH_GAP_MS. Tested in tests/lease-touch.test.ts.
import { lastAutoStatus } from "./auto";
import { run } from "./proc";

export const TOUCH_GAP_MS = 5 * 60_000;

// On globalThis: route bundles may carry their own module copies; one clock for the whole server.
const S = globalThis as typeof globalThis & { __hqLeaseTouch?: number };

/** Whether an owner request may renew now: a mutating browser request, the switch on, none in the last TOUCH_GAP_MS. */
export function touchDue(req: { method: string; origin: string | null }, leaseAuto: boolean, last: number | undefined, now: number): boolean {
  if (!leaseAuto || !req.origin || ["GET", "HEAD", "OPTIONS"].includes(req.method.toUpperCase())) return false;
  return last == null || now - last >= TOUCH_GAP_MS;
}

/** Called by `open()` once a request passed the auth gate; fire-and-forget. */
export function touchLease(req: { method: string; origin: string | null }, now = Date.now(), spawn: typeof run = run): boolean {
  if (!touchDue(req, lastAutoStatus()?.lease_auto === true, S.__hqLeaseTouch, now)) return false;
  S.__hqLeaseTouch = now;
  void spawn("8sync", ["ccc", "auto", "lease", "renew", "--json"], 10_000);
  return true;
}
