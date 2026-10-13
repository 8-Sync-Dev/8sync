# hq-ux-r3: spatial/pixel-office vs list for many agents (read 2026-10-13)
| # | Claim (quote) | Source | Date | Confidence |
|---|---|---|---|---|
| S1 | AI Town: "a virtual town where AI characters live, chat and socialize"; rendered with PixiJS; pixel art 16x16 tilesets; UI can "freeze & unfreeze the world with a button"; sim pauses after 5 min inactivity. It is a social-sim starter kit, not a monitoring tool. | https://github.com/a16z-infra/ai-town | 2026-10-13 | high |
| S2 | Smallville paper: "an interactive sandbox environment inspired by The Sims", town of 25 agents; interaction = conversation, not ops monitoring. | https://arxiv.org/abs/2304.03442 | 2026-10-13 | high |
| S3 | Smallville repo UI (via search summary, mirrors, not fetched from official repo): map + list of active agents, simple sprite avatars, replay "primarily intended for debugging", speed 1-5, one step = 10 s. Even the original pairs map WITH a list. | https://github.com/joonspk-research/generative_agents (secondary summary) | 2026-10-13 | low-medium |
| S4 | Pixel Agents (VS Code): "One agent, one character — every Claude Code terminal gets its own animated character." Poses = writing/reading/running commands; speech bubbles: "Visual indicators when an agent is waiting for input or needs permission." MIT. | https://github.com/martinmunozhr/pixel-agents (fork; upstream pablodelucca/pixel-agents, unconfirmed) | 2026-10-13 | high (README) |
| S5 | Pixel Agents limitation: status detection relies on heuristics and "often misfires"; terminal sync can drift. => decorative state that is wrong is worse than a plain label. | same as S4 | 2026-10-13 | high |
| S6 | Claude Office Visualizer: "Real-time pixel art office simulation that visualizes Claude Code operations"; boss=main agent, employees=subagents. Command Center "gathers the boss of every live terminal into one cross-session office" with columns "Needs-you, Working, Done, Ended" (appears when >=2 sessions). Also decorative extras: animated trashcan for context, printer, skyline day/night, whiteboard 12 modes. | https://github.com/paulrobello/claude-office | 2026-10-13 | high (README) |
| S7 | Other (non-pixel) visualizers exist: Agents Observe (hook stream dashboard, session replay), Claude-Code-Agent-Monitor (React+WebSocket), agent-viewer (Kanban for tmux agents). Not read directly. | search listing: sourcepulse.org/projects/29195119, /24936696 ; awesome.ecosyste.ms/projects/github.com%2Fsimple10%2Fagents-observe | 2026-10-13 | low (listing only) |
| S8 | Gather.town: no controlled study found on presence/awareness benefit. Only practitioner reports + vendor blogs; AoIR paper says it tried to recreate co-located interactions and "where it has not" worked (fetch failed; summary only). | https://spir.aoir.org/ojs/index.php/spir/article/download/12188/10324 (not fetched) | 2026-10-13 | low |
| S9 | NN/g: dashboard = "single-page view that imparts at-a-glance information on which users can act quickly"; consumed "with a minimum of interaction or cognitive processing"; "we are quite adept at estimating how lengths compare, and we can also accurately estimate position in a 2D space"; "color should not be used to communicate ... magnitude"; "circular visualizations require a lot of space to communicate little information." (Supports: position helps, but space-hungry decoration costs density.) | https://www.nngroup.com/articles/dashboards-preattentive/ | 2026-10-13 | high |
| S10 | Carbon status indicators: "Relying solely on color to convey status is insufficient"; combine >=2 of color/shape/symbol; "include both the icon and a label"; 3:1 contrast; severity High (action required) / Medium / Low; "When statuses are consolidated, use the highest-attention color"; "More than five or six indicators can make it harder for users to focus"; shape indicators "suit smaller spaces and scanning large data sets". | https://carbondesignsystem.com/patterns/status-indicator-pattern/ | 2026-10-13 | high |
| S11 | Carbon toast: "non-modal, time-based window elements used to display short messages"; use "sparingly because they interrupt"; auto-close ~5 s; "should always be easily dismissed"; info must be reachable later; critical/error -> inline notification that persists. | https://carbondesignsystem.com/components/notification/usage/ | 2026-10-13 | high (page paraphrased by fetch tool; "sparingly" is paraphrase) |
| S12 | Material snackbar: keep short, auto-dismiss, "Don't use for critical information" (persistent element instead), one at a time, accessible. No exact timing on page. | https://m3.material.io/components/snackbar/guidelines | 2026-10-13 | medium (fetch-tool summary) |
| S13 | Toast guidance (various): min ~5 s, 3-7 s by length; don't auto-dismiss things user must reference; sticky for errors; pause timer on hover/focus is a proposal only; one contributor argues auto-dismiss may violate WCAG 2.2.1 (opinion). | https://spectrum.adobe.com/page/toast ; https://lists.w3.org/Archives/Public/w3c-wai-ig/2025AprJun/0069.html | 2026-10-13 | low-medium |
| S14 | Calm technology (Case) 8 principles: 1 "Technology should require the smallest possible amount of attention"; 2 "inform and create calm"; 3 "make use of the periphery"; 5 "can communicate, but doesn't need to speak"; 6 "should work even when it fails"; 7 "The right amount of technology is the minimum needed to solve the problem". | https://www.caseorganic.com/post/principles-of-calm-technology (also calmtech.institute/calm-tech-principles, timed out) | 2026-10-13 | high |
| S15 | WCAG 2.2.2 Pause, Stop, Hide is Level A: moving/blinking/scrolling content that starts automatically, lasts >5 s, alongside other content needs pause/stop/hide; auto-updating content needs pause/stop/hide or frequency control, unless essential. W3C Understanding page 403'd; text from search summary of W3C page. | https://www.w3.org/WAI/WCAG20/Understanding/pause-stop-hide (403 to fetch) | 2026-10-13 | medium (verify verbatim) |
| S16 | WCAG 2.3.3 Animation from Interactions is Level AAA (motion from interaction can be disabled unless essential); stated by fetch tool from general knowledge, not page. | https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html (403) | 2026-10-13 | medium-low |
| S17 | MDN prefers-reduced-motion: detects "a user has enabled a setting ... to minimize the amount of non-essential motion"; "Animations such as scaling or panning large objects can be vestibular motion triggers." | https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion | 2026-10-13 | high |

