# hq-ui-next-cve — apps/hq-ui on Next 16.4.1 (advisories in 16.0.0–16.4.0)

Source: found by the `/sec` dependency step (`pnpm audit --prod` in apps/hq-ui) during `/autopilot`
item hq-ui-port (2026-10-27). Not from STATE Next; picked because the fix is a patch bump with checkable criteria.

## Problem
`pnpm audit --prod` (apps/hq-ui, next 16.4.0) reports, all fixed in 16.4.1:
- critical GHSA-2464-fhr4-w9xw: RCE in the Image Optimization API with SVG files;
- critical GHSA-673q-mjm6-r5xr: RCE in `use cache` functions returning typed arrays;
- high GHSA-p3m5-59mp-jv5r: DoS in App Router Server Actions.

Exposure today looks low: `next.config.ts` has `images: { unoptimized: true }`, and hq-ui's own code has no
`use cache`, `use server` or `dangerouslyAllowSVG`. HQ binds 127.0.0.1, but `8sync hq ui --public` can put it
behind a public tunnel, and the release asset ships whatever Next is locked, so we bump.

## Design
- `next` and `eslint-config-next` 16.4.0 → 16.4.1 in `apps/hq-ui/package.json`; `pnpm install` updates
  `pnpm-lock.yaml` (only `next`, `@next/*` and `eslint-config-next` entries change).
- Out of scope: other dependency upgrades, `next upgrade` codemods.

## Acceptance criteria (each one command, exit 0 = pass)
| # | Criterion | Command |
|---|---|---|
| C1 | no production advisories left | `pnpm audit --prod` (in apps/hq-ui) |
| C2 | typecheck + whole hq-ui test suite | `pnpm exec next typegen && pnpm exec tsc --noEmit && pnpm exec vitest run` (in apps/hq-ui) |
| C3 | lint (first half of `pnpm build`) | `pnpm exec eslint` (in apps/hq-ui) |
| C4 | CI green: hq-ui-test, package-hq-ui (next build + tarball boots), tests on 3 OS | `gh run view <id>` |
