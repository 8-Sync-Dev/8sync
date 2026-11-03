# Shipped v0.120.0 — HQ delete, shared sessions, eccx loops, omp quota keys

## Goal
Owner 2026-11-03: HQ can delete a session / every session of a project; read-only pane switches on typing; terminal + HQ share one omp like tmux; Vòng lặp lists `/eccx-loop-*` with copy/send; Hạn mức shows all omp accounts, mints member API keys and logs every member call (project root, request). Later: VPS HQ (OVH), artifact public-link feature, HTTP/3/realtime, lowest PC power.

## Checklist
- [x] v0.118.0 → v0.119.1 (PR #261–#263): Claude-Desktop UI, stable public link, Rust core hot path, `hq ui --relink`.
- [x] PR #265: `8sync . rm --purge` + live guard (refuse foreign omp, end own HQ host), `8sync . <name> --share`, HQ "Xóa phiên…"/"Xóa mọi phiên…", type-to-takeover, Vòng lặp eccx commands. Browser smoke on sandbox HQ: delete session, delete project, takeover on key, `--share` keys visible in HQ pane.
- [x] PR #266: Hạn mức omp accounts + `8sk_` member keys + `/api/omp/v1` door + call log (design `docs/hq-quota-keys.md`). UAT against a mock gateway only.
- [x] v0.120.0 tagged.
- [ ] Real omp gateway through `/api/omp/v1` (incl. `responses`), and a member call over the real `--public` link.
- [ ] `--share` typed interactively in a real console (only piped stdin verified).
- [ ] Vòng lặp send to omp/tmux rooms (unit-tested only); owner to pick bare command vs instruction line in `eccxMessage`.
- [ ] VPS: OVH service expired — owner's renewal decision.
- [ ] Artifact public-link feature (blueprint first); HQ HTTP/3 / realtime; remaining spawns; `docs/hq-ui-contract.md` line 46 stale.

## Next
1. Owner smoke: create a key in Hạn mức, call it from another machine via the public link.
2. Owner: renew VPS or keep the quick tunnel.
3. Artifact link blueprint.