## What works (evidence-backed)
- Character = session, 1:1 (S4, S6). Glanceable via pose + bubble for "needs you" (S4, S6).
- Triage buckets Needs-you/Working/Done/Ended (S6) aligns with Carbon attention tiers (S10).
- Status never color-only; icon+label; highest-attention wins when consolidated (S10).
- Position/length scan fast (S9); periphery + minimum attention (S14).

## What hurts
- Decorative motion/extras (trashcan, printer, skyline, S6) = low density, and auto-moving content triggers WCAG 2.2.2 pause control (S15) and vestibular concerns (S17).
- Heuristic-driven wrong states (S5): trust loss.
- Scaling: Carbon warns >5-6 indicators hurt focus (S10); no evidence found that pixel offices scan well at 10+ agents (inference only).
- Toasts for status: interrupt, vanish (S11, S12).

## Recommended hybrid (inference from S4-S14, not a sourced finding)
Thin office strip (one small sprite per session, static by default, animate only on state change, respect prefers-reduced-motion + a pause toggle) above a dense sortable list (icon+label status, age, task, needs-you first). Attention only via persistent badge/count for Needs-you; toasts only for low-priority, never sole channel.

## Contradictions
- Auto-dismiss toast vs WCAG 2.2.1 debated (S13); 5 s vs 3-7 s timing.
- Pixel Agents upstream attribution unclear (fork vs pablodelucca).

## Not found
- Any HCI/NN-g study comparing spatial/avatar vs list dashboards for multi-agent monitoring.
- Controlled Gather.town awareness study.
- Official-repo read of Smallville UI; verbatim WCAG 2.2.2/2.3.3 text (W3C 403); NN/g piece on notification fatigue; Material toast timing numbers.
