"use client";

import { BellRingIcon, CircleDotIcon, CoffeeIcon, FolderPlusIcon, HourglassIcon, MessagesSquareIcon, PowerIcon, SendIcon, TerminalIcon, type LucideIcon } from "lucide-react";
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
    icon: FolderPlusIcon,
    title: "Phòng là session của anh",
    body:
      "Mỗi session Claude Code hoặc omp anh mở là một phòng; HQ không tự mở phòng nào. Dự án có phòng tự hiện bên trái; thêm thư mục ở đó để mở session mới từ tab Sessions.",
  },
  {
    icon: SendIcon,
    title: "Nhắn một phòng",
    body: "Bấm tên phòng để mở Chat phòng rồi gõ tin: tin gõ thẳng vào terminal của phòng hoặc vào inbox của nó. Ở Preview, “Hỏi về ảnh này” gửi ảnh có ghim cho một phòng.",
  },
  {
    icon: TerminalIcon,
    title: "Theo dõi",
    body: "Văn phòng: mỗi phòng đang làm gì. Bấm tên phòng ở bên trái để xem Nhật ký từng bước nó làm, hoặc mở terminal của phòng.",
  },
  {
    icon: BellRingIcon,
    title: "Chỉ trả lời việc cần anh",
    body: "Khung “Anh cần trả lời” hiện câu hỏi và xin quyền của mọi phòng đang dừng chờ anh, kèm cách mở terminal để trả lời.",
  },
  {
    icon: MessagesSquareIcon,
    title: "Chat",
    body: "Tab Chat xem các phòng nhắn nhau và tin anh gửi, theo thời gian.",
  },
  {
    icon: PowerIcon,
    title: "Mở HQ",
    body: "`8sync hq ui [--public]` mở HQ (--public in link internet để mở từ điện thoại, hết hạn sau 12 giờ).",
  },
];

export const GUIDE_LEGEND: { icon: LucideIcon; label: string; hint: string }[] = [
  { icon: CircleDotIcon, label: "Đang làm", hint: "đang chạy việc" },
  { icon: BellRingIcon, label: "Cần bạn", hint: "chờ bạn trả lời hoặc duyệt" },
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
          <DialogDescription>Lần đầu? Làm theo 5 bước này.</DialogDescription>
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
