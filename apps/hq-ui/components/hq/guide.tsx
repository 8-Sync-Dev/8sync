"use client";

import { BellRingIcon, BotIcon, CircleDotIcon, CoffeeIcon, HourglassIcon, MessagesSquareIcon, PowerIcon, SendIcon, TerminalIcon, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type GuideStep = { icon: LucideIcon; title: string; body: string };

export const GUIDE_STEPS: GuideStep[] = [
  {
    icon: BotIcon,
    title: "Mỗi bot là một session của anh",
    body: "Mỗi session Claude Code hoặc omp anh mở là một bot; HQ không tự mở phòng nào. Danh sách bot nằm bên trái (trên điện thoại là mục Bots ở thanh dưới), xếp theo dự án, bot chờ anh lên đầu. Bấm Bot mới để mở bot từ một mẫu trong một thư mục.",
  },
  {
    icon: SendIcon,
    title: "Nhắn một bot",
    body: "Bấm một bot để mở trang của nó rồi gõ tin ở tab Chat; gõ @ để gọi bot khác hoặc chèn file. Tin đi thẳng vào terminal hoặc inbox của bot.",
  },
  {
    icon: TerminalIcon,
    title: "Theo dõi",
    body: "Trang bot có Nhật ký từng bước nó làm, Lịch sử phiên (worktree, phiên con), Bản đồ code của repo và Đang biết gì. Nút Terminal mở terminal của bot.",
  },
  {
    icon: BellRingIcon,
    title: "Chỉ trả lời việc cần anh",
    body: "Bot chờ anh có nhãn Chờ anh và đứng đầu danh sách; câu hỏi hoặc xin quyền của nó hiện ngay trong Chat, kèm cách mở terminal để trả lời.",
  },
  {
    icon: MessagesSquareIcon,
    title: "Nhóm, Tìm và Thêm",
    body: "Nhóm: vài bot cùng một khung chat, anh @ bot nào thì bot đó nhận. Tìm: tìm bot, nhóm và phiên. Thêm: Tổng quan, Văn phòng, Phiên & dự án, Máy và các trang khác. Trên điện thoại bốn mục này nằm ở thanh dưới.",
  },
  {
    icon: PowerIcon,
    title: "Mở HQ",
    body: "`8sync hq ui [--public]` mở HQ (--public in link internet để mở từ điện thoại: link đăng nhập dùng trong 10 phút, đã vào thì giữ 12 giờ; `8sync hq ui --relink` in link mới, địa chỉ không đổi).",
  },
];

export const GUIDE_LEGEND: { icon: LucideIcon; label: string; hint: string }[] = [
  { icon: CircleDotIcon, label: "Đang làm", hint: "đang chạy việc" },
  { icon: BellRingIcon, label: "Chờ anh", hint: "chờ anh trả lời hoặc duyệt" },
  { icon: CoffeeIcon, label: "Rảnh", hint: "chưa có việc" },
];

export const GUIDE_TIPS: string[] = [
  "/do cho việc nhỏ (sửa nhanh, đổi tên): một lượt, không cần plan.",
  "/ship-loop cho việc chạy dài: luôn đặt giới hạn (số vòng, số phút) để không tốn thêm.",
  "Dùng Haiku cho test và việc lặp lại: rẻ và nhanh.",
];

const KEY = "hq.guide.seen";

function seen(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return true; // can't remember -> don't nag
  }
}

function markSeen() {
  try {
    localStorage.setItem(KEY, "1");
  } catch {
    /* private mode */
  }
}

/** "Lần đầu?" — true once on a browser that never closed the guide. */
export function useGuideFirstRun(): [boolean, () => void] {
  const [first, setFirst] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage only exists on the client
    setFirst(!seen());
  }, []);
  return [first, () => setFirst(false)];
}

export function Guide({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) markSeen();
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Cách dùng</DialogTitle>
          <DialogDescription>Lần đầu? Làm theo {GUIDE_STEPS.length} bước này.</DialogDescription>
        </DialogHeader>
        <ol className="flex flex-col gap-3">
          {GUIDE_STEPS.map((s, i) => (
            <li key={s.title} className="flex gap-3">
              <s.icon className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
              <div>
                <p className="text-sm font-medium">
                  {i + 1}. {s.title}
                </p>
                <p className="text-sm text-muted-foreground">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
        <section>
          <h3 className="mb-2 text-sm font-medium">Ý nghĩa biểu tượng</h3>
          <ul className="grid gap-1.5 text-sm sm:grid-cols-2">
            {GUIDE_LEGEND.map((l) => (
              <li key={l.label} className="flex items-center gap-2">
                <l.icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="font-medium">{l.label}</span>
                <span className="text-muted-foreground">{l.hint}</span>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h3 className="mb-2 flex items-center gap-2 text-sm font-medium">
            <HourglassIcon className="size-4 text-muted-foreground" aria-hidden />
            Mẹo tiết kiệm
          </h3>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {GUIDE_TIPS.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </section>
      </DialogContent>
    </Dialog>
  );
}
