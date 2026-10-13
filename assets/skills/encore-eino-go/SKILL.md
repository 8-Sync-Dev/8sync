---
name: encore-eino-go
description: Use when building or editing a Go backend that combines Encore.dev (infrastructure-as-code services, typed SQL, cron, pubsub, auth, secrets) with CloudWeEino (LLM orchestration — ChatModel, ReAct agent, tools, retriever, streaming). Produces Encore service scaffolding, an Eino pipeline hosted behind an `//encore:api`, a green `encore test`/`go test ./...`, and a code-gen-clean `encore.gen.go`. Grounded in Encore.go v1.57.x + Eino v0.9.x canonical bases; extends with the 8syncdev go-kit workflow and omp-native code-intelligence tooling.
locked: true
---

# encore-eino-go — Encore.go + Eino LLM orchestration in one Go codebase

## When to use
- You are starting or extending a Go service group where Encore hosts the infra (services, DB, cron, pubsub, auth, secrets) **and** an LLM pipeline (Eino ChatModel → ReAct agent → tools → streaming) runs inside an Encore API/service.
- User says any of: "Encore Go service", "add an `//encore:api`", "encore.gen.go is stale", "wire Eino into Encore", "ReAct agent in Go", "stream tokens from an Encore endpoint", "encore cron / pubsub / secret / auth handler".
- You need to verify a running Encore app boots, serves, and the Eino graph streams end-to-end.

## When NOT to use
- **Encore.ts** (TypeScript variant) is the target — this skill is Go-first. Encore.ts shares the annotation model but a different SDK/runtime; defer to Encore.ts-specific guidance. (Noted only as a sibling, not migrated here.)
- Pure Go with no Encore and no LLM — use the language skill, not this one.
- Migrating an existing Encore.ts app to Go, or hand-rewriting generated `encore.gen.go`.

## Mental model: how the two layers compose
- **Encore = infra boundary.** A *service* is a Go package with `//encore:service` + an optional `initService`. APIs are annotated `func`s (`//encore:api`). Encore *generates* `encore.gen.go` (the typed client surface + types) — you never edit it. SQL is typed via `encore.dev/storage/sqldb`; cron/pubsub/auth/secrets are `encore.dev/*` packages wired by annotation, not config files.
- **Eino = LLM boundary.** Components (`model.ToolCallingChatModel`, `tool.BaseTool`, retriever, embedder) are composed by Eino's `flow/agent/react` (or `compose`) into an agent. The agent is an ordinary Go object — you build it inside an Encore service and call it from an API handler.
- **The seam:** Encore owns the request lifecycle (auth, DB, pubsub, HTTP/SSE); Eino owns the turn (`ctx` in → `*schema.Message` / `*schema.StreamReader` out). One Encore service package typically wraps one Eino agent build + a `ProcessTurn`/`ProcessTurnStream` entrypoint.

See `references/base.md` for the canonical concepts that break everything if wrong, and `references/patterns.md` for verified 8syncdev go-kit patterns.

## Procedure

### 0. Ground before you touch code (code-intelligence first — mandatory)
> Per the 8sync CLI canon (see `8syncdev/auto-work-cloudgo`), structural queries replace blind grep/read. This is the single biggest token saver in a generated-code-heavy Encore repo.

1. Index the Encore app once: `codegraph index .` at the repo root (the dir holding `encore.app`).
2. Map the generated API surface — `encore.gen.go` is the source of truth for declared endpoints/types:
   - `codegraph query` for symbols in `encore.gen.go` (cbm / serena below only if enabled via `8sync harness cbm|serena on`); or `mcp__codebase_memory_mcp_search_graph` / `semantic_query` to find services and their callers.
   - `mcp__codebase_memory_mcp_get_architecture` for the service→service call graph (Encore services call each other via the generated client, so the graph *is* the dependency map).
3. For a service you are about to edit: `mcp__serena_find_symbol` / `find_referencing_symbols` to get every caller of an API before changing its signature (signature change ⇒ `encore.gen.go` regenerates ⇒ all callers must recompile).
4. Compress any tool dump > ~50 lines with `mcp__headroom_compress` before reasoning over it.

