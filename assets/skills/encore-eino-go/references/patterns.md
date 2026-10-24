# patterns.md — REAL patterns from 8syncdev repos

Every pattern below is cited `repo:path` and was read from the repo (not invented). Primary source: **`8syncdev/agentic-cloudgo-v1`** — a production Encore.go + Eino backend ("go-kit"). All citations are `8syncdev/agentic-cloudgo-v1:<path>` unless a different repo is named. Versions verified in its `be/go.mod`: `encore.dev v1.57.5`, `github.com/cloudwego/eino v0.9.5`, `eino-ext/.../openai v0.1.13`, `eino-ext/.../gemini v0.1.32`.

---

## P1. Encore service + bootstrap (`//encore:service` + `initService`)

`8syncdev/agentic-cloudgo-v1:be/agent/service.go` — a service is a package with a `//encore:service` type and an optional bootstrap that runs before the first request. The bootstrap here loads the LLM key pool from a secret:

```go
//encore:service
type Service struct{}

func initService() (*Service, error) {
    models.BootstrapKeys(context.Background()) // upserts secrets.LLMSeedKeys → llm_api_keys
    return &Service{}, nil
}
```
**Lesson:** `initService` is the right hook to warm a model key pool / cache from a secret; it must be best-effort so a missing secret never blocks startup.

## P2. API declarations — `//encore:api` access levels + `raw` SSE

`8syncdev/agentic-cloudgo-v1:be/chat/qa_api.go` — the annotation carries access level, method, and path; `raw` gives full `http.ResponseWriter` control (used for SSE/export):

```go
//encore:api auth method=GET path=/qa/sessions
//encore:api auth method=PATCH path=/qa/sessions/:sessionID
//encore:api auth raw method=GET path=/qa/feedback/export   // full ResponseWriter → file/stream
```
`8syncdev/agentic-cloudgo-v1:be/chat/enqueue.go` — a `private` API is the cron/pubsub entrypoint (not internet-reachable):
```go
//encore:api private method=POST path=/chat.EnqueueMessage
```
`8syncdev/agentic-cloudgo-v1:be/iam/auth_api.go` — a `public` login endpoint that issues a JWT:
```go
//encore:api public method=POST path=/auth/login
func Login(ctx context.Context, req *LoginRequest) (*LoginResponse, error)
```
**Lesson:** access level is part of the annotation, not middleware; `private` is how cron/pubsub workers expose their handler; `raw` is the only way to stream bytes.

## P3. Typed SQL + named DB + versioned migrations

`8syncdev/agentic-cloudgo-v1:be/engine/pipeline.go` — a named DB is a package value:
```go
var agentDB = sqldb.Named("agent_db")
```
`8syncdev/agentic-cloudgo-v1:be/chat/followup.go` — atomic claim-and-update via `UPDATE ... RETURNING`, iterating `rows.Next()`:
```go
rows, err := chatDB.Query(ctx, `
    UPDATE sessions SET next_followup_at = NULL, followup_count = followup_count + 1
    WHERE id IN (SELECT id FROM sessions WHERE next_followup_at IS NOT NULL
                 AND next_followup_at < NOW() ORDER BY next_followup_at LIMIT 20)
    RETURNING id::text, bot_id, key_customer`)
```
`8syncdev/agentic-cloudgo-v1:be/agent/migrations/` — schema lives as numbered `N_name.up.sql` files (64+ migrations: `1_init.up.sql` … `64_proactive_close.up.sql`). `8syncdev/agentic-cloudgo-v1:be/agent/migrations/1_init.up.sql` shows the `agents`/`llm_providers`/`llm_models`/`llm_api_keys` DDL that the Eino config is read from at runtime.
**Lesson:** every schema change is a new numbered migration; `sqldb.Named` maps to an Encore infra DB whose connection string is infra config (`be/infra.config.json` lists `core_db`, `agent_db`, `chat_db`, `kb_db`), never code.

## P4. Secrets — `var secrets struct{}` + `encore secret set`

`8syncdev/agentic-cloudgo-v1:be/engine/models/keys_bootstrap.go`:
```go
// set via: encore secret set --type prod,dev,pr,local LLMSeedKeys
var secrets struct { LLMSeedKeys string }   // JSON array of provider API keys
```
`8syncdev/agentic-cloudgo-v1:be/iam/auth_api.go`:
```go
var secrets struct { JWTSecret string }
```
`8syncdev/agentic-cloudgo-v1:be/infra.config.json` enumerates all secrets (`JWTSecret`, `LLMSeedKeys`, `CRMAccessKey`, `CRMWebhookSecretKey`, `CRMTokenFallback`) — DB-only fallbacks are marked `__DB_ONLY_NO_FALLBACK__`.
**Lesson:** declare the struct, set the value out-of-band, read the field; multi-valued secrets hold JSON unmarshalled in bootstrap; never commit real values.

## P5. CRON job → private API sweep

