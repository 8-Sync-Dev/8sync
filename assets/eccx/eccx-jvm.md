---
name: eccx-jvm
description: "Run a full JVM plan for a goal using every relevant ECC + 8sync skill in this category"
argument-hint: "<goal> [--dry-run]"
---

# /eccx-jvm — JVM

Goal: `$ARGUMENTS` (`--dry-run` = stop after the plan).
Scope: Java, Kotlin, Spring, Quarkus, Android/Compose.

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
- `android-clean-architecture` — Clean Architecture for Android and KMP: modules, UseCases, and Repositories
- `compose-multiplatform-patterns` — Compose UI patterns for KMP: state, navigation, theming, and platform UI
- `java-coding-standards` — Java coding conventions, naming, and modern Java idioms
- `jpa-patterns` — JPA/Hibernate patterns, entity design, and query optimization
- `kotlin-coroutines-flows` — Coroutine patterns, Flow operators, and structured concurrency
- `kotlin-exposed-patterns` — Exposed ORM patterns for Kotlin database access
- `kotlin-ktor-patterns` — Ktor server patterns, routing, serialization, and plugins
- `kotlin-patterns` — Idiomatic Kotlin, null safety, sealed classes, and DSL design
- `kotlin-testing` — Kotlin testing with MockK, Kotest, and coroutine test patterns
- `mybatis-patterns` — MyBatis and MyBatis-Spring patterns for mapper design, XML and annotation SQL, result
- `quarkus-patterns` — Quarkus 3.x LTS architecture patterns with Camel for messaging, RESTful API design
- `quarkus-security` — Quarkus security implementation patterns: JWT and OIDC authentication, @RolesAllowed RBAC and SecurityIdentity
- `quarkus-tdd` — Test-driven development for Quarkus 3.x LTS using JUnit 5, Mockito, REST Assured
- `quarkus-verification` — Verification loop for Quarkus projects: build, static analysis (Checkstyle, PMD, SpotBugs), tests
- `springboot-patterns` — Spring Boot architecture, dependency injection, and configuration
- `springboot-tdd` — Spring Boot testing with MockMvc, Testcontainers, and slicing
- `springboot-verification` — Spring Boot verification loop for build, tests, and deployment

## Agents
- `java-build-resolver` — Java/Maven/Gradle build, compilation, and dependency error resolution specialist
- `java-reviewer` — Expert Java code reviewer for Spring Boot and Quarkus projects
- `kotlin-build-resolver` — Kotlin/Gradle build and dependency error resolution
- `kotlin-reviewer` — Kotlin and Android/KMP code review for patterns and pitfalls

## Commands
- `gradle-build` — Fix Gradle build configuration issues
- `kotlin-build` — Fix Kotlin/Gradle build errors
- `kotlin-review` — Run Kotlin code review
- `kotlin-test` — Run Kotlin tests
