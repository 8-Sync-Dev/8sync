---
name: eccx-frontend
description: "Run a full Frontend plan for a goal using every relevant ECC + 8sync skill in this category"
argument-hint: "<goal> [--dry-run]"
---

# /eccx-frontend — Frontend

Goal: `$ARGUMENTS` (`--dry-run` = stop after the plan).
Scope: UI, design systems, React/Vue/Next, a11y, motion, web quality.

1. **Select.** From the lists below pick EVERY member that applies to the goal — default to inclusion. List picks with a one-line why; name notable skips.
2. **Load on demand.** Read a picked skill only just before the step that uses it. Never preload all.
3. **Plan.** Numbered steps, each mapped to its skills/agents/commands and its check. `--dry-run`: print the plan and stop.
4. **Execute** step by step with `verification-loop` discipline: after each code step run the project's real build/type-check/lint/tests as applicable; fix before moving on; no step is done without its check output.
5. **Report** (short): what changed, checks + results, members skipped, open risks.

## How to call members
- `<ECC>` = 8sync's pinned ECC checkout `~/.cache/8sync/ecc/` (made by `8sync harness`), else the newest dir under `~/.claude/plugins/cache/ecc/ecc/`.
- Skills: `skill://<name>` = 8sync skill; plain name = ECC skill: `skill://<name>` if it resolves, else read `<ECC>/skills/<name>/SKILL.md`.
- Agents: spawn a `task` subagent whose prompt opens with the role file `<ECC>/agents/<agent>.md`.
- Commands: read `<ECC>/commands/<cmd>.md` and follow it with that step's arguments.
- A member that does not resolve: skip it, say so.

## Skills
- `accessibility` — Design, implement, and audit accessible UI to WCAG 2.2 Level AA across
- `angular-developer` — Generates Angular code and provides architectural guidance
- `benchmark` — Measure performance baselines and detect regressions across browser Core Web Vitals
- `browser-qa` — Run automated post-deploy UI verification with a browser automation MCP
- `dart-flutter-patterns` — Production-ready Dart and Flutter patterns covering null safety, immutable state with Freezed
- `design-system` — Generate a design system from an existing codebase or audit one
- `skill://design-taste-frontend` — Anti-slop frontend skill for landing pages, portfolios, and redesigns
- `flutter-dart-code-review` — Library-agnostic Flutter/Dart code review checklist covering widget best practices, state management patterns
- `frontend-a11y` — Accessibility patterns for React and Next.js
- `frontend-design-direction` — Set an ECC-specific frontend design direction for production UI work
- `frontend-patterns` — React, Next.js, state management, performance, and UI best practices
- `frontend-slides` — Presentation and slide deck generation with web technologies
- `i18n-sync` — Translate and synchronize application JSON locale files using source-key usage, project terminology
- `skill://impeccable` — Redesign, shape, critique, audit, polish, clarify, distill, harden, optimize, adapt, animate, colorize
- `liquid-glass-design` — Apple-inspired liquid glass and translucent UI patterns
- `make-interfaces-feel-better` — Apply concrete design-engineering details that make interfaces feel polished
- `motion-advanced` — Advanced motion patterns for React / Next.js
- `motion-foundations` — Motion tokens, spring presets, performance rules, device adaptation, accessibility enforcement, and SSR
- `motion-patterns` — Production-ready animation patterns for React / Next.js
- `skill://nextjs-app` — Editing, or debugging a Next.js App Router app (Next 15/16, React 19)
- `nextjs-turbopack` — Next.js 16+ and Turbopack guidance
- `nuxt4-patterns` — Nuxt 4 app patterns for hydration safety, performance, route rules, lazy loading
- `react-native-patterns` — React Native and Expo app patterns
- `react-patterns` — React 18/19 patterns including hooks discipline, server/client component boundaries, Suspense + error
- `react-performance` — React and Next.js performance optimization patterns adapted from Vercel Engineering's React Best
- `react-testing` — React component testing with React Testing Library, Vitest/Jest, MSW for network mocking
- `skill://senior-frontend` — Frontend development skill for React, Next.js, TypeScript, and Tailwind CSS applications
- `seo` — Audit, plan, and implement SEO improvements across technical SEO, on-page optimization, structured
- `skill://taste-brutalist` — Raw mechanical interfaces fusing Swiss typographic print with military terminal aesthetics
- `skill://taste-minimalist` — Clean editorial-style interfaces
- `skill://taste-redesign` — Upgrades existing websites and apps to premium quality
- `skill://taste-soft` — Teaches the AI to design like a high-end agency
- `skill://tauri-v2` — Migrating (v1→v2), or debugging a Tauri 2.x desktop app
- `ui-to-vue` — Especially with Vant, Element Plus, or Ant Design Vue
- `vite-patterns` — Vite build tool patterns including config, plugins, HMR, env variables, proxy setup
- `vue-patterns` — Vue.js 3 Composition API patterns, component architecture, reactivity best practices, Pinia state

## Agents
- `a11y-architect` — Accessibility Architect specializing in WCAG 2.2 compliance for Web and Native platforms
- `dart-build-resolver` — Dart/Flutter build, analysis, and dependency error resolution specialist
- `flutter-reviewer` — Flutter and Dart code reviewer
- `react-build-resolver` — Diagnose and fix React build failures across Vite, webpack, Next.js, CRA, Parcel
- `react-reviewer` — Expert React/JSX code reviewer specializing in hook correctness, render performance, server/client component
- `typescript-reviewer` — Expert TypeScript/JavaScript code reviewer specializing in type safety, async correctness, Node/web security
- `vue-reviewer` — Expert Vue.js code reviewer specializing in Composition API correctness, reactivity pitfalls, component

## Commands
- `flutter-build` — Fix Dart analyzer errors and Flutter build failures incrementally
- `flutter-review` — Review Flutter/Dart code for idiomatic patterns, widget best practices, state management, performance
- `flutter-test` — Run Flutter/Dart tests, report failures, and incrementally fix test issues
- `gan-design` — Run a generator/evaluator design loop for frontend or visual work with bounded
- `react-build` — Fix React build failures (Vite, webpack, Next.js, CRA, Parcel, esbuild, Bun) incrementally
- `react-review` — Comprehensive React/JSX code review for hook correctness, render performance, server/client component boundaries
- `react-test` — Enforce TDD workflow for React
- `vue-review` — Comprehensive Vue.js code review for Composition API correctness, reactivity, composable patterns, template