`8syncdev/agentic-cloudgo-v1:be/chat/followup.go` — `cron.NewJob` points `Endpoint` at a `private` API:
```go
var _ = cron.NewJob("silence-followup-sweep", cron.JobConfig{
    Title:    "Queue silence-followup nudges",
    Every:    1 * cron.Minute,
    Endpoint: SweepSilenceFollowups,        // //encore:api private method=POST path=/chat.SweepSilenceFollowups
})
```
**Lesson:** the cron body is just a `private` API; the `Endpoint` field is the typed func reference, not a URL string.

## P6. PubSub — topic + subscription with explicit AckDeadline

`8syncdev/agentic-cloudgo-v1:be/chat/enqueue.go` (topic) + `be/chat/followup.go` (subscription):
```go
var TurnTopic = pubsub.NewTopic[*TurnEvent]("chat-turns",
    pubsub.TopicConfig{DeliveryGuarantee: pubsub.AtLeastOnce})

// AckDeadline ≥ handler worst-case (120s ProcessTurn cap + DB reads); default 30s
// would cancel a nudge mid-Generate.
var _ = pubsub.NewSubscription(FollowupTopic, "silence-followup-worker",
    pubsub.SubscriptionConfig[*FollowupEvent]{AckDeadline: 150 * time.Second, Handler: handleFollowup})
```
`be/infra.config.json` lists six topic/subscription pairs (`chat-turns`, `chat-post-process`, `silence-followup`, `chat-auto-lesson`, `embed-document`, `kb-ingest-job`).
**Lesson:** `AckDeadline` is a correctness knob — too short silently redelivers/cancels a long LLM turn. The async pattern (entrypoint `public` ACKs immediately → publishes turn → worker runs the agent) is how a "don't block the lane" requirement is met.

## P7. Auth handler — `//encore:authhandler`, multi-lane, `errs.Unauthenticated`

`8syncdev/agentic-cloudgo-v1:be/iam/auth_gate.go` — one handler accepts three credential shapes via header/cookie struct tags, returns `auth.UID` + custom `*authz.AuthData`:
```go
type AuthParams struct {
    AccessKey     string       `header:"X-Access-Key"`
    Authorization string       `header:"Authorization"`
    Session       *http.Cookie `cookie:"cg_jwt"`
}

//encore:authhandler
func AuthGate(ctx context.Context, p *AuthParams) (auth.UID, *authz.AuthData, error) {
    // CRM lane (X-Access-Key) → auth.UID("crm:"+domainID)
    // Dashboard lane (Bearer/cookie JWT) → auth.UID("user:"+sub)
    return "", nil, &errs.Error{Code: errs.Unauthenticated, Message: "invalid credentials"}
}
```
**Lesson:** auth = annotation-enforced (any `//encore:api auth` endpoint is gated, no per-handler guard to forget); failure MUST be `errs.Unauthenticated` (other codes hard-abort even `public` endpoints).

## P8. Eino ChatModel factory — `eino-ext` openai/gemini, flavor-dispatched, cached

`8syncdev/agentic-cloudgo-v1:be/engine/models/factory.go` — dispatch by provider `api_flavor` (DB-driven), not vendor name; cache per (provider,model,key):
```go
import ( openaimodel "github.com/cloudwego/eino-ext/components/model/openai"
         geminimodel "github.com/cloudwego/eino-ext/components/model/gemini"
         "github.com/cloudwego/eino/components/model" )

const llmCallTimeout = 60 * time.Second  // eino-ext openai defaults to NO timeout → must set

func ChatModel(ctx context.Context, r ResolvedModel) (model.ToolCallingChatModel, error) {
    switch r.APIFlavor {
    case "openai":
        m, err = openaimodel.NewChatModel(ctx, &openaimodel.ChatModelConfig{
            APIKey: r.APIKey, BaseURL: r.BaseURL, Model: r.ModelName,
            Temperature: &temp, MaxTokens: &maxTok, Timeout: llmCallTimeout,
            // reasoning models: disable thinking / pin reasoning_effort via ExtraFields
            ExtraFields: map[string]any{"reasoning_effort": "none"},
        })
    case "gemini":
        m, err = geminimodel.NewChatModel(ctx, &geminimodel.Config{Client: client, ...})
    }
}
```
**Lesson:** eino-ext's openai component has **no default timeout** — set one or a hung upstream hangs the turn worker forever. Reasoning models (GLM, gpt-5) need provider-specific `ExtraFields` to avoid empty/slow responses.

## P9. Eino tools from plain Go funcs — `utils.InferTool` + registry

`8syncdev/agentic-cloudgo-v1:be/engine/tools/registry.go`:
```go
import ( "github.com/cloudwego/eino/components/tool"
         "github.com/cloudwego/eino/components/tool/utils" )

func mustTool[P, R any](name, desc string, fn func(context.Context, P) (R, error)) tool.BaseTool {
    t, err := utils.InferTool(name, desc, traced(name, fn)) // wraps with provenance recording
    return t
}
func Registry(ctx context.Context, domainID string) map[string]tool.BaseTool {
    return map[string]tool.BaseTool{"saveTicket": ..., "searchKnowledge": ..., "handoff": ...}
}
```
**Lesson:** tool ids here are the SAME strings used in DB-seeded `tool_allowlist` and dashboard graph nodes — the registry is the single source of tool identity across config, model, and UI.

