---
name: deep-research
description: Source-heavy investigation of a topic or codebase that ends in a cited brief. Use when the user asks for deep research, a comparison, a multi-source investigation, an in-depth technical report, or "R&D to pick the best option". Token-lean - snippets before pages, compressed subagent returns, one artifact.
---

# Deep research v2 (token-lean)

Chất lượng đến từ nguồn primary và verify, không từ khối lượng. Mỗi token phải tìm nguồn, kiểm claim, hoặc vào brief.

## Tools (omp · Claude Code)
| Need | omp | Claude Code |
|---|---|---|
| Search | `web_search` | `WebSearch` |
| Read a page | `read <url>` (ranges `:N-M`) | `WebFetch` with a narrow prompt ("extract X, Y with quotes") |
| Code structure | `trail` | `trail ask` via Bash |
| Parallel workers | `task` with a `tasks[]` batch | `Agent` (`researcher`, `verifier`, `reviewer`), several in one message |
| Plan / ledger | `todo` | task list (`TaskCreate`) |

## Pipeline
1. **Plan file** `outputs/.plans/<slug>.md` (slug = 2-5 hyphenated words): key questions, evidence needed, scale decision, task ledger. Lookup ≤5 calls: trả lời inline, không file.
2. **Scale gate** (chọn nhỏ nhất đủ trả lời; không bao giờ nhiều worker hơn sub-question):
   - Lookup / "what is X": tự search, không fan-out.
   - So sánh 2-3 mục: 2 agent `researcher`.
   - Survey nhiều mặt: 3-4 `researcher`, mỗi agent một sub-question, một batch.
3. **Gather.** Search trước, đọc snippet, fetch có trích xuất (quote nguyên văn / line range), không paste cả trang. Việc đo được local (benchmark, script, API probe) thì chạy và ghi lệnh + kết quả. Researcher ghi notes ra file evidence, trả một dòng chứa path + tóm tắt ≤5 bullet `claim — URL|file:line — confidence`.
4. **Lead tự viết draft** `outputs/.drafts/<slug>-draft.md`: kết luận/khuyến nghị trước, evidence theo câu hỏi, caveats; so sánh dạng bảng; `## Sources` đánh số.
5. **Verify:** agent `verifier` thêm/kiểm citation -> `outputs/.drafts/<slug>-cited.md` (claim phải khớp đúng nguồn; thiếu căn cứ -> `[UNVERIFIED]`).
6. **Review:** agent `reviewer` chấm FATAL / MAJOR / MINOR trên bản cited. `reviewer` vốn là diff reviewer (BLOCKER/SHOULD/NIT + MERGEABLE): trong prompt phải đưa rubric FATAL/MAJOR/MINOR (FATAL≈BLOCKER, MAJOR≈SHOULD, MINOR≈NIT) và nói dòng MERGEABLE không áp dụng. Sửa mọi FATAL rồi review lại một lần; không lặp thêm.
7. **Final:** `outputs/<slug>.md` + `outputs/<slug>.provenance.md` (ngày, số vòng, nguồn đã đọc/không đọc được, đã đo gì, `[UNVERIFIED]` còn lại, kết quả verify/review). Bước nào fail (agent lỗi, hết nguồn) -> vẫn ghi output và đặt `Verification: BLOCKED` + lý do trong provenance.

## Rules
- Primary over secondary; newest version of docs; ghi ngày/phiên bản đã đọc.
- Quote số đúng nguồn, nói rõ nguồn; không làm tròn thành claim khác. Nguồn mâu thuẫn: nêu cả hai, nói tin cái nào và vì sao.
- Dừng một hướng sau 2 vòng không có gì mới.
- Không bao giờ gửi source repo private cho model/dịch vụ bên thứ ba khi chưa được user đồng ý — nghiên cứu code ở local.
- Câu hỏi về size/performance của native binary: `references/binary-weight-audit.md`.

<!-- Pipeline adapted from Feynman deepresearch.md (MIT, Copyright (c) 2026 Companion, Inc.; license text in THIRD_PARTY_NOTICES.md) -->
