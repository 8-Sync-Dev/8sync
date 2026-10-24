---
name: nextjs-app
description: Use when building, editing, or debugging a Next.js App Router app (Next 15/16, React 19) — anything involving the `app/` route tree, Server Components vs `'use client'`, Server Actions, Route Handlers, the fetch cache, `middleware.ts`, SEO/metadata, an Encore.ts (or other) backend client, a Turborepo monorepo, or Vercel/Docker deployment. Produces correct RSC boundaries, non-stale caching, verified UI. Grounded in the Next.js 16 App Router canon; extends with the 8syncdev repo patterns + omp-native tooling (trail · engine_* · browser).
locked: true
---

# nextjs-app — Next.js 16 App Router, done right

You are working on a Next.js **App Router** project (Next 15/16.x, React 19). The App Router is not the Pages Router: the failure modes here are *boundary placement* (RSC vs Client), *silent stale data* (the fetch cache), and *invalidation that never fires*. This skill makes those load-bearing decisions explicit and grounds every step in a real omp tool.

> Canonical base: `references/base.md` (Next.js 16 mental model + the cache trap).
> Opinionated patterns: `references/patterns.md` (real `repo:path` citations from `8syncdev/crm-pro-ai`, `8syncdev/8syncdev-pro-v2`, `8syncdev/8sync-verse`).

## When to use

- Editing any file under `app/` (or `src/app/`): pages, layouts, route groups, `loading.tsx`/`error.tsx`/`not-found.tsx`.
- Adding a Server Action (`'use server'`) or a Route Handler (`app/api/*/route.ts`).
- Anything touching **caching**: `fetch` options, `unstable_cache`, `revalidatePath`/`revalidateTag`, ISR, `cacheComponents`/PPR.
- Auth/redirect/rewrite logic → `middleware.ts` (Edge runtime).
- Wiring an external backend (Encore.ts generated client, REST, GraphQL).
- Turborepo/Bun monorepo with multiple Next apps sharing `packages/*`.
- Deploying: Vercel multi-project, self-host Docker (`output: 'standalone'`), or static export (`output: 'export'`).

## When NOT to use

- **Pages Router** (`pages/` directory) — legacy. Only engage if the repo genuinely uses it.
- **Migrating Pages → App** — separate task; this skill assumes App Router already.
- Choosing a CSS framework (Tailwind/CSS Modules/unocss) — out of scope; follow the repo's existing choice.

## Procedure

Every step names a real omp tool. Do not improvise alternatives.

### 0. Ground yourself before editing — map the route tree, do not guess

You NEVER open `app/` files hoping. Before editing:

1. **trail**: `trail build` then `trail ask "route tree, middleware, server actions"`. Locate routes, actions, and the backend client in one call; `trail callers <symbol>` for a call chain RSC→action→backend; `trail skeleton <file>` for per-file symbols.
3. Confirm the **App vs Pages** boundary: if `app/` exists, you're here. `src/app/` is the same router (just under `src/`).

### 1. Place the RSC vs Client boundary correctly

- **Default = Server Component.** It can be `async`, can `await fetch()`/DB/`cookies()`/`headers()` directly, and streams over the network — never ships its source or heavy deps to the browser.
- Add `'use client'` **only** when a module needs `useState`/`useEffect`/event handlers/browser APIs/class components. A `'use client'` file CAN still import and render Server Components as `children` props (pass them down; never import an RSC into a client module).
- Rule of thumb confirmed across 8syncdev repos: **fetch data in the Server Component, pass serializable props to a small `'use client'` leaf** that owns only the interactivity. Keep the client surface minimal — it's what ends up in the bundle.

### 2. Data fetching + the fetch cache (the thing that silently serves stale data)

This is the #1 source of Next bugs. **Next 15+ changed the default: `fetch` is no longer cached.** `fetch(url)` behaves like `cache: 'no-store'` unless you opt in.

- **Dynamic / user-specific data** (CRM rows, auth, dashboards): leave uncached, or set `cache: 'no-store'` explicitly. The 8syncdev CRM api-client pins `cache: 'no-store'` for exactly this.
- **Slowly-changing / public data** (marketing, catalogue): `fetch(url, { next: { revalidate: 3600 } })` (time) or `{ next: { tags: ['products'] } })` then invalidate by tag.
- **Per-request data** (cookies/headers in the tree): that route is dynamic by definition — don't fight it.
- `unstable_cache(fn, keys, { revalidate, tags })` wraps a non-`fetch` function (DB calls) the same way.
- `generateStaticParams` for `[param]` pages you want prerendered at build.

When a page mysteriously shows stale data, the cause is almost always a `fetch` that picked up `force-cache` (or a leftover `{ revalidate }` you forgot). Grep the data path with `trail grep "<fetch site>"` and read the option.

### 3. Mutations: Server Actions vs Route Handlers

| Need | Use |
|---|---|
| Form submit / button that mutates server state and revalidates | **Server Action** (`'use server'` async fn). Pass to a client component or a `<form action={fn}>`. Call `revalidatePath`/`revalidateTag` at the end. |
| Webhook receiver, third-party callback, streaming proxy, public REST endpoint | **Route Handler** (`app/api/<path>/route.ts`, export `GET`/`POST`/…). |
| Need raw `Request`/`Response` control (CORS, streaming body, proxy) | **Route Handler** — Server Actions can't do this. |

Server Actions are RPC over POST to a compiled endpoint; they revalidate the router cache automatically only if you ask. Route Handlers are plain HTTP.

### 4. Cache invalidation that actually fires