## P10. Eino ReAct agent — `flow/agent/react` + `compose.ToolsNodeConfig`

`8syncdev/agentic-cloudgo-v1:be/engine/react_helpers.go` — one shared config for primary/stream/escalation builds:
```go
import ( "github.com/cloudwego/eino/compose"
         "github.com/cloudwego/eino/flow/agent/react" )

func newReactAgent(ctx context.Context, cm model.ToolCallingChatModel,
    toolset []tool.BaseTool, maxStep int, returnDirectly map[string]struct{}) (*react.Agent, error) {
    return react.NewAgent(ctx, &react.AgentConfig{
        ToolCallingModel: cm,
        ToolsConfig: compose.ToolsNodeConfig{
            Tools: toolset, ExecuteSequentially: true, // deliberate: write-tools share per-turn state
        },
        MaxStep:            maxStep,
        ToolReturnDirectly: returnDirectly,
    })
}
```
**Lesson:** `ExecuteSequentially: true` is chosen here because write-tools guard shared mutable per-turn state (idempotency stamps, `ClaimOnce`); Eino's default parallel execution could let two tools pass a gate the turn allows once. The comment in-repo quantifies the tradeoff (≈0.9s/turn vs ~5s saved) — copy that discipline, don't flip it blindly for speed.

## P11. Eino streaming — `agent.Stream` + `schema.StreamReader` → SSE

`8syncdev/agentic-cloudgo-v1:be/engine/pipeline_stream.go`:
```go
agent, err := newReactAgent(ctx, cm, toolset, maxStep, nil)
sr, err := agent.Stream(ctx, msgs)                      // *schema.StreamReader[*schema.Message]
reply, usage, _, err := relayStream(sr, emit, hold, releaseEarly)  // pulls Recv() → SSE frames
```
`StreamTurn(w http.ResponseWriter, r *http.Request)` is the `raw` SSE endpoint that calls `ProcessTurnStream(r.Context(), &req, emit)`.
**Lesson:** the Encore seam is a `raw` handler → `ProcessTurnStream` → Eino `agent.Stream` → `StreamReader.Recv()` relayed as SSE `token`/`tool`/`rag`/`done` frames. The same agent build is shared by stream and non-stream lanes (P10).

## P12. Eino retriever/embedder for RAG (Encore-hosted)

`8syncdev/agentic-cloudgo-v1:be/kb/embed.go` + `be/engine/models/embedder.go` — embeddings stored in Postgres (`pgvector`), retrieved with `WHERE embedding <=> $1::vector < k`; the embedder config (model name, dims, base_url) is **DB-resolved** (`llm_models.kind='embedding'`), not a Go constant:
```go
_, err := db.Exec(ctx, `UPDATE kb_node SET embedding = $2::vector WHERE id = $1::uuid`, id, vec)
vecs, err := models.EmbedDocs(ctx, texts)   // OpenAI-compatible /embeddings call
```
**Lesson:** model + embedder selection is runtime config (DB rows + Encore secrets), enabling A/B and per-env routing without code changes (see migrations `36..40` swapping GLM/Gemini/gpt-5 models in `be/agent/migrations/`).

## P13. Declarative agent graph (JSONB) → resolved Eino config

`8syncdev/agentic-cloudgo-v1:be/pkg/agentgraph/agentgraph.go` — the dashboard edits a `{nodes, edges}` graph (agent/kernel/tool/memory/guardrail/retriever nodes) stored as JSONB; `agentgraph.Parse` validates it and produces a resolved `Config` (model, temperature, tool allowlist, retriever, reply mode) that the engine builds the Eino agent from.
**Lesson:** when agents are user-configurable, separate the *stored graph contract* (validation) from the *Eino build* (runtime) — `Parse` rejects malformed graphs before a turn ever starts.

---

## Workflow canon (8sync CLI / omp tooling) — `8syncdev/auto-work-cloudgo`

`8syncdev/auto-work-cloudgo:AGENTS.md` is the canonical statement of the code-intelligence-first workflow this skill inherits:
> `trail ask` / `trail callers` / `trail skeleton` replace blind grep/read; compress any >~50-line dump with `headroom` before it enters context.

In an Encore+Eino repo this is doubly important because `encore.gen.go` regenerates constantly — always read the *generated* surface through `trail skeleton`, and only `read` a raw file right before you edit it. (Note: `auto-work-cloudgo` is the 8sync CLI/agent harness, **not** an Encore app — cited here for the tooling workflow, not for Encore patterns.)

---

## zus-work — multi-app Encore workspace

`8syncdev/zus-work:backend/go.work` ties together multiple Encore apps (`./core`, `./gate`, `./shared`), each with its own `encore.app` (`backend/core/encore.app`, `backend/gate/encore.app`) and `go.mod`, plus a Rust native daemon for the control-plane (`backend/core/native/`, `backend/core/identity/`). This is the pattern for a monorepo where Encore backends coexist with a non-Go control plane: each Encore app is an independent `encore.app` unit composed via `go.work`, and the native daemon lives alongside as a sibling service.
