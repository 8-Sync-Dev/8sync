"use client";

import {
  BellRingIcon,
  CheckCircle2Icon,
  CircleDotIcon,
  CoffeeIcon,
  EyeIcon,
  FolderPlusIcon,
  HourglassIcon,
  MessagesSquareIcon,
  SendIcon,
  TerminalIcon,
  type LucideIcon,
} from "lucide-react";
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
    title: "Chọn dự án và tạo nhân viên theo vai trò",
    body:
      "Chọn dự án, rồi tạo nhân viên theo vai trò. R&D, Plan, Architect dùng Opus (claude-opus-5-5) cho việc cần nghĩ sâu. " +
      "Fullstack, AI, Reviewer dùng Sonnet (claude-sonnet-5-5) cho việc code hằng ngày. " +
      "Tester, Quick dùng Haiku (claude-haiku-5-5) cho việc nhanh, lặp lại. Đúng model cho đúng việc thì chất lượng tốt mà vẫn tiết kiệm chi phí.",
  },
  {
    icon: SendIcon,
    title: "Giao việc",
    body: "Bấm \"Giao việc\", gõ việc cần làm, rồi chọn cách giao: một phiên cụ thể, theo vai trò (HQ tìm phiên đang chạy có vai đó, chưa có thì mở mới) hoặc cả dự án (mọi phiên đang chạy cùng nhận). Dòng cuối dialog nói rõ việc sẽ đi đâu.",
  },
  {
    icon: TerminalIcon,
    title: "Xem terminal trực tiếp",
    body: "Bấm vào bàn làm việc hoặc thẻ của một người để mở terminal của họ và xem họ đang làm gì ngay lúc đó.",
  },
  {
    icon: MessagesSquareIcon,
    title: "Chat tổng",
    body: "Mọi phòng (session) chung một cuộc chat: xem ai nhắn ai theo thời gian. Khi một người chuyển việc cho người khác, bạn sẽ thấy thẻ bàn giao (handoff) \"A → B\".",
  },
  {
    icon: BellRingIcon,
    title: "Cần bạn",
    body: "Khi nhân viên hỏi hoặc chờ bạn duyệt, mục \"Cần bạn\" sáng lên. Trả lời hoặc duyệt ngay trên web, không cần mở terminal.",
  },
];

export const GUIDE_LEGEND: { icon: LucideIcon; label: string; hint: string }[] = [
  { icon: CircleDotIcon, label: "Đang làm", hint: "đang chạy việc" },
  { icon: BellRingIcon, label: "Cần bạn", hint: "chờ bạn trả lời hoặc duyệt" },
  { icon: EyeIcon, label: "Chờ review", hint: "làm xong, chờ người kiểm" },
  { icon: CheckCircle2Icon, label: "Xong", hint: "đã hoàn thành" },
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
