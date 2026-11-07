# Plan: hq-bots-groups (2026-11-07)

## Key questions
1. Luồng tạo bot: bot trước hay thư mục trước? (GPTs, Projects, Poe, BotFather, Slack apps, Copilot Studio, Cursor, Devin, Copilot coding agent, Grok)
2. Nhóm bot: membership + ai trả lời (Slack, Discord, Teams, Poe, ChatGPT group chats; AutoGen, CrewAI, LangGraph, Claude Code subagents/agent teams)
3. @bot trong chat bot khác: context, routing, chống loop, duyệt của owner → map vào HQ (`[từ phòng …]`, /api/brief, /api/chief/ask)
4. Template bot: catalogue chung + 8 Sync (cpa = content-post-agency), schema, nơi lưu local-first
5. UI messenger: FLIP, reduced motion, @mention combobox, group avatar, empty state, list→thread mobile

## Evidence needed
Docs chính thức / help center / source cho mỗi sản phẩm; code HQ (file:line) cho phần map.

## Scale decision
Lead tự search (direct), không fan-out: 5 câu hỏi hẹp, mỗi câu ≤10 call. Không verifier/reviewer agent (caller giới hạn: một doc, commit local); tự cite + tự review, ghi rõ ở provenance.

## Task ledger
- [x] HQ code map (trail): messages route, chief.ts, sessions POST, omp sessions POST, roles.ts, paths.ts, hq-control SKILL
- [x] cpa: content-post-agency AGENTS.md / .claude/commands/content-daily.md / skills cpa-*
- [x] Gather Q1–Q5 (web): 39 sources; also Telegram bot-to-bot and Claude Code cross-session messaging (loop guards)
- [x] Draft → cite → self-review → deliver `su-code/research/hq-bots-groups.md` + provenance

## Verification log
- Self-review: every (D) claim has ≥2 sources; unverified items carry "chưa kiểm"; fixed a Cursor branch claim that had no source in the list.
- HQ grep: no hop, rate or dedupe guard in deliver.ts or messages/route.ts.

## Decision log
- Deliver path theo caller: `su-code/research/hq-bots-groups.md`, provenance cạnh nó.
