---
description: "Run a full JVM plan for a goal using every relevant ECC + 8sync skill in this category"
argument-hint: "<goal> [--dry-run]"
disable-model-invocation: true
---

# /eccx-jvm — JVM

Goal: `$ARGUMENTS` (`--dry-run` = stop after the plan).
Scope: Java, Kotlin, Spring, Quarkus, Android/Compose.

1. **Select.** From the lists below pick EVERY member that applies to the goal — default to inclusion. List picks with a one-line why; name notable skips.
2. **Load on demand.** Read a picked skill only just before the step that uses it. Never preload all.
3. **Plan.** Numbered steps, each mapped to its skills/agents/commands and its check. `--dry-run`: print the plan and stop.
4. **Execute** step by step with `ecc:verification-loop` discipline: after each code step run the project's real build/type-check/lint/tests as applicable; fix before moving on; no step is done without its check output.
5. **Report** (short): what changed, checks + results, members skipped, open risks.

## How to call members
- `ecc:` members: plugin `ecc@ecc` on → Skill tool / `subagent_type` / `/ecc:<cmd>`; off (saves ~9k tokens a call) → read `<ECC>/skills/<name>/SKILL.md`, a `general-purpose` agent opening with `<ECC>/agents/<agent>.md`, `<ECC>/commands/<cmd>.md`. `<ECC>` = newest `~/.claude/plugins/cache/ecc/ecc/*/`. Plain name = 8sync skill (Skill tool).
- One session: parallel members = Agent calls in one message or one Workflow, no sub-sessions. Unresolved member: skip it, say so.

## Skills
- `ecc:android-clean-architecture` — Clean Architecture for Android and KMP: modules, UseCases, and Repositories
- `ecc:compose-multiplatform-patterns` — Compose UI patterns for KMP: state, navigation, theming, and platform UI
- `ecc:java-coding-standards` — Java coding conventions, naming, and modern Java idioms
- `ecc:jpa-patterns` — JPA/Hibernate patterns, entity design, and query optimization
- `ecc:kotlin-coroutines-flows` — Coroutine patterns, Flow operators, and structured concurrency
- `ecc:kotlin-exposed-patterns` — Exposed ORM patterns for Kotlin database access
- `ecc:kotlin-ktor-patterns` — Ktor server patterns, routing, serialization, and plugins
- `ecc:kotlin-patterns` — Idiomatic Kotlin, null safety, sealed classes, and DSL design
- `ecc:kotlin-testing` — Kotlin testing with MockK, Kotest, and coroutine test patterns
- `ecc:mybatis-patterns` — MyBatis and MyBatis-Spring patterns for mapper design, XML and annotation SQL, result
- `ecc:quarkus-patterns` — Quarkus 3.x LTS architecture patterns with Camel for messaging, RESTful API design
- `ecc:quarkus-security` — Quarkus security implementation patterns: JWT and OIDC authentication, @RolesAllowed RBAC and SecurityIdentity
- `ecc:quarkus-tdd` — Test-driven development for Quarkus 3.x LTS using JUnit 5, Mockito, REST Assured
- `ecc:quarkus-verification` — Verification loop for Quarkus projects: build, static analysis (Checkstyle, PMD, SpotBugs), tests
- `ecc:springboot-patterns` — Spring Boot architecture, dependency injection, and configuration
- `ecc:springboot-tdd` — Spring Boot testing with MockMvc, Testcontainers, and slicing
- `ecc:springboot-verification` — Spring Boot verification loop for build, tests, and deployment

## Agents
- `ecc:java-build-resolver` — Java/Maven/Gradle build, compilation, and dependency error resolution specialist
- `ecc:java-reviewer` — Expert Java code reviewer for Spring Boot and Quarkus projects
- `ecc:kotlin-build-resolver` — Kotlin/Gradle build and dependency error resolution
- `ecc:kotlin-reviewer` — Kotlin and Android/KMP code review for patterns and pitfalls

## Commands
- `/ecc:gradle-build` — Fix Gradle build configuration issues
- `/ecc:kotlin-build` — Fix Kotlin/Gradle build errors
- `/ecc:kotlin-review` — Run Kotlin code review
- `/ecc:kotlin-test` — Run Kotlin tests
