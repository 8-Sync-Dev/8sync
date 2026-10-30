# /auto-team với 3 session con dùng ECC: tổ chức sao cho hiệu quả nhất

Question: Tổ chức /auto-team (trưởng nhóm + 3 session con, 100% ECC) để dùng hết 15 skill owner liệt kê mà tốn ít token, ít đụng nhau, ra kết quả kiểm được.
Ngày: 2026-10-30 · Độ tin cậy: Medium (nguồn web chủ yếu đọc qua đoạn trích; mô tả skill ECC đọc trực tiếp từ `ecc/2.2.3`).

## Bằng chứng
1. Orchestrator–worker: một lead chia việc lúc chạy, worker song song; lead Opus + subagent Sonnet thắng một agent đơn >90% trên eval nội bộ; token giải thích ~80% chênh lệch; hệ đa agent tốn ~15× token so với chat. Lỗi phối hợp sửa bằng brief giàu hơn (mục tiêu + ranh giới). — https://www.anthropic.com/engineering/multi-agent-research-system (qua tóm tắt https://blog.bytebytego.com/p/how-anthropic-built-a-multi-agent; số liệu chưa đọc nguyên văn: not verified)
2. Đa agent chỉ đáng khi việc độc lập; prompt tốt cho một agent đôi khi bằng cả kiến trúc nhiều agent. — https://www.claude.com/blog/building-multi-agent-systems-when-and-how-to-use-them
3. Agent teams: teammate không thừa hưởng context lead, mỗi teammate là một instance (token tăng theo số người), hai teammate sửa cùng file sẽ đè nhau. — https://code.claude.com/docs/en/agent-teams (qua https://www.morphllm.com/claude-code-agent-teams)
4. Evaluator–optimizer chỉ hiệu quả khi tiêu chí chấm rõ; vòng lặp cần trần + điều kiện dừng. — https://www.anthropic.com/research/building-effective-agents (qua https://agentpatterns.ai/agent-design/anthropic-effective-agents-framework/)
5. Mô tả skill ECC 2.2.3 (đọc trực tiếp `~/.claude/plugins/cache/ecc/ecc/2.2.3/skills/*/SKILL.md`):
   - `orch-pipeline` có **hai cổng người** (duyệt plan, xác nhận commit) và chỉ dùng gián tiếp qua `orch-*`.
   - `autonomous-loops` "Retained for compatibility only" → dùng `continuous-agent-loop`.
   - `autonomous-agent-harness` dựa trên cron/dispatch/memory của Claude Code → trùng `/team-tick`.
   - `agent-self-evaluation` chạy sau mỗi việc không tầm thường (chấm 5 trục).
   - `loop-design-check` thiết kế/kiểm loop: mục tiêu máy quyết được, chống chạy hoang.
   - `/ecc:auto-update` là command cập nhật chính plugin ECC.

## Đề xuất (suy luận từ bằng chứng trên)
**Đội hình 3 session con** — chỉ dùng khi dự án có ≥2 lane sửa độc lập; ít hơn thì `--rooms 2`.

| Session | Model | Việc | Skill ECC (gọi khi nào) |
|---|---|---|---|
| Trưởng nhóm (lane chính) | Opus | Viết BOARD, chia card, merge, mốc | `loop-design-check` khi lập mục tiêu/check · `continuous-agent-loop` cho nhịp `/team-tick` · `autonomous-agent-harness` chỉ phần memory/hàng đợi (cron vẫn là `/team-tick`) · `learn` cuối ngày |
| Build & Ship (lane 2) | Sonnet | Code card, CI, PR | `orch-fix-defect`/`orch-add-feature` (cổng plan/commit do trưởng nhóm trả lời qua tin) · `performance-optimization` khi card có số đo chậm · `security-scan` trước khi đẩy card sang review |
| Critic / QA | Sonnet | Chấm card theo AC, không sửa code | `agent-architecture-audit` khi card đụng agent/LLM · `agent-security-hardening` khi đụng hook/tool/credential · `automation-audit-ops` mỗi ngày một lần (hook, cron, MCP còn sống?) · `agent-self-evaluation` chấm output |
| R&D | Sonnet | Trả lời câu hỏi chặn card | `deep-research` · `market-research` · `marketing-campaign` (chỉ khi mục tiêu có ra mắt/marketing) |

Bỏ khỏi đội: `/ecc:auto-update` (owner tự chạy khi muốn nâng ECC); `autonomous-loops` (thay bằng `continuous-agent-loop`).

**Tối ưu token/hiệu quả**
- Skill nạp theo trigger trong brief, không nạp hết vào mọi prompt (đa agent đã ~15× token).
- Brief card: mục tiêu, file được sửa, AC, lệnh check exit 0, card ≤30 phút. Không có lệnh check → không giao.
- Mỗi session giữ thư mục riêng; sửa file người khác → nhắn qua trưởng nhóm.
- Vòng sửa–chấm giữa Build và Critic: tối đa 2 lượt rồi trưởng nhóm quyết (tránh loop vòng tròn).
- Máy quá tải (CPU >85% hoặc RAM >90%) hoặc sắp hết hạn mức → bớt R&D trước.

## Còn thiếu
- Chưa đọc nguyên văn hai bài Anthropic (chỉ qua tóm tắt) → số 90%/80%/15× là not verified.
- Chưa đo thực tế đội 3 session trên dự án của 8 Sync.
