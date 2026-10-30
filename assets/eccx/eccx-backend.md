---
name: eccx-backend
description: "Run a full Backend plan for a goal using every relevant ECC + 8sync skill in this category"
argument-hint: "<goal> [--dry-run]"
---

# /eccx-backend — Backend

Goal: `$ARGUMENTS` (`--dry-run` = stop after the plan).
Scope: APIs, databases, infra, deploy, Node/.NET/PHP, Encore/Eino, Rust. Rust (rust-*) sits here: the ECC web catalog has no Rust category.

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
- `skill://ai-microservice-design` — An LLM gateway, RAG retrieval, an agent/tool-use loop, per-member keys + usage
- `api-connector-builder` — Build a new API connector or provider by matching the target repo's
- `api-design` — REST API design: resource naming, status codes, pagination, and versioning
- `backend-patterns` — Node.js, Express, and Next.js API architecture and optimization
- `bun-runtime` — Bun as runtime, package manager, bundler, and test runner
- `canary-watch` — Checks HTTP endpoints, SSE streams, static assets, console errors, and performance regressions
- `cisco-ios-patterns` — Cisco IOS and IOS-XE review patterns for show commands, config hierarchy, wildcard
- `clickhouse-io` — ClickHouse analytics, query optimization, and data engineering patterns
- `contract-first` — Coordinate frontend/backend or service-to-service work through one authoritative machine-checkable contract
- `csharp-testing` — C# and .NET testing patterns with xUnit, FluentAssertions, mocking, integration
- `data-throughput-accelerator` — Diagnose and accelerate large data movement
- `dotnet-patterns` — Idiomatic C# and .NET patterns, conventions, dependency injection, async/await, and best practices
- `skill://encore-deploy` — Deploy/secrets/rollout runbook for the 8syncdev Encore Cloud backend and Vercel frontends
- `skill://encore-eino-go` — .dev (infrastructure-as-code services, typed SQL, cron, pubsub, auth, secrets) with CloudWeEino
- `error-handling` — Patterns for robust error handling across TypeScript, Python, and Go
- `flox-environments` — Create reproducible, cross-platform (macOS/Linux) development environments with Flox, a declarative Nix-based environment
- `fsharp-testing` — F# testing patterns with xUnit, FsUnit, Unquote, FsCheck property-based testing, integration tests
- `hexagonal-architecture` — Design, implement, and refactor Ports & Adapters systems with clear domain boundaries
- `homelab-network-readiness` — Readiness checklist for homelab VLAN segmentation, local DNS filtering (Pi-hole, AdGuard Home)
- `homelab-network-setup` — Practical home and homelab network planning for gateways, switches, access points, IP
- `homelab-pihole-dns` — Pi-hole installation, blocklist management, DNS-over-HTTPS setup, DHCP integration, local DNS
- `homelab-vlan-segmentation` — Segmenting home networks into VLANs for IoT, guest, trusted, and server traffic
- `homelab-wireguard-vpn` — WireGuard VPN server setup, peer configuration, key generation, split tunneling vs full
- `kubernetes-patterns` — Kubernetes workload patterns, resource management, RBAC, probes, autoscaling, ConfigMap/Secret handling, and kubectl
- `laravel-patterns` — Laravel architecture patterns, routing/controllers, Eloquent ORM, service
- `laravel-plugin-discovery` — Discover and evaluate Laravel packages via LaraPlugins.io MCP. Use when the user
- `laravel-tdd` — Laravel testing strategies with PHPUnit, Pest, model factories, HTTP tests, Sanctum authentication
- `laravel-verification` — Verification loop for Laravel projects: env checks, linting, static analysis, tests
- `latency-critical-systems` — Optimize and verify latency-sensitive systems
- `mcp-server-patterns` — Build MCP servers with Node/TypeScript SDK
- `mysql-patterns` — MySQL and MariaDB schema, query, indexing, transaction, replication, and connection-pool patterns
- `nestjs-patterns` — NestJS architecture patterns for modules, controllers, providers, DTO validation, guards, interceptors, config
- `netmiko-ssh-automation` — Safe Python Netmiko patterns for read-only collection, bounded batch SSH, TextFSM parsing
- `network-bgp-diagnostics` — Diagnostics-only BGP troubleshooting patterns for neighbor state, route exchange, prefix
- `network-config-validation` — Pre-deployment checks for router and switch configuration, including dangerous commands, duplicate addresses
- `network-interface-health` — Diagnose interface errors, drops, CRCs, duplex mismatches, flapping, speed negotiation
- `postgres-patterns` — PostgreSQL query optimization, indexing, and schema design
- `prisma-patterns` — Prisma ORM patterns for TypeScript backends
- `rails-patterns` — Ruby on Rails framework patterns for Rails 7.1+ and 8.x apps
- `redis-patterns` — Redis data structure patterns, caching strategies, distributed locks, rate
- `rust-patterns` — Idiomatic Rust patterns, ownership, error handling, traits, concurrency, and best practices
- `rust-testing` — Rust testing patterns including unit tests, integration tests, async testing, property-based testing
- `scientific-db-pubmed-database` — Direct PubMed and NCBI E-utilities search workflows for biomedical literature, MeSH queries
- `scientific-db-uspto-database` — USPTO patent and trademark data workflow for official record lookup, PatentSearch queries
- `skill://tauri-v2` — Migrating (v1→v2), or debugging a Tauri 2.x desktop app
- `terminal-opener` — Open an executable and its argument array in a visible terminal window
- `tinystruct-patterns` — Expert guidance for developing with the tinystruct Java framework
- `uncloud` — Deploying services, configuring Caddy ingress, adding static proxy routes for non-cluster devices

## Agents
- `csharp-reviewer` — Expert C# code reviewer specializing in .NET conventions, async patterns, security, nullable
- `database-reviewer` — PostgreSQL specialist for query optimization and schema design
- `fsharp-reviewer` — Expert F# code reviewer specializing in functional idioms, type safety, pattern matching
- `homelab-architect` — Designs home and small-lab network plans from hardware inventory, goals, and operator
- `network-architect` — Designs enterprise or multi-site network architecture from requirements, using existing network skills
- `network-config-reviewer` — Reviews router and switch configurations for security, correctness, stale references, risky change-window
- `network-troubleshooter` — Diagnoses network connectivity, routing, DNS, interface, and policy symptoms with a read-only
- `php-reviewer` — Expert PHP code reviewer specializing in PSR-12 compliance, PHP type system, Eloquent
- `ruby-reviewer` — Expert Ruby and Rails code reviewer specializing in idiomatic Ruby, Active Record
- `rust-build-resolver` — Rust build, compilation, and dependency error resolution specialist
- `rust-reviewer` — Expert Rust code reviewer specializing in ownership, lifetimes, error handling, unsafe usage

## Commands
- `rust-build` — Fix Rust build errors, borrow checker issues, and dependency problems incrementally
- `rust-review` — Comprehensive Rust code review for ownership, lifetimes, error handling, unsafe
- `rust-test` — Enforce TDD workflow for Rust