After a mutation, **explicitly** invalidate — nothing revalidates on its own:

- `revalidatePath('/dashboard')` (or `revalidatePath('/', 'layout')` for everything under a layout).
- `revalidateTag('products')` if you fetched with that tag.
- Both throw if called outside a Server Action / Route Handler / `generateMetadata` request context.

**Prove it** (see Acceptance): mutate, reload the page, assert the new value appears. A passing build does NOT prove revalidation.

### 5. Middleware (Edge runtime) — auth, rewrite, locale

`middleware.ts` at the project root (or `src/middleware.ts`) runs on the **Edge runtime** before routing, on (almost) every request.

- Use it for: auth redirects, locale prefix routing, A/B rewrite, geo redirect.
- It runs in Edge: **no** Node APIs, **no** most npm deps, **no** DB drivers. Do auth by verifying a cookie/JWT or calling a lightweight Edge-friendly endpoint.
- Scope it with a `matcher` config so it doesn't run on static assets / `/api` you don't own.
- next-intl v4 (used by `crm-pro-ai`) can do locale routing via the `[locale]` segment + `setRequestLocale` **without** a middleware, or with `createMiddleware` — match the repo's existing choice.

### 6. External backend client (Encore.ts / REST / GraphQL)

Two integration shapes, both present in 8syncdev repos — pick by reading the repo:

- **Generated typed client** (Encore.ts): `encore gen client <lang>` → `packages/core/src/api/client.ts`. `const client = new Client(Environment('prod'))` then `await client.user.getUsers({page:1,size:20})`. Fully typed; use in Server Components/Actions. (`8syncdev/8sync-verse:packages/core/src/api/client.ts`)
- **BFF proxy + shared api-client** (CORS-safe): a catch-all Route Handler forwards to the backend, injecting auth from an httpOnly cookie; Server Actions call the backend directly server-side. (`8syncdev/crm-pro-ai:apps/web/src/app/api/backend/[...slug]/route.ts` + `src/lib/actions/common/api-client.ts`)

Never put a raw backend URL + secret in a Client Component. Resolve env server-side; proxy browser calls through `/api`.

### 7. Metadata / SEO

- Static: `export const metadata: Metadata = {…}` in a layout/page (title template, openGraph, twitter, robots, metadataBase).
- Dynamic: `export async function generateMetadata({ params }): Promise<Metadata>` (params is a Promise in Next 15+ — `await` it).
- File conventions (zero code): `app/{icon,apple-icon,opengraph-image}.{tsx,png}`, `app/manifest.ts`, `app/robots.ts`, `app/sitemap.ts`. The 8syncdev repos use all of these.

### 8. Deployment: Vercel vs Docker/self-host vs static export; env vars

- **Vercel** (8syncdev default for web): multi-project monorepo — each `apps/<name>` is a Vercel project with its Root Directory; `turbo-ignore` skips unaffected apps; env vars per project (prefix `NEXT_PUBLIC_*` to expose to browser). Edge runtime + ISR/PPR + per-PR preview URLs.
- **Self-host / Docker**: set `output: 'standalone'` in `next.config.ts`, build, copy `.next/standalone` + `.next/static`, run `node server.js` (or `next start`). Resolve env at runtime, NOT build — `NEXT_PUBLIC_*` is inlined at build time.
- **Static export**: `output: 'export'` → fully static `out/` (no Server Actions, no middleware, no ISR). Used by `8sync-verse` learn app.
- **Env rule**: `NEXT_PUBLIC_*` is the *only* prefix the browser can see. Everything else is server-only. Verify with `trail grep NEXT_PUBLIC` / `git diff` after wiring env so no secret leaks into a client module.

### 9. Build loop + UI verification

- **Plan the work as gated tasks**: `engine_plan` a slice whose verify commands are the project's real `next build` / `next lint` / `tsc --noEmit` / e2e. Pull the next task with `engine_next`, run `engine_verify` (ALL commands must pass), commit with `engine_advance`. Do NOT hand-roll loops.
- **UI = eyes, not assumption.** Start the dev server, then drive the real flow with the `browser` tool (`xd://browser`): `open` → `run` (`tab.observe()`, click, fill), screenshot the result. Capture artifacts with `8sync shot <url> -o /tmp/x.png`; compare before/after with `8sync diff-img`. A green `next build` does not prove the button works — a screenshot does.
- Fan out independent route edits with `task` subagents (scout for read-only route-tree mapping; worker for edits). Share the route-tree map via `local://` URIs, not pasted text.

## Acceptance check

Before declaring done, ALL of these must hold:

1. **`next build` clean** — zero errors; dynamic/static prerender report matches intent (routes you expect prerendered are prerendered, dynamic ones are dynamic).
2. **Route tree renders** — drive ≥1 real flow in the `browser`; screenshot evidence (`8sync shot`). No console errors on the pages you touched.
3. **Cache invalidation proven** — for every `revalidatePath`/`revalidateTag` the product depends on: mutate → reload → assert the new value is visible. State which path/tag and how you proved it.
4. **Boundary correct** — no `'use client'` leaks data-fetching that should be server-side; no Server Component reaches for `useState`.
5. **Env hygiene** — no backend secret in a client module; `NEXT_PUBLIC_*` only where the browser truly needs it.

## Non-goals

- Pages Router (legacy) unless the repo actually uses it.
- Pages → App migration (separate task).
- Picking/imposing a CSS framework — follow the repo's existing Tailwind/CSS choice.
- Reinventing omp primitives — this skill composes trail/engine_*/browser/8sync verbs; it never reimplements them.
