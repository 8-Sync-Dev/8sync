---
name: ui-ux
description: UI/UX và giao diện (design, redesign, frontend, landing, dashboard, component, a11y, responsive, animation, theme, UX copy) — điểm vào dễ gõ `/ui-ux <việc>`; chọn đúng skill chuyên sâu (impeccable là design system chuẩn của 8 Sync) rồi làm tới khi verify trên trình duyệt.
argument-hint: <việc UI/UX, vd "audit trang settings" | "redesign hero" | "thêm dark mode">
---
Việc: $ARGUMENTS

1. **Luôn mở `impeccable` trước** (design system chuẩn 8 Sync) và làm đúng bước Setup của nó (PRODUCT.md/DESIGN.md, register product/brand). Chọn lệnh con theo việc:
   - làm mới / tính năng UI → `craft` (hoặc `shape` nếu chỉ plan) · review UX có điểm → `critique` · kỹ thuật a11y/perf/responsive → `audit` · trước ship → `polish`
   - chuyển động → `animate` · màu → `colorize` · chữ → `typeset` · bố cục → `layout` · copy → `clarify` · mobile/tablet → `adapt` · chậm → `optimize` · rối → `distill`
2. Bổ trợ khi khớp (mở SKILL.md nếu có trong `/` list):
   - Landing/portfolio, chống "AI slop" → `taste-skill` (design-taste-frontend)
   - Code React/Next/Tailwind/shadcn → `frontend-ui-engineering`, `senior-frontend`, `nextjs-app`; kho workspace (nếu đã `8sync ccc kit --skills-from`): `frontend-design`, `web-design-guidelines`, `react-best-practices`, `shadcn`, `tailwind-design-system`, `accessibility`, `responsive-design`, `core-web-vitals`, `site-ux-audit`
   - Verify trên trình duyệt → `browser-testing-with-devtools` / `/chrome`; không có trình duyệt → ghi "UI: not verified in a browser".
3. Build nặng (`next build`, `pnpm build`) chạy trên CI, không trên máy owner. Kiểm nhẹ ở local: `tsc --noEmit`, test component, lint (nice/ionice).
4. Báo lại: skill đã dùng (cite `SKILL.md`), file đổi, ảnh chụp/bằng chứng, cái gì chưa verify.
