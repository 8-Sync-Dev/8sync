# Shipped v0.118.0 → v0.119.1 — HQ Claude-Desktop UI, stable public link, Rust core hot path

## Goal
Owner 2026-11-02/03: HQ looks like Claude Code Desktop (project → session → sub-session → group, light default); public trycloudflare link fixed from the moment HQ opens; HQ Rust core does the hot work. Later: VPS HQ (OVH), artifact public-link feature, HTTP/3/realtime, lowest PC power.

## Checklist
- [x] v0.118.0 (PR #261): `--public` supervisor hot-swaps node on `8sync up`, respawns crashed node; `public.json` owner pid/port; `EIGHTSYNC_HQ_HOME` sandbox; light default; Claude-Desktop sidebar tree + composer; reopen fix.
- [x] v0.119.0 (PR #262): core `/v1/heavy` + `/v1/omp-ls`, transcript index, `/v1/ls` CPU 86.7 → 28.1 ms, TCP_NODELAY, idle ingest skips write tx.
- [x] Verified live: `8sync up` 0.118 → 0.119 swapped node, host `studio-half-principal-phys.trycloudflare.com` unchanged.
- [x] v0.119.1 (PR #263): `8sync hq ui --relink` — new 10-min login key on the same host (live smoke: new 303, old 401).
- [x] OVH order refunded; GoDaddy M365 ₫1,668,000 refunded (4202175184R).
- [ ] VPS: OVH service expired — owner's renewal decision.
- [ ] Artifact public-link feature (blueprint first).
- [ ] HQ HTTP/3 / realtime; remaining spawns (git preview, /api/know, /api/version, powercfg).

## Next
1. Owner: renew VPS or keep the quick tunnel.
2. Artifact link blueprint.
3. `docs/hq-ui-contract.md` line 46 stale.