### 1. Define / extend an Encore service
1. A service = a package with `//encore:service` and an optional bootstrap:
   ```go
   //encore:service
   type Service struct{}
   func initService() (*Service, error) {
       // load secrets, warm caches, bootstrap key pools — runs before first request
       return &Service{}, nil
   }
   ```
2. Add an API (the annotation *is* the route — no router registration):
   ```go
   //encore:api public method=POST path=/mypkg.DoThing
   func DoThing(ctx context.Context, req *ThingReq) (*ThingResp, error) { ... }
   ```
   Access modifiers: `public` (anyone), `auth` (requires the auth handler), `private` (Encore-internal / cron / pubsub only). Use `raw` for full `http.ResponseWriter` control (SSE, file streaming).
3. After **any** signature/annotation change, run `encore run` (dev) or `encore build` — Encore regenerates `encore.gen.go`. **Never hand-edit `encore.gen.go`.** Confirm it is gitignored (it is regen-only).

### 2. Typed SQL + migrations
1. Declare a named DB: `var db = sqldb.Named("my_db")` (the name maps to an Encore infra DB; local dev uses Encore's built-in Postgres).
2. Migrations live in `<service>/migrations/<n>_name.up.sql` (+ optional `.down.sql`), applied in order. Schema changes = new migration files, never `ALTER` in app code.
3. Typed queries: `db.QueryRow(ctx, "...", args...).Scan(...)`, `db.Exec`, `db.Query` (iterate `rows.Next()`). See `references/patterns.md` §SQL.

### 3. Encore infra primitives (annotation-driven)
- **Secret:** `var secrets struct { FooKey string }` → set via `encore secret set --type prod,dev,pr,local FooKey`. Read `secrets.FooKey`; never log the value.
- **Cron:** `cron.NewJob("id", cron.JobConfig{Every: 1*cron.Minute, Endpoint: MySweep})` where `MySweep` is a `//encore:api private` func.
- **PubSub:** publish = `pubsub.NewTopic[*Evt]("topic", pubsub.TopicConfig{DeliveryGuarantee: pubsub.AtLeastOnce})` then `topic.Publish(ctx, ev)`. Consume = `pubsub.NewSubscription(topic, "worker", pubsub.SubscriptionConfig[*Evt]{AckDeadline: ..., Handler: fn})`. Set `AckDeadline` ≥ your handler's worst-case latency or the broker will redeliver mid-run.
- **Auth:** one `//encore:authhandler` `func(ctx, *AuthParams) (auth.UID, *AuthData, error)` reads headers/cookies; any `//encore:api auth` endpoint is gated by it. Return `errs.Unauthenticated` on failure (never a bare error — Encore treats other codes as a hard abort).

### 4. Build the Eino pipeline (LLM orchestration)
1. **ChatModel** via the matching `eino-ext` component, keyed off a resolved config + provider key:
   ```go
   import ( openaimodel "github.com/cloudwego/eino-ext/components/model/openai"
            "github.com/cloudwego/eino/components/model" )
   cm, err := openaimodel.NewChatModel(ctx, &openaimodel.ChatModelConfig{
       APIKey: key, BaseURL: baseURL, Model: name, Timeout: 60*time.Second, })
   ```
   Dispatch by provider API flavor (OpenAI-compatible base_url vs Gemini), not by vendor name. Cache constructed models per (provider,model,key).
2. **Tools** from plain Go funcs: `utils.InferTool(name, desc, fn)` → `tool.BaseTool`. Assemble a registry `map[string]tool.BaseTool`.
3. **ReAct agent** from the ChatModel + toolset:
   ```go
   import ( "github.com/cloudwego/eino/compose"
            "github.com/cloudwego/eino/flow/agent/react" )
   agent, err := react.NewAgent(ctx, &react.AgentConfig{
       ToolCallingModel: cm,
       ToolsConfig: compose.ToolsNodeConfig{Tools: toolset, ExecuteSequentially: true},
       MaxStep: maxStep,
   })
   ```
   Set `ExecuteSequentially: true` when write-tools share mutable per-turn state (guards, idempotency stamps) — Eino's default runs one message's tool calls concurrently.
4. **Stream:** `sr, err := agent.Stream(ctx, msgs)` returns `*schema.StreamReader[*schema.Message]`; relay chunks to the client. Non-streaming: `agent.Generate(ctx, msgs)`.
5. **Retriever/embedder** for RAG: implement the Eino `Retriever`/`Embedder` component interface (or call a provider `/embeddings` endpoint), store vectors in Postgres (`pgvector`), filter `WHERE embedding <=> $1 < k`.

### 5. Host the Eino pipeline as an Encore service
- Put the Eino build (model factory, tool registry, agent) in one service package; expose `ProcessTurn` / `ProcessTurnStream` as package-level funcs.
- An `//encore:api raw` (or `private` + a `raw` SSE shim) endpoint receives the request, builds/looks-up the agent, and either `Generate`s once or relays a `StreamReader` as SSE frames. Long turns (>~30s) should run **async via PubSub**: the entrypoint `//encore:api public` ACKs immediately and publishes a turn event; a pubsub worker calls `ProcessTurn` and delivers the reply out-of-band.
- Keep LLM keys in `secrets`/DB, never in code. Bootstrap the key pool from a secret in `initService`.

### 6. Build loop with engine_* (verify-driven)
1. Plan the work with `engine_plan` (goal → slices → tasks, each task's verify = a real command).
2. `engine_next` → make the edit → `engine_verify` runs the verify commands. Use these as the gate:
   - `go build ./...` — compiles the Encore app + regenerated client.
   - `encore test` (or `go test ./...`) — Encore's test harness provisions the real local DB/infra.
   - `encore gen` / a boot of `encore run` — regenerates `encore.gen.go` to confirm gen matches declared APIs.
3. `engine_advance` marks the task done (commits when configured). Every task MUST pass its verify before advance.

### 7. Verify the running service (smoke, not a unit test)
1. `encore run` boots the app + local Postgres + applies migrations; note the local base URL (default `http://127.0.0.1:4000`).
2. Hit a `public` endpoint: `curl -X POST http://127.0.0.1:4000/mypkg.DoThing -d '{...}'`. For an `auth` endpoint, obtain a token from your login endpoint first (or use the `X-Access-Key`/cookie lane your auth handler accepts).
3. For a streaming turn: `curl -N` against the SSE endpoint and confirm `token` frames arrive incrementally, then a terminal `done` frame.
4. If there is an admin/dashboard UI, drive it with `browser` (`open` → `run`: observe the accessibility tree, exercise the changed path, screenshot for visual confirmation). Browser is for the human-facing surface; the API contract is verified by `curl`/`browser.run` fetch.

## Acceptance check
- [ ] `encore run` boots cleanly; migrations apply; no startup panics.
- [ ] `encore test` (or `go test ./...`) is green.
- [ ] `go build ./...` succeeds.
- [ ] `encore.gen.go` is freshly regenerated and matches every declared `//encore:api`/service — no stale gen, never hand-edited (gitignored).
- [ ] At least one endpoint exercises the Eino graph end-to-end: a request produces a model reply (non-stream) or a stream of `token`→`done` frames (stream). Tools, if declared, are invoked within the turn.
- [ ] No secrets, keys, or `__DB_ONLY` fallback values are committed.

## Non-goals
- Encore.ts (TypeScript). Noted as a sibling with a shared annotation model; not authored, not migrated here.
- Migrating an existing Encore.ts → Go codebase.
- Hand-editing or rewriting generated `encore.gen.go` (always regenerate).
- Reimplementing omp primitives — this skill composes `codegraph`, `mcp__codebase_memory_mcp_*`, `mcp__serena_*`, `engine_*`, `browser`, and `8sync` verbs; it adds Encore/Eino procedure on top, never replaces them.
