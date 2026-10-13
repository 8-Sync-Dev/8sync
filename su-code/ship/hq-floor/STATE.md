# STATE — hq-floor
## Goal
See PLAN.md. Pixel-office floor for `8sync hq ui`, on brand, AI Elements chat, simpler UX.
## Checklist
- [x] Plan + R&D (sprite-forge: API image gen or Python codeart only, no ready sprites → owner chose code-drawn pixel art; brand from 8syncdev-pro-v2; hq-ui data map)
- [x] R  Rust fields last_tool / stalled_error (14 session_view tests pass)
- [x] S  sprites + floor view + /api/floor (stalled only with open work)
- [x] B  brand + UX + AI Elements chat (display only)
- [x] C  CI job hq-ui-test (typegen, tsc, vitest) + tarball artifact
- [ ] Test (CI green)
- [ ] UAT (packaged artifact, real sessions, screenshot)
- [ ] Review
- [ ] Docs + CHANGELOG + memory
- [ ] Commit
## Evidence
## Next
Dispatch R, S, B in parallel; C myself.
- local (nice 19): `pnpm exec tsc --noEmit` rc=0; `pnpm exec vitest run` → 11 files, 172 tests passed; eslint clean; `cargo test session_view` → 14 passed (agent R).
