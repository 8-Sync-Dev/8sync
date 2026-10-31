---
description: "Run a full Backend plan for a goal using every relevant ECC + 8sync skill in this category"
argument-hint: "<goal> [--dry-run]"
disable-model-invocation: true
---

# /eccx-backend — Backend

Goal: `$ARGUMENTS` (`--dry-run` = stop after the plan).
Scope: APIs, databases, infra, deploy, Node/.NET/PHP, Encore/Eino, Rust. Rust (rust-*) sits here: the ECC web catalog has no Rust category.

1. **Select.** From the lists below pick EVERY member that applies to the goal — default to inclusion. List picks with a one-line why; name notable skips.
2. **Load on demand.** Read a picked skill only just before the step that uses it. Never preload all.
3. **Plan.** Numbered steps, each mapped to its skills/agents/commands and its check. `--dry-run`: print the plan and stop.
4. **Execute** step by step with `ecc:verification-loop` discipline: after each code step run the project's real build/type-check/lint/tests as applicable; fix before moving on; no step is done without its check output.
5. **Report** (short): what changed, checks + results, members skipped, open risks.

## How to call members
- `ecc:` members: plugin `ecc@ecc` on → Skill tool / `subagent_type` / `/ecc:<cmd>`; off (saves ~9k tokens a call) → read `<ECC>/skills/<name>/SKILL.md`, a `general-purpose` agent opening with `<ECC>/agents/<agent>.md`, `<ECC>/commands/<cmd>.md`. `<ECC>` = newest `~/.claude/plugins/cache/ecc/ecc/*/`. Plain name = 8sync skill (Skill tool).
- One session: parallel members = Agent calls in one message or one Workflow, no sub-sessions. Unresolved member: skip it, say so.

## Skills
- `ai-microservice-design` — An LLM gateway, RAG retrieval, an agent/tool-use loop, per-member keys + usage
- `ecc:api-connector-builder` — Build a new API connector or provider by matching the target repo's
- `ecc:api-design` — REST API design: resource naming, status codes, pagination, and versioning
- `ecc:backend-patterns` — Node.js, Express, and Next.js API architecture and optimization
- `ecc:bun-runtime` — Bun as runtime, package manager, bundler, and test runner
- `ecc:canary-watch` — Checks HTTP endpoints, SSE streams, static assets, console errors, and performance regressions
- `ecc:cisco-ios-patterns` — Cisco IOS and IOS-XE review patterns for show commands, config hierarchy, wildcard
- `ecc:clickhouse-io` — ClickHouse analytics, query optimization, and data engineering patterns
- `ecc:contract-first` — Coordinate frontend/backend or service-to-service work through one authoritative machine-checkable contract
- `ecc:csharp-testing` — C# and .NET testing patterns with xUnit, FluentAssertions, mocking, integration
- `ecc:data-throughput-accelerator` — Diagnose and accelerate large data movement
- `ecc:dotnet-patterns` — Idiomatic C# and .NET patterns, conventions, dependency injection, async/await, and best practices
- `encore-deploy` — Deploy/secrets/rollout runbook for the 8syncdev Encore Cloud backend and Vercel frontends
- `encore-eino-go` — .dev (infrastructure-as-code services, typed SQL, cron, pubsub, auth, secrets) with CloudWeEino
- `ecc:error-handling` — Patterns for robust error handling across TypeScript, Python, and Go
- `ecc:flox-environments` — Create reproducible, cross-platform (macOS/Linux) development environments with Flox, a declarative Nix-based environment
- `ecc:fsharp-testing` — F# testing patterns with xUnit, FsUnit, Unquote, FsCheck property-based testing, integration tests
- `ecc:hexagonal-architecture` — Design, implement, and refactor Ports & Adapters systems with clear domain boundaries
- `ecc:homelab-network-readiness` — Readiness checklist for homelab VLAN segmentation, local DNS filtering (Pi-hole, AdGuard Home)
- `ecc:homelab-network-setup` — Practical home and homelab network planning for gateways, switches, access points, IP
- `ecc:homelab-pihole-dns` — Pi-hole installation, blocklist management, DNS-over-HTTPS setup, DHCP integration, local DNS
- `ecc:homelab-vlan-segmentation` — Segmenting home networks into VLANs for IoT, guest, trusted, and server traffic
- `ecc:homelab-wireguard-vpn` — WireGuard VPN server setup, peer configuration, key generation, split tunneling vs full
- `ecc:kubernetes-patterns` — Kubernetes workload patterns, resource management, RBAC, probes, autoscaling, ConfigMap/Secret handling, and kubectl
- `ecc:laravel-patterns` — Laravel architecture patterns, routing/controllers, Eloquent ORM, service
- `ecc:laravel-plugin-discovery` — Discover and evaluate Laravel packages via LaraPlugins.io MCP. Use when the user
- `ecc:laravel-tdd` — Laravel testing strategies with PHPUnit, Pest, model factories, HTTP tests, Sanctum authentication
- `ecc:laravel-verification` — Verification loop for Laravel projects: env checks, linting, static analysis, tests
- `ecc:latency-critical-systems` — Optimize and verify latency-sensitive systems
- `ecc:mcp-server-patterns` — Build MCP servers with Node/TypeScript SDK
- `ecc:mysql-patterns` — MySQL and MariaDB schema, query, indexing, transaction, replication, and connection-pool patterns
- `ecc:nestjs-patterns` — NestJS architecture patterns for modules, controllers, providers, DTO validation, guards, interceptors, config
- `ecc:netmiko-ssh-automation` — Safe Python Netmiko patterns for read-only collection, bounded batch SSH, TextFSM parsing
- `ecc:network-bgp-diagnostics` — Diagnostics-only BGP troubleshooting patterns for neighbor state, route exchange, prefix
- `ecc:network-config-validation` — Pre-deployment checks for router and switch configuration, including dangerous commands, duplicate addresses
- `ecc:network-interface-health` — Diagnose interface errors, drops, CRCs, duplex mismatches, flapping, speed negotiation
- `ecc:postgres-patterns` — PostgreSQL query optimization, indexing, and schema design
- `ecc:prisma-patterns` — Prisma ORM patterns for TypeScript backends
- `ecc:rails-patterns` — Ruby on Rails framework patterns for Rails 7.1+ and 8.x apps
- `ecc:redis-patterns` — Redis data structure patterns, caching strategies, distributed locks, rate
- `ecc:rust-patterns` — Idiomatic Rust patterns, ownership, error handling, traits, concurrency, and best practices
- `ecc:rust-testing` — Rust testing patterns including unit tests, integration tests, async testing, property-based testing
- `ecc:scientific-db-pubmed-database` — Direct PubMed and NCBI E-utilities search workflows for biomedical literature, MeSH queries
- `ecc:scientific-db-uspto-database` — USPTO patent and trademark data workflow for official record lookup, PatentSearch queries
- `sysdesign` — System design for a real change
- `tauri-v2` — Migrating (v1→v2), or debugging a Tauri 2.x desktop app
- `ecc:terminal-opener` — Open an executable and its argument array in a visible terminal window
- `ecc:tinystruct-patterns` — Expert guidance for developing with the tinystruct Java framework
- `ecc:uncloud` — Deploying services, configuring Caddy ingress, adding static proxy routes for non-cluster devices

## Agents
- `ecc:csharp-reviewer` — Expert C# code reviewer specializing in .NET conventions, async patterns, security, nullable
- `ecc:database-reviewer` — PostgreSQL specialist for query optimization and schema design
- `ecc:fsharp-reviewer` — Expert F# code reviewer specializing in functional idioms, type safety, pattern matching
- `ecc:homelab-architect` — Designs home and small-lab network plans from hardware inventory, goals, and operator
- `ecc:network-architect` — Designs enterprise or multi-site network architecture from requirements, using existing network skills
- `ecc:network-config-reviewer` — Reviews router and switch configurations for security, correctness, stale references, risky change-window
- `ecc:network-troubleshooter` — Diagnoses network connectivity, routing, DNS, interface, and policy symptoms with a read-only
- `ecc:php-reviewer` — Expert PHP code reviewer specializing in PSR-12 compliance, PHP type system, Eloquent
- `ecc:ruby-reviewer` — Expert Ruby and Rails code reviewer specializing in idiomatic Ruby, Active Record
- `ecc:rust-build-resolver` — Rust build, compilation, and dependency error resolution specialist
- `ecc:rust-reviewer` — Expert Rust code reviewer specializing in ownership, lifetimes, error handling, unsafe usage

## Commands
- `/ecc:rust-build` — Fix Rust build errors, borrow checker issues, and dependency problems incrementally
- `/ecc:rust-review` — Comprehensive Rust code review for ownership, lifetimes, error handling, unsafe
- `/ecc:rust-test` — Enforce TDD workflow for Rust
